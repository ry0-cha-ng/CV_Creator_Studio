import { aimZoomOverlapWarning } from './aim-zoom';
import {
  likeCtaActive,
  resolveLikeCtaText,
  resolveCtaDesign,
  S4_CTA_COPY,
} from './s4-cta';
import { s7CtaDuplicate } from './s7-cta';
import {
  DELIVERY_PRESET_ORDER,
  DELIVERY_PRESETS,
  platformsFor,
  presetOutputsLabel,
  type DeliveryPresetId,
} from './delivery-presets';
import { AGENT_NAMES_JA, MAP_NAMES_JA } from './valorant-labels';
import {
  HOOK_PATTERNS,
  defaultPublishing,
  ensureTrackingUrl,
  publishingUrls,
} from './production';
import type { AudioTrack, Platform } from './schema/audio';
import {
  defaultDemoCaption,
  type AssetRole,
  type HookPattern,
  type InheritItem,
  type Language,
  type Project,
} from './schema/project';
import type { SceneKey } from './schema/project-keys';
import { thumbnailIconWarning } from './thumbnail';
import { focusHookWarning, focusUpscale, THUMB_FOCUS } from './thumbnail-focus';
import { focusFrameOf, focusOutsideDetail, sceneFocusEffects } from './layout-focus';
import { syncedXPost } from './x-post';
import {
  SCENE_BAND,
  activeTimeline,
  applySceneCutDuration,
  buildTimeline,
  defaultBgmLevel,
  insertSceneItem,
  rebuildSceneItems,
  removeSceneItems,
  sceneDurations,
  sceneTotalDuration,
} from './timeline';
import { clipUsageCount, cutCrop, extraCutsOf } from './scene-cuts';
import { configuredSceneOrder, sceneOrderLabel } from './video-structure';

export const GUIDE_STEPS = [
  { id: 1, name: '定点情報', hint: 'マップ・エージェント・投げ方' },
  { id: 2, name: '動画選択', hint: '1〜3本を登録する' },
  { id: 6, name: 'BGM・効果音', hint: 'BGM・効果音・ゲーム音' },
  { id: 4, name: 'カード用画像', hint: '立ち位置→合わせ位置→発動' },
  { id: 3, name: '切り抜き', hint: 'S1→S2→S3→S4→S6（任意）→S7' },
  { id: 5, name: 'テロップ', hint: 'フック・タイトル・固定コメントの案' },
  { id: 8, name: '投稿内容', hint: 'タイトル・説明文・タグ' },
  { id: 7, name: '最終確認', hint: '日英の通し再生とチェック' },
  { id: 9, name: '書き出し', hint: '投稿先を選んで書き出す' },
  { id: 10, name: '投稿・運用', hint: '投稿して公開を確認する' },
] as const;

export type GuideStepId = (typeof GUIDE_STEPS)[number]['id'];
export type StepStatus = 'idle' | 'active' | 'done' | 'warn';

/** 左の手順リストに出す番号。id は画面の種類で、並びとは別。 */
export const guideStepNumber = (id: GuideStepId): number => {
  const index = GUIDE_STEPS.findIndex((step) => step.id === id);
  return index < 0 ? id : index + 1;
};

export const guideStepAfter = (id: GuideStepId): GuideStepId | null => {
  const index = GUIDE_STEPS.findIndex((step) => step.id === id);
  return GUIDE_STEPS[index + 1]?.id ?? null;
};

export const guideStepBefore = (id: GuideStepId): GuideStepId | null => {
  const index = GUIDE_STEPS.findIndex((step) => step.id === id);
  if (index <= 0) return null;
  return GUIDE_STEPS[index - 1]?.id ?? null;
};

const HOOK_ORDER: HookPattern[] = [
  'result',
  'number',
  'question',
  'scarcity',
  'score',
  'versatile',
  'newmap',
];

const SIDE_JA = { attack: '攻め', defense: '守り' } as const;

const lookupJa = (table: Record<string, string>, id: string): string => {
  if (table[id]) return table[id];
  const match = Object.entries(table).find(([key]) => key.toLowerCase() === id.toLowerCase());
  return match?.[1] ?? id;
};

export const lineupTitle = (project: Project): string => {
  const map = lookupJa(MAP_NAMES_JA, project.lineup.map);
  const agent = lookupJa(AGENT_NAMES_JA, project.lineup.agent);
  const side = SIDE_JA[project.lineup.side];
  return `${map} ${project.lineup.site} ${side} · ${agent}`;
};

export const videosOf = (project: Project): Project['assets'] =>
  project.assets.filter((asset) => asset.type === 'video');

export const assetFileName = (asset: Project['assets'][number]): string => {
  const tagged = asset.tags.find((tag) => tag.startsWith('file:'));
  if (tagged) return tagged.slice(5);
  const parts = asset.path.split(/[\\/]/);
  return parts[parts.length - 1] ?? asset.path;
};

const sceneClip = (project: Project, sceneKey: SceneKey) => {
  const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
  return project.clips.find((item) => item.id === scene?.clipId);
};

export const sceneHasRange = (project: Project, sceneKey: SceneKey): boolean =>
  Boolean(sceneClip(project, sceneKey));

const requiredTrimKeys = (project: Project): SceneKey[] =>
  configuredSceneOrder(project).filter((sceneKey) =>
    (['hook', 'stand', 'aim', 'throw'] as SceneKey[]).includes(sceneKey),
  );

export const trimScenes = (project: Project): SceneKey[] => configuredSceneOrder(project);

const lineupReady = (project: Project): boolean =>
  Boolean(
    project.lineup.map.trim() &&
      project.lineup.agent.trim() &&
      project.lineup.ability.trim() &&
      project.lineup.site &&
      project.lineup.side,
  );

const REVIEW_CAPTIONS = ['hook', 'stand', 'throw', 'demo'] as const;

const reviewCaptionIds = (project: Project): Array<(typeof REVIEW_CAPTIONS)[number]> =>
  REVIEW_CAPTIONS.filter((id) => {
    const sceneKey = id === 'throw' ? 'aim' : id;
    if (!configuredSceneOrder(project).includes(sceneKey)) return false;
    return id !== 'demo' || sceneHasRange(project, 'demo');
  });

const captionById = (project: Project, id: string) =>
  project.captions.find((caption) => caption.id === id) ??
  (id === 'demo' ? defaultDemoCaption() : undefined);

const resolveCaption = (text: string, project: Project, language: Language): string =>
  text
    .replaceAll('{map}', project.lineup.map)
    .replaceAll('{site}', project.lineup.site)
    .replaceAll('{side}', project.lineup.side)
    .replaceAll('{agent}', project.lineup.agent)
    .replaceAll('{ability}', project.lineup.ability)
    .replaceAll('{throwType}', project.lineup.throwType[language])
    .replaceAll('{charge}', String(project.lineup.charge ?? ''))
    .replaceAll('{bounce}', String(project.lineup.bounce ?? ''))
    .replaceAll('{standDescription}', project.lineup.standDescription[language])
    .replaceAll('{aimDescription}', project.lineup.aimDescription[language])
    .replaceAll('{br}', '\n');

