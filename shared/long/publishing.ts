import { DELIVERY_PRESETS, type DeliveryPresetId } from '../delivery-presets';
import type { TakenPostUrl } from '../post-url';
import {
  publishingWorkflowSchema,
  settled,
  stampBundle,
  workflowTaskSchema,
  type AutoCheck,
  type ChecklistItem,
  type PublishingBundle,
  type PublishingSettings,
  type PublishingWorkflow,
  type WorkflowTask,
  type WorkflowTaskType,
} from '../publishing';
import { buildLongDescription, longPostTitle, type CreditTrack } from './outputs';
import { LONG_LANGUAGES, type LongExportRecord, type LongLanguage, type LongProject } from './schema';

/**
 * 横動画（YouTube 通常動画）の投稿ワークフロー。
 * 短尺と同じタスク・状態遷移（投稿前確認 → 言語ごとの YouTube 投稿 → 公開確認 → 公開後QA → 記録完了）を使い、
 * 横動画の書き出し記録・通常動画の URL・横動画用の確認項目に置き換える。
 */

export const LONG_PRESET_BY_LANGUAGE: Record<LongLanguage, DeliveryPresetId> = {
  ja: 'yt-long-ja',
  en: 'yt-long-en',
  ko: 'yt-long-ko',
};

export const LONG_LANGUAGE_NAME: Record<LongLanguage, string> = { ja: '日本語', en: '英語', ko: '韓国語' };

export const longLanguageOf = (preset: string | undefined): LongLanguage | undefined => {
  if (!preset) return undefined;
  const spec = DELIVERY_PRESETS[preset as DeliveryPresetId];
  return spec?.format === 'long' ? (spec.longLanguage as LongLanguage | undefined) : undefined;
};

// ---------------------------------------------------------------------------
// 書き出し記録と出力ファイル

/** 言語ごとの最新の書き出し（部分書き出しは除く）。出力言語の順 */
export const latestLongExports = (project: LongProject): Array<{ language: LongLanguage; record: LongExportRecord }> =>
  LONG_LANGUAGES.filter((language) => project.output.languages.includes(language)).flatMap((language) => {
    const records = project.exports.filter((record) => record.language === language && !record.range);
    const latest = records.reduce<LongExportRecord | undefined>((best, record) => (!best || record.at >= best.at ? record : best), undefined);
    return latest ? [{ language, record: latest }] : [];
  });

export type LongPublishFileKind = 'video' | 'nobgm' | 'srt' | 'thumbnail' | 'copy' | 'chapters' | 'meta';

export type LongPublishFile = {
  language: LongLanguage;
  preset: DeliveryPresetId;
  exportId: string;
  kind: LongPublishFileKind;
  name: string;
  relativePath: string;
};

export const LONG_FILE_LABEL: Record<LongPublishFileKind, string> = {
  video: 'MP4',
  nobgm: 'MP4（BGMなし）',
  srt: '字幕 SRT',
  thumbnail: 'サムネイル',
  copy: '投稿文',
  chapters: 'チャプター草案',
  meta: 'meta.json',
};

const fileKind = (name: string, basename: string): LongPublishFileKind | null => {
  if (name === `${basename}.mp4`) return 'video';
  if (name === `${basename}_nobgm.mp4`) return 'nobgm';
  if (name === `${basename}.srt`) return 'srt';
  if (name === `${basename}.jpg`) return 'thumbnail';
  if (name === `${basename}_chapters.txt`) return 'chapters';
  if (name === `${basename}.txt`) return 'copy';
  if (name === `${basename}.meta.json`) return 'meta';
  return null;
};

/** 最新の書き出しのファイル（保存先フォルダからの相対パス） */
export const longPublishFiles = (project: LongProject): LongPublishFile[] =>
  latestLongExports(project).flatMap(({ language, record }) =>
    record.files.flatMap((relativePath) => {
      const name = relativePath.split('/').pop() ?? relativePath;
      const kind = fileKind(name, record.basename);
      return kind ? [{ language, preset: LONG_PRESET_BY_LANGUAGE[language], exportId: record.exportId, kind, name, relativePath }] : [];
    }),
  );

