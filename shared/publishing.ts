import { z } from 'zod';
import {
  DELIVERY_PRESET_ORDER,
  DELIVERY_PRESETS,
  platformsFor,
  type DeliveryPresetId,
} from './delivery-presets';
import { guessBasename, trackingFor, trackingUrlNearTop } from './export-copy';
import { guideStepNumber, publishingPresets } from './guide';
import type { PostUrlVerdict, TakenPostUrl } from './post-url';
import type { Project } from './schema/project';

export { publishingPresets };

export const workflowStatusSchema = z.enum(['pending', 'in-progress', 'done']);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const workflowTaskTypeSchema = z.enum([
  'pre-publish-check',
  'youtube-publish',
  'tiktok-publish',
  'x-publish',
  'youtube-publication-verify',
  'post-publish-verify',
  'record-complete',
]);
export type WorkflowTaskType = z.infer<typeof workflowTaskTypeSchema>;

export const workflowTaskStatusSchema = z.enum([
  'pending',
  'ready',
  'in-progress',
  'done',
  'skipped',
  'needs-fix',
]);
export type WorkflowTaskStatus = z.infer<typeof workflowTaskStatusSchema>;

export const checklistItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  hint: z.string().optional(),
  required: z.boolean(),
  auto: z.boolean().optional(),
  checked: z.boolean(),
  checkedAt: z.string().optional(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const qaMarkSchema = z.enum(['ok', 'problem']);
export type QaMark = z.infer<typeof qaMarkSchema>;

export const workflowTaskSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  projectId: z.string(),
  type: workflowTaskTypeSchema,
  platform: z.enum(['youtube', 'tiktok', 'x']).optional(),
  preset: z.string().optional(),
  lang: z.enum(['ja', 'en']).optional(),
  status: workflowTaskStatusSchema,
  required: z.boolean(),
  dependsOnTaskIds: z.array(z.string()).default([]),
  dueAt: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  skippedReason: z.string().optional(),
  urlDraft: z.string().optional(),
  postedAtDraft: z.string().optional(),
  warningNote: z.string().optional(),
  checklistItems: z.array(checklistItemSchema).default([]),
  qa: z.record(z.string(), z.record(z.string(), qaMarkSchema)).optional(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowTask = z.infer<typeof workflowTaskSchema>;

export const publishingWorkflowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: workflowStatusSchema,
  selectedPresets: z.array(z.string()).default([]),
  exportStamp: z.string().optional(),
  currentTaskId: z.string().optional(),
  pausedForToday: z.boolean().optional(),
  pausedOn: z.string().optional(),
  staleExport: z.boolean().optional(),
  skipQaPresets: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});
export type PublishingWorkflow = z.infer<typeof publishingWorkflowSchema>;

export const publishingSettingsSchema = z.object({
  accounts: z
    .object({
      youtube: z.string().default(''),
      tiktok: z.string().default(''),
      x: z.string().default(''),
    })
    .default({ youtube: '', tiktok: '', x: '' }),
  enable24hCheck: z.boolean().default(false),
});
export type PublishingSettings = z.infer<typeof publishingSettingsSchema>;

export const DEFAULT_PUBLISHING_SETTINGS: PublishingSettings = {
  accounts: { youtube: '', tiktok: '', x: '' },
  enable24hCheck: false,
};

export type AutoCheck = {
  key: string;
  label: string;
  detail: string;
  ok: boolean;
  severity?: 'warn';
};

export type PublishFileKind = 'video' | 'thumbnail' | 'xCard' | 'copy';

export type PublishFile = {
  preset: DeliveryPresetId;
  kind: PublishFileKind;
  name: string;
  relativePath: string;
};

export type PublishingBundle = {
  workflow: PublishingWorkflow;
  tasks: WorkflowTask[];
};

const PUBLISH_TYPES = new Set<WorkflowTaskType>(['youtube-publish', 'tiktok-publish', 'x-publish']);

export const isPublishTask = (type: WorkflowTaskType): boolean => PUBLISH_TYPES.has(type);

export const publishTypeFor = (preset: DeliveryPresetId): 'youtube-publish' | 'tiktok-publish' | 'x-publish' => {
  const platform = DELIVERY_PRESETS[preset].platform;
  if (platform === 'tiktok') return 'tiktok-publish';
  if (platform === 'x') return 'x-publish';
  return 'youtube-publish';
};

export const orderedPresets = (presets: DeliveryPresetId[]): DeliveryPresetId[] => {
  const selected = new Set(presets);
  const ordered: DeliveryPresetId[] = [];
  for (const platform of ['youtube', 'tiktok', 'x'] as const) {
    for (const id of DELIVERY_PRESET_ORDER) {
      if (selected.has(id) && DELIVERY_PRESETS[id].platform === platform) ordered.push(id);
    }
  }
  return ordered;
};

