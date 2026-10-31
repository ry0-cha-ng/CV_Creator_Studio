import { useEffect, useMemo, useState } from 'react';
import type { LongProjectSummary, ShortReuseSource } from '../../shared/long/ipc';
import type { ContentKind, LongLanguage, ShowOrder } from '../../shared/long/schema';
import {
  CONTENT_KIND_LABEL,
  DEFAULT_SETS,
  LONG_DURATION_GUIDE,
  SHOW_ORDER_LABEL,
  estimateTemplateSeconds,
  slugify,
  type SetConfig,
} from '../../shared/long/templates';
import { useLongStore } from './store';
import { errorText, formatMinSec } from './util';

const GUIDE_STEP_LABEL = ['', '素材選択', '章構成', '実戦の切り出し', '解説と視点配置', '字幕・アバター', '音声', '通し確認', '書き出し・投稿'];

const STATUS_LABEL: Record<LongProjectSummary['status'], string> = { editing: '作成中', exported: '書き出し済み', posted: '投稿済み' };

const durationBadge = (ticks: number) => {
  const sec = ticks / 120_000;
  if (sec < LONG_DURATION_GUIDE.minSec) return <span className="badge warn">目安8〜12分より短い</span>;
  if (sec > LONG_DURATION_GUIDE.maxSec) return <span className="badge warn">目安8〜12分より長い</span>;
  return <span className="badge ok">目安内</span>;
};

