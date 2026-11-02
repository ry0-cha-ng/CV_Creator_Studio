/**
 * 横動画（YouTube 通常動画）の投稿運用：プリセット・通常動画URL・Studio確認・ワークフロー・自動判定・
 * 分析 Post への記録（公開版との結び付け）を、一時フォルダの DB で通しで確認する。
 *   npx tsx scripts/check-long-publishing.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DELIVERY_PRESET_ORDER, DELIVERY_PRESETS, isLongPreset } from '../shared/delivery-presets';
import {
  chapterDraftProblems,
  createLongPublishing,
  latestLongExports,
  longContentStamp,
  longPrecheckAuto,
  longPublishFiles,
  longQaReady,
  longRecordAuto,
  longStatusForWorkflow,
  longYoutubeCopy,
  reconcileLongPublishing,
  LONG_QA_ITEMS,
} from '../shared/long/publishing';
import { longProjectSchema, type LongExportRecord, type LongProject } from '../shared/long/schema';
import { checkPostUrl, checkYoutubeVideoUrl } from '../shared/post-url';
import { completeTask, currentTask, upsertPublicationVerify } from '../shared/publishing';
import { defaultStudioChecks } from '../shared/youtube-publish';
import { youtubePublishMetadataSchema } from '../shared/schema/youtube-publish';
import { AnalyticsService } from '../electron/main/services/analytics-service';
import { LongPublishingService } from '../electron/main/services/long-publishing-service';
import { PublishingService } from '../electron/main/services/publishing-service';
import { baseProject, expect, expectEqual } from './long-test-utils';

let counter = 0;
const nextId = (): string => `id-${(counter += 1)}`;
const NOW = '2026-11-02T00:00:00.000Z';

const exportRecord = (language: 'ja' | 'en' | 'ko', exportId: string, at: string, project: LongProject, extra: Partial<LongExportRecord> = {}): LongExportRecord => {
  const basename = `20261102_test_long_${language}_v1`;
  const dir = 'exports/2026-11-02';
  return {
    exportId,
    at,
    language,
    fps: 60,
    files: [`${dir}/${basename}.mp4`, `${dir}/${basename}.srt`, `${dir}/${basename}_chapters.txt`, `${dir}/${basename}.txt`, `${dir}/${basename}.jpg`, `${dir}/${basename}.meta.json`],
    basename,
    durationTicks: 120_000 * 600,
    contentStamp: longContentStamp(project),
    ...extra,
  };
};

// ---------------------------------------------------------------------------
// プリセット：横動画用は短尺の一覧に出さない
{
  expect(isLongPreset('yt-long-ja') && !isLongPreset('yt-global'), '横動画プリセットの判定');
  expect(!DELIVERY_PRESET_ORDER.some((id) => isLongPreset(id)), '短尺の一覧に横動画プリセットを含めない');
  expectEqual([DELIVERY_PRESETS['yt-long-ko'].platform, DELIVERY_PRESETS['yt-long-ko'].longLanguage, DELIVERY_PRESETS['yt-long-ko'].format], ['youtube', 'ko', 'long'], '韓国語の横動画プリセット');
}

// ---------------------------------------------------------------------------
// 通常動画の URL
{
  const id = 'dQw4w9WgXcQ';
  expectEqual(checkYoutubeVideoUrl(`https://www.youtube.com/watch?v=${id}&si=abc`), { status: 'valid', normalizedUrl: `https://www.youtube.com/watch?v=${id}`, videoId: id, message: '✓ 有効なURLです' }, 'watch?v= を正とする');
  expectEqual(checkYoutubeVideoUrl(`https://youtu.be/${id}`).normalizedUrl, `https://www.youtube.com/watch?v=${id}`, 'youtu.be は watch?v= にそろえる');
  const shorts = checkYoutubeVideoUrl(`https://youtube.com/shorts/${id}`);
  expect(shorts.status === 'warning' && shorts.normalizedUrl === `https://www.youtube.com/watch?v=${id}`, 'Shorts の URL は警告（通常動画として公開されたか確認）');
  expect(checkYoutubeVideoUrl(`https://studio.youtube.com/video/${id}/edit`).status === 'warning', 'Studio の URL は警告');
  expect(checkYoutubeVideoUrl('https://www.youtube.com/@channel').status === 'error', 'チャンネルの URL はエラー');
  expect(checkYoutubeVideoUrl('').status === 'empty', '空');
  const taken = checkYoutubeVideoUrl(`https://youtu.be/${id}`, { taken: [{ url: `https://youtube.com/shorts/${id}`, projectTitle: '別の動画', projectId: 'p2', preset: 'yt-global' }] });
  expect(taken.status === 'error' && /別の動画/.test(taken.message ?? ''), '登録済みの動画は重複としてエラー（表記違いでも同じ動画ID）');
  // 短尺の判定は変わらない
  expect(checkPostUrl('youtube', `https://youtube.com/watch?v=${id}`).status === 'warning', '短尺では watch は従来どおり警告');
  expectEqual(checkPostUrl('youtube', `https://youtu.be/${id}`).normalizedUrl, `https://youtube.com/shorts/${id}`, '短尺では従来どおり Shorts URL');
}

// ---------------------------------------------------------------------------
// Studio の確認項目：通常動画だけ追加し、Shorts は変えない
{
  const shorts = defaultStudioChecks(youtubePublishMetadataSchema.parse({ contentKind: 'shorts' }));
  expectEqual(shorts.map((item) => item.key), ['game-title', 'related-videos', 'shorts-cover', 'paid-promotion', 'brand-partner', 'rights', 'translations'], 'Shorts の確認項目は従来どおり');
  const video = defaultStudioChecks(youtubePublishMetadataSchema.parse({ contentKind: 'video', relatedVideosMode: 'set' }));
  expectEqual(video.map((item) => item.key), ['game-title', 'related-videos', 'shorts-cover', 'paid-promotion', 'brand-partner', 'rights', 'translations', 'chapters', 'subtitles', 'end-screen'], '通常動画の確認項目');
  expect(video.find((item) => item.key === 'related-videos')!.status === 'not_applicable', '通常動画では Shorts の関連動画は対象外');
  expect(video.find((item) => item.key === 'chapters')!.required, 'チャプター表示の確認は必須');
}

// ---------------------------------------------------------------------------
// 内容の識別値：動画に関わる変更だけで変わる
{
  const project = baseProject();
  const stamp = longContentStamp(project);
  expectEqual(longContentStamp({ ...project, editor: { ...project.editor, playhead: 999 }, publishing: { ...project.publishing, title: { ja: '変更' } }, updatedAt: 'x', status: 'exported' }), stamp, '編集画面・投稿文・状態は含めない');
  expectEqual(longContentStamp({ ...project, assets: project.assets.map((asset) => ({ ...asset, proxyPath: 'other.mp4', missing: true })) }), stamp, 'プロキシ・欠落表示は含めない');
  expect(longContentStamp({ ...project, output: { ...project.output, fps: 30 } }) !== stamp, '出力設定の変更で変わる');
  // 保存→読み直し（既定値の補完）や、項目の並び順の違いでは変わらない
  const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(project))).reverse()) as LongProject;
  expectEqual(longContentStamp(longProjectSchema.parse(reordered)), stamp, '保存して読み直しても同じ');
  expectEqual(longContentStamp({ ...project, assets: project.assets.map((asset) => Object.fromEntries(Object.entries(asset).reverse()) as typeof asset) }), stamp, '項目の並び順に左右されない');
}

// ---------------------------------------------------------------------------
// チャプター草案の確認
{
  expectEqual(chapterDraftProblems('0:00 導入\n0:15 実戦\n1:02:03 まとめ'), [], '条件を満たす草案');
  expectEqual(chapterDraftProblems('0:05 導入\n0:10 実戦'), ['最初のチャプターが 0:00 ではありません', 'チャプターが3つ未満です（YouTube で表示されないことがあります）', '「0:05 導入」と「0:10 実戦」の間が10秒未満です'], '条件を満たさない草案');
}

// ---------------------------------------------------------------------------
// ワークフロー
{
  const base = baseProject();
  const project: LongProject = { ...base, output: { ...base.output, languages: ['ja', 'en'] } };
  expect(createLongPublishing(project, NOW, nextId) === null, '書き出し前は作らない');
  const exported: LongProject = {
    ...project,
    publishing: { ...project.publishing, url: 'https://youtu.be/dQw4w9WgXcQ' },
    exports: [
      exportRecord('ja', 'ex-ja-1', '2026-11-01T00:00:00.000Z', project),
      exportRecord('ja', 'ex-ja-part', '2026-11-01T12:00:00.000Z', project, { range: { start: 0, end: 120_000 } }),
      exportRecord('en', 'ex-en-1', '2026-11-01T01:00:00.000Z', project),
    ],
  };
  expectEqual(latestLongExports(exported).map(({ language, record }) => [language, record.exportId]), [['ja', 'ex-ja-1'], ['en', 'ex-en-1']], '部分書き出しは投稿の対象にしない');
  expectEqual(longPublishFiles(exported).filter((file) => file.language === 'ja').map((file) => file.kind), ['video', 'srt', 'chapters', 'copy', 'thumbnail', 'meta'], '出力ファイルの分類');
  const bundle = createLongPublishing(exported, NOW, nextId)!;
  expectEqual(bundle.tasks.map((task) => [task.type, task.preset ?? '', task.lang ?? '']), [
    ['pre-publish-check', '', ''],
    ['youtube-publish', 'yt-long-ja', 'ja'],
    ['youtube-publish', 'yt-long-en', 'en'],
    ['post-publish-verify', '', ''],
    ['record-complete', '', ''],
  ], '言語ごとの投稿タスク');
  const ja = bundle.tasks[1]!;
  expect(ja.checklistItems.some((entry) => entry.key === 'subtitles' && !entry.required), 'SRT があれば字幕アップロード（任意）を出す');
  expectEqual(ja.urlDraft, 'https://youtu.be/dQw4w9WgXcQ', '以前の URL 欄は最初の言語の下書きに引き継ぐ');
  expect(currentTask(bundle.tasks)?.type === 'pre-publish-check', '最初は投稿前確認');

  // 自動判定
  const checks = longPrecheckAuto(exported, { filesPresent: true, fileDetail: '', licenseOk: true, licenseDetail: '', chapters: { ja: '0:00 a\n0:20 b\n0:40 c', en: '0:00 a' } });
  expect(checks.find((check) => check.key === 'export-fresh')!.ok, '書き出し後に変更がなければ最新');
  expect(!checks.find((check) => check.key === 'copy-present')!.ok, 'タイトルが空なら未完了');
  const chapterCheck = checks.find((check) => check.key === 'chapters')!;
  expect(!chapterCheck.ok && chapterCheck.severity === 'warn' && /英語/.test(chapterCheck.detail), 'チャプターの問題は警告（言語付き）');
  const edited = { ...exported, output: { ...exported.output, captionMode: 'srt' as const } };
  const staleCheck = longPrecheckAuto(edited, { filesPresent: true, fileDetail: '', licenseOk: true, licenseDetail: '', chapters: {} }).find((check) => check.key === 'export-fresh')!;
  expect(!staleCheck.ok && staleCheck.severity === undefined, '書き出し後に内容を変えたら最新ではない（止める）');
  const jaOnly = { ...exported, exports: exported.exports.filter((record) => record.language === 'ja') };
  const missing = longPrecheckAuto(jaOnly, { filesPresent: true, fileDetail: '', licenseOk: true, licenseDetail: '', chapters: {} }).find((check) => check.key === 'export-fresh')!;
  expect(!missing.ok && missing.severity === 'warn' && /英語/.test(missing.detail), '書き出していない言語は警告（投稿の対象外）');

  // 投稿 → 公開確認 → QA → 記録
  let working = completeTask(bundle, bundle.tasks[0]!.id, NOW);
  working = completeTask(working, ja.id, NOW, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', postedAt: NOW });
  working = upsertPublicationVerify(working, working.tasks.find((task) => task.id === ja.id)!, '2026-11-03T00:00:00.000Z', NOW, nextId);
  expect(working.tasks.some((task) => task.type === 'youtube-publication-verify' && task.preset === 'yt-long-ja'), '予約したら公開確認タスクを作る');
  const en = working.tasks.find((task) => task.preset === 'yt-long-en' && task.type === 'youtube-publish')!;
  working = completeTask(working, en.id, NOW, { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', postedAt: NOW });
  const verify = working.tasks.find((task) => task.type === 'youtube-publication-verify')!;
  working = completeTask(working, verify.id, NOW);
  const qaTask = working.tasks.find((task) => task.type === 'post-publish-verify')!;
  const allOk = Object.fromEntries(LONG_QA_ITEMS.map((entry) => [entry.key, 'ok' as const]));
  expect(!longQaReady(qaTask, ['yt-long-ja', 'yt-long-en']), 'QA 未記入では完了できない');
  expect(longQaReady({ ...qaTask, qa: { 'yt-long-ja': allOk, 'yt-long-en': allOk } }, ['yt-long-ja', 'yt-long-en']), 'すべて OK なら完了できる');
  const posts = [
    { preset: 'yt-long-ja' as const, language: 'ja' as const, url: 'u1', postedAt: NOW, exportId: 'ex-ja-1' },
    { preset: 'yt-long-en' as const, language: 'en' as const, url: 'u2', postedAt: NOW },
  ];
  const record = longRecordAuto(working.tasks, posts);
  expect(record.find((check) => check.key === 'recorded')!.ok && !record.find((check) => check.key === 'export-linked')!.ok, '版と結び付いていない投稿を検出');

  // 投稿後に書き出し直すと staleExport
  const reexported: LongProject = { ...exported, exports: [...exported.exports, exportRecord('ja', 'ex-ja-2', '2026-11-02T00:00:00.000Z', project)] };
  const reconciled = reconcileLongPublishing(working, reexported, NOW, nextId)!;
  expect(reconciled.workflow.staleExport === true, '投稿後の書き出し直しを知らせる');
  expect(reconciled.tasks.find((task) => task.id === ja.id)?.status === 'done', '投稿済みのタスクは残す');
  // 投稿前なら、チェックを引き継いで最新の書き出しに合わせる
  const checked = { ...bundle, tasks: bundle.tasks.map((task) => (task.id === ja.id ? { ...task, checklistItems: task.checklistItems.map((entry) => ({ ...entry, checked: entry.key === 'title' })) } : task)) };
  const before = reconcileLongPublishing(checked, reexported, NOW, nextId)!;
  expect(!before.workflow.staleExport && before.workflow.exportStamp?.includes('ex-ja-2'), '投稿前は最新の書き出しに合わせる');
  expect(before.tasks.find((task) => task.id === ja.id)!.checklistItems.find((entry) => entry.key === 'title')!.checked, 'チェックを引き継ぐ');
  // 言語を追加すると投稿タスクが増える
  const withKo: LongProject = { ...reexported, output: { ...reexported.output, languages: ['ja', 'en', 'ko'] }, exports: [...reexported.exports, exportRecord('ko', 'ex-ko-1', NOW, project)] };
  expect(reconcileLongPublishing(checked, withKo, NOW, nextId)!.tasks.some((task) => task.preset === 'yt-long-ko'), '言語の追加');

  // 状態
  expectEqual(longStatusForWorkflow(exported, { workflow: { ...bundle.workflow, status: 'done' }, posts: [{ ...posts[0]!, publicationState: 'scheduled' }] }), 'exported', '予約中は posted にしない');
  expectEqual(longStatusForWorkflow(exported, { workflow: { ...bundle.workflow, status: 'done' }, posts }), 'posted', '公開済みなら posted');

  // 投稿用の文章：チャプター込み
  const copy = longYoutubeCopy({ ...exported, publishing: { ...exported.publishing, title: { ja: '定点集' }, description: { ja: '説明です' }, tags: ['#valorant', '定点'] } }, 'ja', '0:00 導入\n0:20 実戦', [{ title: '曲', artist: '作者', creditRequired: true, creditText: '' }]);
  expectEqual(copy, { title: '定点集', description: '説明です\n\nチャプター\n0:00 導入\n0:20 実戦\n\nBGM・効果音\n曲 / 作者\n\n#valorant #定点', tags: ['valorant', '定点'] }, 'YouTube の説明欄');
}

// ---------------------------------------------------------------------------
// サービスの通し確認（一時フォルダの DB）
const main = async (): Promise<void> => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'cvcs-long-publishing-'));
  const open: Array<{ close: () => void }> = [];
  try {
    const base = baseProject();
    const project: LongProject = {
      ...base,
      output: { ...base.output, languages: ['ja'] },
      publishing: { ...base.publishing, title: { ja: '横動画テスト' }, description: { ja: '説明' } },
    };
    const record = exportRecord('ja', 'ex-ja-1', '2026-11-01T00:00:00.000Z', project);
    const exported: LongProject = { ...project, exports: [record] };
    mkdirSync(path.join(workspace, 'exports', '2026-11-02'), { recursive: true });
    for (const file of record.files) writeFileSync(path.join(workspace, file), file.endsWith('_chapters.txt') ? '0:00 導入\n0:20 実戦\n0:40 まとめ\n' : 'x');
    const analytics = new AnalyticsService(() => workspace);
    analytics.initialize();
    open.push(analytics.db());
    // 書き出し時の公開版（LongExportService が固定保存するもの）
    analytics.freezeLongExport({
      exportId: 'ex-ja-1',
      projectId: project.id,
      basename: record.basename,
      lang: 'ja',
      format: 'long',
      source: 'export',
      needsReview: false,
      frozenAt: record.at,
      durationSec: 600,
      renderedDurationSec: 600,
      templateId: 'T-LONG',
      templateVersion: '1',
      hookPattern: '',
      scenes: [],
    } as never);
    const publishing = new PublishingService(
      () => workspace,
      async () => {
        throw new Error('短尺の Project は読まない');
      },
      async () => [],
      () => analytics.urlRows(),
      () => false,
      () => null,
    );
    publishing.initialize();
    const service = new LongPublishingService({ publishing, analytics, loadProject: async () => exported, workspace: () => workspace, getTrack: () => null });
    let view = await service.view(project.id);
    expect(view.available && view.tasks.length === 4, 'ワークフローを作る（投稿前確認・日本語・QA・記録）');
    expect(Object.values(view.present).every(Boolean), '書き出しファイルがそろっている');
    expect(view.copy.ja?.description.includes('0:20 実戦'), '書き出したチャプター草案から説明欄を作る');
    const pre = view.tasks[0]!;
    view = await service.complete(project.id, pre.id, { checklist: pre.checklistItems.map((entry) => ({ id: entry.id, checked: true })) });
    const jaTask = view.tasks.find((task) => task.type === 'youtube-publish')!;
    let failed = '';
    try {
      await service.complete(project.id, jaTask.id, { url: 'https://youtu.be/dQw4w9WgXcQ' });
    } catch (error) {
      failed = String(error);
    }
    expect(/必須があと/.test(failed), '必須のチェックが残っていれば完了しない');
    view = await service.complete(project.id, jaTask.id, {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      checklist: jaTask.checklistItems.map((entry) => ({ id: entry.id, checked: true })),
    });
    expectEqual(view.posts.map((post) => [post.preset, post.url, post.exportId, post.videoId]), [['yt-long-ja', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'ex-ja-1', 'dQw4w9WgXcQ']], '分析の Post に記録し、書き出した版と結び付ける');
    const post = analytics.longPosts(project.id)[0]!;
    expect(post.contentType === 'VIDEO_ON_DEMAND' && post.lang === 'ja', '通常動画として記録');
    expectEqual(analytics.postView(post.id).snapshot?.exportId, 'ex-ja-1', '公開版の記録が投稿に結び付く');
    expect(!analytics.bundle().tasks.some((task) => task.postId === post.id), '横動画には短尺の振り返りタスクを作らない');
    // 別の Project で同じ URL は使えない
    expect(checkYoutubeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { taken: publishing.takenAll(), ignore: { projectId: 'other', preset: 'yt-long-ja' } }).status === 'error', '登録済みの URL を重複として検出');
    // QA → 記録完了
    const qa = view.tasks.find((task) => task.type === 'post-publish-verify')!;
    const marks = Object.fromEntries(LONG_QA_ITEMS.map((entry) => [entry.key, 'ok' as const]));
    view = await service.complete(project.id, qa.id, { qa: { 'yt-long-ja': marks } });
    const recordTask = view.tasks.find((task) => task.type === 'record-complete')!;
    view = await service.complete(project.id, recordTask.id, {});
    expect(view.workflow?.status === 'done', 'ワークフローが完了');
    expectEqual(longStatusForWorkflow(exported, view), 'posted', 'Project は投稿済み');
    // やり直し
    view = await service.needsFix(project.id, jaTask.id);
    expect(view.tasks.find((task) => task.id === jaTask.id)?.status === 'needs-fix' && view.workflow?.status === 'in-progress', '投稿のやり直し');
    // YouTube（API）からの反映：やり直して新しい動画を予約 → 公開確認タスク
    const source = await service.draftSource(project.id, 'yt-long-ja');
    expect(source.exportId === 'ex-ja-1' && source.videoPath.endsWith('.mp4') && source.copy.title === '横動画テスト', 'API 投稿の下書きに使う書き出し');
    await service.applyYoutubePublication(project.id, jaTask.id, {
      url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb',
      videoId: 'bbbbbbbbbbb',
      exportRef: { exportId: 'ex-ja-1', frozenAt: NOW },
      publicationState: 'scheduled',
      scheduledPublishAt: '2026-11-05T00:00:00.000Z',
      advance: true,
    });
    view = await service.view(project.id);
    expect(view.tasks.some((task) => task.type === 'youtube-publication-verify' && task.dueAt === '2026-11-05T00:00:00.000Z'), '予約の公開確認タスク');
    expect(view.posts[0]?.publicationState === 'scheduled' && !view.posts[0]?.postedAt, '予約中は投稿日時を入れない（前の動画の公開日時を引き継がない）');
    expect(view.posts[0]?.videoId === 'bbbbbbbbbbb' && view.posts.length === 1, '同じ言語の Post を新しい動画に付け替える');
  } finally {
    for (const database of open) {
      try {
        database.close();
      } catch {
        // 閉じ済み
      }
    }
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      // PublishingService の DB は閉じる手段がないため、一時フォルダが残ることがある
    }
  }
};

main()
  .then(() => console.log('long publishing ok'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
