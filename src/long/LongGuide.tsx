import type { PlayerRef } from '@remotion/player';
import { useRef, useState } from 'react';
import { addScene, assignCandidate, deleteScene, setSceneEnabled, updateChapter, updateScene } from '../../shared/long/commands';
import { hasErrors } from '../../shared/long/diagnostics';
import { chapterDuration, orderedChapters, type RenderPlan } from '../../shared/long/render-plan';
import type { LongProject } from '../../shared/long/schema';
import { CHAPTER_ROLE_LABEL, CONTENT_KIND_LABEL, SCENE_PURPOSE_LABEL, SHOW_ORDER_LABEL } from '../../shared/long/templates';
import { AssetPanel } from './AssetPanel';
import { ExportDialog } from './ExportDialog';
import { LongPublishDialog } from './LongPublishDialog';
import { DiagnosticList, Inspector } from './Inspector';
import { CaptionInspector } from './InspectorItems';
import { PlacementInspector } from './InspectorPlacement';
import { LongPlayerContext, useLongPlayer } from './player';
import { PreviewPane } from './PreviewPane';
import { isDirty, saveLongNow, useLongStore } from './store';
import { formatMinSec, useLongPlan } from './util';

export const GUIDE_STEPS = [
  { id: 1, name: '素材選択', hint: '録画を取り込み、使う区間（候補）に名前・タグ・見せ場を付けます' },
  { id: 2, name: '章構成', hint: '章の順番と、各セットの「扱う内容」「見せる順番」を決め、候補を枠に割り当てます' },
  { id: 3, name: '実戦の切り出し', hint: '各シーンの IN/OUT・速度・フリーズを整えます' },
  { id: 4, name: '解説と視点配置', hint: 'マップ・キルログの拡大、敵視点のPiP、矢印などで狙いを示します' },
  { id: 5, name: '字幕・アバター', hint: '発話字幕・解説・リアクション、表情と予告カットインを付けます' },
  { id: 6, name: '音声', hint: '音声ストリーム、BGM、効果音、BGMを下げる区間を決めます' },
  { id: 7, name: '通し確認', hint: '動画全体を通して見て、確認の一覧を解決します' },
  { id: 8, name: '書き出し・投稿', hint: '選んだ言語で書き出し、投稿文とチャプター草案を確認します' },
] as const;

type StepState = 'done' | 'todo';

/** 手順の完了はデータから毎回判定する（確認だけの手順は確認済みの記録を使う） */
export const stepStates = (project: LongProject, plan: RenderPlan): Record<number, StepState> => {
  const confirmed = new Set(project.editor.confirmed);
  const enabledChapters = new Set(project.chapters.filter((chapter) => chapter.enabled).map((chapter) => chapter.id));
  const activeScenes = project.scenes.filter((scene) => scene.enabled && enabledChapters.has(scene.chapterId));
  const unassigned = activeScenes.filter((scene) => scene.content.kind === 'empty').length;
  const errors = hasErrors(plan.diagnostics);
  const rangeErrors = plan.diagnostics.some((item) => item.code === 'INVALID_RANGE' || item.code === 'INVALID_RECT');
  const missingText = plan.diagnostics.some((item) => item.code === 'CAPTION_MISSING_TRANSLATION');
  const has = (done: boolean): StepState => (done ? 'done' : 'todo');
  return {
    1: has(project.assets.some((asset) => asset.kind === 'video') && project.candidates.length > 0),
    2: has(project.chapters.length > 0 && unassigned === 0),
    3: has(activeScenes.some((scene) => scene.content.kind === 'placement') && !rangeErrors && unassigned === 0),
    4: has(confirmed.has('views') || project.placements.some((placement) => placement.role !== 'main') || project.overlays.length > 0),
    5: has(!missingText && (confirmed.has('captions') || project.captions.length > 0)),
    6: has(confirmed.has('sound')),
    7: has(!errors && confirmed.has('review')),
    8: has(project.status === 'exported' || project.status === 'posted'),
  };
};