/** フック以外のテロップが表示警告になる日本語の文字数。 */
export const CAPTION_JA_MAX_CHARS = 15;

/** フックが表示警告になる日本語の文字数。 */
export const HOOK_JA_MAX_CHARS = 20;

/** フックの行数チェック。改行2つまでと同じ。 */
export const HOOK_CAPTION_MAX_LINES = 3;

/** 英語テロップが表示警告になる語数。 */
export const CAPTION_EN_MAX_WORDS = 6;

export const captionMetrics = (
  text: string,
  project: Project,
  language: Language,
  captionId?: string,
): { lines: number; overflow: boolean; empty: boolean } => {
  const resolved = resolveCaption(text, project, language).replaceAll(/[[\]]/g, '');
  const lines = resolved.split('\n');
  const body = lines.join('').trim();
  const maxLines = captionId === 'hook' ? HOOK_CAPTION_MAX_LINES : 2;
  const englishWordLimit = CAPTION_EN_MAX_WORDS;
  const overflow =
    lines.length > maxLines ||
    (language === 'ja'
      ? [...body].length > (captionId === 'hook' ? HOOK_JA_MAX_CHARS : CAPTION_JA_MAX_CHARS)
      : body.split(/\s+/).filter(Boolean).length > englishWordLimit);
  return { lines: lines.length, overflow, empty: !resolved.trim() };
};

export const exportContentStamp = (project: Project): string =>
  JSON.stringify({
    lineup: project.lineup,
    assets: project.assets,
    clips: project.clips,
    stills: project.stills,
    scenes: project.scenes,
    captions: project.captions,
    templateId: project.templateId,
    timelineEdited: project.timelineEdited,
    timeline: project.timeline,
    timelineMix: project.timelineMix,
    templateParams: project.templateParams,
    hookPattern: project.hookPattern,
    englishCaptionPreset: project.englishCaptionPreset,
    experiment: project.experiment,
    cardLayout: project.cardLayout,
    cardAimZoom: project.cardAimZoom ?? null,
    cardAimMarker: project.cardAimMarker ?? null,
    cardStills: project.cardStills,
    audio: project.audio,
    publishing: project.publishing,
    plannedPostDate: project.plannedPostDate ?? null,
    exportPresets: project.guide.exportPresets,
    exportWithoutBgm: project.guide.exportWithoutBgm,
    thumbnailOnly: project.guide.thumbnailOnly,
    thumbnailFrame: project.thumbnailFrame,
    ...(project.thumbnail ? { thumbnail: project.thumbnail } : {}),
  });

export type ReviewItem = {
  id: string;
  label: string;
  detail: string;
  level: 'ok' | 'warn' | 'error' | 'info';
  step?: GuideStepId;
};

const s4Review = (project: Project): ReviewItem[] => {
  const hidden = project.captions.find((caption) => caption.id === 'cta')?.hidden === true;
  if (likeCtaActive(project)) {
    const text = resolveLikeCtaText(project);
    const shown = (['ja', 'en'] as const).some((language) => text.line1[language].trim());
    return [
      {
        id: 'cta-duplicate',
        label: 'S4のCTA',
        detail:
          hidden || !shown
            ? 'CTAは出ていません'
            : 'YouTubeは映像の上に高評価CTAを1ブロックだけ出します。TikTokは従来のClutchVault案内です',
        level: 'ok',
        step: 5,
      },
    ];
  }
  const stored = project.templateParams.s4Cta;
  const mainJa = (stored?.main.ja ?? S4_CTA_COPY.ja.main).trim();
  const mainEn = (stored?.main.en ?? S4_CTA_COPY.en.main).trim();
  const shown = Boolean(mainJa || mainEn);
  return [
    {
      id: 'cta-duplicate',
      label: 'S4のCTA',
      detail:
        hidden || !shown
          ? 'CTAは出ていません'
          : '映像直下に1ブロックだけ表示します',
      level: 'ok',
      step: 5,
    },
  ];
};

const s7Review = (project: Project): ReviewItem[] => {
  if (resolveCtaDesign(project) === 's4-block') return s4Review(project);
  const cta = project.captions.find((caption) => caption.id === 'cta');
  const shown = Boolean(cta && !cta.hidden && (cta.text.ja.trim() || cta.text.en.trim()));
  const duplicate = s7CtaDuplicate(project);
  return [
    {
      id: 'cta-duplicate',
      label: 'S7のCTA',
      detail: duplicate
        ? '同じCTA文言がS7に2か所あります'
        : shown
          ? '主CTAは1か所だけです'
          : 'CTA文言は出ていません',
      level: duplicate ? 'error' : 'ok',
      step: duplicate ? 5 : undefined,
    },
  ];
};

