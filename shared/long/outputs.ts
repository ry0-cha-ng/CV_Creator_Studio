import { diagnostic, type Diagnostic } from './diagnostics';
import type { RenderPlan } from './render-plan';
import { localizedText, type LongLanguage, type LongProject } from './schema';
import { SCENE_PURPOSE_LABEL } from './templates';
import { TICKS_PER_SECOND, formatChapterTime, formatSrtTime, frameToTicks, ticksToSec, type Ticks } from './time';

/**
 * 横動画の出力物（SRT・チャプター草案・meta・投稿文・ファイル名）。
 * すべて描画計画（最終フレーム時刻）から作り、編集用のマーカーやガイドは含めない。
 */

export const LONG_LANGUAGE_LABEL: Record<LongLanguage, string> = { ja: '日本語', en: 'English', ko: '한국어' };

const RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g;

export const safeFileSegment = (value: string): string =>
  value.replace(RESERVED, '').replace(/\s+/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 64);

export const yyyymmdd = (date: Date): string =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

/** {yyyymmdd}_{projectSlug}_long_{lang}_v{n} */
export const longBasename = (input: { date: Date; slug: string; language: LongLanguage; version: number; part?: string }): string => {
  const slug = safeFileSegment(input.slug) || 'video';
  const base = `${yyyymmdd(input.date)}_${slug}_long_${input.language}_v${input.version}`;
  return input.part ? `${base}_${safeFileSegment(input.part)}` : base;
};

/**
 * 同名を避ける版番号：既存のファイル名に、その版の名前で始まるものがない最小の番号（1〜999）。
 * 隠しファイル（先頭が「.」の中間ファイル）は数えない。
 */
