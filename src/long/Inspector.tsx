import { useEffect, useState } from 'react';
import { captionDraft, placeAvatarEvent, updateChapter, upsert } from '../../shared/long/commands';
import type { Diagnostic } from '../../shared/long/diagnostics';
import { randomId } from '../../shared/long/ids';
import { buildChapters, LONG_LANGUAGE_LABEL } from '../../shared/long/outputs';
import { chapterDuration, type RenderPlan } from '../../shared/long/render-plan';
import { LONG_LANGUAGES, type CaptionKind, type ContentKind, type LongLanguage, type ShowOrder } from '../../shared/long/schema';
import { CHAPTER_ROLE_LABEL, CONTENT_KIND_LABEL, SHOW_ORDER_LABEL } from '../../shared/long/templates';
import { frameToTicks, secToTicks } from '../../shared/long/time';
import { useStudioStore } from '../store';
import { Field, Section } from './fields';
import { AudioItemInspector, AvatarEventInspector, CaptionInspector, OverlayInspector, SceneInspector } from './InspectorItems';
import { PlacementInspector, sourceTicksAt } from './InspectorPlacement';
import { SrtImportDialog } from './SrtImportDialog';
import { LONG_PUBLISHING_EVENT, LongPublishDialog } from './LongPublishDialog';
import { LONG_LANGUAGE_NAME, longDoneCount, longLanguageOf, type LongPublishingView } from '../../shared/long/publishing';
import { useLongPlayer } from './player';
import { saveLongNow, useLongStore, type Selection } from './store';
import { formatMinSec } from './util';

type Tab = 'selected' | 'chapter' | 'publish' | 'audio' | 'check';

/** 診断の対象へ移動する */
export const focusDiagnostic = (diagnostic: Diagnostic, plan: RenderPlan, seek: (frame: number) => void): void => {
  const { kind, id } = diagnostic.entity;
  const store = useLongStore.getState();
  const project = store.project;
  if (!project) return;
  const selection: Selection | null =
    kind === 'scene'
      ? { kind: 'scene', id }
      : kind === 'placement'
        ? { kind: 'placement', id }
        : kind === 'caption'
          ? { kind: 'caption', id }
          : kind === 'overlay'
            ? { kind: 'overlay', id }
            : kind === 'avatar'
              ? project.avatarEvents.some((item) => item.id === id)
                ? { kind: 'avatar', id }
                : null
              : kind === 'chapter'
                ? { kind: 'chapter', id }
                : kind === 'audio'
                  ? project.bgm.some((item) => item.id === id)
                    ? { kind: 'bgm', id }
                    : project.se.some((item) => item.id === id)
                      ? { kind: 'se', id }
                      : { kind: 'ducking', id }
                  : null;
  if (selection) store.select(selection);
  const sceneId =
    kind === 'scene'
      ? id
      : kind === 'placement'
        ? project.placements.find((item) => item.id === id)?.sceneId
        : kind === 'caption'
          ? project.captions.find((item) => item.id === id)?.sceneId
          : kind === 'overlay'
            ? project.overlays.find((item) => item.id === id)?.sceneId
            : undefined;
  const scene = plan.scenes.find((item) => item.id === sceneId);
  const chapterId = scene?.chapterId ?? (kind === 'chapter' ? id : undefined);
  if (chapterId) store.live((current) => ({ ...current, editor: { ...current.editor, chapterId } }));
  if (scene) seek(scene.from);
};

export const DiagnosticList = ({ plan, diagnostics }: { plan: RenderPlan; diagnostics: Diagnostic[] }) => {
  const player = useLongPlayer();
  if (diagnostics.length === 0) return <div className="diag info">問題は見つかっていません。</div>;
  return (
    <>
      {diagnostics.map((item, index) => (
        <div key={`${item.code}-${item.entity.id}-${index}`} className={`diag ${item.severity}`}>
          {item.severity === 'error' ? '✕' : item.severity === 'warning' ? '⚠' : 'ℹ'}
          <div style={{ flex: 1 }}>
            {item.message}
            {item.suggestedAction ? <div style={{ opacity: 0.85 }}>→ {item.suggestedAction}</div> : null}
            <code>{item.code}</code>{' '}
            <button type="button" className="sm" onClick={() => focusDiagnostic(item, plan, player.seek)}>
              該当箇所へ
            </button>
          </div>
        </div>
      ))}
    </>
  );
};