// ---------------------------------------------------------------------------
// 書き出しが最新かの判定

/** FNV-1a（32bit）を2つの初期値で計算した識別値。暗号用途ではない */
const hashText = (text: string): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193 + 0x9e3779b1) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
};

/** キーの順に左右されない JSON（同じ内容なら同じ文字列） */
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableJson(item))).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/**
 * 動画の中身に関わる内容の識別値。投稿文・状態・書き出し記録・編集画面の状態と、
 * プレビュー用プロキシ・欠落表示のような動画に影響しない値は含めない。
 */
export const longContentStamp = (project: LongProject): string => {
  const { editor: _editor, updatedAt: _updatedAt, createdAt: _createdAt, status: _status, publishing: _publishing, exports: _exports, title: _title, slug: _slug, ...content } = project;
  const assets = content.assets.map(({ proxyPath: _proxyPath, missing: _missing, ...asset }) => asset);
  return hashText(stableJson({ ...content, assets }));
};

// ---------------------------------------------------------------------------
// チャプター草案の確認（書き出したチャプター草案を読み直して判定する）

export const chapterDraftProblems = (text: string): string[] => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return ['チャプター草案が空です'];
  const seconds = lines.map((line) => {
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})\s/.exec(line);
    return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
  });
  const problems: string[] = [];
  if (seconds.some((value) => value === null)) problems.push('時刻で始まらない行があります');
  if (seconds[0] !== 0) problems.push('最初のチャプターが 0:00 ではありません');
  if (lines.length < 3) problems.push('チャプターが3つ未満です（YouTube で表示されないことがあります）');
  for (let index = 1; index < seconds.length; index += 1) {
    const gap = (seconds[index] ?? 0) - (seconds[index - 1] ?? 0);
    if (gap < 10) {
      problems.push(`「${lines[index - 1]}」と「${lines[index]}」の間が10秒未満です`);
      break;
    }
  }
  return problems;
};

// ---------------------------------------------------------------------------
// 投稿用のタイトル・説明欄（書き出した動画のチャプターと一致させる）

export type LongYoutubeCopy = { title: string; description: string; tags: string[] };

export const longYoutubeCopy = (project: LongProject, language: LongLanguage, chaptersText: string, credits: CreditTrack[]): LongYoutubeCopy => ({
  title: longPostTitle(project, language),
  description: buildLongDescription(project, language, { text: chaptersText.trim(), entries: [], diagnostics: [] }, credits),
  tags: project.publishing.tags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean),
});

// ---------------------------------------------------------------------------
// タスクとチェックリスト

const item = (taskId: string, key: string, label: string, required: boolean, hint?: string, auto = false): ChecklistItem => ({
  id: `${taskId}:${key}`,
  key,
  label,
  hint,
  required,
  auto: auto || undefined,
  checked: false,
});

const longChecklist = (taskId: string, type: WorkflowTaskType, language?: LongLanguage, hasSrt = false): ChecklistItem[] => {
  if (type === 'pre-publish-check') {
    return [
      item(taskId, 'export-fresh', '書き出しが最新', true, undefined, true),
      item(taskId, 'files-exist', '必要なファイルがそろっている', true, undefined, true),
      item(taskId, 'copy-present', 'タイトルが空でない', true, undefined, true),
      item(taskId, 'license-ok', '音源のライセンスに問題がない', true, undefined, true),
      item(taskId, 'conditions-match', '言語・字幕・サムネイルが想定どおり', true, '目で確認'),
    ];
  }
  if (type === 'youtube-publish') {
    const name = language ? LONG_LANGUAGE_NAME[language] : '';
    return [
      item(taskId, 'upload', `${name}のMP4を通常動画としてアップロード`, true, 'Shorts ではなく通常の動画として投稿'),
      item(taskId, 'title', 'タイトルを貼る', true),
      item(taskId, 'description', '説明文を貼る', true, 'チャプター・クレジット込みの文章をコピー'),
      item(taskId, 'thumbnail', '16:9 サムネイルを設定', true),
      ...(hasSrt ? [item(taskId, 'subtitles', '字幕（SRT）をアップロード', false, '焼き込みにした場合は不要')] : []),
      item(taskId, 'end-screen', '終了画面・カードを設定', false, 'YouTube Studio で設定。アプリ内のエンディング画像とは別'),
      item(taskId, 'schedule', '公開設定・公開日時を確認', true),
      item(taskId, 'publish', '公開する', true),
    ];
  }
  return [];
};

