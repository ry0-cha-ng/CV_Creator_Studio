import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AnalyticsService } from '../electron/main/services/analytics-service';
import { nearestExport, snapshotFromProject } from '../shared/published-snapshot';
import { createDefaultProject } from '../shared/schema/project';
import type { YoutubeReport } from '../shared/schema/youtube';
import { describeWindow, median, retentionPoints } from '../shared/youtube-compare';

const fail = (message: string): never => {
  throw new Error(message);
};

const project = createDefaultProject('project-1', '2026-10-01T00:00:00.000Z');
project.posts = [
  {
    id: 'log-1',
    platform: 'youtube',
    lang: 'en',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    postedAt: '2026-10-01T12:00:00.000Z',
    preset: 'yt-global',
  },
];

const estimated = snapshotFromProject({
  exportId: 'estimate:post',
  project,
  source: 'estimate',
  frozenAt: '2026-10-02T00:00:00.000Z',
  lang: 'en',
});
if (!estimated.needsReview || !estimated.note?.includes('推定')) fail('推定には要確認の注記が要る');
if (estimated.scenes.some((scene) => scene.meaning === 'success')) fail('素材のないデモを成功場面として作らない');
const loop = estimated.scenes.find((scene) => scene.meaning === 'loop');
const cta = estimated.scenes.find((scene) => scene.meaning === 'cta');
if (!loop || !cta || cta.startSec !== loop.startSec || cta.endSec !== loop.endSec) fail('標準構成のCTAはループと重なる');

const early = snapshotFromProject({
  exportId: 'export-s4',
  project: { ...project, templateParams: { ...project.templateParams, ctaDesign: 's4-block' } },
  source: 'export',
  frozenAt: '2026-10-02T00:00:00.000Z',
  lang: 'en',
});
const thrown = early.scenes.find((scene) => scene.meaning === 'throw');
const s4 = early.scenes.find((scene) => scene.meaning === 'cta');
if (!thrown || !s4 || Math.abs(s4.endSec - thrown.endSec) > 0.001 || Math.abs(thrown.endSec - s4.startSec - 2) > 0.001) {
  fail('S4のCTAは投げ方の末尾2秒');
}

const points = retentionPoints(
  { status: 'ok', rows: [{ elapsedVideoTimeRatio: 0.5, audienceWatchRatio: 1.4 }] } as YoutubeReport,
  10,
);
if (points[0]?.watch !== 1.4 || points[0]?.sec !== 5) fail('100%超の維持と秒換算を残す');
if (retentionPoints({ status: 'no-data', rows: [] } as YoutubeReport, 10).length !== 0) fail('データなしに曲線を作らない');

if (median([1, 100, 3]) !== 3) fail('中央値');
const open = describeWindow('2026-10-20T12:00:00.000Z', '2026-10-21', [], 'publish-calendar-7d');
if (open.status !== 'in-progress' || open.complete) fail('期間が終わる前は集計途中');

const near = nearestExport(
  [
    {
      ...early,
      exportId: 'near',
      postId: undefined,
      lang: 'en',
      frozenAt: '2026-10-01T11:00:00.000Z',
    },
  ],
  { postedAt: '2026-10-01T12:00:00.000Z', lang: 'en' },
);
const far = nearestExport(
  [{ ...early, exportId: 'far', postId: undefined, lang: 'en', frozenAt: '2026-09-01T00:00:00.000Z' }],
  { postedAt: '2026-10-01T12:00:00.000Z', lang: 'en' },
);
if (!near || far) fail('近い書き出しだけ投稿へ付ける');

const workspace = mkdtempSync(path.join(tmpdir(), 'cvcs-published-'));
const service = new AnalyticsService(() => workspace);
try {
  service.initialize();
  service.syncProject(project);
  service.ensurePublishedSnapshots([project]);
  const post = service.bundle().posts[0];
  if (!post) fail('投稿がない');
  const first = service.postView(post.id).snapshot;
  const card = first?.scenes.find((scene) => scene.meaning === 'card');
  if (!first || first.source !== 'estimate' || !card) fail('過去動画は推定として保存する');
  project.templateParams = { ...project.templateParams, sceneDurations: { hook: 10 } };
  service.ensurePublishedSnapshots([project]);
  const second = service.postView(post.id).snapshot;
  const cardAgain = second?.scenes.find((scene) => scene.meaning === 'card');
  if (!cardAgain || cardAgain.startSec !== card.startSec) fail('再推定で投稿版の時刻を変えない');
  const frozen = service.freezePublishedExport({
    exportId: 'export-fixed',
    project,
    basename: 'clip',
    renderedDurationSec: 18.5,
    language: 'en',
    frozenAt: '2026-10-02T00:00:00.000Z',
  });
  project.templateParams = { ...project.templateParams, sceneDurations: { hook: 8 } };
  const again = service.freezePublishedExport({
    exportId: 'export-fixed',
    project,
    basename: 'clip',
    renderedDurationSec: 18.5,
    language: 'en',
    frozenAt: '2026-10-03T00:00:00.000Z',
  });
  if (again.scenes.find((scene) => scene.meaning === 'hook')?.endSec !== frozen.scenes.find((scene) => scene.meaning === 'hook')?.endSec) {
    fail('同じ書き出しIDを上書きしない');
  }
  console.log('published checks ok');
} finally {
  try {
    service.db().close();
  } catch {
    // 初期化前の失敗では閉じる対象がない。
  }
  rmSync(workspace, { recursive: true, force: true });
}