const AddBar = ({ plan }: { plan: RenderPlan }) => {
  const [srt, setSrt] = useState(false);
  const project = useLongStore((state) => state.project)!;
  const frame = useLongStore((state) => state.frame);
  const transact = useLongStore((state) => state.transact);
  const scene = plan.scenes.find((item) => frame >= item.from && frame < item.to);
  const sceneData = project.scenes.find((item) => item.id === scene?.id);
  const mainId = sceneData?.content.kind === 'placement' ? sceneData.content.placementId : undefined;
  const offset = scene ? frameToTicks(frame - scene.from, plan.fps) : 0;

  const addCaption = (kind: CaptionKind): void => {
    if (!scene) return;
    const source = mainId ? sourceTicksAt(plan, mainId, frame) : null;
    // 発話字幕は素材時刻（配置ID）に結び付け、解説・リアクションはシーン相対
    const anchor = kind === 'speech' && mainId && source !== null ? { kind: 'source' as const, placementId: mainId, ticks: source } : { kind: 'scene' as const, sceneId: scene.id, offset };
    const caption = captionDraft(randomId, kind, anchor, secToTicks(kind === 'reaction' ? 1.2 : 2.5), scene.id);
    caption.text = { ja: kind === 'speech' ? '（発話）' : kind === 'explain' ? '（解説）' : 'ナイス！' };
    transact('字幕の追加', (current) => upsert(current, 'captions', caption));
    useLongStore.getState().select({ kind: 'caption', id: caption.id });
  };
  const addShape = (): void => {
    if (!scene) return;
    const id = randomId('ov');
    transact('図形の追加', (current) =>
      upsert(current, 'overlays', {
        id,
        kind: 'arrow',
        anchor: { kind: 'scene', sceneId: scene.id, offset },
        duration: secToTicks(2),
        target: mainId ?? 'screen',
        rect: { x: 0.4, y: 0.6, w: 0.1, h: -0.12 },
        color: '#FF4655',
        strokeWidth: 10,
        text: {},
        motion: 'pop',
        seGainDb: 0,
        sceneId: scene.id,
      }),
    );
    useLongStore.getState().select({ kind: 'overlay', id });
  };
  const addAvatar = (): void => {
    if (!scene) return;
    const id = randomId('av');
    transact('表情の追加', (current) =>
      placeAvatarEvent(current, {
        id,
        expressionId: 'E04',
        anchor: { kind: 'scene', sceneId: scene.id, offset },
        duration: secToTicks(1.5),
        motion: 'bounce',
        after: 'base',
        seGainDb: 0,
        text: {},
        sceneId: scene.id,
      }),
    );
    useLongStore.getState().select({ kind: 'avatar', id });
  };
  const addDuck = (): void => {
    const id = randomId('dk');
    transact('BGMを下げる区間の追加', (current) =>
      upsert(current, 'ducking', {
        id,
        anchor: scene ? { kind: 'scene', sceneId: scene.id, offset } : { kind: 'project', ticks: frameToTicks(frame, plan.fps) },
        duration: secToTicks(2),
        depthDb: -12,
        attack: secToTicks(0.2),
        release: secToTicks(0.8),
        sceneId: scene?.id,
      }),
    );
    useLongStore.getState().select({ kind: 'ducking', id });
  };
  return (
    <div className="row wrap" style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)' }}>
      <span className="muted" style={{ fontSize: 11 }}>
        再生位置に追加
      </span>
      <button type="button" className="sm" disabled={!scene} onClick={() => addCaption('speech')}>
        発話字幕
      </button>
      <button type="button" className="sm" disabled={!scene} onClick={() => addCaption('explain')}>
        解説
      </button>
      <button type="button" className="sm" disabled={!scene} onClick={() => addCaption('reaction')}>
        リアクション
      </button>
      <button type="button" className="sm" disabled={!scene} onClick={addShape}>
        図形
      </button>
      <button type="button" className="sm" disabled={!scene} onClick={addAvatar}>
        表情
      </button>
      <button type="button" className="sm" onClick={addDuck}>
        BGMを下げる
      </button>
      <button type="button" className="sm" title="SRTファイルから発話字幕・解説、または既存字幕の訳を取り込みます" onClick={() => setSrt(true)}>
        SRT取り込み
      </button>
      {srt ? <SrtImportDialog plan={plan} onClose={() => setSrt(false)} /> : null}
    </div>
  );
};