export const PUBLISH_PAGES = {
  youtube: { href: 'https://studio.youtube.com/', label: 'YouTube Studio を開く' },
  tiktok: { href: 'https://www.tiktok.com/tiktokstudio/upload', label: 'TikTok Studio を開く' },
  x: { href: 'https://x.com/compose/post', label: 'X の投稿画面を開く' },
} as const;

export const QA_ITEMS: Record<
  'youtube' | 'tiktok' | 'x',
  Array<{ key: string; label: string; hint: string }>
> = {
  youtube: [
    { key: 'url', label: 'URLが開く', hint: '公開した Shorts を開く' },
    { key: 'visibility', label: '公開状態が正しい', hint: '限定公開や予約のままになっていない' },
    { key: 'video', label: '映像が正常に再生される', hint: '' },
    { key: 'audio', label: '音声・BGM・効果音が正常', hint: '' },
    { key: 'overlay', label: 'テロップが UI に隠れていない', hint: '右のボタンと下のタイトル' },
    { key: 'language', label: '言語・タイトル・説明が正しい', hint: '英語。翻訳欄は使っていれば確認' },
    { key: 'link', label: 'ClutchVault URLが開き、UTM が正しい', hint: 'utm_source=youtube' },
    { key: 'claims', label: '警告・権利申し立てがない', hint: '' },
  ],
  tiktok: [
    { key: 'url', label: 'URLが開く', hint: 'プロフィールではなく動画' },
    { key: 'visibility', label: '公開状態が正しい', hint: '全員に公開' },
    { key: 'video', label: '映像が正常に再生される', hint: '' },
    { key: 'audio', label: '音声・BGM・効果音が正常', hint: 'TikTok 側の音が足されていない' },
    { key: 'overlay', label: 'テロップが UI に隠れていない', hint: '右側のアイコン・下部のキャプション' },
    { key: 'language', label: '言語・キャプションが正しい', hint: '日本語' },
    { key: 'link', label: 'プロフィールの ClutchVault が開き、UTM が正しい', hint: 'utm_source=tiktok' },
    { key: 'claims', label: '警告・権利申し立てがない', hint: '' },
  ],
  x: [
    { key: 'url', label: 'URLが開く', hint: 'ポストを開く' },
    { key: 'visibility', label: '公開状態が正しい', hint: '' },
    { key: 'card', label: 'カードが見える', hint: '4:5 の画像' },
    { key: 'language', label: '投稿文が正しい', hint: '日本語' },
    { key: 'link', label: 'ClutchVault URLが開く', hint: '定点の詳細ページ。投稿文のリンクに UTM は付けない' },
  ],
};

const item = (
  taskId: string,
  key: string,
  label: string,
  required: boolean,
  hint?: string,
  auto = false,
): ChecklistItem => ({
  id: `${taskId}:${key}`,
  key,
  label,
  hint,
  required,
  auto: auto || undefined,
  checked: false,
});

const checklistFor = (taskId: string, type: WorkflowTaskType, preset?: DeliveryPresetId): ChecklistItem[] => {
  if (type === 'pre-publish-check') {
    return [
      item(taskId, 'export-fresh', '書き出しが最新', true, undefined, true),
      item(taskId, 'files-exist', '必要なファイルがそろっている', true, undefined, true),
      item(taskId, 'copy-present', '投稿文が空でない', true, undefined, true),
      item(taskId, 'license-ok', '音源のライセンスに問題がない', true, undefined, true),
      item(taskId, 'utm-ready', 'ClutchVault の UTM 付き URL ができている', true, undefined, true),
      item(taskId, 'experiment-arm', '実験の Control / Variant が決まっている', true, undefined, true),
      item(taskId, 'conditions-match', '今回の言語と実験の条件が想定どおり', true, '目で確認'),
    ];
  }
  if (type === 'youtube-publish') {
    const english = preset !== 'yt-ja';
    const rows = [
      item(taskId, 'upload', english ? '英語MP4をアップロード' : '日本語MP4をアップロード', true),
      item(taskId, 'title', 'タイトルを貼る', true, 'フック先頭・内部記法なし'),
      item(taskId, 'description', '説明文を貼る', true, '概要の直後にUTM URL。クローズドβ前の公開状況'),
      item(taskId, 'hashtags', 'ハッシュタグを説明文の末尾に置く', true),
      item(taskId, 'thumbnail', 'サムネイル / カバーを確認', true),
      item(taskId, 'clutchvault', 'ClutchVault導線を確認', true, 'URLを開き、遷移先とUTMを確認'),
      item(taskId, 'schedule', '公開設定・公開日時を確認', true),
      item(taskId, 'publish', '公開する', true),
    ];
    if (preset === 'yt-global') {
      rows.push(
        item(taskId, 'ja-translation', '日本語の翻訳タイトル・説明を設定', false),
        item(taskId, 'ko-translation', '韓国語の翻訳タイトル・説明を設定', false),
      );
    }
    rows.push(item(taskId, 'related', '関連動画を設定', false));
    return rows;
  }
  if (type === 'tiktok-publish') {
    const japanese = preset !== 'tt-en';
    return [
      item(taskId, 'upload', japanese ? '日本語MP4を選択' : '英語MP4を選択', true),
      item(taskId, 'caption', 'キャプション・ハッシュタグを設定', true),
      item(taskId, 'cover', 'カバーを確認', true),
      item(taskId, 'audio', '音声 / BGMが意図どおりか確認', true),
      item(taskId, 'clutchvault', 'ClutchVaultへの導線を確認', true, 'プロフィール'),
      item(taskId, 'publish', '公開する', true),
    ];
  }
  if (type === 'x-publish') {
    return [
      item(taskId, 'card', 'X用4:5カードを添付', true),
      item(taskId, 'copy', '投稿文を貼り付け', true),
      item(taskId, 'clutchvault', 'ClutchVault URLを確認', true),
      item(taskId, 'publish', '投稿する', true),
    ];
  }
  return [];
};