/** 公開後QA（横動画） */
export const LONG_QA_ITEMS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'url', label: 'URLが開く', hint: '通常動画（watch?v=）として開く' },
  { key: 'visibility', label: '公開状態が正しい', hint: '限定公開や予約のままになっていない' },
  { key: 'video', label: '映像が正常に再生される', hint: '1080p を選べる・カクつかない' },
  { key: 'audio', label: '音声が正常', hint: 'ゲーム音・声・BGMのバランス、音ズレがない' },
  { key: 'subtitles', label: '字幕が正しく出る', hint: '焼き込み、またはアップロードした SRT' },
  { key: 'chapters', label: 'チャプターが表示される', hint: '表示されない場合は説明欄の時刻を確認' },
  { key: 'language', label: '言語・タイトル・説明が正しい', hint: '' },
  { key: 'claims', label: '警告・権利申し立てがない', hint: '' },
];

export const longQaReady = (task: WorkflowTask, presets: string[], skipPresets: string[] = []): boolean => {
  const qa = task.qa ?? {};
  const skip = new Set(skipPresets);
  return presets.every((preset) => skip.has(preset) || LONG_QA_ITEMS.every((entry) => qa[preset]?.[entry.key] === 'ok'));
};

export const longTaskTitle = (task: WorkflowTask): string => {
  const language = longLanguageOf(task.preset);
  if (task.type === 'pre-publish-check') return '投稿前確認';
  if (task.type === 'youtube-publish') return `YouTube に投稿（${language ? LONG_LANGUAGE_NAME[language] : ''}）`;
  if (task.type === 'youtube-publication-verify') return `YouTube の公開を確認（${language ? LONG_LANGUAGE_NAME[language] : ''}）`;
  if (task.type === 'post-publish-verify') return '公開後QA';
  return '記録完了';
};

export const longTaskBlurb = (task: WorkflowTask): string => {
  if (task.type === 'pre-publish-check') return '投稿を始める前に1回だけ確認します。アプリが判定できるものは判定済みです';
  if (task.type === 'youtube-publish') {
    return 'アプリから YouTube へ送るか、書き出したMP4と投稿文で手動投稿し、通常動画のURLを記録します。YouTube に接続していなくても進められます';
  }
  if (task.type === 'youtube-publication-verify') return '予約公開は YouTube が行います。予定時刻を過ぎたら状態を再取得してください';
  if (task.type === 'post-publish-verify') return '数字はまだ見ません。公開した動画を開いて、事故がないかだけ確かめます';
  return '投稿の記録がそろっているかを最後に確かめます';
};

const makeTask = (
  project: LongProject,
  workflowId: string,
  type: WorkflowTaskType,
  sortOrder: number,
  now: string,
  nextId: () => string,
  language?: LongLanguage,
  hasSrt = false,
): WorkflowTask => {
  const id = nextId();
  return workflowTaskSchema.parse({
    id,
    workflowId,
    projectId: project.id,
    type,
    platform: language ? 'youtube' : undefined,
    preset: language ? LONG_PRESET_BY_LANGUAGE[language] : undefined,
    lang: language,
    status: 'pending',
    required: true,
    dependsOnTaskIds: [],
    checklistItems: longChecklist(id, type, language, hasSrt),
    sortOrder,
    createdAt: now,
    updatedAt: now,
  });
};