const ChapterTab = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const tracks = useStudioStore((state) => state.audioTracks).filter((track) => track.kind === 'bgm');
  const chapter = project.chapters.find((item) => item.id === project.editor.chapterId) ?? project.chapters[0];
  if (!chapter) return <p className="muted" style={{ padding: 12 }}>章がありません</p>;
  const update = (label: string, patch: Parameters<typeof updateChapter>[2]): void => transact(label, (current) => updateChapter(current, chapter.id, patch));
  const chapterBgm = project.bgm.filter((item) => item.chapterId === chapter.id);
  return (
    <div style={{ padding: '8px 12px' }}>
      <div className="row">
        <b>{CHAPTER_ROLE_LABEL[chapter.role]}</b>
        <span className="dim mono">{formatMinSec(chapterDuration(project, chapter.id))}</span>
      </div>
      {LONG_LANGUAGES.filter((language) => project.output.languages.includes(language)).map((language) => (
        <Field key={language} label={`題名（${language}）`}>
          <input value={chapter.title[language] ?? ''} onChange={(event) => update('章の題名', { title: { ...chapter.title, [language]: event.target.value } })} />
        </Field>
      ))}
      {chapter.role === 'set' ? (
        <>
          <Field label="扱う内容">
            <select value={chapter.contentKind ?? 'single'} onChange={(event) => update('扱う内容', { contentKind: event.target.value as ContentKind })}>
              {(Object.keys(CONTENT_KIND_LABEL) as ContentKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {CONTENT_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="見せる順番">
            <span className="muted">{chapter.showOrder ? SHOW_ORDER_LABEL[chapter.showOrder as ShowOrder] : '—'}（タイムラインの「章を組み直す」で変更）</span>
          </Field>
        </>
      ) : null}
      <label className="row" style={{ gap: 4 }}>
        <input type="checkbox" checked={chapter.enabled} onChange={(event) => update(event.target.checked ? '章の有効化' : '章の無効化', { enabled: event.target.checked })} />
        有効（無効にすると尺と出力から外し、内容は残す）
      </label>
      <label className="row" style={{ gap: 4 }}>
        <input type="checkbox" checked={chapter.inChapters} onChange={(event) => update('チャプター草案', { inChapters: event.target.checked })} />
        チャプター草案に載せる
      </label>
      <Section title="定点・スキル（使用順）">
        {chapter.lineups
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((link) => {
            const lineup = project.lineups.find((item) => item.id === link.lineupId);
            const patchLink = (patch: Partial<typeof link>): void =>
              update('定点の関連', { lineups: chapter.lineups.map((item) => (item.lineupId === link.lineupId ? { ...item, ...patch } : item)) });
            return (
              <div key={link.lineupId} className="card" style={{ padding: 6, marginBottom: 4 }}>
                <div className="row">
                  <input type="number" min={1} value={link.order} style={{ width: 44 }} onChange={(event) => patchLink({ order: Math.max(1, Number(event.target.value) || 1) })} />
                  <b style={{ flex: 1 }}>{lineup?.title || `${lineup?.map ?? ''} ${lineup?.ability ?? ''}`}</b>
                  <button type="button" className="sm ghost" onClick={() => update('定点の関連を外す', { lineups: chapter.lineups.filter((item) => item.lineupId !== link.lineupId) })}>
                    ×
                  </button>
                </div>
                <input value={link.role.ja ?? ''} placeholder="役割（例：視界を奪う）" style={{ width: '100%', marginTop: 3 }} onChange={(event) => patchLink({ role: { ...link.role, ja: event.target.value } })} />
                <input value={link.cue.ja ?? ''} placeholder="合図・条件（例：足音2つで投げる）" style={{ width: '100%', marginTop: 3 }} onChange={(event) => patchLink({ cue: { ...link.cue, ja: event.target.value } })} />
              </div>
            );
          })}
        <select
          value=""
          onChange={(event) => {
            if (!event.target.value) return;
            update('定点の関連', { lineups: [...chapter.lineups, { lineupId: event.target.value, order: chapter.lineups.length + 1, cue: {}, role: {} }] });
          }}
        >
          <option value="">＋ 定点を関連付け…（素材パネルの「定点」で登録）</option>
          {project.lineups
            .filter((item) => !chapter.lineups.some((link) => link.lineupId === item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || `${item.map} ${item.site} ${item.ability}`}
              </option>
            ))}
        </select>
      </Section>
      <Section title="章のBGM">
        {chapterBgm.map((item) => (
          <div key={item.id} className="row">
            ♪ {tracks.find((track) => track.id === item.audioTrackId)?.title ?? item.audioTrackId}
            <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'bgm', id: item.id })}>
              設定
            </button>
          </div>
        ))}
        <select
          value=""
          onChange={(event) => {
            if (!event.target.value) return;
            const id = randomId('bgm');
            transact('章のBGM', (current) =>
              upsert(current, 'bgm', {
                id,
                audioTrackId: event.target.value,
                anchor: { kind: 'chapter', chapterId: chapter.id, offset: 0 },
                duration: Math.max(secToTicks(5), chapterDuration(current, chapter.id)),
                offset: 0,
                gainDb: -18,
                fadeIn: secToTicks(1),
                fadeOut: secToTicks(1),
                loop: true,
                volumePoints: [],
                chapterId: chapter.id,
              }),
            );
          }}
        >
          <option value="">＋ この章にBGMを付ける…</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.title}
            </option>
          ))}
        </select>
        <p className="dim" style={{ fontSize: 10.5 }}>章のBGMは章の移動に追従します（章相対）。全体のBGMと重なる場合は、全体BGMの長さ・下げで調整します。</p>
      </Section>
      <Section title="メモ">
        <textarea style={{ width: '100%' }} value={chapter.note} onChange={(event) => update('章のメモ', { note: event.target.value })} />
      </Section>
      {plan.chapters.length === 0 ? null : null}
    </div>
  );
};