export const reviewItems = (project: Project, tracks: AudioTrack[] = []): ReviewItem[] => {
  const missingScenes = requiredTrimKeys(project).filter((key) => !sceneHasRange(project, key));
  const cardsReady = Boolean(
    project.cardStills.stand && project.cardStills.aim && project.cardStills.result,
  );
  const captionIds = reviewCaptionIds(project);
  const englishGaps = captionIds.filter((id) => {
    const caption = captionById(project, id);
    return caption ? captionMetrics(caption.text.en, project, 'en', id).empty : true;
  });
  const track = tracks.find((item) => item.id === project.audio.bgm?.audioTrackId) ?? null;
  let license: ReviewItem;
  if (!project.audio.bgm) {
    license = {
      id: 'license',
      label: 'BGMのライセンス',
      detail: 'BGMなし',
      level: 'ok',
    };
  } else if (!track) {
    license = {
      id: 'license',
      label: 'BGMのライセンス',
      detail: '選択した曲がライブラリにありません',
      level: 'error',
      step: 6,
    };
  } else if (
    track.licenseStatus !== 'confirmed' ||
    !track.sourceUrl.trim() ||
    (track.creditRequired && !track.creditText.trim())
  ) {
    license = {
      id: 'license',
      label: 'BGMのライセンス',
      detail: `「${track.title}」はライセンス未確認です`,
      level: 'warn',
      step: 6,
    };
  } else {
    const selectedPlatforms = platformsFor(project.guide.exportPresets);
    const blocked = selectedPlatforms.filter(
      (platform) => !track.allowedPlatforms.includes(platform),
    );
    const platformName = (platform: Platform): string =>
      platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : 'X';
    license =
      blocked.length > 0
        ? {
            id: 'license',
            label: 'BGMのライセンス',
            detail: `${blocked.map(platformName).join('・')} では使えません`,
            level: 'error',
            step: 6,
          }
        : {
            id: 'license',
            label: 'BGMのライセンス',
            detail:
              selectedPlatforms.length > 0
                ? `${selectedPlatforms.map(platformName).join('・')} で使えます`
                : '選んだ投稿先で使えます',
            level: 'ok',
          };
  }

  const captionName = { hook: 'HOOK', stand: 'STAND', throw: 'AIM', demo: '実戦' } as const;
  const aimCopyMissing =
    englishGaps.length === 1 &&
    englishGaps[0] === 'throw' &&
    !project.lineup.aimDescription.en.trim();

  return [
    {
      id: 'scenes',
      label: 'すべてのシーンに素材がある',
      detail:
        missingScenes.length === 0
          ? `構成 ${sceneOrderLabel(configuredSceneOrder(project))} · 必須素材を設定済み`
          : `未設定: ${missingScenes.map((sceneKey) => SCENE_BAND[sceneKey]).join('・')}`,
      level: missingScenes.length === 0 ? 'ok' : 'error',
      step: missingScenes.length === 0 ? undefined : 3,
    },
    {
      id: 'cards',
      label: 'カード用画像',
      detail: cardsReady
        ? `3枚そろっています · ${project.cardLayout === 'stack' ? 'B案' : 'A案'}`
        : '3枚そろっていません',
      level: cardsReady ? 'ok' : 'error',
      step: cardsReady ? undefined : 4,
    },
    (() => {
      const overlap = aimZoomOverlapWarning(project);
      const zoom = project.cardAimZoom;
      return {
        id: 'aim-zoom',
        label: '合わせ位置ズーム',
        detail: !zoom?.enabled
          ? 'オフ'
          : overlap ??
            `×${zoom.zoom} · ${zoom.style === 'loupe' ? '円形ルーペ' : zoom.style === 'split' ? 'サイド分割' : '角型インセット'}`,
        level: overlap ? 'warn' : 'ok',
        step: overlap ? 4 : undefined,
      } as const;
    })(),
    (() => {
      const notes = project.scenes.flatMap((scene) => {
        if (scene.layout916 !== 'focus') return [];
        const clip = project.clips.find((item) => item.id === scene.clipId);
        const asset = project.assets.find((item) => item.id === clip?.assetId);
        const frame = focusFrameOf(asset?.meta.width, asset?.meta.height);
        const arrow = activeTimeline(project).items.find((item) => item.sceneKey === scene.sceneKey)?.arrow ?? null;
        const detail = focusOutsideDetail(
          frame,
          scene.cropCenterX,
          sceneFocusEffects(scene, arrow),
          scene.cropZoom,
          scene.cropCenterY,
        );
        return detail ? [`${SCENE_BAND[scene.sceneKey]}: ${detail}`] : [];
      });
      return {
        id: 'focus-crop',
        label: 'フォーカスの切り抜き',
        detail:
          notes.length > 0
            ? notes.join(' ')
            : project.scenes.some((scene) => scene.layout916 === 'focus')
              ? '切り抜く範囲の外に出ている演出はありません'
              : 'フォーカスのシーンはありません',
        level: notes.length > 0 ? 'warn' : 'ok',
        step: notes.length > 0 ? 3 : undefined,
      } as const;
    })(),
    {
      id: 'english',
      label: '英語のテロップ',
      detail:
        englishGaps.length === 0
          ? captionIds.includes('demo')
            ? 'HOOK・STAND・AIM・実戦 が入力されています'
            : 'HOOK・STAND・AIM が入力されています（実戦は S6 を入れたとき）'
          : aimCopyMissing
            ? 'AIM が空です（英語の合わせ方の説明が未入力）'
            : `${englishGaps.map((id) => captionName[id]).join('・')} が空です`,
      level: englishGaps.length === 0 ? 'ok' : 'warn',
      step: englishGaps.length === 0 ? undefined : aimCopyMissing ? 1 : 5,
    },
    ...s7Review(project),
    license,
    {
      id: 'lineup',
      label: '定点情報の必須項目',
      detail: 'マップ・サイト・攻守・エージェント・アビリティ',
      level: lineupReady(project) ? 'ok' : 'error',
      step: lineupReady(project) ? undefined : 1,
    },
    (() => {
      const iconWarning = thumbnailIconWarning(project);
      return {
        id: 'thumbnail-icons',
        label: 'サムネイルの識別画像',
        detail: iconWarning ?? 'エージェントとスキルの画像を表示します',
        level: iconWarning ? 'warn' : 'ok',
        step: iconWarning ? 1 : undefined,
      } as const;
    })(),
    ...(['ja', 'en'] as const).flatMap((language) => {
      if (!focusHookWarning(project, language)) return [];
      const name = language === 'ja' ? '日本語' : 'English';
      return [
        {
          id: `thumbnail-hook-${language}`,
          label: 'サムネイルのフック',
          detail: `${name}のフックが3行に収まりません。最小サイズでもはみ出します`,
          level: 'warn' as const,
          step: 5 as const,
        },
      ];
    }),
    ...(() => {
      const upscale = focusUpscale(project);
      if (upscale === null || upscale <= THUMB_FOCUS.zoom.warnUpscale) return [];
      return [
        {
          id: 'thumbnail-upscale',
          label: 'サムネイルの拡大',
          detail: `映像を${upscale.toFixed(2)}倍に拡大しています。1.60倍を超えるとぼやけます`,
          level: 'warn' as const,
          step: 4 as const,
        },
      ];
    })(),
    {
      id: 'experiment',
      label: 'この動画の実験',
      detail: project.experimentRef
        ? `${project.experimentRef.arm === 'control' ? 'Control' : 'Variant'} を選択しています`
        : '実験なし',
      level: 'ok',
    },
    {
      id: 'timeline',
      label: '詳細編集での変更',
      detail: project.timelineEdited
        ? 'タイムラインを手編集しています。尺・切り抜きは手順と連動します'
        : 'タイムラインは未編集（手順の変更がそのまま反映されます）',
      level: 'info',
    },
  ];
};

const stepComplete = (project: Project, step: GuideStepId, tracks: AudioTrack[]): boolean => {
  if (step === 1) return lineupReady(project);
  if (step === 2) return videosOf(project).length > 0;
  if (step === 3) return requiredTrimKeys(project).every((key) => sceneHasRange(project, key));
  if (step === 4) {
    return Boolean(project.cardStills.stand && project.cardStills.aim && project.cardStills.result);
  }
  if (step === 5) {
    return reviewCaptionIds(project).every((id) => {
      const caption = captionById(project, id);
      return Boolean(caption && !captionMetrics(caption.text.ja, project, 'ja', id).empty);
    });
  }
  if (step === 6) return project.guide.confirmedSteps.includes('sound');
  if (step === 7) {
    return (
      project.guide.confirmedSteps.includes('review') &&
      reviewItems(project, tracks).every((item) => item.level !== 'error')
    );
  }
  if (step === 8) {
    return Boolean(project.publishing.title.ja.trim() && project.publishing.title.en.trim());
  }
  if (step === 9) {
    return project.guide.lastExport?.contentStamp === exportContentStamp(project);
  }
  if (publishingPresets(project).length === 0) return false;
  return project.status === 'posted';
};