const exportStampOf = (project: LongProject): string =>
  latestLongExports(project)
    .map(({ language, record }) => `${language}:${record.exportId}`)
    .join('|');

/** 書き出しがあれば、言語ごとの投稿タスクを持つワークフローを作る。書き出し前は null */
export const createLongPublishing = (project: LongProject, now: string, nextId: () => string): PublishingBundle | null => {
  const exported = latestLongExports(project);
  if (exported.length === 0) return null;
  const workflowId = nextId();
  const files = longPublishFiles(project);
  const tasks: WorkflowTask[] = [makeTask(project, workflowId, 'pre-publish-check', 0, now, nextId)];
  exported.forEach(({ language }, index) => {
    const hasSrt = files.some((file) => file.language === language && file.kind === 'srt');
    tasks.push(makeTask(project, workflowId, 'youtube-publish', index + 1, now, nextId, language, hasSrt));
  });
  tasks.push(makeTask(project, workflowId, 'post-publish-verify', tasks.length, now, nextId));
  tasks.push(makeTask(project, workflowId, 'record-complete', tasks.length, now, nextId));
  // 以前の「投稿の記録（URL）」欄の値は、最初の言語の URL 下書きとして引き継ぐ（完了にはしない）
  const legacy = project.publishing.url?.trim();
  if (legacy) {
    const first = tasks.find((task) => task.type === 'youtube-publish');
    if (first) Object.assign(first, { urlDraft: legacy, postedAtDraft: project.publishing.postedAt });
  }
  const workflow: PublishingWorkflow = publishingWorkflowSchema.parse({
    id: workflowId,
    projectId: project.id,
    status: 'pending',
    selectedPresets: exported.map(({ language }) => LONG_PRESET_BY_LANGUAGE[language]),
    exportStamp: exportStampOf(project),
    createdAt: now,
    updatedAt: now,
  });
  return stampBundle({ workflow, tasks }, now);
};

const sameSlot = (left: WorkflowTask, right: WorkflowTask): boolean => left.type === right.type && (left.preset ?? '') === (right.preset ?? '');
const touched = (task: WorkflowTask): boolean => task.status === 'done' || task.status === 'skipped' || task.status === 'needs-fix' || task.status === 'in-progress';

/**
 * 既存のワークフローを、いまの書き出し状態に合わせる。
 * 進めたタスク（完了・スキップ・要修正・作業中）は残し、チェックや URL 下書きも引き継ぐ。
 * 投稿済みの後に書き出し直した場合は staleExport を立てる（投稿をやり直すかは人が決める）。
 */
export const reconcileLongPublishing = (
  existing: PublishingBundle | null,
  project: LongProject,
  now: string,
  nextId: () => string,
): PublishingBundle | null => {
  const fresh = createLongPublishing(project, now, nextId);
  if (!existing) return fresh;
  if (!fresh) return existing;
  const workflowId = existing.workflow.id;
  const merged = fresh.tasks.map((task) => {
    const previous = existing.tasks.find((candidate) => sameSlot(candidate, task));
    if (!previous) return { ...task, workflowId };
    const checked = new Map(previous.checklistItems.map((entry) => [entry.key, entry.checked]));
    return {
      ...previous,
      sortOrder: task.sortOrder,
      checklistItems: task.checklistItems.map((entry) => ({ ...entry, id: `${previous.id}:${entry.key}`, checked: checked.get(entry.key) ?? false })),
    };
  });
  // 出力言語から外れても、投稿まで進めた言語のタスクは残す
  const kept = existing.tasks.filter(
    (task) => (task.type === 'youtube-publish' && touched(task) && !merged.some((other) => sameSlot(other, task))) || task.type === 'youtube-publication-verify',
  );
  const publish = [...merged.filter((task) => task.type === 'youtube-publish'), ...kept.filter((task) => task.type === 'youtube-publish')];
  const verify = kept.filter((task) => task.type === 'youtube-publication-verify');
  const pre = merged.find((task) => task.type === 'pre-publish-check')!;
  const post = merged.find((task) => task.type === 'post-publish-verify')!;
  const record = merged.find((task) => task.type === 'record-complete')!;
  const ordered = [pre, ...publish, ...verify, post, record].map((task, index) => ({ ...task, sortOrder: index }));
  const posted = existing.tasks.some((task) => task.type === 'youtube-publish' && (task.status === 'done' || task.status === 'needs-fix'));
  const stamp = fresh.workflow.exportStamp;
  return stampBundle(
    {
      workflow: {
        ...existing.workflow,
        selectedPresets: fresh.workflow.selectedPresets,
        exportStamp: posted ? existing.workflow.exportStamp : stamp,
        staleExport: posted && stamp !== existing.workflow.exportStamp,
      },
      tasks: ordered,
    },
    now,
  );
};

