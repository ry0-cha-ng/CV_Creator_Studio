import {
  AUTO_PROVIDERS,
  buildCaptionContext,
  buildPrompt,
  buildPublishingContext,
  clipAiInstruction,
  buildSummaryContext,
  findUnsafeContext,
  interpretModelOutput,
  omitApiCredentials,
  planUsageFromRateLimits,
  providersFor,
  shouldContinue,
} from '../shared/ai';
import { emptyAnalyticsBundle, type AnalyticsBundle, type AnalyticsPost } from '../shared/schema/analytics';
import { createDefaultProject } from '../shared/schema/project';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const project = createDefaultProject('p1', '2026-01-01T00:00:00.000Z');
project.assets.push({
  id: 'video-1',
  type: 'video',
  path: 'C:\\clips\\secret.mp4',
});
const caption = buildCaptionContext(project);
if (findUnsafeContext(caption)) fail('caption context should not include the video path');
if (JSON.stringify(caption).includes('secret.mp4')) fail('caption context leaked a path');
if (JSON.stringify(buildPublishingContext(project)).includes('.mp4')) fail('publishing context leaked a path');
const instructed = buildPrompt('captions', caption, '今の日本語テロップを英語にして');
if (!instructed.includes('追加の指示: 今の日本語テロップを英語にして')) fail('caption instruction missing');
const blank = buildPrompt('publishing', buildPublishingContext(project), '   ');
if (blank.includes('追加の指示')) fail('blank instruction should be omitted');
const clipped = buildPrompt('publishing', buildPublishingContext(project), 'あ'.repeat(800));
const instructionLine = clipped.split('\n').find((line) => line.startsWith('追加の指示: ')) ?? '';
if (clipAiInstruction('あ'.repeat(800)).length !== 400) fail('instruction clip length');
if (instructionLine.length !== '追加の指示: '.length + 400) fail('prompt kept a long instruction');
if (!findUnsafeContext('C:\\clips\\secret.mp4')) fail('instruction path should be refused');

const post = {
  id: 'post-1',
  projectId: 'p1',
  preset: 'yt-ja',
  platform: 'youtube',
  lang: 'ja',
  url: 'https://example.com/watch',
  postedAt: '2026-01-02T00:00:00.000Z',
  templateId: 't-std',
  hookPattern: 'result',
  content: {
    title: 'Ascent',
    map: 'Ascent',
    site: 'A',
    side: 'attack',
    agent: 'Phoenix',
    ability: 'Curveball',
    series: 'phoenix-lineups',
    templateId: 't-std',
    hookPattern: 'result',
    thumbnailPath: 'C:\\clips\\thumb.mp4',
  },
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
} as AnalyticsPost;
const bundle: AnalyticsBundle = { ...emptyAnalyticsBundle(), posts: [post] };
const summary = buildSummaryContext(bundle, post);
const summaryText = JSON.stringify(summary);
if (summaryText.includes('thumb.mp4') || summaryText.includes('example.com')) fail('summary context leaked a path or url');
if (findUnsafeContext(summary)) fail('summary context was marked unsafe');
if (!findUnsafeContext({ file: 'C:\\clips\\thumb.mp4' })) fail('a media path should be refused');

if (providersFor('auto').some((provider) => provider.includes('api'))) fail('auto must stay on the subscription path');
if (providersFor('auto').join() !== AUTO_PROVIDERS.join()) fail('auto order changed');
if (shouldContinue('auto', 'rate_limited')) fail('rate limit must stop the chain');
if (!shouldContinue('auto', 'unavailable')) fail('unavailable should try the next subscription path');
if (shouldContinue('claude-code-cli', 'unavailable')) fail('an explicit provider must not continue');

const env = omitApiCredentials({ ANTHROPIC_API_KEY: 'sk-ant-test', PATH: 'C:\\bin' });
if ('ANTHROPIC_API_KEY' in env) fail('api key remained in the child environment');
if (env.PATH !== 'C:\\bin') fail('unrelated environment was dropped');

const tooMany = interpretModelOutput(
  'captions',
  JSON.stringify({
    candidates: [1, 2, 3, 4].map((number) => ({
      hook: { ja: `あ${number}`, en: `A${number}` },
      stand: { ja: '立', en: 'STAND' },
      aim: { ja: '狙', en: 'AIM' },
    })),
  }),
);
if (!tooMany.ok || tooMany.payload.type !== 'captions' || tooMany.payload.candidates.length !== 3) {
  fail('caption candidates were not limited to 3');
}

const wrapped = interpretModelOutput(
  'summary',
  JSON.stringify({
    type: 'result',
    result: JSON.stringify({ good: ['伸びた', '余分', '余分2'], concerns: ['短い'], insufficient: false }),
  }),
);
if (!wrapped.ok || wrapped.payload.type !== 'summary' || wrapped.payload.good.length !== 2) {
  fail('summary points were not limited to 2');
}

const limited = interpretModelOutput('summary', 'You have hit your usage limit');
if (limited.ok || limited.code !== 'rate_limited') fail('usage limit was not recognized');

const bad = interpretModelOutput('hypothesis', 'not json');
if (bad.ok || bad.code !== 'invalid_output') fail('invalid text should be rejected');

const judgement = interpretModelOutput(
  'hypothesis',
  '{"judgement":"まだ判断しない","insufficient":true,"rationale":"判断材料不足"}',
);
if (!judgement.ok || judgement.payload.type !== 'hypothesis' || judgement.payload.judgement !== 'undecided') {
  fail('hypothesis label was not mapped');
}

const plan = planUsageFromRateLimits({
  five_hour: { utilization: 0, resets_at: '2026-10-04T15:59:59.000Z' },
  seven_day: { utilization: 2, resets_at: '2026-10-07T21:59:59.000Z' },
});
if (!plan || plan.headline !== '5時間 残100% · 7日 残98%' || plan.low) fail('plan remaining was not formatted');
if (planUsageFromRateLimits(null) !== null) fail('missing limits should be hidden');
const empty = planUsageFromRateLimits({ five_hour: { utilization: 100 } });
if (!empty || empty.windows[0]?.remainingPercent !== 0 || !empty.low) fail('full window should show 0% left');

console.log('ai checks ok');