/** 言語ごとの投稿の記録と、投稿画面への入口 */
const PublishSummary = () => {
  const project = useLongStore((state) => state.project)!;
  const [view, setView] = useState<LongPublishingView | null>(null);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  // 上部バー・ガイドから開いた投稿画面での変更も反映する
  useEffect(() => {
    const bump = (): void => setRevision((value) => value + 1);
    window.addEventListener(LONG_PUBLISHING_EVENT, bump);
    return () => window.removeEventListener(LONG_PUBLISHING_EVENT, bump);
  }, []);
  useEffect(() => {
    if (project.exports.length === 0) return;
    let cancel = false;
    void saveLongNow()
      .then(() => window.studio.long.publishing.get(project.id))
      .then((next) => !cancel && setView(next))
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [project.id, project.exports.length, open, revision]);
  if (project.exports.length === 0) {
    return <p className="dim" style={{ fontSize: 11 }}>書き出した後に、言語ごとの投稿をここから進めます。YouTube に接続していなくても、手動で投稿して URL を記録できます。</p>;
  }
  return (
    <div>
      {view?.tasks
        .filter((task) => task.type === 'youtube-publish')
        .map((task) => {
          const language = longLanguageOf(task.preset);
          const post = view.posts.find((item) => item.preset === task.preset);
          return (
            <div key={task.id} className="row" style={{ fontSize: 11.5 }}>
              <span style={{ width: 48 }}>{language ? LONG_LANGUAGE_NAME[language] : ''}</span>
              {post?.url ? (
                <a href={post.url} target="_blank" rel="noreferrer" className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.url}
                </a>
              ) : (
                <span className="dim" style={{ flex: 1 }}>
                  {task.status === 'skipped' ? 'スキップ' : '未投稿'}
                </span>
              )}
              {post?.publicationState && post.publicationState !== 'public' ? <span className="badge">{post.publicationState}</span> : null}
            </div>
          );
        })}
      {view?.workflow ? (
        <div className="dim" style={{ fontSize: 11 }}>
          {longDoneCount(view.tasks)} / {view.tasks.length} 完了{view.workflow.status === 'done' ? ' · すべて完了' : ''}
        </div>
      ) : null}
      {project.publishing.url && !view?.posts.length ? (
        <div className="dim" style={{ fontSize: 11 }}>以前に記録した URL：{project.publishing.url}（投稿画面で最初の言語の下書きとして使います）</div>
      ) : null}
      <button type="button" className="sm pri" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>
        投稿を進める
      </button>
      {open ? <LongPublishDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
};

const PublishTab = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const chapters = buildChapters(plan, project.id);
  const patch = (label: string, value: Partial<typeof project.publishing>): void =>
    transact(label, (current) => ({ ...current, publishing: { ...current.publishing, ...value } }));
  return (
    <div style={{ padding: '8px 12px' }}>
      {project.output.languages.map((language: LongLanguage) => (
        <div key={language}>
          <Field label={`タイトル（${language}）`}>
            <input value={project.publishing.title[language] ?? ''} onChange={(event) => patch('タイトル', { title: { ...project.publishing.title, [language]: event.target.value } })} />
          </Field>
          <Field label={`説明文（${language}）`} wide>
            <textarea
              style={{ width: '100%', minHeight: 80 }}
              value={project.publishing.description[language] ?? ''}
              onChange={(event) => patch('説明文', { description: { ...project.publishing.description, [language]: event.target.value } })}
            />
          </Field>
        </div>
      ))}
      <Field label="タグ">
        <input value={project.publishing.tags.join(' ')} placeholder="#valorant #定点" onChange={(event) => patch('タグ', { tags: event.target.value.split(/\s+/).filter(Boolean) })} />
      </Field>
      <Section title="チャプター草案（解決済みの時刻から作成）">
        <pre className="mono" style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--input)', padding: 6, borderRadius: 4 }}>
          {chapters.text || '（章がありません）'}
        </pre>
        {chapters.diagnostics.map((item, index) => (
          <div key={index} className={`diag ${item.severity}`}>
            {item.message}
          </div>
        ))}
        <p className="dim" style={{ fontSize: 10.5 }}>説明文の自分で書いた部分は変えず、書き出す投稿文の末尾にチャプターを足します。YouTube でチャプターとして有効になるかは保証しません。</p>
      </Section>
      <Section title="投稿（YouTube 通常動画）">
        <PublishSummary />
        {project.exports.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">書き出した版</div>
            {project.exports.slice(-6).reverse().map((record) => (
              <div key={record.exportId} className="row" style={{ fontSize: 11 }}>
                <span className="mono">{record.basename}</span>
                <span className="dim">{new Date(record.at).toLocaleString('ja-JP')}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
};

const AudioTab = () => {
  const project = useLongStore((state) => state.project)!;
  const tracks = useStudioStore((state) => state.audioTracks);
  const name = (id: string): string => tracks.find((track) => track.id === id)?.title ?? '（ライブラリにない音源）';
  return (
    <div style={{ padding: '8px 12px' }}>
      <Section title="BGM">
        {project.bgm.length === 0 ? <span className="dim">素材パネルの「音源」から全体BGM、章タブから章のBGMを付けます。</span> : null}
        {project.bgm.map((item) => (
          <div key={item.id} className="row">
            <span style={{ flex: 1 }}>
              ♪ {name(item.audioTrackId)} <span className="dim">{item.chapterId ? '章' : '全体'}</span>
            </span>
            <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'bgm', id: item.id })}>
              設定
            </button>
          </div>
        ))}
      </Section>
      <Section title="効果音">
        {project.se.map((item) => (
          <div key={item.id} className="row">
            <span style={{ flex: 1 }}>♪ {name(item.audioTrackId)}</span>
            <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'se', id: item.id })}>
              設定
            </button>
          </div>
        ))}
      </Section>
      <Section title="BGMを下げる区間">
        {project.ducking.map((item) => (
          <div key={item.id} className="row">
            <span style={{ flex: 1 }}>{item.depthDb} dB</span>
            <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'ducking', id: item.id })}>
              設定
            </button>
          </div>
        ))}
      </Section>
      <p className="dim" style={{ fontSize: 10.5 }}>
        書き出しの最後に、BGMの有無にかかわらず −36.5 LUFS（2パス loudnorm）へそろえます。プレビューの音量はこの処理の前の値です。曲の自動伸長・自動ダッキングは H2 です。
      </p>
    </div>
  );
};