const stepPartial = (project: Project, step: GuideStepId): boolean => {
  if (step === 2) return videosOf(project).length > 0;
  if (step === 3) return requiredTrimKeys(project).some((key) => sceneHasRange(project, key));
  if (step === 4) {
    return Boolean(project.cardStills.stand || project.cardStills.aim || project.cardStills.result);
  }
  if (step === 8) {
    return Boolean(project.publishing.title.ja.trim() || project.publishing.title.en.trim());
  }
  if (step === 10) return project.posts.some((post) => post.url.trim());
  return false;
};

const stepWarning = (project: Project, step: GuideStepId, tracks: AudioTrack[]): boolean => {
  if (step === 1) {
    return !project.lineup.standDescription.en.trim() || !project.lineup.aimDescription.en.trim();
  }
  if (step === 5) {
    return reviewCaptionIds(project).some((id) => {
      const caption = captionById(project, id);
      if (!caption) return false;
      const english = captionMetrics(caption.text.en, project, 'en', id);
      const japanese = captionMetrics(caption.text.ja, project, 'ja', id);
      return english.empty || english.overflow || japanese.overflow;
    });
  }
  if (step === 7) return reviewItems(project, tracks).some((item) => item.level === 'warn');
  return false;
};

const orderDeliveryPresets = (presets: DeliveryPresetId[]): DeliveryPresetId[] => {
  const selected = new Set(presets);
  const ordered: DeliveryPresetId[] = [];
  for (const platform of ['youtube', 'tiktok', 'x'] as const) {
    for (const id of DELIVERY_PRESET_ORDER) {
      if (selected.has(id) && DELIVERY_PRESETS[id].platform === platform) ordered.push(id);
    }
  }
  return ordered;
};

/**
 * 投稿運用の対象。
 * 直近の書き出しに記録されたプリセットを優先する。
 * サムネイルだけの再書き出しで記録が空になっても、書き出しファイルのリンクから戻す。
 */
export const publishingPresets = (project: Project): DeliveryPresetId[] => {
  if (!project.guide.lastExport) return [];
  const exported = orderDeliveryPresets(project.guide.lastExport.presets);
  if (exported.length > 0) return exported;
  const selected = orderDeliveryPresets(project.guide.exportPresets);
  if (selected.length > 0) return selected;
  return orderDeliveryPresets(
    (Object.entries(project.publishing.links) as Array<[string, string | undefined]>).flatMap(([id, url]) =>
      id in DELIVERY_PRESETS && url?.trim() ? [id as DeliveryPresetId] : [],
    ),
  );
};

export const stepSummary = (project: Project, step: GuideStepId): string => {
  if (step === 1) {
    return `${lookupJa(MAP_NAMES_JA, project.lineup.map)} · ${project.lineup.site} · ${SIDE_JA[project.lineup.side]} · ${lookupJa(AGENT_NAMES_JA, project.lineup.agent)}`;
  }
  if (step === 2) {
    const count = videosOf(project).length;
    return count > 0 ? `${count}本` : '動画なし';
  }
  if (step === 3) return `${activeTimeline(project).durationSec.toFixed(1)}秒`;
  if (step === 4) {
    const layout = project.cardLayout === 'stack' ? 'B案' : 'A案';
    const zoom = project.cardAimZoom;
    if (!zoom?.enabled) return `${layout} · ズームなし`;
    return `${layout} · ズーム ×${zoom.zoom}`;
  }
  if (step === 5) {
    const line = project.captions.find((caption) => caption.id === 'hook')?.text.ja.split('\n')[0]?.trim() ?? '';
    return line || 'フック未入力';
  }
  if (step === 6) return project.audio.bgm ? 'BGMあり' : 'BGMなし';
  if (step === 8) return project.publishing.title.ja.trim() || '投稿文';
  if (step === 9) return publishingPresets(project).join('・') || project.guide.exportPresets.join('・') || 'プリセットなし';
  if (step === 10) return project.status === 'posted' ? '投稿済み' : '投稿・運用';
  return '';
};

export type GuideStepView = {
  id: GuideStepId;
  name: string;
  hint: string;
  status: StepStatus;
  summary: string;
  blocker: string | null;
};

export const guideSteps = (
  project: Project,
  current: GuideStepId,
  tracks: AudioTrack[] = [],
): GuideStepView[] =>
  GUIDE_STEPS.map((step) => {
    const id = step.id;
    const done = stepComplete(project, id, tracks);
    const warn = done && stepWarning(project, id, tracks);
    let status: StepStatus = 'idle';
    if (warn) status = 'warn';
    else if (done) status = 'done';
    else if (stepPartial(project, id) || id === current) status = 'active';
    const blocker =
      id === 3 && videosOf(project).length === 0
        ? '動画がないため、切り抜きを始められません。手順2で録画を追加してください。'
        : null;
    return {
      id,
      name: step.name,
      hint:
        id === 3 ? `動画構成 ${sceneOrderLabel(configuredSceneOrder(project))}` : step.hint,
      status,
      summary: done ? stepSummary(project, id) : '',
      blocker,
    };
  });

export const completedStepCount = (project: Project, tracks: AudioTrack[] = []): number =>
  GUIDE_STEPS.filter((step) => stepComplete(project, step.id, tracks)).length;

export const guideHeadline = (project: Project, tracks: AudioTrack[] = []): string => {
  const count = completedStepCount(project, tracks);
  const throughExport = GUIDE_STEPS.filter((step) => step.id <= 9).every((step) =>
    stepComplete(project, step.id, tracks),
  );
  if (throughExport && !stepComplete(project, 10, tracks)) {
    return `${count} / 10 完了 · 書き出しまで完了`;
  }
  return `${count} / 10 完了`;
};

export const nextGuideAction = (
  project: Project,
  tracks: AudioTrack[] = [],
): { step: GuideStepId; label: string } => {
  const pending = GUIDE_STEPS.find((step) => !stepComplete(project, step.id, tracks));
  if (!pending) return { step: 10, label: '開く' };
  if (pending.id === 10) {
    const started = project.posts.some((post) => post.url.trim());
    return { step: 10, label: started ? '投稿・運用を続ける' : '投稿・運用を始める' };
  }
  return { step: pending.id, label: `続きから（${guideStepNumber(pending.id)} ${pending.name}）` };
};