const settled = (status: WorkflowTaskStatus): boolean => status === 'done' || status === 'skipped';

export const taskTitle = (task: WorkflowTask): string => {
  if (task.type === 'pre-publish-check') return '投稿前確認';
  if (task.type === 'youtube-publish') return 'YouTubeへ投稿してください';
  if (task.type === 'tiktok-publish') return 'TikTokへ投稿してください';
  if (task.type === 'x-publish') return 'Xへ投稿してください';
  if (task.type === 'youtube-publication-verify') return 'YouTubeの公開を確認してください';
  if (task.type === 'post-publish-verify') return '公開後QA';
  return '記録完了';
};

export const taskShortLabel = (task: WorkflowTask): string => {
  if (task.type === 'pre-publish-check') return '投稿前確認';
  if (task.type === 'youtube-publish') return 'YouTube';
  if (task.type === 'tiktok-publish') return 'TikTok';
  if (task.type === 'x-publish') return 'X';
  if (task.type === 'youtube-publication-verify') return 'YT公開確認';
  if (task.type === 'post-publish-verify') return '公開後QA';
  return '記録完了';
};

export const taskBlurb = (task: WorkflowTask): string => {
  if (task.type === 'pre-publish-check') return '投稿を始める前に1回だけ確認します。アプリが判定できるものは判定済みです';
  if (task.type === 'youtube-publish') {
    return `${task.preset === 'yt-ja' ? '日本語版' : '英語版'}（${task.preset ?? 'youtube'}）を YouTube Shorts に手動で投稿し、URLを記録します`;
  }
  if (task.type === 'tiktok-publish') {
    return `${task.preset === 'tt-en' ? '英語版' : '日本語版'}（${task.preset ?? 'tiktok'}）を TikTok に手動で投稿し、URLを記録します`;
  }
  if (task.type === 'x-publish') return 'X用カードと、日英フックから作った投稿文を手動で投稿し、ポストのURLを記録します';
  if (task.type === 'youtube-publication-verify') {
    return '予約公開はYouTubeが行います。予定時刻までは他媒体を進められます。公開後に状態を再取得してください';
  }
  if (task.type === 'post-publish-verify') return '数字はまだ見ません。公開した投稿を開いて、事故がないかだけ確かめます';
  return '投稿の記録と、振り返りの予約がそろっているかを最後に確かめます。すべて自動で判定します';
};