const ConfirmButton = ({ id, label }: { id: string; label: string }) => {
  const confirmed = useLongStore((state) => state.project?.editor.confirmed.includes(id));
  return (
    <button
      type="button"
      className={confirmed ? '' : 'pri'}
      onClick={() =>
        useLongStore.getState().live((current) => ({
          ...current,
          editor: { ...current.editor, confirmed: confirmed ? current.editor.confirmed.filter((item) => item !== id) : [...current.editor.confirmed, id] },
        }))
      }
    >
      {confirmed ? `✓ ${label}（取り消す）` : label}
    </button>
  );
};

const ChapterComposer = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const [open, setOpen] = useState<string | null>(project.editor.chapterId ?? null);
  return (
    <div>
      {orderedChapters(project).map((chapter) => {
        const expanded = open === chapter.id;
        const scenes = chapter.sceneIds.map((id) => project.scenes.find((scene) => scene.id === id)).filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
        const unassigned = scenes.filter((scene) => scene.enabled && scene.content.kind === 'empty').length;
        return (
          <div key={chapter.id} className="card" style={{ padding: '8px 10px', marginBottom: 8, opacity: chapter.enabled ? 1 : 0.6 }}>
            <div className="row wrap">
              <button type="button" className="sm ghost" onClick={() => setOpen(expanded ? null : chapter.id)}>
                {expanded ? '▾' : '▸'}
              </button>
              <b>{chapter.title.ja || CHAPTER_ROLE_LABEL[chapter.role]}</b>
              {chapter.role === 'set' ? (
                <select value={chapter.contentKind ?? 'single'} onChange={(event) => transact('扱う内容', (current) => updateChapter(current, chapter.id, { contentKind: event.target.value as 'single' | 'combo' }))}>
                  {Object.entries(CONTENT_KIND_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : null}
              {chapter.showOrder ? <span className="badge">{SHOW_ORDER_LABEL[chapter.showOrder]}</span> : null}
              <span className="sp" />
              <span className="mono dim">{formatMinSec(chapterDuration(project, chapter.id))}</span>
              {unassigned > 0 && chapter.enabled ? <span className="badge warn">未割当 {unassigned}</span> : null}
              <label className="row" style={{ gap: 3 }}>
                <input type="checkbox" checked={chapter.enabled} onChange={(event) => transact('章の有効・無効', (current) => updateChapter(current, chapter.id, { enabled: event.target.checked }))} />
                有効
              </label>
            </div>
            {expanded ? (
              <table className="t" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>シーン</th>
                    <th>役割</th>
                    <th>割り当てた候補</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scenes.map((scene) => {
                    const placement = scene.content.kind === 'placement' ? project.placements.find((item) => item.id === (scene.content as { placementId: string }).placementId) : undefined;
                    const candidate = placement?.role === 'main' ? project.candidates.find((item) => item.id === placement.candidateId) : undefined;
                    return (
                      <tr key={scene.id} style={{ opacity: scene.enabled ? 1 : 0.5, background: scene.purpose === 'fail' || scene.purpose === 'unexpected' ? '#2a1d24' : undefined }}>
                        <td>
                          <input value={scene.label} style={{ width: '100%' }} onChange={(event) => transact('シーン名', (current) => updateScene(current, scene.id, { label: event.target.value }))} />
                        </td>
                        <td className="dim">{scene.hint || SCENE_PURPOSE_LABEL[scene.purpose]}</td>
                        <td>
                          <select
                            value={candidate?.id ?? ''}
                            onChange={(event) => {
                              const picked = project.candidates.find((item) => item.id === event.target.value);
                              if (picked) transact('素材の割り当て', (current) => assignCandidate(current, scene.id, picked));
                            }}
                          >
                            <option value="">
                              {scene.content.kind === 'empty' ? '未割当' : scene.content.kind === 'still' ? '静止画・カード' : '（範囲を直接指定）'}
                            </option>
                            {project.candidates.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} {item.tags.length ? `［${item.tags.join('・')}］` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button type="button" className="sm ghost" title={scene.enabled ? '除外（内容は残す）' : '戻す'} onClick={() => transact(scene.enabled ? 'シーンを除外' : 'シーンを戻す', (current) => setSceneEnabled(current, scene.id, !scene.enabled))}>
                            {scene.enabled ? '除外' : '戻す'}
                          </button>
                          <button type="button" className="sm ghost danger" onClick={() => transact('シーンの削除', (current) => deleteScene(current, scene.id))}>
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
            {expanded ? (
              <div className="row wrap" style={{ marginTop: 6 }}>
                <button type="button" className="sm" onClick={() => transact('シーンの追加', (current) => addScene(current, chapter.id, 'action', { label: 'シーン' }).project)}>
                  ＋ シーン
                </button>
                <button type="button" className="sm" onClick={() => transact('失敗・想定外の挿入', (current) => addScene(current, chapter.id, 'fail', { label: '失敗／想定外' }).project)}>
                  ＋ 失敗・想定外
                </button>
                <button type="button" className="sm" onClick={() => transact('反応の追加', (current) => addScene(current, chapter.id, 'reaction', { label: '本人の反応' }).project)}>
                  ＋ 本人の反応
                </button>
                <button type="button" className="sm" onClick={() => transact('要点カードの追加', (current) => addScene(current, chapter.id, 'card', { label: '要点カード' }).project)}>
                  ＋ 要点カード
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {plan.chapters.length === 0 ? <p className="muted">有効な章がありません。</p> : null}
    </div>
  );
};

const SceneTabs = ({ plan, children }: { plan: RenderPlan; children: (sceneId: string) => React.ReactNode }) => {
  const project = useLongStore((state) => state.project)!;
  const player = useLongPlayer();
  const chapter = project.chapters.find((item) => item.id === project.editor.chapterId) ?? orderedChapters(project).find((item) => item.enabled);
  const [sceneId, setSceneId] = useState<string | null>(null);
  if (!chapter) return <p className="muted">章がありません</p>;
  const scenes = chapter.sceneIds.map((id) => project.scenes.find((scene) => scene.id === id)).filter((scene): scene is NonNullable<typeof scene> => Boolean(scene && scene.enabled));
  const current = scenes.find((scene) => scene.id === sceneId) ?? scenes[0];
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <select
          value={chapter.id}
          onChange={(event) => {
            useLongStore.getState().live((projectNow) => ({ ...projectNow, editor: { ...projectNow.editor, chapterId: event.target.value } }));
            setSceneId(null);
          }}
        >
          {orderedChapters(project).filter((item) => item.enabled).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title.ja || CHAPTER_ROLE_LABEL[item.role]}
            </option>
          ))}
        </select>
        {scenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className="sm"
            aria-pressed={current?.id === scene.id}
            onClick={() => {
              setSceneId(scene.id);
              const planned = plan.scenes.find((item) => item.id === scene.id);
              if (planned) player.seek(planned.from);
            }}
          >
            {scene.label || SCENE_PURPOSE_LABEL[scene.purpose]}
            {scene.content.kind === 'empty' ? ' ⚠' : ''}
          </button>
        ))}
      </div>
      {current ? children(current.id) : null}
    </div>
  );
};

/** W7：横動画ガイド。詳細編集と同じ Project を編集する */
export const LongGuide = ({ active }: { active: boolean }) => {
  const playerRef = useRef<PlayerRef | null>(null);
  const project = useLongStore((state) => state.project)!;
  const saving = useLongStore((state) => state.saving);
  const dirty = useLongStore((state) => isDirty(state));
  const { plan } = useLongPlan();
  const [exporting, setExporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  if (!plan) return null;
  const states = stepStates(project, plan);
  const step = project.editor.guideStep;
  const done = Object.values(states).filter((value) => value === 'done').length;
  const go = (next: number): void =>
    useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, guideStep: Math.min(8, Math.max(1, next)) } }));
  const info = GUIDE_STEPS[step - 1]!;

  const work = (): React.ReactNode => {
    switch (step) {
      case 1:
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, height: '100%' }}>
            <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
              <AssetPanel />
            </div>
            <div className="muted">
              <p>録画タブの「＋ 録画」で取り込み（エクスプローラから素材パネルへ複数まとめてドラッグ＆ドロップもできます）、「候補を作る」で使う区間を切り出します。成功・失敗・想定外などのタグと、見せ場マーカーを付けておくと、後の手順で使えます。</p>
              <p>音声が複数ある録画は「音声」で試聴して、ゲーム音・本人の声・混合の役割を付けます。</p>
              <p>ショートで使った素材は、ホームの「ショートから再利用」で取り込めます（元のショートは変わりません）。</p>
            </div>
          </div>
        );
      case 2:
        return <ChapterComposer plan={plan} />;
      case 3:
        return (
          <SceneTabs plan={plan}>
            {(sceneId) => {
              const scene = project.scenes.find((item) => item.id === sceneId)!;
              return scene.content.kind === 'placement' ? (
                <div className="card" style={{ padding: 0 }}>
                  <PlacementInspector placementId={scene.content.placementId} plan={plan} />
                </div>
              ) : (
                <p className="muted">このシーンは{scene.content.kind === 'empty' ? '未割当です。手順2で候補を割り当ててください' : '静止画・カードです'}。</p>
              );
            }}
          </SceneTabs>
        );
      case 4:
        return (
          <div>
            <SceneTabs plan={plan}>
              {(sceneId) => {
                const scene = project.scenes.find((item) => item.id === sceneId)!;
                return scene.content.kind === 'placement' ? (
                  <div className="card" style={{ padding: 0 }}>
                    <PlacementInspector placementId={scene.content.placementId} plan={plan} />
                  </div>
                ) : (
                  <p className="muted">素材を割り当てたシーンで、拡大・PiP・図形を設定します。</p>
                );
              }}
            </SceneTabs>
            <div style={{ marginTop: 8 }}>
              <ConfirmButton id="views" label="拡大・視点はこれでよい" />
            </div>
          </div>
        );
      case 5:
        return (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>右のプレビューで位置を確認しながら、詳細編集の「再生位置に追加」から字幕・表情を足せます。ここでは本文をまとめて編集します。</p>
            {project.captions.length === 0 ? <p className="dim">字幕はまだありません。</p> : null}
            {project.captions.map((caption) => (
              <div key={caption.id} className="card" style={{ padding: 0, marginBottom: 8 }}>
                <CaptionInspector caption={caption} />
              </div>
            ))}
            <ConfirmButton id="captions" label="字幕・アバターはこれでよい" />
          </div>
        );
      case 6:
        return (
          <div>
            <div className="card" style={{ padding: 0, height: 520, display: 'flex', flexDirection: 'column' }}>
              <Inspector plan={plan} />
            </div>
            <div style={{ marginTop: 8 }}>
              <ConfirmButton id="sound" label="音声を確認した" />
            </div>
          </div>
        );
      case 7:
        return (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>右のプレビューで「動画全体」を選び、通して確認します。エラーは書き出し前に解決が必要です（警告は残っていても書き出せます）。</p>
            <DiagnosticList plan={plan} diagnostics={plan.diagnostics} />
            <div style={{ marginTop: 8 }}>
              <ConfirmButton id="review" label="通しで確認した" />
            </div>
          </div>
        );
      default:
        return (
          <div>
            <div className="row">
              <button type="button" className="pri" onClick={() => setExporting(true)}>
                書き出し画面を開く
              </button>
              <button type="button" disabled={project.exports.length === 0} title={project.exports.length === 0 ? '書き出した後に投稿できます' : undefined} onClick={() => setPublishing(true)}>
                投稿を進める（YouTube 通常動画）
              </button>
            </div>
            <p className="muted">投稿文・チャプター草案は「投稿」タブで確認・編集できます。YouTube に接続していなくても、書き出したMP4と投稿文で手動投稿し、URL を記録できます。</p>
            <div className="card" style={{ padding: 0, height: 480, display: 'flex', flexDirection: 'column' }}>
              <Inspector plan={plan} />
            </div>
          </div>
        );
    }
  };

  return (
    <LongPlayerContext.Provider value={playerRef}>
      <div className="lv-top">
        <button type="button" className="sm ghost" onClick={() => void saveLongNow().then((ok) => ok && useLongStore.getState().open(null))}>
          ☰ 一覧
        </button>
        <span className="pname">{project.title}</span>
        <span className="badge long">横動画</span>
        <span className={saving || dirty ? 'saving' : 'saved'}>{saving ? '保存中…' : dirty ? '未保存の変更あり' : '● 保存済み'}</span>
        <span className="sp" />
        <span className="muted">
          進み具合 <b className="mono">{done} / 8</b> 完了
        </span>
        <span className="seg">
          <button type="button" aria-pressed>
            ガイド作成
          </button>
          <button type="button" aria-pressed={false} onClick={() => useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, mode: 'editor' } }))}>
            詳細編集
          </button>
        </span>
      </div>
      <div className="lv-guide">
        <div className="steps">
          <div className="muted" style={{ fontSize: 11 }}>
            作成の手順
          </div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>T-LONG 横動画</div>
          {GUIDE_STEPS.map((item) => (
            <button key={item.id} type="button" aria-pressed={step === item.id} onClick={() => go(item.id)}>
              <span className={`num ${states[item.id] === 'done' ? 'done' : step === item.id ? 'now' : ''}`}>{states[item.id] === 'done' ? '✓' : item.id}</span>
              <span>
                {item.id} {item.name}
              </span>
            </button>
          ))}
          <p className="dim" style={{ fontSize: 10.5 }}>細かい調整は詳細編集で。手順が未完了でも、ほかの手順へ移動できます。</p>
        </div>
        <div className="work">
          <div className="mono muted" style={{ fontSize: 11 }}>
            STEP {step} / 8
          </div>
          <h2 style={{ fontSize: 16 }}>{info.name}</h2>
          <p className="muted" style={{ marginTop: 2 }}>
            {info.hint}
          </p>
          {work()}
        </div>
        <div className="pv">{active ? <PreviewPane plan={plan} compact /> : null}</div>
        <div className="foot">
          <div style={{ width: 130 }}>
            <div className="muted" style={{ fontSize: 10.5 }}>
              構成
            </div>
            <b className="mono">{formatMinSec(plan.totalTicks)}</b> <span className="dim" style={{ fontSize: 10 }}>目安8〜12分</span>
          </div>
          <div style={{ display: 'flex', gap: 4, flex: 1, height: 44 }}>
            {orderedChapters(project)
              .filter((chapter) => chapter.enabled)
              .map((chapter) => {
                const unassigned = chapter.sceneIds.filter((id) => project.scenes.find((scene) => scene.id === id && scene.enabled && scene.content.kind === 'empty')).length;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`lv-ch ${project.editor.chapterId === chapter.id ? 'on' : ''} ${unassigned ? 'warn' : ''}`}
                    style={{ flex: Math.max(10, chapterDuration(project, chapter.id) / 120_000), padding: '2px 5px' }}
                    onClick={() => {
                      useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, chapterId: chapter.id, guideStep: 3 } }));
                    }}
                  >
                    <div className="t">{chapter.title.ja || CHAPTER_ROLE_LABEL[chapter.role]}</div>
                    <div className="m" style={{ color: unassigned ? 'var(--warn)' : undefined }}>
                      {unassigned ? `未割当 ${unassigned}` : '✓'}
                    </div>
                  </button>
                );
              })}
          </div>
          <button type="button" disabled={step <= 1} onClick={() => go(step - 1)}>
            戻る
          </button>
          <button type="button" className="pri" disabled={step >= 8} onClick={() => go(step + 1)}>
            {step < 8 ? `次へ：${GUIDE_STEPS[step]!.name}` : '完了'}
          </button>
        </div>
      </div>
      {exporting ? (
        <ExportDialog
          plan={plan}
          onClose={() => setExporting(false)}
          onPublish={() => {
            setExporting(false);
            setPublishing(true);
          }}
        />
      ) : null}
      {publishing ? <LongPublishDialog onClose={() => setPublishing(false)} /> : null}
    </LongPlayerContext.Provider>
  );
};