// ---------------------------------------------------------------------------
// 自動判定

export type LongPostRecord = {
  preset: DeliveryPresetId;
  language: LongLanguage;
  url: string;
  postedAt?: string;
  publicationState?: string;
  exportId?: string;
  videoId?: string;
};

export const longPrecheckAuto = (
  project: LongProject,
  input: {
    filesPresent: boolean;
    fileDetail: string;
    licenseOk: boolean;
    licenseDetail: string;
    /** 言語ごとの書き出したチャプター草案 */
    chapters: Partial<Record<LongLanguage, string>>;
  },
): AutoCheck[] => {
  const exported = latestLongExports(project);
  const stamp = longContentStamp(project);
  const missingLanguages = project.output.languages.filter((language) => !exported.some((item) => item.language === language));
  const unknown = exported.filter(({ record }) => !record.contentStamp);
  const stale = exported.filter(({ record }) => record.contentStamp && record.contentStamp !== stamp);
  const titlesMissing = exported.filter(({ language }) => !(project.publishing.title[language]?.trim() || project.publishing.title.ja?.trim()));
  const descriptionsMissing = exported.filter(({ language }) => !project.publishing.description[language]?.trim());
  const chapterProblems = exported.flatMap(({ language }) => chapterDraftProblems(input.chapters[language] ?? '').map((problem) => `${LONG_LANGUAGE_NAME[language]}：${problem}`));
  const checks: AutoCheck[] = [
    {
      key: 'export-fresh',
      label: '書き出しが最新',
      ok: exported.length > 0 && stale.length === 0 && unknown.length === 0 && missingLanguages.length === 0,
      // 書き出し後の変更は止める。判定できない以前の版・書き出していない言語は警告にとどめる
      severity: exported.length > 0 && stale.length === 0 ? 'warn' : undefined,
      detail:
        exported.length === 0
          ? 'まだ書き出していません'
          : stale.length > 0
            ? `書き出し後に内容が変わっています（${stale.map(({ language }) => LONG_LANGUAGE_NAME[language]).join('・')}）。書き出し直してください`
            : [
                unknown.length > 0 ? '以前の版のため、書き出し後の変更を判定できません。目で確認してください' : '',
                missingLanguages.length > 0
                  ? `書き出していない言語（${missingLanguages.map((language) => LONG_LANGUAGE_NAME[language]).join('・')}）は投稿の対象にしません`
                  : '',
              ]
                .filter(Boolean)
                .join(' / ') || '最後の書き出しは、いまの内容と一致しています',
    },
    { key: 'files-exist', label: '必要なファイルがそろっている', ok: input.filesPresent, detail: input.fileDetail },
    {
      key: 'copy-present',
      label: 'タイトルが空でない',
      ok: titlesMissing.length === 0,
      detail: titlesMissing.length === 0 ? '投稿する言語のタイトルがあります' : `タイトルが空の言語があります：${titlesMissing.map(({ language }) => LONG_LANGUAGE_NAME[language]).join('・')}（右パネルの「投稿」で入力）`,
    },
    {
      key: 'description-present',
      label: '説明文がある',
      ok: descriptionsMissing.length === 0,
      severity: 'warn',
      detail: descriptionsMissing.length === 0 ? '投稿する言語の説明文があります' : `説明文が空の言語があります：${descriptionsMissing.map(({ language }) => LONG_LANGUAGE_NAME[language]).join('・')}（チャプターだけで投稿できます）`,
    },
    {
      key: 'chapters',
      label: 'チャプター草案が YouTube の条件を満たす',
      ok: chapterProblems.length === 0,
      severity: 'warn',
      detail: chapterProblems.length === 0 ? '先頭 0:00・3項目以上・各10秒以上です（表示は YouTube 側の判定です）' : chapterProblems.join(' / '),
    },
    { key: 'license-ok', label: '音源のライセンスに問題がない', ok: input.licenseOk, detail: input.licenseDetail },
  ];
  return checks;
};