const isWaitingPublication = (task: WorkflowTask, now = new Date()): boolean => {
  if (task.type !== 'youtube-publication-verify' || !task.dueAt) return false;
  const due = new Date(task.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() > now.getTime();
};

export const currentTask = (tasks: WorkflowTask[], now = new Date()): WorkflowTask | null => {
  const ordered = [...tasks].sort((left, right) => left.sortOrder - right.sortOrder);
  return (
    ordered.find((task) => task.status === 'needs-fix') ??
    ordered.find(
      (task) => (task.status === 'ready' || task.status === 'in-progress') && !isWaitingPublication(task, now),
    ) ??
    null
  );
};

export const refreshReadiness = (tasks: WorkflowTask[]): WorkflowTask[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return [...tasks]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((task) => {
      if (task.status === 'done' || task.status === 'skipped' || task.status === 'needs-fix') return task;
      const ready = task.dependsOnTaskIds.every((id) => {
        const dependency = byId.get(id);
        return Boolean(dependency && settled(dependency.status));
      });
      const status: WorkflowTaskStatus = ready
        ? task.status === 'in-progress'
          ? 'in-progress'
          : 'ready'
        : 'pending';
      return status === task.status ? task : { ...task, status };
    });
};

const chainDependencies = (tasks: WorkflowTask[]): WorkflowTask[] => {
  const ordered = [...tasks].sort((left, right) => left.sortOrder - right.sortOrder);
  return ordered.map((task, index) => {
    if (task.type === 'youtube-publication-verify') {
      const youtube = ordered.find((item) => item.type === 'youtube-publish' && item.preset === task.preset);
      return { ...task, dependsOnTaskIds: youtube ? [youtube.id] : [] };
    }
    const blockers = ordered.slice(0, index).filter((item) => item.type !== 'youtube-publication-verify');
    const extra =
      task.type === 'post-publish-verify' || task.type === 'record-complete'
        ? ordered.filter((item) => item.type === 'youtube-publication-verify').map((item) => item.id)
        : [];
    return { ...task, dependsOnTaskIds: [...new Set([...blockers.map((item) => item.id), ...extra])] };
  });
};

const stampBundle = (bundle: PublishingBundle, now: string): PublishingBundle => {
  const tasks = refreshReadiness(chainDependencies(bundle.tasks));
  const active = currentTask(tasks);
  const requiredOpen = tasks.some((task) => task.required && !settled(task.status) && task.status !== 'needs-fix');
  const needsFix = tasks.some((task) => task.status === 'needs-fix');
  let status = bundle.workflow.status;
  if (!requiredOpen && !needsFix && tasks.length > 0 && tasks.every((task) => settled(task.status))) {
    status = 'done';
  } else if (status === 'done') {
    status = 'in-progress';
  }
  return {
    workflow: {
      ...bundle.workflow,
      status,
      currentTaskId: active?.id,
      updatedAt: now,
      completedAt: status === 'done' ? bundle.workflow.completedAt ?? now : undefined,
    },
    tasks,
  };
};

const postedPreset = (project: Project, preset: string): boolean =>
  project.posts.some((post) => post.preset === preset && post.url.trim());

const absorbExistingUrls = (bundle: PublishingBundle, project: Project, now: string): PublishingBundle => {
  const tasks = bundle.tasks.map((task) => {
    if (!task.preset || !isPublishTask(task.type)) return task;
    if (task.status === 'skipped' || task.status === 'needs-fix' || task.status === 'done') return task;
    if (!postedPreset(project, task.preset)) return task;
    const post = project.posts.find((item) => item.preset === task.preset);
    return {
      ...task,
      status: 'done' as const,
      urlDraft: post?.url ?? task.urlDraft,
      postedAtDraft: post?.postedAt ?? task.postedAtDraft,
      completedAt: task.completedAt ?? post?.postedAt ?? now,
      checklistItems: task.checklistItems.map((entry) => ({ ...entry, checked: true })),
      updatedAt: now,
    };
  });
  const publish = tasks.filter((task) => isPublishTask(task.type));
  const allPosted = publish.length > 0 && publish.every((task) => task.status === 'done');
  const nextTasks = allPosted
    ? tasks.map((task) =>
        task.type === 'pre-publish-check' && task.status !== 'done'
          ? {
              ...task,
              status: 'done' as const,
              completedAt: task.completedAt ?? now,
              checklistItems: task.checklistItems.map((entry) => ({ ...entry, checked: true })),
              updatedAt: now,
            }
          : task,
      )
    : tasks;
  return stampBundle({ ...bundle, tasks: nextTasks }, now);
};

export const createPublishing = (
  project: Project,
  now: string,
  nextId: () => string,
): PublishingBundle | null => {
  const presets = publishingPresets(project);
  if (presets.length === 0) return null;
  const workflowId = nextId();
  const make = (
    type: WorkflowTaskType,
    sortOrder: number,
    preset?: DeliveryPresetId,
  ): WorkflowTask => {
    const id = nextId();
    const platform = preset ? DELIVERY_PRESETS[preset].platform : undefined;
    return workflowTaskSchema.parse({
      id,
      workflowId,
      projectId: project.id,
      type,
      platform,
      preset,
      lang: preset ? (DELIVERY_PRESETS[preset].videoLanguage ?? 'ja') : undefined,
      status: 'pending',
      required: true,
      dependsOnTaskIds: [],
      dueAt: type !== 'pre-publish-check' && isPublishTask(type) ? project.plannedPostDate : undefined,
      checklistItems: checklistFor(id, type, preset),
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  };
  const tasks: WorkflowTask[] = [make('pre-publish-check', 0)];
  presets.forEach((preset, index) => {
    tasks.push(make(publishTypeFor(preset), index + 1, preset));
  });
  tasks.push(make('post-publish-verify', tasks.length));
  tasks.push(make('record-complete', tasks.length));
  const workflow = publishingWorkflowSchema.parse({
    id: workflowId,
    projectId: project.id,
    status: 'pending',
    selectedPresets: presets,
    exportStamp: project.guide.lastExport.contentStamp,
    createdAt: now,
    updatedAt: now,
  });
  return absorbExistingUrls({ workflow, tasks }, project, now);
};

const protectedStatus = (status: WorkflowTaskStatus): boolean =>
  status === 'done' || status === 'skipped' || status === 'needs-fix';

const sameSlot = (left: WorkflowTask, right: WorkflowTask): boolean =>
  left.type === right.type && (left.preset ?? '') === (right.preset ?? '');

/** まだ媒体に投稿していない間も、目視チェックやURL下書きを残す。 */
const carryBeforePost = (freshTask: WorkflowTask, previous: WorkflowTask | undefined): WorkflowTask => {
  if (!previous) return freshTask;
  const checked = new Map(previous.checklistItems.map((entry) => [entry.key, entry.checked]));
  const status =
    previous.status === 'done' ||
    previous.status === 'skipped' ||
    previous.status === 'needs-fix' ||
    previous.status === 'in-progress'
      ? previous.status
      : freshTask.status;
  return {
    ...freshTask,
    id: previous.id,
    status,
    urlDraft: previous.urlDraft,
    postedAtDraft: previous.postedAtDraft,
    qa: previous.qa,
    startedAt: previous.startedAt,
    completedAt: previous.completedAt,
    skippedReason: previous.skippedReason,
    warningNote: previous.warningNote,
    createdAt: previous.createdAt,
    checklistItems: freshTask.checklistItems.map((entry) => ({
      ...entry,
      id: `${previous.id}:${entry.key}`,
      checked: checked.get(entry.key) ?? false,
    })),
  };
};

export const reconcilePublishing = (
  existing: PublishingBundle | null,
  project: Project,
  now: string,
  nextId: () => string,
): PublishingBundle | null => {
  const fresh = createPublishing(project, now, nextId);
  if (!fresh) return existing;
  if (!existing) return fresh;
  const posted = existing.tasks.some(
    (task) => isPublishTask(task.type) && protectedStatus(task.status),
  );
  const stamp = project.guide.lastExport?.contentStamp;
  if (!posted) {
    return absorbExistingUrls(
      {
        workflow: {
          ...fresh.workflow,
          id: existing.workflow.id,
          status: existing.workflow.status === 'done' ? 'pending' : existing.workflow.status,
          pausedForToday: existing.workflow.pausedForToday,
          pausedOn: existing.workflow.pausedOn,
          createdAt: existing.workflow.createdAt,
          staleExport: false,
        },
        tasks: fresh.tasks.map((task) => {
          const previous = existing.tasks.find((item) => sameSlot(item, task));
          return { ...carryBeforePost(task, previous), workflowId: existing.workflow.id };
        }),
      },
      project,
      now,
    );
  }
  const wanted = new Map(fresh.tasks.filter((task) => task.preset).map((task) => [task.preset, task]));
  const kept = existing.tasks.filter((task) => {
    if (!isPublishTask(task.type)) return true;
    return Boolean(task.preset && wanted.has(task.preset));
  });
  for (const [preset, template] of wanted) {
    if (!kept.some((task) => task.preset === preset)) {
      kept.push({ ...template, workflowId: existing.workflow.id });
    }
  }
  const structural = fresh.tasks.filter((task) => !isPublishTask(task.type) && task.type !== 'youtube-publication-verify');
  const mergedStructural = structural.map((template) => {
    const previous = existing.tasks.find((task) => task.type === template.type);
    return previous
      ? { ...previous, sortOrder: template.sortOrder, workflowId: existing.workflow.id }
      : { ...template, workflowId: existing.workflow.id };
  });
  const publishTasks = kept
    .filter((task) => isPublishTask(task.type))
    .sort((left, right) => {
      const leftIndex = publishingPresets(project).indexOf(left.preset as DeliveryPresetId);
      const rightIndex = publishingPresets(project).indexOf(right.preset as DeliveryPresetId);
      return leftIndex - rightIndex;
    })
    .map((task, index) => ({ ...task, sortOrder: index + 1 }));
  const verifyTasks = existing.tasks
    .filter((task) => task.type === 'youtube-publication-verify')
    .map((task, index) => ({ ...task, workflowId: existing.workflow.id, sortOrder: publishTasks.length + 1 + index }));
  const after = publishTasks.length + 1 + verifyTasks.length;
  const tasks = [
    { ...mergedStructural[0], sortOrder: 0 },
    ...publishTasks,
    ...verifyTasks,
    { ...mergedStructural[1], sortOrder: after },
    { ...mergedStructural[2], sortOrder: after + 1 },
  ];
  return absorbExistingUrls(
    {
      workflow: {
        ...existing.workflow,
        selectedPresets: publishingPresets(project),
        exportStamp: stamp,
        staleExport: Boolean(stamp && stamp !== existing.workflow.exportStamp),
      },
      tasks,
    },
    project,
    now,
  );
};

export const applyChecklist = (
  tasks: WorkflowTask[],
  taskId: string,
  checks: Array<{ id: string; checked: boolean }>,
  now: string,
): WorkflowTask[] =>
  tasks.map((task) => {
    if (task.id !== taskId) return task;
    const wanted = new Map(checks.map((entry) => [entry.id, entry.checked]));
    return {
      ...task,
      status: task.status === 'ready' ? 'in-progress' : task.status,
      checklistItems: task.checklistItems.map((entry) =>
        wanted.has(entry.id) ? { ...entry, checked: wanted.get(entry.id) ?? false } : entry,
      ),
      updatedAt: now,
    };
  });

export const applyNeedsFix = (tasks: WorkflowTask[], publishTaskId: string, now: string): WorkflowTask[] => {
  const target = tasks.find((task) => task.id === publishTaskId);
  if (!target || !isPublishTask(target.type)) return tasks;
  const next = tasks.map((task) => {
    if (task.id === publishTaskId) {
      return { ...task, status: 'needs-fix' as const, completedAt: undefined, updatedAt: now };
    }
    if (
      (task.type === 'post-publish-verify' || task.type === 'record-complete') &&
      task.status !== 'pending'
    ) {
      return { ...task, status: 'pending' as const, completedAt: undefined, updatedAt: now };
    }
    return task;
  });
  return refreshReadiness(chainDependencies(next));
};

export const skipTask = (
  bundle: PublishingBundle,
  taskId: string,
  reason: string | undefined,
  now: string,
): PublishingBundle => {
  const tasks = bundle.tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status: 'skipped' as const,
          skippedReason: reason?.trim() || undefined,
          completedAt: now,
          updatedAt: now,
        }
      : task,
  );
  return stampBundle({ ...bundle, tasks }, now);
};

const manualReady = (task: WorkflowTask): boolean =>
  task.checklistItems.filter((entry) => entry.required && !entry.auto).every((entry) => entry.checked);

export const canCompletePublish = (task: WorkflowTask, verdict: PostUrlVerdict): string | null => {
  const missing = task.checklistItems.filter((entry) => entry.required && !entry.auto && !entry.checked);
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`必須があと${missing.length}個`);
  if (verdict.status === 'empty') parts.push('URLが未入力');
  else if (verdict.status === 'error') parts.push('URLの形式が違います');
  return parts.length > 0 ? parts.join(' · ') : null;
};

