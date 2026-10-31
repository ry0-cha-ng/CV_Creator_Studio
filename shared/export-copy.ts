import {
  DELIVERY_PRESET_ORDER,
  DELIVERY_PRESETS,
  buildTrackingUrl,
  formatPresetCopy,
  provisionalBasename,
  replaceClutchVaultUrl,
  videoLanguagesFor,
  type CopyBlock,
  type CopyLanguage,
  type DeliveryPresetId,
} from './delivery-presets';
import type { Project } from './schema/project';
import { prepareXPost, savedReplyVideoUrl } from './x-post';

export type ExportJob = {
  slot: 'ja' | 'en' | 'x';
  language: 'ja' | 'en';
  presetIds: DeliveryPresetId[];
  video: boolean;
  finishedCard: boolean;
  thumbnail: boolean;
  xCard: boolean;
};

export const jobsForPresets = (
  presets: DeliveryPresetId[],
  thumbnailOnly: Array<'ja' | 'en'> = [],
): ExportJob[] => {
  const jobs: ExportJob[] = [];
  const videoLanguages = videoLanguagesFor(presets);
  for (const language of videoLanguages) {
    const presetIds = presets.filter((id) => DELIVERY_PRESETS[id].videoLanguage === language);
    jobs.push({
      slot: language,
      language,
      presetIds,
      video: true,
      finishedCard: true,
      thumbnail: true,
      xCard: false,
    });
  }
  for (const language of thumbnailOnly) {
    if (videoLanguages.includes(language)) continue;
    jobs.push({
      slot: language,
      language,
      presetIds: [],
      video: false,
      finishedCard: false,
      thumbnail: true,
      xCard: false,
    });
  }
  if (presets.includes('x-jp')) {
    jobs.push({
      slot: 'x',
      language: 'ja',
      presetIds: ['x-jp'],
      video: false,
      finishedCard: true,
      thumbnail: false,
      xCard: true,
    });
  }
  return jobs;
};

export const captionLanguagesFor = (presets: DeliveryPresetId[]): Array<'ja' | 'en'> => {
  const languages = new Set<'ja' | 'en'>(videoLanguagesFor(presets));
  if (presets.includes('x-jp') || presets.includes('tt-jp') || presets.includes('yt-ja')) {
    languages.add('ja');
  }
  if (presets.includes('yt-global') || presets.includes('tt-en')) languages.add('en');
  return [...languages];
};

const textOf = (
  value: { ja: string; en: string; ko?: string },
  language: CopyLanguage,
): string => {
  if (language === 'ko') return value.ko?.trim() ? value.ko : value.en;
  return value[language];
};

export const replyVideoUrl = (project: Project): string =>
  savedReplyVideoUrl(project) || (project.guide.xReplyVideo === 'tiktok' ? '{TikTok URL}' : '{YouTube URL}');

export const trackingFor = (
  project: Project,
  presetId: DeliveryPresetId,
  basename: string,
  language?: CopyLanguage,
  identity = true,
): string =>
  buildTrackingUrl({
    presetId,
    basename,
    language,
    campaign: project.experiment.utmCampaign,
    base: project.publishing.memoUrl,
    identity,
  });

export const trackingUrlFor = (
  project: Project,
  language: CopyLanguage,
  now = new Date(),
  identity = true,
): string => {
  const presetId =
    DELIVERY_PRESET_ORDER.find(
      (id) =>
        project.guide.exportPresets.includes(id) && DELIVERY_PRESETS[id].copyLanguages.includes(language),
    ) ?? (language === 'en' || language === 'ko' ? 'yt-global' : 'tt-jp');
  return trackingFor(project, presetId, guessBasename(project, presetId, now), language, identity);
};

export const trackingUrlNearTop = (description: string, expected: string): boolean => {
  if (!expected.trim()) return false;
  const replaced = replaceClutchVaultUrl(description, expected);
  const index = replaced.indexOf(expected);
  if (index < 0) return false;
  const paragraphs = replaced
    .slice(0, index)
    .split(/\n\s*\n/)
    .filter((part) => part.trim());
  return paragraphs.length <= 2;
};

export const copyForJob = (
  project: Project,
  job: ExportJob,
  basename: string,
  credit: string,
): { text: string; links: Partial<Record<DeliveryPresetId, string>> } => {
  const links: Partial<Record<DeliveryPresetId, string>> = {};
  for (const presetId of job.presetIds) {
    links[presetId] = trackingFor(project, presetId, basename);
  }
  if (job.presetIds.length === 0 && job.thumbnail) {
    return {
      links,
      text: `サムネイル（${job.language === 'ja' ? '日本語' : '英語'}）\n`,
    };
  }
  if (job.slot === 'x') {
    return {
      links,
      text: prepareXPost(project).text,
    };
  }
  const blocks: CopyBlock[] = [];
  for (const presetId of job.presetIds) {
    const languages = DELIVERY_PRESETS[presetId].copyLanguages;
    languages.forEach((language, index) => {
      const url = trackingFor(project, presetId, basename, language);
      const description = replaceClutchVaultUrl(
        textOf(project.publishing.description, language),
        url,
      );
      blocks.push({
        heading: job.presetIds.length > 1 && index === 0 ? `# ${presetId}` : undefined,
        language,
        title: textOf(project.publishing.title, language),
        description,
        hashtags: textOf(project.publishing.hashtags, language),
        url,
        credit,
      });
    });
  }
  return { links, text: formatPresetCopy(blocks) };
};

export const guessBasename = (project: Project, presetId: DeliveryPresetId, now = new Date()): string => {
  const fromLink = project.publishing.links[presetId];
  if (fromLink) {
    try {
      const content = new URL(fromLink).searchParams.get('utm_content');
      if (content) return content;
    } catch {
      // 保存済みリンクが URL でないときは、命名規則から組む。
    }
  }
  return provisionalBasename({
    plannedPostDate: project.plannedPostDate,
    map: project.lineup.map,
    site: project.lineup.site,
    agent: project.lineup.agent,
    slot: DELIVERY_PRESETS[presetId].videoLanguage ?? 'x',
    now,
  });
};
