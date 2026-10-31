import {
  AUTO_PROVIDERS,
  buildCaptionContext,
  buildPrompt,
  buildPublishTranslateContext,
  buildPublishingContext,
  buildWordingContext,
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
import { patchWordingSession, wordingSessionOf } from '../src/guide/wording-session';

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

const translatePrompt = buildPrompt(
  'publish-translate',
  buildPublishTranslateContext(project, ['title', 'description']),
);
if (!translatePrompt.includes('URL、UTM、#で始まるハッシュタグは一文字も変えないでください。')) {
  fail('translate prompt dropped the keep-url rule');
}
if (translatePrompt.includes('候補は最大3件です。')) fail('translate prompt asked for three candidates');
if (findUnsafeContext(buildPublishTranslateContext(project, ['title']))) fail('translate context was marked unsafe');
const translated = interpretModelOutput(
  'publish-translate',
  '{"title":{"ja":"アセント","ko":"어센트"},"description":{"ja":"説明","ko":""}}',
);
if (!translated.ok || translated.payload.type !== 'publish-translate' || translated.payload.title?.ko !== '어센트') {
  fail('translate payload was not read');
}
if (translated.payload.type === 'publish-translate' && translated.payload.description?.ko) {
  fail('empty korean description should be omitted');
}
const emptyTranslation = interpretModelOutput('publish-translate', '{"title":{"ja":"","ko":""}}');
if (emptyTranslation.ok) fail('empty translation should be rejected');
if (!translatePrompt.includes('その前だけを訳してください')) fail('translate prompt should keep the title tail');
if (!buildPrompt('captions', caption).includes('因果を断定しないでください。')) {
  fail('caption prompt should keep the caution');
}
if (!buildPrompt('captions', caption).includes('hookJaMaxChars') || caption.limits.hookJaMaxChars !== 20) {
  fail('caption hook limit should be 20 characters');
}
if (caption.limits.jaMaxChars !== 15 || caption.limits.enMaxWords !== 6) {
  fail('non-hook caption limits changed');
}
const wordingContext = buildWordingContext(project, 'ワンウェイから無料キル', '短く');
if (findUnsafeContext(wordingContext)) fail('wording context was marked unsafe');
if (wordingContext.hookJaMaxChars !== 20 || wordingContext.hookEnMaxWords !== 6 || wordingContext.hookMaxLines !== 3) {
  fail('concise wording limits should match the caption check');
}
if (wordingContext.englishCaptionPreset !== 'en-concise') fail('saved concise preset should stay');
if (typeof wordingContext.throwType === 'string' || !wordingContext.stand.ja) fail('wording context dropped lineup text');
const wordingPrompt = buildPrompt('wording', wordingContext);
if (!wordingPrompt.includes('それぞれ5件')) fail('wording prompt should ask for five');
if (wordingPrompt.includes('候補は最大3件です。')) fail('wording prompt asked for three candidates');
if (wordingPrompt.includes('因果を断定しない')) fail('wording prompt should not use the analytics caution');
if (!wordingPrompt.includes('titleSuffix')) fail('wording prompt dropped the title suffix');
if (!wordingPrompt.includes('意味を確認するための自然な日本語訳')) fail('wording prompt should ask for a reading gloss');
if (!wordingPrompt.includes('投稿文には使いません')) fail('wording prompt should keep the gloss out of the post');
if (!wordingPrompt.includes('ワンウェイから無料キル') || !wordingPrompt.includes('"tone":"短く"')) {
  fail('wording prompt dropped the user brief or tone');
}
if (!wordingPrompt.includes("WHO'S HIDING BACK THERE?") || !wordingPrompt.includes('mollyを他のスキルの単語として使わない')) {
  fail('wording prompt dropped the style examples');
}
if (!wordingPrompt.includes('「投げる」「燃やす」「モロトフ」に固定しない')) fail('wording prompt fixed the verb');
const noted = buildPrompt('wording', wordingContext, 'もっと短く');
if (!noted.includes('追加の指示: もっと短く')) fail('wording prompt dropped an extra instruction');
const standardProject = createDefaultProject('p2', '2026-01-01T00:00:00.000Z');
standardProject.englishCaptionPreset = 'standard';
const standardContext = buildWordingContext(standardProject, '守りで開幕に前へ出る', '');
if (standardContext.hookEnMaxWords !== 6 || wordingContext.hookEnMaxWords !== 6 || project.englishCaptionPreset !== 'en-concise') {
  fail('english word limit should be 6 without rewriting the saved preset');
}
const bareProject = createDefaultProject('p3', '2026-01-01T00:00:00.000Z');
bareProject.lineup.throwType = { ja: '', en: '' };
bareProject.lineup.standDescription = { ja: '', en: '' };
bareProject.lineup.aimDescription = { ja: '', en: '' };
const bareBrief = '身体を出さず、サイトの死角にいる敵を確認する';
const barePrompt = buildPrompt('wording', buildWordingContext(bareProject, bareBrief, ''));
if (!barePrompt.includes(bareBrief) || barePrompt.includes('.mp4')) fail('empty throw info should still send the brief');
const sampleBriefs = [
  '意外な場所から、敵の設置と解除を妨害する。相手は届かないと思っている位置から手を出せる。',
  '守りで開幕に前へ出て、先制キルを狙う。待つ守りではなく、自分から仕掛ける。',
  'ミッドをラークしてくる相手の進路を、スキルで通りにくくする。',
  '身体を出さず、サイト内の特定の死角にいる敵を確認する。進入を決める前の判断材料になる。',
  '敵が裏取りすると反応する罠を、見落とされやすい位置に設置する。反応してもキルは確定しない。',
  '味方の進入に合わせて敵の視界を妨害し、味方が仕掛けやすい状況をつくる。',
];
for (const brief of sampleBriefs) {
  const sample = buildPrompt('wording', buildWordingContext(project, brief, '短く自信のある口調'));
  if (!sample.includes(brief) || findUnsafeContext(buildWordingContext(project, brief, '短く自信のある口調'))) {
    fail('sample brief was not sent safely');
  }
  if (!sample.includes('それぞれ5件') || sample.includes('http://') || sample.includes('https://')) {
    fail('sample prompt changed the count or added a url');
  }
}
const wording = interpretModelOutput(
  'wording',
  '{"hooks":[{"ja":"無料キル","en":"Free kills"}],"titles":["Free kills | Ascent A Phoenix Lineup"],"pinnedComments":["What angle should I cover next?"]}',
);
if (!wording.ok || wording.payload.type !== 'wording') fail('wording payload was not read');
if (wording.ok && wording.payload.type === 'wording') {
  if (wording.payload.hooks.length !== 1 || wording.payload.titles[0]?.en !== 'Free kills' || wording.payload.titles[0]?.ja !== '') {
    fail('wording title should drop the suffix');
  }
  if (wording.payload.pinnedComments[0]?.en !== 'What angle should I cover next?' || wording.payload.pinnedComments[0]?.ja !== '') {
    fail('pinned comment was dropped');
  }
}
const glossed = interpretModelOutput(
  'wording',
  '{"hooks":[],"titles":[{"en":"Free kills | Ascent A Phoenix Lineup","ja":"無料キル | アセント"}],"pinnedComments":[{"en":"What angle should I cover next?","ja":"次はどの角度をカバーしましょうか？"}]}',
);
if (!glossed.ok || glossed.payload.type !== 'wording') fail('glossed wording was not read');
if (glossed.ok && glossed.payload.type === 'wording') {
  if (glossed.payload.titles[0]?.en !== 'Free kills' || glossed.payload.titles[0]?.ja !== '無料キル') {
    fail('wording title gloss should keep only the lead');
  }
  if (glossed.payload.pinnedComments[0]?.ja !== '次はどの角度をカバーしましょうか？') {
    fail('pinned comment gloss was dropped');
  }
}
const emptyWording = interpretModelOutput('wording', '{"hooks":[],"titles":[],"pinnedComments":[]}');
if (emptyWording.ok) fail('empty wording should be rejected');
const keptLong = interpretModelOutput(
  'wording',
  JSON.stringify({
    hooks: [{ ja: 'あ'.repeat(20), en: 'One two three four five six' }],
    titles: [{ en: 'Check this corner before you walk in', ja: '入る前にこの角を確認する' }],
    pinnedComments: [{ en: 'Do you clear on the info or wait for your duo?', ja: '情報を見たら入る？デュオを待つ？' }],
  }),
);
if (!keptLong.ok || keptLong.payload.type !== 'wording') fail('long wording was rejected');
if (keptLong.ok && keptLong.payload.type === 'wording') {
  if (keptLong.payload.hooks[0]?.ja.length !== 20 || keptLong.payload.hooks[0]?.en !== 'One two three four five six') {
    fail('over-guide hook text was cut');
  }
  if (keptLong.payload.titles.length !== 1 || keptLong.payload.pinnedComments.length !== 1) {
    fail('wording should keep one title and one comment');
  }
}
const remembered = {
  hooks: [{ ja: '裏を取るな', en: 'Wrong route' }],
  titles: [{ en: 'A flank trap', ja: '裏取り用の罠' }],
  pinnedComments: [{ en: 'Wait or rotate?', ja: '待つ？回る？' }],
};
patchWordingSession('project-a', () => ({ ideas: remembered, picked: { hook: 0 } }));
if (wordingSessionOf('project-a').ideas?.hooks[0]?.ja !== '裏を取るな' || wordingSessionOf('project-a').picked.hook !== 0) {
  fail('wording ideas should stay after the screen unmounts');
}
if (wordingSessionOf('project-b').ideas) fail('another project should not see the ideas');
patchWordingSession('project-a', (current) => ({ picked: { ...current.picked, title: 1 } }));
if (wordingSessionOf('project-a').picked.hook !== 0 || wordingSessionOf('project-a').picked.title !== 1) {
  fail('wording picks should stay with the ideas');
}

console.log('ai checks ok');