export const longRecordAuto = (tasks: WorkflowTask[], posts: LongPostRecord[]): AutoCheck[] => {
  const publish = tasks.filter((task) => task.type === 'youtube-publish');
  const rows = publish.map((task) => {
    const post = posts.find((item) => item.preset === task.preset && item.url.trim());
    return { task, post, skipped: task.status === 'skipped' };
  });
  const name = (preset?: string): string => {
    const language = longLanguageOf(preset);
    return language ? LONG_LANGUAGE_NAME[language] : preset ?? '';
  };
  return [
    {
      key: 'recorded',
      label: '各言語に URL またはスキップ理由がある',
      ok: rows.every((row) => row.skipped || Boolean(row.post)),
      detail: rows.map((row) => `${name(row.task.preset)}${row.skipped ? ' スキップ' : row.post ? ' 記録済み' : ' 未記録'}`).join(' · '),
    },
    {
      key: 'posted-at',
      label: '投稿日時がある',
      ok: rows.every((row) => row.skipped || Boolean(row.post?.postedAt) || row.post?.publicationState === 'scheduled' || row.post?.publicationState === 'private' || row.post?.publicationState === 'unlisted'),
      detail: 'URL を記録した言語',
    },
    {
      key: 'export-linked',
      label: '投稿と書き出した版が結び付いている',
      ok: rows.every((row) => row.skipped || Boolean(row.post?.exportId)),
      detail: '分析で、どの版を投稿したか追えます',
    },
  ];
};

// ---------------------------------------------------------------------------
// 画面用

export type LongPublishingView = {
  workflow: PublishingWorkflow | null;
  tasks: WorkflowTask[];
  current: WorkflowTask | null;
  autoChecks: AutoCheck[];
  recordChecks: AutoCheck[];
  files: LongPublishFile[];
  /** 各ファイルが保存先にあるか */
  present: Record<string, boolean>;
  posts: LongPostRecord[];
  copy: Partial<Record<LongLanguage, LongYoutubeCopy>>;
  taken: TakenPostUrl[];
  settings: PublishingSettings;
  started: boolean;
  /** 書き出し済みで、ワークフローを作れる */
  available: boolean;
};

/** ワークフローの状態から Project の状態を決める（公開待ちが残る間は posted にしない） */
export const longStatusForWorkflow = (project: LongProject, view: Pick<LongPublishingView, 'workflow' | 'posts'>): LongProject['status'] => {
  if (view.workflow?.status === 'done') {
    const waiting = view.posts.some((post) => post.publicationState === 'scheduled' || post.publicationState === 'private' || post.publicationState === 'unlisted');
    return waiting ? 'exported' : 'posted';
  }
  if (project.status === 'posted') return 'exported';
  return project.status;
};

export const longDoneCount = (tasks: WorkflowTask[]): number => tasks.filter((task) => settled(task.status)).length;