export const Inspector = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const selection = useLongStore((state) => state.selection);
  const [tab, setTab] = useState<Tab>('selected');
  // 「音源」「章」タブの「設定」や確認の「該当箇所へ」で選んだら、その設定が見える「選択中」タブへ移る
  useEffect(() => {
    if (selection.kind !== 'none') setTab('selected');
  }, [selection]);
  const errorCount = plan.diagnostics.filter((item) => item.severity === 'error').length;
  const warnCount = plan.diagnostics.filter((item) => item.severity === 'warning').length;
  const entityDiagnostics = plan.diagnostics.filter((item) => 'id' in selection && item.entity.id === selection.id);

  const body = (): React.ReactNode => {
    switch (selection.kind) {
      case 'placement':
        return <PlacementInspector placementId={selection.id} plan={plan} />;
      case 'scene':
        return <SceneInspector sceneId={selection.id} />;
      case 'caption': {
        const caption = project.captions.find((item) => item.id === selection.id);
        return caption ? <CaptionInspector caption={caption} /> : null;
      }
      case 'overlay': {
        const overlay = project.overlays.find((item) => item.id === selection.id);
        return overlay ? <OverlayInspector overlay={overlay} plan={plan} /> : null;
      }
      case 'avatar': {
        const event = project.avatarEvents.find((item) => item.id === selection.id);
        return event ? <AvatarEventInspector event={event} /> : null;
      }
      case 'bgm':
      case 'se':
      case 'ducking':
        return <AudioItemInspector kind={selection.kind} id={selection.id} plan={plan} />;
      case 'chapter':
        return <ChapterTab plan={plan} />;
      default:
        return <p className="muted" style={{ padding: 12 }}>タイムラインやストーリーボードで、シーン・映像・字幕などを選ぶと設定が表示されます。</p>;
    }
  };

  return (
    <div className="lv-inspector">
      <div className="lv-tabs">
        {(
          [
            ['selected', '選択中'],
            ['chapter', '章'],
            ['publish', '投稿'],
            ['audio', '音源'],
            ['check', `確認${errorCount ? ` ✕${errorCount}` : warnCount ? ` ⚠${warnCount}` : ''}`],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {tab === 'selected' ? (
          <>
            <AddBar plan={plan} />
            {body()}
            {entityDiagnostics.length > 0 ? (
              <div className="lv-sec">
                <DiagnosticList plan={plan} diagnostics={entityDiagnostics} />
              </div>
            ) : null}
          </>
        ) : tab === 'chapter' ? (
          <ChapterTab plan={plan} />
        ) : tab === 'publish' ? (
          <PublishTab plan={plan} />
        ) : tab === 'audio' ? (
          <AudioTab />
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              表示中の言語：{LONG_LANGUAGE_LABEL[useLongStore.getState().language]}（書き出し時は選んだ言語ごとに確認します）
            </div>
            <DiagnosticList plan={plan} diagnostics={plan.diagnostics} />
          </div>
        )}
      </div>
    </div>
  );
};