/** W1：横動画のホーム（一覧と新規作成）。ショートの一覧は出さない。 */
export const LongHome = () => {
  const summaries = useLongStore((state) => state.summaries);
  const [filter, setFilter] = useState<'all' | LongProjectSummary['status']>('all');
  const [method, setMethod] = useState<'template' | 'empty' | 'reuse'>('template');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [hook, setHook] = useState(true);
  const [closing, setClosing] = useState(true);
  const [ending, setEnding] = useState(true);
  const [sets, setSets] = useState<SetConfig[]>(DEFAULT_SETS);
  const [languages, setLanguages] = useState<LongLanguage[]>(['ja', 'en']);
  const [fps, setFps] = useState<30 | 60>(60);
  const [inheritFrom, setInheritFrom] = useState('');
  const [inherit, setInherit] = useState<Array<'audio' | 'avatars' | 'cutins'>>(['audio', 'avatars', 'cutins']);
  const [shortSources, setShortSources] = useState<ShortReuseSource[] | null>(null);
  const [reuseId, setReuseId] = useState('');
  const [reuseClips, setReuseClips] = useState<string[]>([]);
  const [reuseStills, setReuseStills] = useState<string[]>([]);
  const [reuseLineup, setReuseLineup] = useState(true);
  const [reuseCaptions, setReuseCaptions] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<LongProjectSummary | null>(null);

  useEffect(() => {
    if (summaries[0] && !inheritFrom) setInheritFrom(summaries[0].id);
  }, [summaries]);

  useEffect(() => {
    if (method !== 'reuse' || shortSources) return;
    void window.studio.long
      .shortSources()
      .then(setShortSources)
      .catch((error) => useLongStore.getState().setMessage(errorText(error)));
  }, [method]);

  const reuseSource = shortSources?.find((source) => source.id === reuseId);
  useEffect(() => {
    if (!reuseSource) return;
    setReuseClips(reuseSource.clips.map((clip) => clip.id));
    setReuseStills(reuseSource.stills.map((still) => still.id));
    if (!title.trim()) setTitle(`${reuseSource.title}（横動画）`);
  }, [reuseId]);

  const params = useMemo(() => ({ hook, sets, closing, ending }), [hook, sets, closing, ending]);
  const estimate = method === 'empty' ? 0 : estimateTemplateSeconds(params);
  const shown = summaries.filter((item) => filter === 'all' || item.status === filter);
  const next = summaries.find((item) => item.status === 'editing');

  const open = async (id: string): Promise<void> => {
    try {
      useLongStore.getState().open(await window.studio.long.load(id));
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  const create = async (): Promise<void> => {
    setCreating(true);
    try {
      const project = await window.studio.long.create({
        title: title.trim() || '新しい横動画',
        slug: slug.trim() || undefined,
        fps,
        languages: languages.length ? languages : ['ja'],
        template: method === 'empty' ? null : params,
        inheritFromId: inheritFrom || undefined,
        inherit: inheritFrom ? inherit : [],
        reuse:
          method === 'reuse' && reuseId
            ? { projectId: reuseId, clipIds: reuseClips, stillIds: reuseStills, lineup: reuseLineup, captions: reuseCaptions }
            : undefined,
      });
      useLongStore.getState().open(project);
      useLongStore.getState().setSummaries(await window.studio.long.list());
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    } finally {
      setCreating(false);
    }
  };

  const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="lv-home">
      <div className="left">
        {next ? (
          <div className="card">
            <h3>次にやること</h3>
            <div className="row">
              <div style={{ flex: 1 }}>
                <b>{next.title}</b>
                <div className="muted">
                  STEP {next.guideStep} {GUIDE_STEP_LABEL[next.guideStep]}
                  {next.unassigned > 0 ? ` · 未割当 ${next.unassigned}枠` : ''}
                </div>
              </div>
              <button type="button" className="pri" onClick={() => void open(next.id)}>
                続きから（{next.guideStep} {GUIDE_STEP_LABEL[next.guideStep]}）
              </button>
            </div>
          </div>
        ) : null}
        <div className="card scroll" style={{ flex: 1 }}>
          <h3>
            横動画プロジェクト <span className="badge">{summaries.length}件</span>
            <span className="sp" />
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">すべての状態</option>
              <option value="editing">作成中</option>
              <option value="exported">書き出し済み</option>
              <option value="posted">投稿済み</option>
            </select>
          </h3>
          {shown.length === 0 ? (
            <p className="muted">横動画のプロジェクトはまだありません。右の「新しい横動画を作る」から始めます。</p>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>章</th>
                  <th>尺（有効な章）</th>
                  <th>状態</th>
                  <th>手順</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <b>{item.title}</b>
                      <br />
                      <span className="dim">
                        更新 {new Date(item.updatedAt).toLocaleString('ja-JP')} · {item.languages.join('/').toUpperCase()}
                      </span>
                    </td>
                    <td className="mono">
                      {item.chapters}章{item.disabledChapters > 0 ? <span className="dim">（無効{item.disabledChapters}）</span> : null}
                    </td>
                    <td className="mono">
                      {formatMinSec(item.durationTicks)} {durationBadge(item.durationTicks)}
                    </td>
                    <td>
                      <span className={`badge ${item.status === 'editing' ? '' : 'ok'}`}>{STATUS_LABEL[item.status]}</span>
                    </td>
                    <td>
                      <div className="prog">
                        <i style={{ width: `${(Math.max(0, item.guideStep - 1) / 8) * 100}%` }} />
                      </div>
                      <span className="dim mono">{item.guideStep} / 8</span>
                    </td>
                    <td>
                      <div className="row">
                        <button type="button" className="sm pri" onClick={() => void open(item.id)}>
                          開く
                        </button>
                        <button
                          type="button"
                          className="sm"
                          onClick={() =>
                            void window.studio.long
                              .duplicate(item.id)
                              .then(async () => useLongStore.getState().setSummaries(await window.studio.long.list()))
                              .catch((error) => useLongStore.getState().setMessage(errorText(error)))
                          }
                        >
                          複製して新規
                        </button>
                        <button type="button" className="sm ghost danger" onClick={() => setDeleting(item)}>
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="dim">尺の目安（8〜12分）は表示だけで、範囲外でも書き出せます。</p>
        </div>
      </div>
      <div className="card scroll">
        <h3>STEP 0　新しい横動画を作る</h3>
        <div className="lv-field">
          <span>作り方</span>
          <div className="seg">
            <button type="button" aria-pressed={method === 'template'} onClick={() => setMethod('template')}>
              テンプレートから
            </button>
            <button type="button" aria-pressed={method === 'empty'} onClick={() => setMethod('empty')}>
              空のプロジェクト
            </button>
            <button type="button" aria-pressed={method === 'reuse'} onClick={() => setMethod('reuse')}>
              ショートから再利用
            </button>
          </div>
        </div>
        {method === 'reuse' ? (
          <div className="lv-sec" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <h4>取り込むショート（元のプロジェクトは変更しません）</h4>
            <select style={{ width: '100%' }} value={reuseId} onChange={(event) => setReuseId(event.target.value)}>
              <option value="">選んでください</option>
              {(shortSources ?? []).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}（{source.map} · {source.agent}）
                </option>
              ))}
            </select>
            {reuseSource ? (
              <div style={{ marginTop: 6 }}>
                <div className="muted">元動画と切り出し範囲</div>
                {reuseSource.clips.map((clip) => (
                  <label key={clip.id} className="row" style={{ gap: 6 }}>
                    <input type="checkbox" checked={reuseClips.includes(clip.id)} onChange={() => setReuseClips((list) => toggle(list, clip.id))} />
                    {clip.label} · {clip.assetName} · {clip.in.toFixed(1)}〜{clip.out.toFixed(1)}秒
                  </label>
                ))}
                {reuseSource.stills.length > 0 ? <div className="muted">静止画</div> : null}
                {reuseSource.stills.map((still) => (
                  <label key={still.id} className="row" style={{ gap: 6 }}>
                    <input type="checkbox" checked={reuseStills.includes(still.id)} onChange={() => setReuseStills((list) => toggle(list, still.id))} />
                    {still.label}
                  </label>
                ))}
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={reuseLineup} onChange={(event) => setReuseLineup(event.target.checked)} />
                  定点情報
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={reuseCaptions} onChange={(event) => setReuseCaptions(event.target.checked)} />
                  テキスト（文言だけ。縦型の位置は持ち込みません）
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="lv-field">
          <span>プロジェクト名</span>
          <input value={title} placeholder="例：Ascent 定点セット Vol.4" onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="lv-field">
          <span>スラッグ</span>
          <input value={slug} placeholder={slugify(title) || 'ascent-teiten-vol4'} onChange={(event) => setSlug(event.target.value)} />
        </div>
        {method !== 'empty' ? (
          <div className="lv-sec" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <h4>章の構成 <span className="dim" style={{ fontWeight: 400 }}>— 作成後も自由に追加・削除・並べ替えできます</span></h4>
            <table className="t">
              <thead>
                <tr>
                  <th>章</th>
                  <th>扱う内容</th>
                  <th>見せる順番</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <label className="row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={hook} onChange={(event) => setHook(event.target.checked)} />
                      フック
                    </label>
                  </td>
                  <td colSpan={3} className="dim">
                    見せ場の先出し（約15秒）
                  </td>
                </tr>
                {sets.map((set, index) => (
                  <tr key={index}>
                    <td>Set {index + 1}</td>
                    <td>
                      <select
                        value={set.contentKind}
                        onChange={(event) =>
                          setSets((list) => list.map((item, i) => (i === index ? { ...item, contentKind: event.target.value as ContentKind } : item)))
                        }
                      >
                        {(Object.keys(CONTENT_KIND_LABEL) as ContentKind[]).map((kind) => (
                          <option key={kind} value={kind}>
                            {CONTENT_KIND_LABEL[kind]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={set.showOrder}
                        onChange={(event) =>
                          setSets((list) => list.map((item, i) => (i === index ? { ...item, showOrder: event.target.value as ShowOrder } : item)))
                        }
                      >
                        {(Object.keys(SHOW_ORDER_LABEL) as ShowOrder[]).map((order) => (
                          <option key={order} value={order}>
                            {SHOW_ORDER_LABEL[order]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button type="button" className="sm ghost" onClick={() => setSets((list) => list.filter((_, i) => i !== index))}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}>
                    <button type="button" className="sm" onClick={() => setSets((list) => [...list, { contentKind: 'single', showOrder: 'success-first' }])}>
                      ＋ セットを追加
                    </button>{' '}
                    <span className="dim">（4〜5章が目安）</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <label className="row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={closing} onChange={(event) => setClosing(event.target.checked)} />
                      締め
                    </label>
                  </td>
                  <td colSpan={3} className="dim">
                    ハイライト（解説少なめ）
                  </td>
                </tr>
                <tr>
                  <td>
                    <label className="row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={ending} onChange={(event) => setEnding(event.target.checked)} />
                      エンディング
                    </label>
                  </td>
                  <td colSpan={3} className="dim">
                    要点・次回・任意のCTA
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 6 }}>
              <span className="muted">合計の目安</span>
              <b className="mono">{formatMinSec(estimate * 120_000)}</b>
              {durationBadge(estimate * 120_000)}
            </div>
          </div>
        ) : null}
        <div className="lv-field">
          <span>出力言語</span>
          <div className="row">
            {(['ja', 'en', 'ko'] as LongLanguage[]).map((language) => (
              <label key={language} className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={languages.includes(language)} onChange={() => setLanguages((list) => toggle(list, language))} />
                {language === 'ja' ? '日本語' : language === 'en' ? 'English' : '한국어'}
              </label>
            ))}
          </div>
        </div>
        <div className="lv-field">
          <span>fps</span>
          <div className="seg">
            <button type="button" aria-pressed={fps === 60} onClick={() => setFps(60)}>
              60fps
            </button>
            <button type="button" aria-pressed={fps === 30} onClick={() => setFps(30)}>
              30fps
            </button>
          </div>
        </div>
        {summaries.length > 0 ? (
          <div className="lv-field">
            <span>引き継ぎ</span>
            <div>
              <select value={inheritFrom} onChange={(event) => setInheritFrom(event.target.value)} style={{ width: '100%', marginBottom: 4 }}>
                <option value="">引き継がない</option>
                {summaries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              {inheritFrom ? (
                <div className="row wrap">
                  {(
                    [
                      ['audio', 'BGM'],
                      ['avatars', 'アバターセット'],
                      ['cutins', 'カットイン画像'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={inherit.includes(key)} onChange={() => setInherit((list) => toggle(list, key))} />
                      {label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 10 }}>
          <span className="sp" />
          <button type="button" className="pri" disabled={creating || (method === 'reuse' && !reuseId)} onClick={() => void create()}>
            {creating ? '作成中…' : '作成して「1 素材選択」へ'}
          </button>
        </div>
      </div>
      {deleting ? (
        <div className="lv-backdrop">
          <div className="lv-dialog" style={{ width: 420 }}>
            <div className="dh">プロジェクトを削除</div>
            <div className="db">「{deleting.title}」を削除します。素材ファイル（library）は残ります。</div>
            <div className="df">
              <button type="button" onClick={() => setDeleting(null)}>
                やめる
              </button>
              <button
                type="button"
                className="pri"
                onClick={() =>
                  void window.studio.long
                    .remove(deleting.id)
                    .then(async () => {
                      setDeleting(null);
                      useLongStore.getState().setSummaries(await window.studio.long.list());
                    })
                    .catch((error) => useLongStore.getState().setMessage(errorText(error)))
                }
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