const sameXPost = (left: Project['publishing']['xPost'], right: Project['publishing']['xPost']): boolean =>
  left.ja === right.ja &&
  left.en === right.en &&
  left.jaEdited === right.jaEdited &&
  left.enEdited === right.enEdited &&
  left.videoUrl === right.videoUrl &&
  left.videoUrlEdited === right.videoUrlEdited &&
  left.spotDraft === right.spotDraft;

export const followPublishing = (project: Project): Project => {
  const urls = publishingUrls(project);
  const generated = defaultPublishing(project, urls);
  const edited = project.guide.publishingEdited;
  const includeKorean = project.guide.exportPresets.includes('yt-global');
  const descriptionOf = (language: 'ja' | 'en' | 'ko', handEdited: boolean, current: string): string =>
    handEdited
      ? current
      : ensureTrackingUrl(generated.description[language] ?? '', language, urls[language]);
  const xPost = syncedXPost(project);
  const publishing: Project['publishing'] = {
    title: {
      ja: edited.title?.ja ? project.publishing.title.ja : generated.title.ja,
      en: edited.title?.en ? project.publishing.title.en : generated.title.en,
      ...(includeKorean || project.publishing.title.ko !== undefined || edited.title?.ko
        ? { ko: edited.title?.ko ? project.publishing.title.ko : generated.title.ko }
        : {}),
    },
    description: {
      ja: descriptionOf('ja', Boolean(edited.description?.ja), project.publishing.description.ja),
      en: descriptionOf('en', Boolean(edited.description?.en), project.publishing.description.en),
      ...(includeKorean || project.publishing.description.ko !== undefined || edited.description?.ko
        ? {
            ko: descriptionOf('ko', Boolean(edited.description?.ko), project.publishing.description.ko ?? ''),
          }
        : {}),
    },
    hashtags: {
      ja: edited.hashtags?.ja ? project.publishing.hashtags.ja : generated.hashtags.ja,
      en: edited.hashtags?.en ? project.publishing.hashtags.en : generated.hashtags.en,
      ...(includeKorean || project.publishing.hashtags.ko !== undefined || edited.hashtags?.ko
        ? { ko: edited.hashtags?.ko ? project.publishing.hashtags.ko : generated.hashtags.ko }
        : {}),
    },
    links: project.publishing.links,
    memoUrl: project.publishing.memoUrl,
    pinnedComment: project.publishing.pinnedComment,
    xPost,
  };
  if (
    publishing.title.ja === project.publishing.title.ja &&
    publishing.title.en === project.publishing.title.en &&
    publishing.title.ko === project.publishing.title.ko &&
    publishing.description.ja === project.publishing.description.ja &&
    publishing.description.en === project.publishing.description.en &&
    publishing.description.ko === project.publishing.description.ko &&
    publishing.hashtags.ja === project.publishing.hashtags.ja &&
    publishing.hashtags.en === project.publishing.hashtags.en &&
    publishing.hashtags.ko === project.publishing.hashtags.ko &&
    sameXPost(project.publishing.xPost, xPost)
  ) {
    return project;
  }
  return { ...project, publishing };
};

/** 定点メモを説明文へ反映する。手入力済みの説明文はURLだけ差し替え、未編集は後段の雛形追従に任せる。 */
export const applyPublishingMemo = (project: Project, memoUrl: string): Project => {
  const next: Project = {
    ...project,
    publishing: { ...project.publishing, memoUrl },
  };
  const urls = publishingUrls(next);
  const edited = next.guide.publishingEdited.description;
  if (!edited?.ja && !edited?.en && !edited?.ko) return next;
  const description = { ...next.publishing.description };
  for (const language of ['ja', 'en', 'ko'] as const) {
    if (!edited[language]) continue;
    const current = description[language];
    if (typeof current !== 'string') continue;
    description[language] = ensureTrackingUrl(current, language, urls[language]);
  }
  return { ...next, publishing: { ...next.publishing, description } };
};

export const nextHookPattern = (previous: HookPattern | undefined): HookPattern => {
  if (!previous || previous === 'custom') return 'result';
  const index = HOOK_ORDER.indexOf(previous);
  if (index < 0) return 'result';
  return HOOK_ORDER[(index + 1) % HOOK_ORDER.length] ?? 'result';
};

export const applyInheritance = (
  project: Project,
  source: Project,
  items: InheritItem[],
): Project => {
  let next: Project = {
    ...project,
    inheritedFrom: { projectId: source.id, items: [...items] },
  };
  if (items.includes('agent')) {
    next = {
      ...next,
      lineup: {
        ...next.lineup,
        agent: source.lineup.agent,
        ability: source.lineup.ability,
        throwType: { ...source.lineup.throwType },
        charge: source.lineup.charge,
        bounce: source.lineup.bounce,
        crouch: source.lineup.crouch,
      },
    };
  }
  if (items.includes('bgm')) {
    next = {
      ...next,
      audio: { bgm: source.audio.bgm ? { ...source.audio.bgm } : null },
    };
  }
  if (items.includes('templateParams')) {
    next = {
      ...next,
      templateParams: {
        ...next.templateParams,
        accent: source.templateParams.accent,
        fps: source.templateParams.fps,
      },
    };
  }
  if (items.includes('cardLayout')) {
    next = { ...next, cardLayout: source.cardLayout };
  }
  if (items.includes('cardAimZoom')) {
    if (!source.cardAimZoom) {
      next = {
        ...next,
        annotationStyle: source.annotationStyle,
        cardAimZoom: { enabled: false, style: 'corner', position: 'auto', zoom: 4, guide: true },
      };
    } else {
      next = {
        ...next,
        annotationStyle: source.annotationStyle,
        cardAimZoom: {
          enabled: source.cardAimZoom.enabled,
          style: source.cardAimZoom.style,
          position: source.cardAimZoom.position,
          zoom: source.cardAimZoom.zoom,
          size: source.cardAimZoom.size,
          guide: source.cardAimZoom.guide,
        },
      };
    }
  }
  if (items.includes('hookRotation')) {
    const pattern = nextHookPattern(source.hookPattern);
    next = {
      ...next,
      hookPattern: pattern,
      guide: { ...next.guide, previousHookPattern: source.hookPattern },
      captions: next.captions.map((caption) =>
        caption.id === 'hook'
          ? {
              ...caption,
              text:
                pattern === 'custom'
                  ? caption.text
                  : { ...HOOK_PATTERNS[pattern] },
            }
          : caption,
      ),
    };
  }
  if (items.includes('effects')) {
    const built = buildTimeline(next);
    const sourceEffects = activeTimeline(source).effects;
    built.effects = built.effects.map((effect) => {
      const previous = sourceEffects.find((item) => item.id === effect.id);
      return previous?.audioTrackId
        ? { ...effect, audioTrackId: previous.audioTrackId }
        : effect;
    });
    next = { ...next, timeline: built, timelineEdited: false };
  }
  if (source.plannedPostDate) {
    next = { ...next, plannedPostDate: shiftPostDate(source.plannedPostDate) };
  }
  if (items.includes('thumbnail')) {
    const layout = source.thumbnail?.layout === 'focus' ? 'focus' : 'classic';
    const zoom = source.thumbnail?.zoom;
    next = {
      ...next,
      thumbnail: {
        layout,
        ...(zoom !== undefined ? { zoom } : {}),
      },
    };
  }
  if (items.includes('experiment')) {
    next = {
      ...next,
      experiment: {
        phase: source.experiment.phase,
        series: source.experiment.series,
        testVariables: [],
        hypothesis: undefined,
        utmCampaign: source.experiment.utmCampaign,
      },
      experimentRef: source.experimentRef ? { ...source.experimentRef } : undefined,
    };
  }
  if (source.guide.exportPresets.length > 0) {
    next = {
      ...next,
      guide: {
        ...next.guide,
        exportPresets: [...source.guide.exportPresets],
        xReplyVideo: source.guide.xReplyVideo,
        exportWithoutBgm: source.guide.exportWithoutBgm,
      },
    };
  }
  return next;
};

