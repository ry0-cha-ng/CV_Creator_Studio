import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { resolveCatalogMediaFile } from './catalog-path';

const contentTypeFor = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mkv':
      return 'video/x-matroska';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
    case '.aac':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
};

const escapesRoot = (relative: string): boolean =>
  relative === '..' ||
  relative.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relative);

export const resolveWorkspaceFile = (workspace: string, requestPath: string): string | null => {
  let decoded = requestPath.replace(/^\/+/, '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0')) return null;
  const root = path.resolve(workspace);
  const absolute = path.resolve(root, decoded);
  const relative = path.relative(root, absolute);
  if (escapesRoot(relative)) return null;
  return absolute;
};

export const workspaceRelativePath = (workspace: string, requestPath: string): string | null => {
  const absolute = resolveWorkspaceFile(workspace, requestPath);
  if (!absolute) return null;
  const relative = path.relative(path.resolve(workspace), absolute);
  if (escapesRoot(relative)) return null;
  return relative.split(path.sep).join('/');
};

export const isInsideRoot = (rootReal: string, candidateReal: string): boolean => {
  const relative = path.relative(path.resolve(rootReal), path.resolve(candidateReal));
  return !escapesRoot(relative) && relative !== '';
};

const parseByteRange = (
  header: string,
  size: number,
): { start: number; end: number } | null => {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || size <= 0) return null;
  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return null;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === '' ? size - 1 : Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || start > end) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
};

const loopbackOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const applyCors = (request: IncomingMessage, response: ServerResponse): boolean => {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!loopbackOrigin.test(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Range');
  response.setHeader(
    'Access-Control-Expose-Headers',
    'Accept-Ranges, Content-Length, Content-Range, Content-Type',
  );
  return true;
};

const tokensMatch = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
};

const deny = (response: ServerResponse): void => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(404);
  response.end();
};

export type WorkspaceMediaServer = {
  url: string;
  close: () => Promise<void>;
};

const pipeFile = (
  request: IncomingMessage,
  response: ServerResponse,
  fileReal: string,
  fileSize: number,
  contentType: string,
): void => {
  const rangeHeader = request.headers.range;
  if (!rangeHeader) {
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': fileSize,
      'Content-Type': contentType,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(fileReal);
    stream.on('error', () => response.destroy());
    response.on('close', () => {
      if (!response.writableEnded) stream.destroy();
    });
    stream.pipe(response);
    return;
  }

  const range = parseByteRange(rangeHeader, fileSize);
  if (!range) {
    response.writeHead(416, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${fileSize}`,
    });
    response.end();
    return;
  }
  response.writeHead(206, {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': range.end - range.start + 1,
    'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
    'Content-Type': contentType,
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(fileReal, { start: range.start, end: range.end });
  stream.on('error', () => response.destroy());
  response.on('close', () => {
    if (!response.writableEnded) stream.destroy();
  });
  stream.pipe(response);
};

export const startWorkspaceMediaServer = ({
  workspace,
  allowedRelativePaths,
  catalogRoot,
  allowedCatalogPaths,
}: {
  workspace: string;
  allowedRelativePaths: readonly string[];
  catalogRoot?: string;
  allowedCatalogPaths?: readonly string[];
}): Promise<WorkspaceMediaServer> =>
  new Promise((resolve, reject) => {
    const token = randomBytes(32).toString('hex');
    const allowed = new Set(
      allowedRelativePaths
        .map((relativePath) => workspaceRelativePath(workspace, relativePath))
        .filter((relativePath): relativePath is string => relativePath !== null),
    );
    const allowedCatalog = new Set(allowedCatalogPaths ?? []);
    let rootReal: string | null = null;
    let catalogReal: string | null = null;

    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const [requestToken, ...rest] = pathname.split('/').filter((segment) => segment.length > 0);
      if (!applyCors(request, response) || !requestToken || !tokensMatch(requestToken, token)) {
        deny(response);
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        deny(response);
        return;
      }
      const requestPath = rest.join('/');

      void (async () => {
        if (catalogRoot && allowedCatalog.has(requestPath)) {
          const absolute = resolveCatalogMediaFile(catalogRoot, requestPath);
          if (!absolute) {
            deny(response);
            return;
          }
          catalogReal ??= await realpath(catalogRoot);
          const fileReal = await realpath(absolute);
          if (!isInsideRoot(catalogReal, fileReal)) {
            deny(response);
            return;
          }
          const file = await stat(fileReal);
          if (!file.isFile()) {
            deny(response);
            return;
          }
          pipeFile(request, response, fileReal, file.size, contentTypeFor(fileReal));
          return;
        }

        const relativePath = workspaceRelativePath(workspace, requestPath);
        const absolute = relativePath ? resolveWorkspaceFile(workspace, relativePath) : null;
        if (!relativePath || !absolute || !allowed.has(relativePath)) {
          deny(response);
          return;
        }

        rootReal ??= await realpath(workspace);
        const fileReal = await realpath(absolute);
        if (!isInsideRoot(rootReal, fileReal)) {
          deny(response);
          return;
        }
        const file = await stat(fileReal);
        if (!file.isFile()) {
          deny(response);
          return;
        }
        pipeFile(request, response, fileReal, file.size, contentTypeFor(fileReal));
      })().catch(() => deny(response));
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('素材サーバーの待受に失敗しました'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/${token}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
            server.closeAllConnections();
          }),
      });
    });
  });
