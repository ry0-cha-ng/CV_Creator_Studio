import { createDefaultProject } from '../shared/schema/project';
import {
  applyNeedsFix,
  createPublishing,
  currentTask,
  reconcilePublishing,
  skipTask,
  taskTitle,
} from '../shared/publishing';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

let sequence = 0;
const nextId = (): string => {
  sequence += 1;
  return `id-${sequence}`;
};

const now = '2026-10-05T09:00:00.000Z';
const project = createDefaultProject('pub', now);
project.guide.lastExport = {
  at: now,
  projectUpdatedAt: now,
  presets: ['yt-global', 'tt-jp', 'x-jp'],
  contentStamp: 'stamp-1',
  outputDir: 'exports/2026-10-05',
};
project.publishing.title = { ja: '日本語', en: 'English', ko: '한국어' };
project.publishing.links = {
  'yt-global': 'https://clutchvault.app/en/?utm_content=base_en',
  'tt-jp': 'https://clutchvault.app/?utm_content=base_ja',
  'x-jp': 'https://clutchvault.app/?utm_content=base_x',
};

const created = createPublishing(project, now, nextId);
if (!created) fail('workflow should be created');
const types = created.tasks.map((task) => task.type);
if (types.join(',') !== 'pre-publish-check,youtube-publish,tiktok-publish,x-publish,post-publish-verify,record-complete') {
  fail(`unexpected tasks: ${types.join(',')}`);
}
if (created.tasks.some((task) => task.preset === 'yt-ja' || task.preset === 'tt-en')) fail('unselected presets');
const first = currentTask(created.tasks);
if (first?.type !== 'pre-publish-check' || first.status !== 'ready') fail('first task should be ready');
if (created.tasks.filter((task) => task.status === 'ready').length !== 1) fail('only one ready task');
if (taskTitle(created.tasks[1]) !== 'YouTubeへ投稿してください') fail('youtube title');

const open = structuredClone(created);
const manual = open.tasks[0]?.checklistItems.find((entry) => entry.key === 'conditions-match');
if (!manual) fail('manual precheck item');
manual.checked = true;
open.tasks[0].status = 'in-progress';
open.tasks[1].urlDraft = 'https://youtube.com/shorts/draft';
sequence = 50;
const kept = reconcilePublishing(open, project, now, nextId);
if (!kept) fail('reconcile before post');
if (kept.tasks[0]?.id !== open.tasks[0]?.id) fail('precheck id must stay before posting');
const keptManual = kept.tasks[0]?.checklistItems.find((entry) => entry.key === 'conditions-match');
if (!keptManual?.checked || keptManual.id !== manual.id) fail('manual check must survive reconcile');
if (kept.tasks[1]?.urlDraft !== 'https://youtube.com/shorts/draft') fail('url draft must survive reconcile');

const skipped = skipTask(created, first.id, 'あとで', now);
const second = currentTask(skipped.tasks);
if (second?.type !== 'youtube-publish' || second.status !== 'ready') fail('skip should open youtube');

const posted = structuredClone(project);
posted.posts = [
  {
    id: 'post-yt',
    platform: 'youtube',
    lang: 'en',
    url: 'https://youtube.com/shorts/dQw4w9WgXcQ',
    postedAt: now,
    preset: 'yt-global',
  },
];
sequence = 100;
const absorbed = createPublishing(posted, now, nextId);
if (!absorbed) fail('absorbed workflow');
const youtube = absorbed.tasks.find((task) => task.preset === 'yt-global');
if (youtube?.status !== 'done') fail('existing url should complete youtube');
const active = currentTask(absorbed.tasks);
if (active?.type !== 'pre-publish-check') fail(`pre-check stays first, got ${active?.type}`);

const fixed = applyNeedsFix(absorbed.tasks, youtube?.id ?? '', now);
const back = fixed.find((task) => task.preset === 'yt-global');
if (back?.status !== 'needs-fix') fail('needs-fix');
if (currentTask(fixed)?.id !== back?.id) fail('needs-fix should be current');
const verify = fixed.find((task) => task.type === 'post-publish-verify');
if (verify?.status === 'ready' || verify?.status === 'done') fail('verify should wait');

posted.guide.lastExport = { ...posted.guide.lastExport!, contentStamp: 'stamp-2' };
sequence = 200;
const reconciled = reconcilePublishing(absorbed, posted, now, nextId);
if (!reconciled) fail('reconcile');
if (reconciled.tasks.find((task) => task.preset === 'yt-global')?.status !== 'done') {
  fail('re-export must not reopen a posted task');
}
if (!reconciled.workflow.staleExport) fail('stale export flag');

const both = structuredClone(project);
both.guide.exportPresets = ['yt-global', 'yt-ja', 'tt-jp'];
both.guide.lastExport = { ...both.guide.lastExport!, presets: both.guide.exportPresets };
sequence = 300;
const extra = createPublishing(both, now, nextId);
const youtubeTasks = extra?.tasks.filter((task) => task.type === 'youtube-publish') ?? [];
if (youtubeTasks.length !== 2) fail('one task per selected youtube preset');
if (youtubeTasks[0]?.preset !== 'yt-global' || youtubeTasks[1]?.preset !== 'yt-ja') fail('youtube preset order');

const recovered = structuredClone(project);
recovered.guide.exportPresets = [];
recovered.guide.lastExport = { ...recovered.guide.lastExport!, presets: [] };
recovered.publishing.links = {
  'yt-global': 'https://clutchvault.app/en/?utm_content=20261030_Bind_en_v1',
  'x-jp': 'https://clutchvault.app/?utm_content=20261030_Bind_x_v1',
};
sequence = 400;
const fromLinks = createPublishing(recovered, now, nextId);
if (!fromLinks) fail('thumbnail-only export should still open publishing from file links');
const recoveredPresets = fromLinks.tasks.flatMap((task) => (task.preset ? [task.preset] : []));
if (recoveredPresets.join(',') !== 'yt-global,x-jp') fail(`recovered presets ${recoveredPresets.join(',')}`);

console.log('publishing checks ok');
