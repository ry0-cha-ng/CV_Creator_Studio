import {
  DEFAULT_YOUTUBE_SYNC_SETTINGS,
  youtubeSyncSettingsSchema,
  type SyncRun,
  type YoutubeStatus,
  type YoutubeSyncProgress,
  type YoutubeSyncSettings,
} from '../../../shared/schema/youtube';
import type { AnalyticsService } from './analytics-service';
import { YoutubeApi } from './youtube-api';
import { YoutubeAuth, type SecretBox } from './youtube-auth';
import { YoutubeError } from './youtube-error';
import { YoutubeStore } from './youtube-store';
import { YoutubeSyncService } from './youtube-sync-service';

export type YoutubeServiceDeps = {
  directory: string;
  box: SecretBox;
  openExternal: (url: string) => Promise<void>;
  analytics: AnalyticsService;
  hasWorkspace: () => boolean;
  readSettings: () => Promise<YoutubeSyncSettings | undefined>;
  writeSettings: (settings: YoutubeSyncSettings) => Promise<void>;
  onProgress: (progress: YoutubeSyncProgress) => void;
  fetch?: typeof fetch;
};

/** 認証・保存・同期をまとめた窓口。レンダラーへは状態だけを返し、トークンは渡さない。 */
export class YoutubeService {
  readonly auth: YoutubeAuth;
  readonly store: YoutubeStore;
  private readonly sync: YoutubeSyncService;

  constructor(private readonly deps: YoutubeServiceDeps) {
    this.auth = new YoutubeAuth({
      directory: deps.directory,
      box: deps.box,
      openExternal: deps.openExternal,
      fetch: deps.fetch,
    });
    this.store = new YoutubeStore(() => deps.analytics.db());
    const api = new YoutubeApi({ token: (force) => this.auth.accessToken(force), fetch: deps.fetch });
    this.sync = new YoutubeSyncService({
      store: this.store,
      api,
      importVideos: (videos) => deps.analytics.upsertImportedVideos(videos),
      settings: () => this.settings(),
      onProgress: deps.onProgress,
    });
  }

  async settings(): Promise<YoutubeSyncSettings> {
    return (await this.deps.readSettings()) ?? DEFAULT_YOUTUBE_SYNC_SETTINGS;
  }

  async setSettings(patch: Partial<YoutubeSyncSettings>): Promise<YoutubeStatus> {
    const next = youtubeSyncSettingsSchema.parse({ ...(await this.settings()), ...patch });
    await this.deps.writeSettings(next);
    return this.status();
  }

  async status(): Promise<YoutubeStatus> {
    const auth = await this.auth.state();
    const phase = !auth.clientId
      ? 'unconfigured'
      : auth.needsReauth
        ? 'reauth-required'
        : auth.connected
          ? 'connected'
          : 'disconnected';
    const base: YoutubeStatus = {
      phase,
      clientId: auth.clientId,
      hasClientSecret: auth.hasClientSecret,
      secureStorage: auth.secureStorage,
      settings: await this.settings(),
      running: this.sync.running(),
      counts: { videos: 0, linked: 0, unlinked: 0, withDaily: 0 },
    };
    if (!this.deps.hasWorkspace()) return base;
    const channel = this.store.channel();
    const posts = this.deps.analytics.youtubePostCounts();
    return {
      ...base,
      channel: channel ? { channelId: channel.channelId, title: channel.title, handle: channel.handle } : undefined,
      lastRun: this.store.lastRun(),
      horizon: this.store.state('horizon').lastDataDate,
      counts: {
        videos: channel ? this.store.videos(channel.channelId).filter((video) => !video.missingSince).length : 0,
        linked: posts.linked,
        unlinked: posts.unlinked,
        withDaily: this.store.videosWithDaily(),
      },
    };
  }

  async setClient(clientId: string, clientSecret?: string): Promise<YoutubeStatus> {
    await this.auth.setClient(clientId, clientSecret);
    return this.status();
  }

  async connect(): Promise<YoutubeStatus> {
    await this.auth.connect();
    return this.status();
  }

  async disconnect(): Promise<YoutubeStatus> {
    this.sync.cancel();
    await this.auth.disconnect();
    return this.status();
  }

  cancelLogin(): void {
    this.auth.cancelLogin();
  }

  async startSync(trigger: SyncRun['trigger']): Promise<SyncRun> {
    if (!this.deps.hasWorkspace()) throw new YoutubeError('unknown', '保存先フォルダが選択されていません');
    const auth = await this.auth.state();
    if (!auth.connected) throw new YoutubeError('auth', 'YouTubeに接続していません');
    return this.sync.start(trigger);
  }

  cancelSync(): void {
    this.sync.cancel();
  }

  /** 起動時の補完。接続済みで設定がONのときだけ。失敗しても起動は止めない。 */
  async syncOnStartup(): Promise<void> {
    if (!this.deps.hasWorkspace()) return;
    const [auth, settings] = await Promise.all([this.auth.state(), this.settings()]);
    if (!auth.connected || auth.needsReauth || !settings.syncOnStartup) return;
    await this.sync.start('startup');
  }
}