export const nextVersionNumber = (existingNames: Iterable<string>, base: (version: number) => string): number => {
  const names = [...existingNames].filter((name) => !name.startsWith('.'));
  for (let version = 1; version < 1000; version += 1) {
    const prefix = base(version);
    // v1 と v10 を取り違えないよう、版の直後が区切り（_ または .）か終端のものだけを同じ版とみなす
    if (!names.some((name) => name === prefix || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}_`))) return version;
  }
  throw new Error('書き出しの版番号が上限に達しました');
};

const frameTicks = (plan: RenderPlan, frame: number): Ticks => frameToTicks(frame, plan.fps);

// ---------------------------------------------------------------------------
// SRT

/** 発話字幕と解説から SRT を作る（最終フレームの時刻）。range は部分書き出しの [from, to) フレーム */
export const buildSrt = (plan: RenderPlan, range?: { from: number; to: number }): string => {
  const offset = range?.from ?? 0;
  const end = range?.to ?? plan.durationInFrames;
  const cues = plan.captions
    .filter((caption) => caption.kind !== 'reaction')
    .map((caption) => ({
      from: Math.max(caption.from, offset),
      to: Math.min(caption.from + caption.duration, end),
      text: caption.text,
    }))
    .filter((cue) => cue.to > cue.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(frameTicks(plan, cue.from - offset))} --> ${formatSrtTime(frameTicks(plan, cue.to - offset))}\n${cue.text}\n`,
    )
    .join('\n');
};

// ---------------------------------------------------------------------------
// チャプター

export const CHAPTER_MIN_GAP_SEC = 10;

export type ChapterDraft = { text: string; entries: Array<{ time: string; title: string; seconds: number }>; diagnostics: Diagnostic[] };

/**
 * 有効な章の実際の開始時刻からチャプター草案を作る。
 * YouTube の有効条件（先頭 0:00・3項目以上・各10秒以上）は草案として警告するだけで保証しない。
 */
export const buildChapters = (plan: RenderPlan, projectId: string): ChapterDraft => {
  const diagnostics: Diagnostic[] = [];
  const entries = plan.chapters
    .filter((chapter) => chapter.inChapters && chapter.to > chapter.from)
    .map((chapter) => {
      const seconds = Math.floor(ticksToSec(frameTicks(plan, chapter.from)));
      return { id: chapter.id, seconds, time: formatChapterTime(seconds * TICKS_PER_SECOND), title: chapter.title || '（無題）' };
    });
  if (entries.length > 0 && entries[0]!.seconds !== 0) {
    entries[0] = { ...entries[0]!, seconds: 0, time: '0:00' };
  }
  for (let index = 1; index < entries.length; index += 1) {
    const gap = entries[index]!.seconds - entries[index - 1]!.seconds;
    if (gap < CHAPTER_MIN_GAP_SEC) {
      diagnostics.push(
        diagnostic(
          'CHAPTER_TOO_CLOSE',
          'warning',
          { kind: 'chapter', id: entries[index]!.id },
          `チャプター「${entries[index - 1]!.title}」と「${entries[index]!.title}」の間が ${gap} 秒です（10秒未満は YouTube で無効になることがあります）`,
          { suggestedAction: '章をチャプターから外すか、章の長さを見直してください' },
        ),
      );
    }
  }
  for (const entry of entries) {
    if (entry.title === '（無題）') {
      diagnostics.push(
        diagnostic('CHAPTER_RULES', 'warning', { kind: 'chapter', id: entry.id }, 'チャプター名が空です', { suggestedAction: '章の題名を入力してください' }),
      );
    }
  }
  if (entries.length > 0 && entries.length < 3) {
    diagnostics.push(
      diagnostic('CHAPTER_RULES', 'info', { kind: 'project', id: projectId }, 'チャプターが3つ未満です。YouTube ではチャプターとして表示されない場合があります'),
    );
  }
  return {
    text: entries.map((entry) => `${entry.time} ${entry.title}`).join('\n'),
    entries: entries.map(({ time, title, seconds }) => ({ time, title, seconds })),
    diagnostics,
  };
};

// ---------------------------------------------------------------------------
// 投稿文

export type CreditTrack = { title: string; artist: string; creditRequired: boolean; creditText: string };

/** 投稿文：ユーザーの説明文は変更せず、その後ろにチャプター・クレジットのブロックを足す */
export const buildPostText = (
  project: LongProject,
  language: LongLanguage,
  chapters: ChapterDraft,
  credits: CreditTrack[],
): string => {
  const title = localizedText(project.publishing.title, language) || localizedText(project.publishing.title, 'ja') || project.title;
  const description = localizedText(project.publishing.description, language);
  const heading = language === 'ja' ? 'チャプター' : language === 'ko' ? '챕터' : 'Chapters';
  const creditHeading = language === 'ja' ? 'BGM・効果音' : language === 'ko' ? 'BGM・효과음' : 'Music & SFX';
  const creditLines = credits
    .filter((track) => track.creditRequired)
    .map((track) => track.creditText.trim() || `${track.title}${track.artist ? ` / ${track.artist}` : ''}`);
  const blocks = [
    `【${language === 'ja' ? 'タイトル' : language === 'ko' ? '제목' : 'Title'}】`,
    title,
    '',
    `【${language === 'ja' ? '説明文' : language === 'ko' ? '설명' : 'Description'}】`,
    description,
  ];
  if (chapters.text) blocks.push('', `${heading}`, chapters.text);
  if (creditLines.length > 0) blocks.push('', creditHeading, ...creditLines);
  if (project.publishing.tags.length > 0) blocks.push('', project.publishing.tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '));
  return `${blocks.join('\n').trim()}\n`;
};

// ---------------------------------------------------------------------------
// meta.json・出力版の記録

export type LongExportMetaInput = {
  exportId: string;
  appVersion: string;
  exportedAt: string;
  basename: string;
  language: LongLanguage;
  project: LongProject;
  plan: RenderPlan;
  partial?: { fromFrame: number; toFrame: number };
  files: string[];
  captionMode: 'burn' | 'srt';
  withoutBgm: boolean;
  chapters: ChapterDraft;
  loudness: { measuredI: number | null; normalized: boolean };
  assetStamps: Record<string, { size: number; mtimeMs: number } | undefined>;
};

const secOf = (plan: RenderPlan, frame: number): number => Math.round(ticksToSec(frameTicks(plan, frame)) * 1000) / 1000;

export const buildLongMeta = (input: LongExportMetaInput): Record<string, unknown> => {
  const { project, plan } = input;
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  const chapterById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  const lineupById = new Map(project.lineups.map((lineup) => [lineup.id, lineup]));
  return {
    app: 'CV Creator Studio',
    appVersion: input.appVersion,
    format: 'long',
    exportId: input.exportId,
    exportedAt: input.exportedAt,
    projectId: project.id,
    projectTitle: project.title,
    projectUpdatedAt: project.updatedAt,
    longSchemaVersion: project.longSchemaVersion,
    basename: input.basename,
    language: input.language,
    output: { width: plan.width, height: plan.height, fps: plan.fps, captionMode: input.captionMode, withoutBgm: input.withoutBgm },
    durationSec: secOf(plan, input.partial ? input.partial.toFrame - input.partial.fromFrame : plan.durationInFrames),
    partial: input.partial ? { fromSec: secOf(plan, input.partial.fromFrame), toSec: secOf(plan, input.partial.toFrame) } : null,
    loudness: { targetLufs: -36.5, measuredLufs: input.loudness.measuredI, normalized: input.loudness.normalized },
    template: project.template,
    chapters: plan.chapters.map((chapter) => {
      const source = chapterById.get(chapter.id);
      return {
        id: chapter.id,
        title: chapter.title,
        role: source?.role,
        contentKind: source?.contentKind,
        showOrder: source?.showOrder,
        startSec: secOf(plan, chapter.from),
        endSec: secOf(plan, chapter.to),
        lineups: (source?.lineups ?? []).map((link) => {
          const lineup = lineupById.get(link.lineupId);
          return {
            order: link.order,
            map: lineup?.map,
            site: lineup?.site,
            agent: lineup?.agent,
            ability: lineup?.ability,
            role: localizedText(link.role, input.language),
            cue: localizedText(link.cue, input.language),
          };
        }),
      };
    }),
    chapterDraft: input.chapters.entries,
    scenes: plan.scenes.map((scene) => {
      const source = sceneById.get(scene.id);
      return {
        id: scene.id,
        chapterId: scene.chapterId,
        purpose: source?.purpose,
        purposeLabel: source ? SCENE_PURPOSE_LABEL[source.purpose] : undefined,
        label: scene.label,
        startSec: secOf(plan, scene.from),
        endSec: secOf(plan, scene.to),
        replayOf: source?.replayOf,
      };
    }),
    layers: plan.layers.map((layer) => ({
      role: layer.role,
      placementId: layer.placementId,
      ranges: layer.pieces.map((piece) => [secOf(plan, piece.from), secOf(plan, piece.from + piece.duration)]),
    })),
    avatars: plan.avatars.map((piece) => ({ startSec: secOf(plan, piece.from), endSec: secOf(plan, piece.from + piece.duration), motion: piece.motion })),
    cutins: plan.overlays
      .filter((overlay) => overlay.kind === 'cutin')
      .map((overlay) => ({ startSec: secOf(plan, overlay.from), endSec: secOf(plan, overlay.from + overlay.duration) })),
    captions: { count: plan.captions.length },
    assets: project.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      path: asset.path,
      stamp: input.assetStamps[asset.id] ?? asset.stamp,
    })),
    files: input.files,
  };
};

/** 範囲を秒で表示する（UI用） */
export const formatRangeSec = (plan: RenderPlan, from: number, to: number): string =>
  `${formatSrtTime(frameTicks(plan, from)).replace(',', '.')} – ${formatSrtTime(frameTicks(plan, to)).replace(',', '.')}`;
