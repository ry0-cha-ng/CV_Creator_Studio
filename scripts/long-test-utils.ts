import { sequentialIds } from '../shared/long/ids';
import { longProjectSchema, type LongAsset, type LongProject } from '../shared/long/schema';
import { createLongProject } from '../shared/long/templates';
import { secToTicks } from '../shared/long/time';

export const fail = (message: string): never => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

export const expect = (condition: unknown, message: string): void => {
  if (!condition) fail(message);
};

export const expectEqual = <T>(actual: T, expected: T, message: string): void => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${message}\n  expected: ${e}\n  actual:   ${a}`);
};

export const expectClose = (actual: number, expected: number, tolerance: number, message: string): void => {
  if (!(Math.abs(actual - expected) <= tolerance)) fail(`${message}（expected ${expected} ±${tolerance}, actual ${actual}）`);
};

/** 検証用の素材（A：1920×1080 60fps 20秒、B：1280×720 30fps 15秒） */
export const assetA = (): LongAsset => ({
  id: 'asset-a',
  kind: 'video',
  name: 'A 投げる側',
  path: 'library/footage/long-test/a.mp4',
  proxyPath: 'projects/long-test/cache/proxies/asset-a.mp4',
  probe: {
    durationTicks: secToTicks(20),
    width: 1920,
    height: 1080,
    fps: 60,
    avgFps: 60,
    vfr: false,
    codec: 'h264',
    audioStreams: [
      { audioIndex: 0, streamIndex: 1, codec: 'aac', channels: 2, sampleRate: 48000, startOffset: 0, extractedPath: 'projects/long-test/cache/audio/asset-a_0.m4a', role: 'mixed' },
      { audioIndex: 1, streamIndex: 2, codec: 'aac', channels: 2, sampleRate: 48000, startOffset: 0, extractedPath: 'projects/long-test/cache/audio/asset-a_1.m4a', role: 'game' },
      { audioIndex: 2, streamIndex: 3, codec: 'aac', channels: 1, sampleRate: 48000, startOffset: 0, extractedPath: 'projects/long-test/cache/audio/asset-a_2.m4a', role: 'voice' },
    ],
  },
  tags: [],
});

export const assetB = (): LongAsset => ({
  id: 'asset-b',
  kind: 'video',
  name: 'B 受ける側',
  path: 'library/footage/long-test/b.mp4',
  probe: {
    durationTicks: secToTicks(15),
    width: 1280,
    height: 720,
    fps: 30,
    avgFps: 30,
    vfr: false,
    codec: 'h264',
    audioStreams: [
      { audioIndex: 0, streamIndex: 1, codec: 'aac', channels: 2, sampleRate: 48000, startOffset: 0, extractedPath: 'projects/long-test/cache/audio/asset-b_0.m4a', role: 'secondary' },
    ],
  },
  tags: [],
});

export const baseProject = (template: 'default' | 'empty' = 'default'): LongProject => {
  const project = createLongProject({
    id: 'long-test',
    title: 'テスト',
    now: '2026-10-31T00:00:00.000Z',
    ids: sequentialIds(),
    template: template === 'empty' ? null : undefined,
  });
  return longProjectSchema.parse({ ...project, assets: [assetA(), assetB()] });
};