export const upsertPublicationVerify = (
  bundle: PublishingBundle,
  youtubeTask: WorkflowTask,
  dueAt: string | undefined,
  now: string,
  nextId: () => string,
): PublishingBundle => {
  const existing = bundle.tasks.find(
    (task) => task.type === 'youtube-publication-verify' && task.preset === youtubeTask.preset,
  );
  if (!dueAt) {
    if (!existing) return bundle;
    return stampBundle(
      {
        ...bundle,
        tasks: bundle.tasks.map((task) =>
          task.id === existing.id
            ? { ...task, status: 'skipped' as const, skippedReason: '非公開または限定公開で保管', completedAt: now, dueAt: undefined, updatedAt: now }
            : task,
        ),
      },
      now,
    );
  }
  if (existing) {
    return stampBundle(
      {
        ...bundle,
        tasks: bundle.tasks.map((task) =>
          task.id === existing.id
            ? {
                ...task,
                dueAt,
                status: existing.status === 'done' ? 'done' : 'pending',
                skippedReason: undefined,
                updatedAt: now,
              }
            : task,
        ),
      },
      now,
    );
  }
  const id = nextId();
  const verify: WorkflowTask = workflowTaskSchema.parse({
    id,
    workflowId: bundle.workflow.id,
    projectId: youtubeTask.projectId,
    type: 'youtube-publication-verify',
    platform: 'youtube',
    preset: youtubeTask.preset,
    lang: youtubeTask.lang,
    status: 'pending',
    required: true,
    dependsOnTaskIds: [youtubeTask.id],
    dueAt,
    sortOrder: youtubeTask.sortOrder + 1,
    createdAt: now,
    updatedAt: now,
    checklistItems: [],
  });
  return stampBundle({ ...bundle, tasks: [...bundle.tasks, verify] }, now);
};

