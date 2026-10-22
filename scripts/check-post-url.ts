import { checkPostUrl } from '../shared/post-url';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const id = 'dQw4w9WgXcQ';

const expectStatus = (
  platform: 'youtube' | 'tiktok' | 'x',
  input: string,
  status: 'valid' | 'warning' | 'error' | 'empty',
  messageIncludes?: string,
): ReturnType<typeof checkPostUrl> => {
  const verdict = checkPostUrl(platform, input);
  if (verdict.status !== status) {
    fail(`${platform} ${input} expected ${status}, got ${verdict.status} (${verdict.message ?? ''})`);
  }
  if (messageIncludes && !verdict.message?.includes(messageIncludes)) {
    fail(`${platform} ${input} message missing "${messageIncludes}": ${verdict.message ?? ''}`);
  }
  return verdict;
};

const shorts = expectStatus('youtube', `https://youtube.com/shorts/${id}`, 'valid');
if (shorts.normalizedUrl !== `https://youtube.com/shorts/${id}`) fail('shorts canonical');
const shortLink = expectStatus('youtube', `https://youtu.be/${id}?si=abc`, 'valid');
if (shortLink.normalizedUrl !== `https://youtube.com/shorts/${id}`) fail('youtu.be should become shorts');
const watch = expectStatus('youtube', `https://www.youtube.com/watch?v=${id}&feature=share`, 'warning', 'Shorts');
if (watch.suggestion?.url !== `https://youtube.com/shorts/${id}`) fail('watch suggestion');
const studio = expectStatus('youtube', `https://studio.youtube.com/video/${id}/edit`, 'warning', 'YouTube Studio');
if (studio.suggestion?.url !== `https://youtube.com/shorts/${id}`) fail('studio suggestion');
expectStatus('youtube', 'https://youtube.com/@h1gher', 'error', 'チャンネル');
expectStatus('youtube', 'https://youtube.com/channel/UCabcdefghijk', 'error', 'チャンネル');
expectStatus('youtube', 'https://example.com/video', 'error', 'YouTube Shorts');
expectStatus('youtube', '  \n', 'empty');

const tiktok = expectStatus('tiktok', 'https://www.tiktok.com/@h1gher/video/1234567890?is_from_webapp=1', 'valid');
if (tiktok.normalizedUrl !== 'https://tiktok.com/@h1gher/video/1234567890') fail('tiktok canonical');
expectStatus('tiktok', 'https://vm.tiktok.com/ZMabcdef/', 'warning', '短縮URL');
expectStatus('tiktok', 'https://tiktok.com/t/ZMabcdef', 'warning', '短縮URL');
expectStatus('tiktok', 'https://tiktok.com/@h1gher', 'error', 'プロフィールではなく');
expectStatus('tiktok', 'https://tiktok.com/@h1gher/', 'error', 'プロフィールではなく');
expectStatus('tiktok', 'https://tiktok.com/@h1gher?lang=ja', 'error', 'プロフィールではなく');
expectStatus('tiktok', 'https://tiktok.com/@h1gher/photo/123', 'error', '写真投稿');
expectStatus('tiktok', 'https://www.tiktok.com/tiktokstudio/content', 'error', 'TikTok Studio');
expectStatus('tiktok', 'https://tiktok.com/explore', 'error', 'TikTok の動画');

const post = expectStatus('x', 'https://x.com/h1gher/status/1234567890', 'valid');
if (post.normalizedUrl !== 'https://x.com/h1gher/status/1234567890') fail('x canonical');
const twitter = expectStatus('x', 'https://twitter.com/h1gher/status/1234567890?s=20', 'valid');
if (twitter.normalizedUrl !== 'https://x.com/h1gher/status/1234567890') fail('twitter should become x.com');
const mobile = expectStatus('x', 'https://mobile.twitter.com/h1gher/status/1234567890', 'valid');
if (mobile.normalizedUrl !== 'https://x.com/h1gher/status/1234567890') fail('mobile twitter');
const bare = expectStatus('x', 'https://x.com/i/status/1234567890', 'valid');
if (bare.normalizedUrl !== 'https://x.com/i/status/1234567890') fail('i/status');
const photo = expectStatus('x', 'https://x.com/h1gher/status/1234567890/photo/1', 'valid');
if (photo.normalizedUrl !== 'https://x.com/h1gher/status/1234567890') fail('strip photo');
const analytics = expectStatus('x', 'https://x.com/h1gher/status/1234567890/analytics', 'valid');
if (analytics.normalizedUrl !== 'https://x.com/h1gher/status/1234567890') fail('strip analytics');
expectStatus('x', 'https://x.com/h1gher', 'error', 'プロフィール');
expectStatus('x', 'https://x.com/home', 'error', 'ポストのURL');

const crossed = checkPostUrl('tiktok', `https://youtube.com/shorts/${id}`);
if (crossed.status !== 'error' || !crossed.message?.includes('YouTube')) fail('cross platform');

const duplicate = checkPostUrl('youtube', `https://youtube.com/shorts/${id}`, {
  taken: [{ url: `https://youtu.be/${id}`, projectTitle: 'Summit' }],
});
if (duplicate.status !== 'error' || !duplicate.message?.includes('Summit')) fail('duplicate url');

const own = checkPostUrl('youtube', `https://youtube.com/shorts/${id}`, {
  taken: [{ url: `https://youtu.be/${id}`, projectTitle: 'Summit', projectId: 'p1', preset: 'yt-global' }],
  ignore: { projectId: 'p1', preset: 'yt-global' },
});
if (own.status !== 'valid') fail('own url should stay valid');

const account = checkPostUrl('tiktok', 'https://tiktok.com/@other/video/123', {
  accounts: { tiktok: '@h1gher' },
});
if (account.status !== 'warning' || !account.message?.includes('@h1gher')) fail('account warning');

const padded = checkPostUrl('youtube', `  https://youtube.com/shorts/${id} \n`);
if (padded.status !== 'valid') fail('trim');

console.log('post-url checks ok');