export type FilenameGuess = {
  map?: string;
  site?: 'A' | 'B' | 'C' | 'Mid';
  side?: 'attack' | 'defense';
  label: string;
};

export const guessLineupFromFileName = (fileName: string): FilenameGuess | null => {
  const tokens = fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  let map: string | undefined;
  for (const [id, ja] of Object.entries(MAP_NAMES_JA)) {
    const slug = id.toLowerCase();
    if (tokens.includes(slug) || tokens.includes(ja.toLowerCase())) {
      map = id;
      break;
    }
  }
  const side = tokens.some((token) => ['def', 'defense', 'defence'].includes(token))
    ? 'defense'
    : tokens.some((token) => ['atk', 'attack'].includes(token))
      ? 'attack'
      : undefined;
  const siteToken = tokens.find((token) => ['a', 'b', 'c', 'mid'].includes(token));
  const site = siteToken
    ? siteToken === 'mid'
      ? 'Mid'
      : (siteToken.toUpperCase() as 'A' | 'B' | 'C')
    : undefined;
  if (!map && !side && !site) return null;
  const label = [
    map ? lookupJa(MAP_NAMES_JA, map) : null,
    side ? SIDE_JA[side] : null,
    site ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { map, site, side, label };
};

/** 最初に登録した動画。各シーンの基準になる。 */
export const baseVideoOf = (project: Project): Project['assets'][number] | undefined =>
  videosOf(project)[0];

export const desiredAssetForScene = (
  project: Project,
  sceneKey: SceneKey,
): Project['assets'][number] | undefined => {
  const base = baseVideoOf(project);
  if (!base || sceneKey === 'card' || sceneKey === 'loop') return undefined;
  if (sceneKey === 'demo') return undefined;
  return base;
};

const syncOptionalDemoTimeline = (project: Project): Project => {
  if (!project.timeline) return project;
  const sceneOrder = configuredSceneOrder(project);
  if (!sceneOrder.includes('demo')) {
    const timeline = removeSceneItems(project.timeline, 'demo');
    return timeline === project.timeline ? project : { ...project, timeline };
  }
  if (sceneHasRange(project, 'demo')) {
    const clip = sceneClip(project, 'demo');
    const duration = clip ? Math.max(0.1, clip.out - clip.in) : Math.max(6, project.templateParams.demoDuration);
    const demoIndex = sceneOrder.indexOf('demo');
    const afterSceneKey =
      [...sceneOrder.slice(0, demoIndex)]
        .reverse()
        .find((sceneKey) =>
          project.timeline?.items.some((item) => item.sceneKey === sceneKey),
        ) ?? 'demo';
    const timeline = insertSceneItem(
      project,
      project.timeline,
      'demo',
      duration,
      afterSceneKey,
    );
    return timeline === project.timeline ? project : { ...project, timeline };
  }
  const timeline = removeSceneItems(project.timeline, 'demo');
  return timeline === project.timeline ? project : { ...project, timeline };
};

export const assignClipsFromRoles = (project: Project): Project => {
  const next = structuredClone(project);
  for (const scene of next.scenes) {
    const current = next.clips.find((clip) => clip.id === scene.clipId);
    const currentAsset = next.assets.find((item) => item.id === current?.assetId);
    if (current && currentAsset?.type === 'video') continue;
    if (current) scene.clipId = undefined;
    const asset = desiredAssetForScene(next, scene.sceneKey);
    if (!asset) continue;
    const mediaDuration = asset.meta.duration ?? 1;
    const target =
      scene.sceneKey === 'demo'
        ? Math.max(6, next.templateParams.demoDuration)
        : sceneDurations(next)[scene.sceneKey];
    const span = Math.min(target, mediaDuration);
    const id = crypto.randomUUID();
    next.clips.push({
      id,
      assetId: asset.id,
      in: 0,
      out: Math.max(0.1, span),
    });
    scene.clipId = id;
  }
  return syncOptionalDemoTimeline(next);
};

const clipSpanForScene = (project: Project, sceneKey: SceneKey, fallback: number): number => {
  if (fallback > 0) return fallback;
  if (sceneKey === 'demo') return Math.max(6, project.templateParams.demoDuration);
  return sceneDurations(project)[sceneKey];
};

/** 切り抜き中のシーンだけ、使う動画を差し替える。他のシーンの範囲は残す。 */
export const retargetSceneVideo = (project: Project, sceneKey: SceneKey, assetId: string): Project => {
  if (sceneKey === 'card') return project;
  const asset = project.assets.find((item) => item.id === assetId && item.type === 'video');
  const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
  if (!asset || !scene) return project;
  const current = project.clips.find((clip) => clip.id === scene.clipId);
  const shared = Boolean(current && clipUsageCount(project, current.id) > 1);
  if (current && !shared && current.assetId === asset.id) return project;

  const next = structuredClone(project);
  const targetScene = next.scenes.find((item) => item.sceneKey === sceneKey);
  const targetClip = next.clips.find((clip) => clip.id === targetScene?.clipId);
  if (!targetScene) return project;
  const mediaDuration = Math.max(0.1, asset.meta.duration ?? 1);
  const previousSpan = targetClip && targetClip.out > targetClip.in ? targetClip.out - targetClip.in : 0;
  const span = Math.min(clipSpanForScene(next, sceneKey, previousSpan), mediaDuration);
  const start = targetClip ? Math.min(Math.max(0, targetClip.in), Math.max(0, mediaDuration - span)) : 0;
  const range = { in: start, out: Math.min(mediaDuration, start + Math.max(0.1, span)) };
  if (!(range.out > range.in)) {
    range.in = 0;
    range.out = Math.min(mediaDuration, Math.max(0.1, span));
  }
  if (targetClip && !shared) {
    targetClip.assetId = asset.id;
    targetClip.in = range.in;
    targetClip.out = range.out;
  } else {
    const id = crypto.randomUUID();
    next.clips.push({ id, assetId: asset.id, in: range.in, out: range.out });
    targetScene.clipId = id;
  }
  const marker = targetScene.aimMarker;
  const nextSpan = range.out - range.in;
  if (marker && marker.at > nextSpan) marker.at = Math.max(0, nextSpan);

  let result = sceneKey === 'demo' ? syncOptionalDemoTimeline(next) : next;
  const timeline = result.timeline;
  if (timeline && timeline.items.some((item) => item.sceneKey === sceneKey && item.sourceOffset !== 0)) {
    result = {
      ...result,
      timeline: {
        ...timeline,
        items: timeline.items.map((item) =>
          item.sceneKey === sceneKey ? { ...item, sourceOffset: 0 } : item,
        ),
      },
    };
  }
  const sceneDuration = activeTimeline(result).items.find((item) => item.sceneKey === sceneKey)?.duration;
  if (sceneDuration && sceneDuration > nextSpan + 0.05) {
    result = applySceneCutDuration(result, sceneKey, nextSpan);
  }
  return result;
};

/** 動画と、その動画を元にした切り抜き・カード用画像の登録を外す。 */
export const removeVideoAsset = (project: Project, assetId: string): Project => {
  const target = project.assets.find((asset) => asset.id === assetId);
  if (!target || target.type !== 'video') return project;

  const next = structuredClone(project);
  const removedClipIds = new Set(
    next.clips.filter((clip) => clip.assetId === assetId).map((clip) => clip.id),
  );
  const removedStillIds = new Set(
    next.stills.filter((still) => still.assetId === assetId).map((still) => still.id),
  );

  next.assets = next.assets.filter((asset) => asset.id !== assetId);
  next.clips = next.clips.filter((clip) => clip.assetId !== assetId);
  next.stills = next.stills.filter((still) => still.assetId !== assetId);
  const cutsChanged = new Set<SceneKey>();
  for (const scene of next.scenes) {
    const extras = scene.extraCuts ?? [];
    const kept = extras.filter((cut) => !removedClipIds.has(cut.clipId));
    if (kept.length !== extras.length) cutsChanged.add(scene.sceneKey);
    if (scene.clipId && removedClipIds.has(scene.clipId)) {
      scene.clipId = undefined;
      // カット1の動画が消えたら、残っているカットを繰り上げる
      const promoted = extraCutsOf({ ...scene, extraCuts: kept })[0];
      if (promoted) {
        const crop = cutCrop(scene, promoted);
        scene.clipId = promoted.clipId;
        scene.cropCenterX = crop.cropCenterX;
        scene.cropCenterY = crop.cropCenterY;
        scene.cropZoom = crop.cropZoom;
        kept.shift();
        cutsChanged.add(scene.sceneKey);
      }
    }
    if (kept.length > 0) scene.extraCuts = kept;
    else delete scene.extraCuts;
  }
  for (const role of ['stand', 'aim', 'result'] as const) {
    const stillId = next.cardStills[role];
    if (stillId && removedStillIds.has(stillId)) next.cardStills[role] = undefined;
  }
  if (next.thumbnailFrame?.assetId === assetId) next.thumbnailFrame = undefined;
  if (next.thumbnail?.frame?.assetId === assetId && next.thumbnail) {
    const { frame: _frame, ...rest } = next.thumbnail;
    next.thumbnail = rest;
  }

  let result = assignClipsFromRoles(next);
  for (const sceneKey of cutsChanged) result = rebuildSceneItems(result, sceneKey);
  return result;
};

/** S6 を外す。実戦デモの役割も外し、切り抜きが定点本体だけのときはその範囲も消す。 */
export const omitDemoScene = (project: Project): Project => {
  const next = structuredClone(project);
  const scene = next.scenes.find((item) => item.sceneKey === 'demo');
  if (scene?.clipId) {
    const clipId = scene.clipId;
    scene.clipId = undefined;
    if (!next.scenes.some((item) => item.clipId === clipId)) {
      next.clips = next.clips.filter((item) => item.id !== clipId);
    }
  }
  for (const asset of next.assets) {
    if (asset.role === 'demo') asset.role = undefined;
  }
  return syncOptionalDemoTimeline(next);
};

/** 実戦デモがなければ定点本体から S6 の範囲を作る。 */
export const includeDemoFromMain = (project: Project): Project => {
  if (sceneHasRange(project, 'demo')) return project;
  const next = structuredClone(project);
  const source = videosOf(next)[0];
  const scene = next.scenes.find((item) => item.sceneKey === 'demo');
  if (!source || !scene) return project;
  const mediaDuration = source.meta.duration ?? 1;
  const span = Math.min(Math.max(6, next.templateParams.demoDuration), mediaDuration);
  const id = crypto.randomUUID();
  next.clips.push({
    id,
    assetId: source.id,
    in: 0,
    out: Math.max(0.1, span),
  });
  scene.clipId = id;
  return syncOptionalDemoTimeline(next);
};

export const defaultRoleForNewVideo = (project: Project): AssetRole | undefined =>
  videosOf(project).some((asset) => asset.role === 'main') ? undefined : 'main';

export type CardCandidate = {
  role: 'stand' | 'aim' | 'result';
  seconds: number;
  label: string;
  clipId: string;
  assetId: string;
};

const pushCandidate = (
  list: CardCandidate[],
  candidate: CardCandidate,
): void => {
  if (
    list.some(
      (item) =>
        item.assetId === candidate.assetId &&
        Math.abs(item.seconds - candidate.seconds) < 0.05,
    )
  ) return;
  list.push(candidate);
};

export const cardCandidates = (project: Project): Record<'stand' | 'aim' | 'result', CardCandidate[]> => {
  const standClip = sceneClip(project, 'stand');
  const aimClip = sceneClip(project, 'aim');
  const throwClip = sceneClip(project, 'throw');
  const demoClip = sceneClip(project, 'demo');
  const aimScene = project.scenes.find((scene) => scene.sceneKey === 'aim');
  const result: Record<'stand' | 'aim' | 'result', CardCandidate[]> = {
    stand: [],
    aim: [],
    result: [],
  };
  if (standClip) {
    const mid = (standClip.in + standClip.out) / 2;
    pushCandidate(result.stand, {
      role: 'stand',
      seconds: standClip.out,
      label: '終わり',
      clipId: standClip.id,
      assetId: standClip.assetId,
    });
    pushCandidate(result.stand, {
      role: 'stand',
      seconds: mid,
      label: '中央',
      clipId: standClip.id,
      assetId: standClip.assetId,
    });
    pushCandidate(result.stand, {
      role: 'stand',
      seconds: standClip.in,
      label: '始まり',
      clipId: standClip.id,
      assetId: standClip.assetId,
    });
  }
  if (aimClip) {
    const mid = (aimClip.in + aimClip.out) / 2;
    const freezeAt =
      aimScene?.freeze?.enabled === true ? aimClip.in + aimScene.freeze.at : mid;
    pushCandidate(result.aim, {
      role: 'aim',
      seconds: freezeAt,
      label: aimScene?.freeze?.enabled ? 'フリーズ' : '中央',
      clipId: aimClip.id,
      assetId: aimClip.assetId,
    });
    pushCandidate(result.aim, {
      role: 'aim',
      seconds: aimClip.out,
      label: '終わり',
      clipId: aimClip.id,
      assetId: aimClip.assetId,
    });
    pushCandidate(result.aim, {
      role: 'aim',
      seconds: mid,
      label: '中央',
      clipId: aimClip.id,
      assetId: aimClip.assetId,
    });
  }
  if (throwClip) {
    pushCandidate(result.result, {
      role: 'result',
      seconds: Math.max(throwClip.in, throwClip.out - 0.25),
      label: '終わり近く',
      clipId: throwClip.id,
      assetId: throwClip.assetId,
    });
    pushCandidate(result.result, {
      role: 'result',
      seconds: throwClip.out,
      label: '終わり',
      clipId: throwClip.id,
      assetId: throwClip.assetId,
    });
  }
  if (demoClip) {
    pushCandidate(result.result, {
      role: 'result',
      seconds: (demoClip.in + demoClip.out) / 2,
      label: 'デモの中央',
      clipId: demoClip.id,
      assetId: demoClip.assetId,
    });
  }
  return result;
};

export const compositionBlocks = (
  project: Project,
): Array<{ sceneKey: SceneKey; label: string; duration: number; auto: boolean }> => {
  const timeline = activeTimeline(project);
  const labels: Record<SceneKey, string> = {
    hook: 'S1',
    stand: 'S2',
    aim: 'S3',
    throw: 'S4',
    card: 'S5',
    demo: 'S6',
    loop: 'S7',
  };
  if (project.timelineEdited) {
    return timeline.items.map((item) => ({
      sceneKey: item.sceneKey,
      label: labels[item.sceneKey],
      duration: item.duration,
      auto:
        item.sceneKey === 'card' ||
        (item.sceneKey === 'loop' && !sceneHasRange(project, 'loop')),
    }));
  }
  return configuredSceneOrder(project).map((sceneKey) => {
    const skipped = sceneKey === 'demo' && !sceneHasRange(project, 'demo');
    const duration = skipped ? 0 : sceneTotalDuration(project, sceneKey);
    const auto =
      sceneKey === 'card' ||
      (sceneKey === 'loop' && !sceneHasRange(project, 'loop')) ||
      skipped;
    return { sceneKey, label: labels[sceneKey], duration, auto };
  });
};

export const sceneGuideCopy = (sceneKey: SceneKey): { title: string; body: string } => {
  const table: Partial<Record<SceneKey, { title: string; body: string }>> = {
    hook: { title: 'S1 フック', body: '着弾・キルの瞬間' },
    stand: { title: 'S2 立ち位置', body: '立ち位置と周りの目印' },
    aim: { title: 'S3 狙い', body: '照準を合わせてから投げる直前まで' },
    throw: { title: 'S4 発動', body: '投げてから着弾・発動まで' },
    card: { title: 'S5 カード', body: '完成カードを全画面表示。秒数だけ変えられます' },
    demo: { title: 'S6 デモ', body: '実戦でこの定点を使った場面。なくても進めます' },
    loop: { title: 'S7 ループ', body: 'S1 の開始直前。終了は S1 の in より 0.01 秒前。別テイクにもできます' },
  };
  return table[sceneKey] ?? { title: sceneKey, body: '' };
};

export const defaultPostDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  date.setHours(19, 0, 0, 0);
  return toOffsetIso(date);
};

