import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { aiProviderChoiceSchema, type AiProviderChoice } from '../../../shared/ai';
import { youtubeSyncSettingsSchema, type YoutubeSyncSettings } from '../../../shared/schema/youtube';

/** このPC専用の初期保存先。設定が無いとき、起動時にここを開く。 */
export const DEFAULT_WORKSPACE = 'C:\\Users\\ry0ch\\デスクトップ\\VCV\\VCV\\CVCS';

export type StudioSettings = {
  workspace?: string;
  /** 「作る」の制作モード（ショート／横動画）と、横動画側で最後に開いていた Project */
  createMode?: 'short' | 'long';
  lastLongProjectId?: string;
  aiProvider?: AiProviderChoice;
  youtubeSync?: YoutubeSyncSettings;
};

const settingsPath = (): string => path.join(app.getPath('userData'), 'studio-settings.json');

export const readStudioSettings = async (): Promise<StudioSettings> => {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Record<string, unknown>;
    const settings: StudioSettings = {};
    if (typeof raw.workspace === 'string') settings.workspace = raw.workspace;
    if (raw.createMode === 'short' || raw.createMode === 'long') settings.createMode = raw.createMode;
    if (typeof raw.lastLongProjectId === 'string' && /^[a-zA-Z0-9_-]+$/.test(raw.lastLongProjectId)) {
      settings.lastLongProjectId = raw.lastLongProjectId;
    }
    const provider = aiProviderChoiceSchema.safeParse(raw.aiProvider);
    if (provider.success) settings.aiProvider = provider.data;
    const youtubeSync = youtubeSyncSettingsSchema.safeParse(raw.youtubeSync ?? {});
    if (youtubeSync.success) settings.youtubeSync = youtubeSync.data;
    return settings;
  } catch {
    return {};
  }
};

export const patchStudioSettings = async (patch: Partial<StudioSettings>): Promise<StudioSettings> => {
  const next = { ...(await readStudioSettings()), ...patch };
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  const temporary = `${settingsPath()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(temporary, settingsPath());
  return next;
};