export const completeTask = (
  bundle: PublishingBundle,
  taskId: string,
  now: string,
  patch?: { url?: string; postedAt?: string; warningNote?: string },
): PublishingBundle => {
  const tasks = bundle.tasks.map((task) => {
    if (task.id !== taskId) return task;
    return {
      ...task,
      status: 'done' as const,
      urlDraft: patch?.url ?? task.urlDraft,
      postedAtDraft: patch?.postedAt ?? task.postedAtDraft,
      warningNote: patch?.warningNote ?? task.warningNote,
      completedAt: now,
      updatedAt: now,
      checklistItems: task.checklistItems.map((entry) => ({ ...entry, checked: true })),
    };
  });
  const started =
    bundle.workflow.status === 'pending' ? { ...bundle.workflow, status: 'in-progress' as const } : bundle.workflow;
  return stampBundle({ workflow: started, tasks }, now);
};

export const publishingStarted = (bundle: PublishingBundle): boolean =>
  bundle.workflow.status !== 'pending' ||
  bundle.tasks.some((task) => task.status === 'done' || task.status === 'needs-fix' || task.status === 'in-progress');

export const publishFiles = (project: Project): PublishFile[] => {
  const directory = (project.guide.lastExport?.outputDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = directory ? `${directory}/` : '';
  const files: PublishFile[] = [];
  for (const preset of publishingPresets(project)) {
    const base = guessBasename(project, preset);
    const spec = DELIVERY_PRESETS[preset];
    const push = (kind: PublishFileKind, name: string): void => {
      files.push({ preset, kind, name, relativePath: `${prefix}${name}` });
    };
    if (spec.outputs.includes('video')) {
      push('video', `${base}.mp4`);
      push('thumbnail', `${base}.jpg`);
    }
    if (spec.outputs.includes('xCard')) push('xCard', `${base}_card45.png`);
    push('copy', `${base}.txt`);
  }
  return files;
};

const copyText = (project: Project, language: 'ja' | 'en' | 'ko'): string => {
  const field =
    language === 'ko'
      ? project.publishing.title.ko
      : project.publishing.title[language];
  return field?.trim() ?? '';
};

export const precheckAuto = (
  project: Project,
  input: {
    exportFresh: boolean;
    filesPresent: boolean;
    fileDetail: string;
    licenseOk: boolean;
    licenseDetail: string;
  },
): AutoCheck[] => {
  const fresh = input.exportFresh;
  const presets = publishingPresets(project);
  const copyOk = presets.every((preset) =>
    DELIVERY_PRESETS[preset].copyLanguages.every((language) => copyText(project, language)),
  );
  const linksOk = presets.every((preset) => Boolean(project.publishing.links[preset]?.trim()));
  const descriptionOk = presets.every((preset) =>
    DELIVERY_PRESETS[preset].copyLanguages.every((language) =>
      trackingUrlNearTop(
        project.publishing.description[language] ?? '',
        trackingFor(project, preset, guessBasename(project, preset), language),
      ),
    ),
  );
  const youtubeTitles = presets
    .filter((preset) => DELIVERY_PRESETS[preset].platform === 'youtube')
    .flatMap((preset) =>
      DELIVERY_PRESETS[preset].copyLanguages.map((language) => project.publishing.title[language] ?? ''),
    );
  const titleMarkup = youtubeTitles.some((title) => /[\[\]]|\{br\}/.test(title));
  const experiment = project.experimentRef;
  const checks: AutoCheck[] = [
    {
      key: 'export-fresh',
      label: '書き出しが最新',
      ok: fresh,
      detail: fresh ? '最後の書き出しは、いまの内容と一致しています' : '書き出し後に内容が変わっています。書き出し直してください',
    },
    {
      key: 'files-exist',
      label: '必要なファイルがそろっている',
      ok: input.filesPresent,
      detail: input.fileDetail,
    },
    {
      key: 'copy-present',
      label: '投稿文が空でない',
      ok: copyOk,
      detail: copyOk
        ? '選んだ投稿先のタイトルがあります'
        : `空のタイトルがあります。手順${guideStepNumber(8)}で入れてください`,
    },
    {
      key: 'license-ok',
      label: '音源のライセンスに問題がない',
      ok: input.licenseOk,
      detail: input.licenseDetail,
    },
    {
      key: 'utm-ready',
      label: 'ClutchVault の UTM 付き URL ができている',
      ok: linksOk && descriptionOk,
      detail: !linksOk
        ? '書き出し時の計測URLがありません'
        : descriptionOk
          ? `${presets.length}媒体ぶん。説明文の上部と一致しています`
          : '説明文の上部にある URL が、計測用URLと一致していません',
    },
    {
      key: 'experiment-arm',
      label: '実験の Control / Variant が決まっている',
      ok: !experiment || experiment.arm === 'control' || experiment.arm === 'variant',
      detail: experiment
        ? experiment.arm === 'control'
          ? 'Control'
          : 'Variant'
        : '実験なし',
    },
  ];
  if (youtubeTitles.length > 0) {
    checks.push(
      {
        key: 'title-markup',
        label: 'YouTubeタイトルに内部記法が残っていない',
        ok: !titleMarkup,
        detail: titleMarkup
          ? `[ ] または {br} がタイトルに残っています。手順${guideStepNumber(8)}で外してください`
          : '内部記法はありません',
      },
    );
  }
  return checks;
};

export const recordAuto = (
  project: Project,
  tasks: WorkflowTask[],
  hasReview: (preset: string) => boolean,
  skipReviewPresets: string[] = [],
): AutoCheck[] => {
  const presets = publishingPresets(project);
  const skipReview = new Set(skipReviewPresets);
  const rows = presets.map((preset) => {
    const task = tasks.find((item) => item.preset === preset);
    const post = project.posts.find((item) => item.preset === preset && item.url.trim());
    const skipped = task?.status === 'skipped';
    const kept = post?.publicationState === 'private' || post?.publicationState === 'unlisted';
    const scheduled = post?.publicationState === 'scheduled';
    return {
      preset,
      skipped,
      post,
      ok: skipped || Boolean(post?.url && (post.postedAt || kept || scheduled)),
    };
  });
  const recorded = rows.every((row) => row.ok);
  const reviewOk = rows.every(
    (row) => row.skipped || skipReview.has(row.preset) || row.post?.publicationState === 'private' || row.post?.publicationState === 'unlisted' || hasReview(row.preset),
  );
  const experimentOk = !project.experimentRef || Boolean(project.experimentRef.experimentId && project.experimentRef.arm);
  return [
    {
      key: 'recorded',
      label: '選択した各媒体にURLまたはスキップ理由がある',
      ok: recorded,
      detail: rows
        .map((row) => `${row.preset}${row.skipped ? ' スキップ' : row.post ? ' 記録済み' : ' 未記録'}`)
        .join(' · '),
    },
    {
      key: 'posted-at',
      label: '投稿日時がある',
      ok: rows.every((row) => row.skipped || Boolean(row.post?.postedAt)),
      detail: 'URLを記録した媒体',
    },
    {
      key: 'experiment',
      label: '実験条件をPostへ写せる',
      ok: experimentOk,
      detail: project.experimentRef
        ? `${project.experimentRef.arm === 'control' ? 'Control' : 'Variant'}`
        : '実験なし',
    },
    {
      key: 'utm',
      label: 'utmContent を保存できる',
      ok: presets.every((preset) => Boolean(guessBasename(project, preset))),
      detail: 'ファイル名と対応',
    },
    {
      key: 'review',
      label: '7日後の振り返りがある',
      ok: reviewOk,
      detail: reviewOk ? '投稿した媒体ごとに予約済みです' : '投稿URLがまだ同期されていません',
    },
  ];
};

export const withRecordedPost = (
  project: Project,
  preset: DeliveryPresetId,
  url: string,
  postedAt: string,
  postId: string,
  extra?: {
    publicationState?: NonNullable<Project['posts'][number]['publicationState']>;
    scheduledPublishAt?: string;
    timezone?: string;
  },
): Project => {
  const spec = DELIVERY_PRESETS[preset];
  const patch = {
    url,
    postedAt,
    platform: spec.platform,
    lang: spec.videoLanguage ?? ('ja' as const),
    ...extra,
  };
  const posts = project.posts.some((post) => post.preset === preset)
    ? project.posts.map((post) => (post.preset === preset ? { ...post, ...patch, lang: spec.videoLanguage ?? post.lang } : post))
    : [
        ...project.posts,
        {
          id: postId,
          preset,
          ...patch,
          lang: spec.videoLanguage ?? 'ja',
        },
      ];
  return { ...project, posts };
};

export const projectStatusForWorkflow = (
  project: Project,
  bundle: PublishingBundle,
  previousStatus: WorkflowStatus,
): Project['status'] => {
  if (bundle.workflow.status === 'done') {
    const waiting = project.posts.some(
      (post) => post.platform === 'youtube' && (post.publicationState === 'scheduled' || post.publicationState === 'private' || post.publicationState === 'unlisted'),
    );
    return waiting ? 'exported' : 'posted';
  }
  if (previousStatus === 'done' && project.status === 'posted') return 'exported';
  return project.status;
};

export const manualPrecheckReady = (task: WorkflowTask, checks: AutoCheck[]): boolean =>
  checks.every((check) => check.ok || check.severity === 'warn') && manualReady(task);

export const qaReady = (task: WorkflowTask, presets: DeliveryPresetId[], skipPresets: string[] = []): boolean => {
  const qa = task.qa ?? {};
  const skip = new Set(skipPresets);
  return presets.every((preset) => {
    if (skip.has(preset)) return true;
    const platform = DELIVERY_PRESETS[preset].platform;
    const marks = qa[preset] ?? {};
    return QA_ITEMS[platform].every((entry) => marks[entry.key] === 'ok');
  });
};

export type PublishingView = {
  workflow: PublishingWorkflow | null;
  tasks: WorkflowTask[];
  current: WorkflowTask | null;
  autoChecks: AutoCheck[];
  recordChecks: AutoCheck[];
  files: PublishFile[];
  taken: TakenPostUrl[];
  settings: PublishingSettings;
  started: boolean;
};

export type StudioNextAction = {
  kind: 'publish' | 'scheduled' | 'analysis' | 'produce';
  projectId: string;
  title: string;
  headline: string;
  detail: string;
  meta: string;
  remaining: number;
  progress: string;
  step?: number;
  analysisTaskId?: string;
  thumbnailPath?: string;
  chip?: string;
};

export const platformsLabel = (presets: DeliveryPresetId[]): string => platformsFor(presets).join('・');

export const remainingCount = (tasks: WorkflowTask[], currentId?: string): number =>
  tasks.filter((task) => task.id !== currentId && !settled(task.status)).length;

export const doneCount = (tasks: WorkflowTask[]): number => tasks.filter((task) => settled(task.status)).length;
