import { applySafeValue, appCtr, divide, isReferenceSample, savesPer1k } from '../shared/analytics';
import { createDefaultProject, parseProject } from '../shared/schema/project';
import type { MetricSnapshot } from '../shared/schema/analytics';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (divide(1, 0) !== null) fail('divide by zero should be null');
if (divide(undefined, 4) !== null) fail('missing numerator should be null');
const snapshot = { views: 0, clutchVaultVisits: 3 } as MetricSnapshot;
if (appCtr(snapshot) !== null) fail('app ctr with 0 views should be null');
if (savesPer1k({ views: 0, lineupSaves: 2 } as MetricSnapshot) !== null) fail('saves per 1k zero views');
if (!isReferenceSample(2) || isReferenceSample(3)) fail('n<3 reference sample');

const legacy = parseProject({
  schemaVersion: 4,
  id: 'v4',
  title: '版4',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lineup: {
    id: 'lineup-v4',
    map: 'Ascent',
    site: 'A',
    side: 'defense',
    agent: 'Phoenix',
    ability: 'Curveball',
    throwType: { ja: '通常', en: 'NORMAL' },
    crouch: false,
    standDescription: { ja: '角', en: 'CORNER' },
    aimDescription: { ja: '印', en: 'MARK' },
  },
  assets: [],
  clips: [],
  stills: [],
  scenes: [{ sceneKey: 'hook', layout916: 'blur-fit', cropCenterX: 0.5, volume: 1 }],
  captions: [{ id: 'hook', sceneKey: 'hook', text: { ja: 'あ', en: 'A' }, styleId: 'cap.hook' }],
  templateId: 't-std',
  timelineEdited: false,
  timeline: null,
  templateParams: { accent: '#FF4655', fps: 60, demoDuration: 11.5, sceneDurationOffsets: {} },
  hookPattern: 'custom',
  cardLayout: 'stack',
  cardStills: {},
  audio: { bgm: null },
  publishing: { title: { ja: '', en: '' }, description: { ja: '', en: '' }, hashtags: { ja: '', en: '' } },
  posts: [],
  status: 'editing',
  experiment: { phase: 'p1', testVariables: ['hook'], hypothesis: '結果型', series: 'phoenix-lineups' },
  guide: { mode: 'guide', lastStep: 1, confirmedSteps: [], publishingEdited: {} },
});
if (legacy.schemaVersion !== 7) fail('v4 should become v7');
if (legacy.analytics.series !== 'phoenix-lineups') fail('series should carry over');
if (!legacy.experiment.hypothesis) fail('legacy experiment kept for migration');

const project = createDefaultProject('apply', '2026-10-04T00:00:00.000Z');
const caption = project.captions.find((item) => item.id === 'hook')?.text.ja;
const applied = applySafeValue(project, 'hook', '結果型');
if (applied.hookPattern !== 'result') fail('hook pattern should update');
if (applied.captions.find((item) => item.id === 'hook')?.text.ja !== caption) fail('caption text must stay');
const opened = applySafeValue(project, 'opening', '結果先出し');
if (opened.analytics.openingType !== 'result-first') fail('opening stored on analytics');
if (opened.scenes[0]?.sceneKey !== project.scenes[0]?.sceneKey) fail('scene order must stay');

console.log('analytics checks ok');