export const shiftPostDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return defaultPostDate();
  date.setDate(date.getDate() + 2);
  return toOffsetIso(date);
};

const pad = (value: number): string => String(value).padStart(2, '0');

const toOffsetIso = (date: Date): string => {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

export const toDateTimeLocal = (iso: string | undefined): string => {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const fromDateTimeLocal = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return defaultPostDate();
  return toOffsetIso(date);
};

export const markPublishingEdited = (
  project: Project,
  field: 'title' | 'description' | 'hashtags',
  language: Language | 'ko',
): Project => ({
  ...project,
  guide: {
    ...project.guide,
    publishingEdited: {
      ...project.guide.publishingEdited,
      [field]: {
        ...project.guide.publishingEdited[field],
        [language]: true,
      },
    },
  },
});

export const platformOutputs = (platform: Platform): string => {
  if (platform === 'x') return 'X用カード（4:5）・投稿文';
  return '動画・完成カード・サムネイル・投稿文';
};

export const presetOutputs = presetOutputsLabel;

export const HOOK_PATTERN_LABELS: Record<HookPattern, string> = {
  result: '結果型',
  number: '数字型',
  question: '問いかけ型',
  scarcity: '希少性',
  score: '実利・スコア',
  versatile: '汎用性',
  newmap: '新マップ',
  custom: '自由入力',
};

export const GAME_VOLUME_DEFAULTS: Record<SceneKey, number> = {
  hook: 0.1,
  stand: 0.1,
  aim: 0.1,
  throw: 0.1,
  card: 0.1,
  demo: 0.1,
  loop: 0.1,
};

export const applyDefaultVolumes = (project: Project, game: boolean, bgm: boolean): Project => {
  if (!game && !bgm) return project;
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      volume: game ? GAME_VOLUME_DEFAULTS[scene.sceneKey] : scene.volume,
      bgmVolume: bgm ? defaultBgmLevel(scene.sceneKey) : scene.bgmVolume,
    })),
  };
};

export const licenseSummary = (
  track: AudioTrack | null,
  platforms: Platform[],
): { ok: boolean; warn: boolean; message: string } => {
  if (!track) {
    return { ok: true, warn: false, message: 'BGMなしです。投稿先の制限はありません。' };
  }
  if (
    track.licenseStatus !== 'confirmed' ||
    !track.sourceUrl.trim() ||
    (track.creditRequired && !track.creditText.trim())
  ) {
    return {
      ok: false,
      warn: true,
      message: `「${track.title}」のライセンスは未確認です。書き出し時に止まります。`,
    };
  }
  const blocked = platforms.filter((platform) => !track.allowedPlatforms.includes(platform));
  if (blocked.length > 0) {
    return {
      ok: false,
      warn: false,
      message: `「${track.title}」は ${blocked.join('・')} では使えません。`,
    };
  }
  return {
    ok: true,
    warn: false,
    message: track.creditRequired
      ? `選んだ投稿先で使えます。クレジット表記が説明文に足されます。`
      : '選んだ投稿先で使えます。クレジット表記は不要です。',
  };
};
