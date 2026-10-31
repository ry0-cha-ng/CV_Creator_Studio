import { createReadStream } from 'node:fs';
import { classifyHttpError } from '../../../shared/youtube-analytics';
import { UPLOAD_CHUNK_BYTES } from '../../../shared/schema/youtube-publish';
import { redactSecrets } from '../../../shared/youtube-publish';
import { asYoutubeError, YoutubeError } from './youtube-error';

export type UploadOutcome =
  | { kind: 'complete'; videoId: string }
  | { kind: 'paused'; received: number }
  | { kind: 'unknown' }
  | { kind: 'incomplete'; received: number };

export type ResumableUploadDeps = {
  token: (forceRefresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  onProgress?: (sent: number, total: number) => void;
};

const alignedChunk = (size: number): number => {
  const unit = 256 * 1024;
  if (size <= unit) return size;
  return Math.floor(size / unit) * unit;
};

const readRange = (filePath: string, start: number, endExclusive: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { start, end: endExclusive - 1 });
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });

const rangeReceived = (header: string | null): number => {
  if (!header) return 0;
  const match = /bytes=0-(\d+)/.exec(header);
  if (!match) return 0;
  return Number(match[1]) + 1;
};

export class ResumableUploadService {
  constructor(private readonly deps: ResumableUploadDeps) {}

  async queryOffset(sessionUrl: string, total: number, signal?: AbortSignal): Promise<number | 'unknown'> {
    const http = this.deps.fetch ?? fetch;
    const token = await this.deps.token();
    let response: Response;
    try {
      response = await http(sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Length': '0',
          'Content-Range': `bytes */${total}`,
        },
        signal,
      });
    } catch (error) {
      throw asYoutubeError(error);
    }
    if (response.status === 308) return rangeReceived(response.headers.get('range'));
    if (response.status === 200 || response.status === 201) {
      const json = (await response.json().catch(() => ({}))) as { id?: string };
      if (json.id) return total;
      return 'unknown';
    }
    if (response.status === 404 || response.status === 410) {
      throw new YoutubeError('not-found', 'アップロードセッションの期限が切れています', false, response.status);
    }
    const payload = await response.json().catch(() => ({}));
    const classified = classifyHttpError(response.status, payload);
    throw new YoutubeError(classified.kind, classified.message, classified.retryable, response.status);
  }

  async upload(input: {
    sessionUrl: string;
    filePath: string;
    total: number;
    start: number;
    signal?: AbortSignal;
  }): Promise<UploadOutcome> {
    const http = this.deps.fetch ?? fetch;
    const chunkSize = alignedChunk(UPLOAD_CHUNK_BYTES);
    let offset = input.start;
    let refreshed = false;
    while (offset < input.total) {
      if (input.signal?.aborted) return { kind: 'paused', received: offset };
      const end = Math.min(offset + chunkSize, input.total);
      const body = await readRange(input.filePath, offset, end);
      const token = await this.deps.token(false);
      this.deps.onProgress?.(offset, input.total);
      let response: Response;
      try {
        response = await http(input.sessionUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Length': String(body.byteLength),
            'Content-Range': `bytes ${offset}-${end - 1}/${input.total}`,
            'Content-Type': 'video/mp4',
          },
          body: new Uint8Array(body),
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal?.aborted) return { kind: 'paused', received: offset };
        const failure = asYoutubeError(error);
        if (end === input.total) return { kind: 'unknown' };
        throw failure;
      }
      if (response.status === 308) {
        offset = rangeReceived(response.headers.get('range')) || end;
        refreshed = false;
        continue;
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.deps.token(true);
        continue;
      }
      if (response.status === 200 || response.status === 201) {
        const json = (await response.json().catch(() => ({}))) as { id?: string };
        if (!json.id) return { kind: 'unknown' };
        this.deps.onProgress?.(input.total, input.total);
        return { kind: 'complete', videoId: json.id };
      }
      if (end === input.total && (response.status === 0 || response.status >= 500)) {
        return { kind: 'unknown' };
      }
      const payload = await response.json().catch(() => ({}));
      const classified = classifyHttpError(response.status, payload);
      throw new YoutubeError(classified.kind, redactSecrets(classified.message), classified.retryable, response.status);
    }
    return { kind: 'incomplete', received: offset };
  }
}
