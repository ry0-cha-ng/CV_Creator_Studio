import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import {
  resolveWorkspaceFile,
  startWorkspaceMediaServer,
} from '../electron/main/services/workspace-media-server.ts';

const execFileAsync = promisify(execFile);
const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const root = await mkdtemp(path.join(tmpdir(), 'cvcs-root-'));
const outside = await mkdtemp(path.join(tmpdir(), 'cvcs-outside-'));
const sibling = await mkdtemp(path.join(tmpdir(), 'cvcs-root-sibling-'));
await mkdir(path.join(root, 'projects'));
await writeFile(path.join(root, 'projects', 'ok.png'), 'INSIDE');
await writeFile(path.join(root, 'secret.txt'), 'WORKSPACE-SECRET');
await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE');
await writeFile(path.join(sibling, 'secret.txt'), 'SIBLING');

assert(resolveWorkspaceFile(root, '../secret.txt') === null, 'parent traversal was allowed');
assert(resolveWorkspaceFile(root, 'C:/Windows/win.ini') === null, 'drive path was allowed');
assert(
  resolveWorkspaceFile(path.join(root, 'nested'), path.join(sibling, 'secret.txt')) === null,
  'absolute sibling path was allowed',
);
assert(
  resolveWorkspaceFile('C:\\data\\CV', 'C:\\data\\CV-other\\secret.txt') === null,
  'prefix sibling was allowed',
);

let junction = false;
try {
  await symlink(outside, path.join(root, 'jump'), 'junction');
  junction = true;
} catch {
  junction = false;
}

const server = await startWorkspaceMediaServer({
  workspace: root,
  allowedRelativePaths: ['projects/ok.png', 'jump/secret.txt'],
});
assert(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/.test(server.url), `unexpected url ${server.url}`);
const token = server.url.slice(server.url.lastIndexOf('/') + 1);
const origin = server.url.slice(0, server.url.lastIndexOf('/'));

const bodyOf = async (url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> => {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.text() };
};

const ok = await bodyOf(`${server.url}/projects/ok.png`);
const noToken = await bodyOf(`${origin}/projects/ok.png`);
const wrongToken = await bodyOf(`${origin}/${'ab'.repeat(32)}/projects/ok.png`);
const secret = await bodyOf(`${server.url}/secret.txt`);
const traversal = await bodyOf(`${server.url}/projects/../../secret.txt`);
const drive = await bodyOf(`${server.url}/C:/Windows/win.ini`);
const evil = await bodyOf(`${server.url}/projects/ok.png`, { Origin: 'https://evil.example' });
const jump = junction ? await bodyOf(`${server.url}/jump/secret.txt`) : null;
await server.close();

assert(ok.status === 200 && ok.body === 'INSIDE', `allowed file failed: ${ok.status}`);
assert(noToken.status === 404 && !noToken.body.includes('INSIDE'), 'missing token was served');
assert(wrongToken.status === 404, 'wrong token was served');
assert(secret.status === 404 && !secret.body.includes('WORKSPACE-SECRET'), 'unlisted workspace file was served');
assert(traversal.status === 404 && !traversal.body.includes('WORKSPACE-SECRET'), 'traversal was served');
assert(drive.status === 404 && !drive.body.includes('['), 'drive path was served');
assert(evil.status === 404 && !evil.body.includes('INSIDE'), 'foreign origin was served');
if (jump) {
  assert(jump.status === 404 && !jump.body.includes('OUTSIDE'), `junction escape was served: ${jump.body}`);
}

const workspace = 'C:/Users/ry0ch/Desktop/VCV/CVCS';
const project = JSON.parse(
  await readFile(
    path.join(workspace, 'projects/64deb583-f735-4851-9931-b6eba854f77e/project.json'),
    'utf8',
  ),
) as {
  stills: Array<{ path: string }>;
  assets: Array<{ path: string; proxyPath?: string }>;
};
const media = await startWorkspaceMediaServer({
  workspace,
  allowedRelativePaths: [
    ...project.stills.map((still) => still.path),
    ...project.assets.flatMap((asset) => [asset.path, asset.proxyPath].filter((item): item is string => Boolean(item))),
  ],
});
const output = path.join(tmpdir(), 'cvcs-secure-card-test.png');
try {
  const serveUrl = await bundle({
    entryPoint: path.resolve('remotion/index.ts'),
    webpackOverride: (config) => config,
  });
  const inputProps = {
    project,
    language: 'ja' as const,
    mediaBaseUrl: media.url,
    useOriginalMedia: true,
  };
  const card = await selectComposition({ serveUrl, id: 'LineupCard', inputProps });
  await renderStill({
    serveUrl,
    composition: card,
    inputProps,
    output,
    imageFormat: 'png',
  });
  const videoOutput = path.join(tmpdir(), 'cvcs-secure-video-test.png');
  const video = await selectComposition({ serveUrl, id: 'LineupShortStandard', inputProps });
  await renderStill({
    serveUrl,
    composition: video,
    inputProps,
    frame: 30,
    output: videoOutput,
    imageFormat: 'png',
  });
  await rm(videoOutput, { force: true });
  const rendered = await execFileAsync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${output}').Length`],
    { windowsHide: true },
  );
  console.log(
    JSON.stringify({
      junction,
      tokenLength: token.length,
      renderedBytes: Number(rendered.stdout.trim()),
    }),
  );
} finally {
  await media.close();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  await rm(sibling, { recursive: true, force: true });
  await rm(output, { force: true });
}
