import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { YoutubeError } from './youtube-error';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Analytics API の reports.query は yt-analytics.readonly に加えて youtube.readonly も必要。 */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const;

export type SecretBox = {
  available: () => boolean;
  encrypt: (plain: string) => Buffer;
  decrypt: (cipher: Buffer) => string;
};

type StoredConfig = { clientId: string; needsReauth?: boolean };
type StoredSecrets = { clientSecret?: string; refreshToken?: string; scope?: string; obtainedAt?: string };

export type AuthState = {
  clientId: string;
  hasClientSecret: boolean;
  connected: boolean;
  needsReauth: boolean;
  secureStorage: boolean;
};

const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

const writeAtomic = async (target: string, data: string | Buffer): Promise<void> => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, target);
};

const CALLBACK_HTML = (ok: boolean, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>CV Creator Studio</title>` +
  `<body style="font-family:sans-serif;background:#0b1118;color:#e8eef5;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><h2>${ok ? '接続しました' : '接続できませんでした'}</h2><p>${text}</p></div></body>`;

export class YoutubeAuth {
  private cached?: { token: string; expiresAt: number };
  private login?: { server: Server; cancel: () => void };

  constructor(
    private readonly deps: {
      directory: string;
      box: SecretBox;
      openExternal: (url: string) => Promise<void>;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private get configPath(): string {
    return path.join(this.deps.directory, 'youtube-client.json');
  }

  private get secretsPath(): string {
    return path.join(this.deps.directory, 'youtube-secrets.bin');
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private http(): typeof fetch {
    return this.deps.fetch ?? fetch;
  }

  private async readConfig(): Promise<StoredConfig> {
    try {
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as Partial<StoredConfig>;
      return { clientId: typeof raw.clientId === 'string' ? raw.clientId : '', needsReauth: raw.needsReauth === true };
    } catch {
      return { clientId: '' };
    }
  }

  private async writeConfig(config: StoredConfig): Promise<void> {
    await writeAtomic(this.configPath, JSON.stringify(config, null, 2));
  }

  private async readSecrets(): Promise<StoredSecrets> {
    if (!this.deps.box.available()) return {};
    try {
      return JSON.parse(this.deps.box.decrypt(await fs.readFile(this.secretsPath))) as StoredSecrets;
    } catch {
      return {};
    }
  }

  private async writeSecrets(secrets: StoredSecrets): Promise<void> {
    if (!this.deps.box.available()) {
      throw new YoutubeError('permission', 'このPCでは認証情報を暗号化して保存できないため、接続できません');
    }
    await writeAtomic(this.secretsPath, this.deps.box.encrypt(JSON.stringify(secrets)));
  }

  async state(): Promise<AuthState> {
    const config = await this.readConfig();
    const secrets = await this.readSecrets();
    return {
      clientId: config.clientId,
      hasClientSecret: Boolean(secrets.clientSecret),
      connected: Boolean(secrets.refreshToken),
      needsReauth: Boolean(config.needsReauth),
      secureStorage: this.deps.box.available(),
    };
  }

  /** クライアントIDを変えたときは、別クライアントのトークンを使い回さない。 */
  async setClient(clientId: string, clientSecret?: string): Promise<AuthState> {
    const id = clientId.trim();
    if (id && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
      throw new YoutubeError('unknown', 'クライアントIDの形式が違います（…apps.googleusercontent.com）');
    }
    const config = await this.readConfig();
    const secrets = await this.readSecrets();
    const changed = config.clientId !== id;
    await this.writeConfig({ clientId: id, needsReauth: changed ? false : config.needsReauth });
    const nextSecret = clientSecret === undefined ? secrets.clientSecret : clientSecret.trim() || undefined;
    await this.writeSecrets(changed ? { clientSecret: nextSecret } : { ...secrets, clientSecret: nextSecret });
    if (changed) this.cached = undefined;
    return this.state();
  }

  cancelLogin(): void {
    this.login?.cancel();
  }

  /** システムのブラウザで同意画面を開き、127.0.0.1 のループバックで認可コードを受け取る（PKCE）。 */
  async connect(): Promise<AuthState> {
    const config = await this.readConfig();
    if (!config.clientId) throw new YoutubeError('auth', '先にクライアントIDを保存してください');
    const secrets = await this.readSecrets();
    this.cancelLogin();
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = base64Url(randomBytes(16));
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let redirectUri = '';
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/') {
          response.writeHead(404).end();
          return;
        }
        const finish = (ok: boolean, text: string) => {
          response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(CALLBACK_HTML(ok, text));
        };
        if (url.searchParams.get('state') !== state) {
          finish(false, '確認用の値が一致しません。アプリからもう一度接続してください。');
          return;
        }
        const error = url.searchParams.get('error');
        const received = url.searchParams.get('code');
        if (error || !received) {
          finish(false, 'アクセスが許可されませんでした。アプリに戻ってください。');
          cleanup();
          reject(new YoutubeError('auth', 'Googleでの許可がキャンセルされました'));
          return;
        }
        finish(true, 'このタブを閉じて、CV Creator Studio に戻ってください。');
        cleanup();
        resolve({ code: received, redirectUri });
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new YoutubeError('auth', 'ログインの待ち時間が過ぎました。もう一度接続してください'));
      }, LOGIN_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        server.close();
        if (this.login?.server === server) this.login = undefined;
      };
      this.login = {
        server,
        cancel: () => {
          cleanup();
          reject(new YoutubeError('cancelled', 'ログインを中止しました'));
        },
      };
      server.on('error', (error) => {
        cleanup();
        reject(new YoutubeError('network', `ログイン用の受け口を開けません: ${error.message}`));
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        redirectUri = `http://127.0.0.1:${port}`;
        const url = new URL(AUTH_URL);
        url.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: YOUTUBE_SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
        this.deps.openExternal(url.toString()).catch((error: unknown) => {
          cleanup();
          reject(new YoutubeError('unknown', `ブラウザを開けません: ${String(error)}`));
        });
      });
    });
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (secrets.clientSecret) body.set('client_secret', secrets.clientSecret);
    const token = await this.tokenRequest(body);
    if (!token.refresh_token) throw new YoutubeError('auth', 'リフレッシュトークンを受け取れませんでした');
    const granted = new Set((token.scope ?? '').split(/\s+/));
    const missing = YOUTUBE_SCOPES.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new YoutubeError(
        'permission',
        '同意画面で「YouTube アカウントの表示」と「YouTube Analytics レポートの表示」の両方にチェックを入れてください',
      );
    }
    await this.writeSecrets({
      clientSecret: secrets.clientSecret,
      refreshToken: token.refresh_token,
      scope: token.scope,
      obtainedAt: new Date(this.now()).toISOString(),
    });
    await this.writeConfig({ clientId: config.clientId, needsReauth: false });
    this.cached = { token: token.access_token, expiresAt: this.now() + (token.expires_in ?? 3600) * 1000 };
    return this.state();
  }

  /** 有効なアクセストークン。期限の1分前に更新する。 */
  async accessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const config = await this.readConfig();
    const secrets = await this.readSecrets();
    if (!config.clientId || !secrets.refreshToken) throw new YoutubeError('auth', 'YouTubeに接続していません');
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: secrets.refreshToken,
    });
    if (secrets.clientSecret) body.set('client_secret', secrets.clientSecret);
    try {
      const token = await this.tokenRequest(body);
      this.cached = { token: token.access_token, expiresAt: this.now() + (token.expires_in ?? 3600) * 1000 };
      if (config.needsReauth) await this.writeConfig({ ...config, needsReauth: false });
      return token.access_token;
    } catch (error) {
      if (error instanceof YoutubeError && error.kind === 'auth') {
        this.cached = undefined;
        await this.writeConfig({ ...config, needsReauth: true });
      }
      throw error;
    }
  }

  async disconnect(): Promise<AuthState> {
    const secrets = await this.readSecrets();
    if (secrets.refreshToken) {
      try {
        await this.http()(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: secrets.refreshToken }).toString(),
        });
      } catch {
        // 取り消しに失敗しても、このPCからは消す。
      }
    }
    this.cached = undefined;
    await this.writeSecrets({ clientSecret: secrets.clientSecret });
    const config = await this.readConfig();
    await this.writeConfig({ clientId: config.clientId, needsReauth: false });
    return this.state();
  }

  private async tokenRequest(body: URLSearchParams): Promise<{
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  }> {
    let response: Response;
    try {
      response = await this.http()(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (error) {
      throw new YoutubeError('network', `Googleへ接続できません: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof json.access_token !== 'string') {
      const reason = typeof json.error === 'string' ? json.error : `HTTP ${response.status}`;
      if (reason === 'invalid_grant') {
        throw new YoutubeError('auth', 'Googleの許可が切れています。もう一度ログインしてください', false, response.status);
      }
      if (reason === 'invalid_client' || reason === 'unauthorized_client') {
        throw new YoutubeError('auth', 'クライアントIDまたはシークレットが正しくありません', false, response.status);
      }
      throw new YoutubeError(response.status >= 500 ? 'server' : 'auth', `トークンを取得できません（${reason}）`, response.status >= 500, response.status);
    }
    return json as { access_token: string; expires_in?: number; refresh_token?: string; scope?: string };
  }
}
