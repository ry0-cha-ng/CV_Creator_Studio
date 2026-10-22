import { useEffect, useState } from 'react';
import type { ProjectCreateOptions, ProjectSummary } from '../../shared/ipc';
import type { StudioNextAction } from '../../shared/publishing';
import type { InheritItem, Project } from '../../shared/schema/project';
import { useStudioStore } from '../store';
import { getAgentOptionLabel, valorantMaster } from '../valorantMaster';
import { mediaUrl } from './media';

const STATUS_LABEL: Record<Project['status'], string> = {
  editing: '作成中',
  exported: '書き出し済み',
  posted: '投稿済み',
};

const INHERIT_OPTIONS: Array<{ id: InheritItem; label: string; defaultOn: boolean }> = [
  { id: 'agent', label: 'エージェント・アビリティ', defaultOn: true },
  { id: 'bgm', label: 'BGM', defaultOn: true },
  { id: 'effects', label: '効果音', defaultOn: true },
  { id: 'hookRotation', label: 'フックの型', defaultOn: true },
  { id: 'experiment', label: 'この動画の実験', defaultOn: true },
  { id: 'templateParams', label: 'アクセント色・fps', defaultOn: true },
  { id: 'cardLayout', label: 'カードのレイアウト', defaultOn: false },
  { id: 'cardAimZoom', label: '合わせ位置ズーム', defaultOn: true },
];

const formatUpdated = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const GuideHome = ({
  onBackup,
  onRestore,
  onWorkspace,
  publishHold,
  onResumePublish,
  onOpenReview,
}: {
  onBackup: () => void;
  onRestore: () => void;
  onWorkspace: () => void;
  publishHold: boolean;
  onResumePublish: () => void;
  onOpenReview: (taskId: string) => void;
}) => {
  const store = useStudioStore();
  const [filter, setFilter] = useState<'all' | Project['status']>('all');
  const [templateId, setTemplateId] = useState<Project['templateId']>('t-std');
  const [title, setTitle] = useState('新しい定点');
  const [sourceId, setSourceId] = useState(store.projects[0]?.id ?? '');
  const [items, setItems] = useState<InheritItem[]>(
    INHERIT_OPTIONS.filter((item) => item.defaultOn).map((item) => item.id),
  );
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [defaultAgent, setDefaultAgent] = useState('Phoenix');
  const [nextAction, setNextAction] = useState<StudioNextAction | null>(null);
  useEffect(() => {
    void window.studio.getDefaultAgent().then(setDefaultAgent).catch(() => setDefaultAgent('Phoenix'));
  }, []);
  useEffect(() => {
    void window.studio.getStudioNext().then(setNextAction).catch(() => setNextAction(null));
  }, [store.projects]);

  const visible = store.projects.filter((item) => filter === 'all' || item.status === filter);

  const create = (): void => {
    const options: ProjectCreateOptions = {
      templateId,
      title: title.trim() || '新しい定点',
      inheritFromId: sourceId || undefined,
      inheritItems: sourceId ? items : [],
      agentId: defaultAgent,
    };
    store.setBusy(true);
    store.setError(null);
    void window.studio
      .createProject(options)
      .then(async (created) => {
        store.setProject(created);
        store.setProjects(await window.studio.listProjects());
      })
      .catch((error: unknown) => store.setError(errorMessage(error)))
      .finally(() => store.setBusy(false));
  };

  const open = (id: string, step?: number): void => {
    store.setBusy(true);
    store.setError(null);
    void window.studio
      .loadProject(id)
      .then((loaded) => {
        loaded.guide.mode = 'guide';
        if (typeof step === 'number') loaded.guide.lastStep = step;
        store.setProject(loaded, true);
      })
      .catch((error: unknown) => store.setError(errorMessage(error)))
      .finally(() => store.setBusy(false));
  };

  const duplicate = (id: string): void => {
    store.setBusy(true);
    void window.studio
      .duplicateProject(id)
      .then(async (copy) => {
        store.setProject(copy);
        store.setProjects(await window.studio.listProjects());
      })
      .catch((error: unknown) => store.setError(errorMessage(error)))
      .finally(() => store.setBusy(false));
  };

  const remove = (): void => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    store.setBusy(true);
    void window.studio
      .deleteProject(target.id)
      .then(() => window.studio.listProjects())
      .then((projects) => store.setProjects(projects))
      .catch((error: unknown) => store.setError(errorMessage(error)))
      .finally(() => store.setBusy(false));
  };

  return (
    <div className="gd-app">
      <header className="gd-top">
        <span className="gd-spacer" />
        <button type="button" onClick={onWorkspace}>保存先を変更</button>
        <button type="button" onClick={onBackup}>バックアップ</button>
        <button type="button" onClick={onRestore}>取り込み</button>
      </header>
      <div className="gd-home">
        {(publishHold || nextAction) && (
          <section className="gd-next" aria-label="次にやること">
            {publishHold ? (
              <>
                <span className="gd-kicker">次にやること</span>
                <h2>今日はここまで</h2>
                <p className="gd-muted">続きは次に開いたとき、同じタスクから始まります</p>
                <button type="button" className="gd-fill" onClick={onResumePublish}>
                  やっぱり続ける
                </button>
              </>
            ) : nextAction ? (
              <>
                <span className="gd-kicker">次にやること</span>
                <article>
                  {nextAction.thumbnailPath ? (
                    <img src={mediaUrl(nextAction.thumbnailPath)} alt="" />
                  ) : (
                    <div className="gd-next-thumb" />
                  )}
                  <div>
                    <div className="gd-next-chips">
                      {nextAction.chip && <span>{nextAction.chip}</span>}
                      {nextAction.progress && <span>{nextAction.progress}</span>}
                    </div>
                    <h2>{nextAction.headline}</h2>
                    <p>{nextAction.title}</p>
                    <p className="gd-muted">{nextAction.detail}</p>
                    <button
                      type="button"
                      className="gd-fill"
                      onClick={() => {
                        onResumePublish();
                        if (nextAction.kind === 'analysis' && nextAction.analysisTaskId) {
                          onOpenReview(nextAction.analysisTaskId);
                          return;
                        }
                        open(nextAction.projectId, nextAction.step);
                      }}
                    >
                      {nextAction.kind === 'analysis' ? '振り返りを開く' : nextAction.kind === 'produce' ? '続きを開く' : '投稿手順を開く'}
                    </button>
                    {nextAction.kind === 'publish' && nextAction.remaining > 0 && (
                      <span className="gd-muted">残り {nextAction.remaining}件</span>
                    )}
                  </div>
                </article>
              </>
            ) : null}
          </section>
        )}
        <section className="gd-home-list">
          <div className="gd-home-heading">
            <h1>プロジェクト</h1>
            <span>{store.projects.length}件</span>
            <button
              type="button"
              onClick={() =>
                void window.studio.exportPostsCsv().then((file) => {
                  if (file) store.setError(`CSVを書き出しました: ${file}`);
                })
              }
              disabled={store.busy}
            >
              数字をCSVで書き出す
            </button>
            <span className="gd-spacer" />
            <label className="gd-filter">
              状態
              <select
                aria-label="状態で絞り込む"
                value={filter}
                onChange={(event) => setFilter(event.target.value as typeof filter)}
              >
                <option value="all">すべて</option>
                <option value="editing">作成中</option>
                <option value="exported">書き出し済み</option>
                <option value="posted">投稿済み</option>
              </select>
            </label>
          </div>
          <div className="gd-cards">
            {visible.length === 0 && <p className="gd-muted">プロジェクトはまだありません。</p>}
            {visible.map((item) => (
              <article key={item.id} className="gd-card">
                <div className="gd-thumb" />
                <div className="gd-card-body">
                  <div className="gd-card-title">
                    <strong>{item.title}</strong>
                    <span className={`gd-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </div>
                  <span className="gd-muted">
                    {item.templateId === 't-guide' ? 'T-GUIDE' : 'T-STD'} · 更新 {formatUpdated(item.updatedAt)}
                  </span>
                  <div className="gd-progress">
                    <div className="gd-progress-track">
                      <span style={{ width: `${(item.completedSteps / 10) * 100}%` }} />
                    </div>
                    <span className="gd-progress-label">
                      {item.completedSteps} / 10 手順完了
                      {item.pendingMetrics > 0 ? ` · 数字未入力 ${item.pendingMetrics}` : ''}
                    </span>
                  </div>
                  <div className="gd-card-actions">
                    <button type="button" className="gd-fill" onClick={() => open(item.id, item.nextStep)}>
                      {item.nextLabel}
                    </button>
                    <button type="button" onClick={() => duplicate(item.id)} disabled={store.busy}>
                      複製して新規
                    </button>
                    <button type="button" onClick={() => setPendingDelete(item)} disabled={store.busy}>
                      削除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="gd-create" aria-label="新しい動画を作る">
          <span className="gd-kicker">STEP 0</span>
          <h2>新しい動画を作る</h2>
          <p className="gd-muted">テンプレートを選ぶと、作成の手順が決まります</p>
          <label className="gd-field">
            シリーズの既定エージェント
            <select
              aria-label="シリーズの既定エージェント"
              value={defaultAgent}
              onChange={(event) => {
                const agentId = event.target.value;
                setDefaultAgent(agentId);
                void window.studio.setDefaultAgent(agentId).catch((error: unknown) => {
                  store.setError(errorMessage(error));
                });
              }}
            >
              {valorantMaster.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {getAgentOptionLabel(agent.id)}
                </option>
              ))}
            </select>
          </label>
          <span className="gd-field">テンプレート</span>
          <label className={`gd-choice ${templateId === 't-std' ? 'is-on' : ''}`}>
            <input
              type="radio"
              name="template"
              checked={templateId === 't-std'}
              onChange={() => setTemplateId('t-std')}
            />
            <span>
              <strong>T-STD 定点ショート</strong>
              <span>28秒 · 7シーン · ループ終わり · 手順10</span>
            </span>
          </label>
          <label className={`gd-choice ${templateId === 't-guide' ? 'is-on' : ''}`}>
            <input
              type="radio"
              name="template"
              checked={templateId === 't-guide'}
              onChange={() => setTemplateId('t-guide')}
            />
            <span>
              <strong>T-GUIDE ガイド型</strong>
              <span>24秒 · 4区間（タイトル・手順・カード・デモ）</span>
            </span>
          </label>
          <label className="gd-field">
            プロジェクト名
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
            <span>定点情報を変えると「サミット A 守り · フェニックス」のように上書きされます</span>
          </label>
          <label className="gd-field">
            前のプロジェクトから引き継ぐ
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">引き継がない</option>
              {store.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}（{formatUpdated(item.updatedAt)}）
                </option>
              ))}
            </select>
          </label>
          <div className="gd-checks">
            {INHERIT_OPTIONS.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  disabled={!sourceId}
                  checked={items.includes(option.id)}
                  onChange={(event) =>
                    setItems((current) =>
                      event.target.checked
                        ? [...current, option.id]
                        : current.filter((item) => item !== option.id),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
          <button type="button" className="primary gd-create-go" onClick={create} disabled={store.busy}>
            作成して「1 定点情報」へ
          </button>
        </section>
      </div>
      {pendingDelete && (
        <div className="confirm-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="confirm-dialog" role="dialog" onClick={(event) => event.stopPropagation()}>
            <h2>プロジェクトを削除しますか？</h2>
            <p>「{pendingDelete.title}」を削除します。元に戻せません。</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setPendingDelete(null)}>キャンセル</button>
              <button type="button" className="primary" onClick={remove}>削除する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
