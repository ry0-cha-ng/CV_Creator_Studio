import { useMemo, useRef, useState } from 'react';
import { randomId } from '../../shared/long/ids';
import { LONG_LANGUAGE_LABEL } from '../../shared/long/outputs';
import type { RenderPlan } from '../../shared/long/render-plan';
import type { LongLanguage } from '../../shared/long/schema';
import { LONG_LANGUAGES } from '../../shared/long/schema';
import { applySrtImport, parseSrt, planSrtImport, type SrtBase, type SrtImportOptions, type SrtParseResult } from '../../shared/long/srt';
import { formatTicks, secToTicks, ticksToFrame } from '../../shared/long/time';
import { useLongPlayer } from './player';
import { useLongStore } from './store';
import { errorText } from './util';

type BaseKind = SrtBase['kind'];

/**
 * SRT の取り込み（T07）。基準（動画全体・章・シーン・録画の素材時刻）と言語を選び、
 * 一覧とプレビューで位置を確かめてから、1回の編集として反映する。
 */
export const SrtImportDialog = ({ plan, onClose }: { plan: RenderPlan; onClose: () => void }) => {
  const project = useLongStore((state) => state.project)!;
  const frame = useLongStore((state) => state.frame);
  const player = useLongPlayer();
  const currentScene = plan.scenes.find((item) => frame >= item.from && frame < item.to);
  const currentMain = (() => {
    const scene = project.scenes.find((item) => item.id === currentScene?.id);
    const placement = scene?.content.kind === 'placement' ? project.placements.find((item) => item.id === (scene.content as { placementId: string }).placementId) : undefined;
    return placement?.role === 'main' ? placement : undefined;
  })();
  const videos = project.assets.filter((asset) => asset.kind === 'video');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<SrtParseResult | null>(null);
  const [baseKind, setBaseKind] = useState<BaseKind>(currentMain ? 'asset' : 'project');
  const [chapterId, setChapterId] = useState(currentScene?.chapterId ?? project.editor.chapterId ?? plan.chapters[0]?.id ?? '');
  const [sceneId, setSceneId] = useState(currentScene?.id ?? plan.scenes[0]?.id ?? '');
  const [assetId, setAssetId] = useState(currentMain?.assetId ?? videos[0]?.id ?? '');
  const [shiftSec, setShiftSec] = useState(0);
  const [language, setLanguage] = useState<LongLanguage>(project.output.languages[0] ?? 'ja');
  const [kind, setKind] = useState<'speech' | 'explain'>('speech');
  const [mode, setMode] = useState<'new' | 'translate'>('new');

  const base: SrtBase | null =
    baseKind === 'project'
      ? { kind: 'project' }
      : baseKind === 'chapter'
        ? chapterId
          ? { kind: 'chapter', chapterId }
          : null
        : baseKind === 'scene'
          ? sceneId
            ? { kind: 'scene', sceneId }
            : null
          : assetId
            ? { kind: 'asset', assetId }
            : null;
  const options: SrtImportOptions | null = base ? { base, shift: secToTicks(shiftSec), language, kind, mode } : null;
  const items = useMemo(() => (parsed && options ? planSrtImport(project, parsed.cues, options) : []), [parsed, project, JSON.stringify(options)]);
  const count = (action: string): number => items.filter((item) => item.action === action).length;
  const usable = count('add') + count('translate');

  const read = async (file: File): Promise<void> => {
    try {
      const buffer = await file.arrayBuffer();
      // UTF-8 で読めない（置換文字が出る）場合は Shift_JIS として読み直す
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buffer);
      setFileName(file.name);
      setParsed(parseSrt(text));
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  const confirm = (): void => {
    if (!options || usable === 0) return;
    let summary = { added: 0, translated: 0 };
    useLongStore.getState().transact('SRTの取り込み', (current) => {
      const result = applySrtImport(current, planSrtImport(current, parsed!.cues, options), options, randomId);
      summary = { added: result.added, translated: result.translated };
      return result.project;
    });
    useLongStore
      .getState()
      .setMessage(
        `SRTを取り込みました（${[summary.added ? `追加 ${summary.added}件` : '', summary.translated ? `訳 ${summary.translated}件` : ''].filter(Boolean).join('・')}）。Undo で取り込み前に戻せます`,
      );
    onClose();
  };

  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 980, height: '84vh' }}>
        <div className="dh">
          SRTを取り込む
          <span className="dim" style={{ fontWeight: 400 }}>
            位置を確かめてから反映します。反映後も Undo で戻せます
          </span>
          <span className="sp" />
          <button type="button" className="sm ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db" style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          <div>
            <div className="lv-field">
              <span>ファイル</span>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".srt,text/plain"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void read(file);
                    event.target.value = '';
                  }}
                />
                <button type="button" className="sm" onClick={() => fileRef.current?.click()}>
                  SRTファイルを選ぶ…
                </button>
                <div className="mono dim" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {fileName || '（未選択）'}
                </div>
              </div>
            </div>
            <div className="lv-field">
              <span>時刻の基準</span>
              <div>
                <label className="row" style={{ gap: 4 }} title="録画から作った SRT。同じ録画を使っているシーンへ素材時刻で振り分け、配置の移動・速度変更に追従します">
                  <input type="radio" checked={baseKind === 'asset'} disabled={videos.length === 0} onChange={() => setBaseKind('asset')} />
                  録画の時刻
                  <select value={assetId} disabled={baseKind !== 'asset'} onChange={(event) => setAssetId(event.target.value)} style={{ maxWidth: 170 }}>
                    {videos.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={baseKind === 'project'} onChange={() => setBaseKind('project')} />
                  完成動画の先頭
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={baseKind === 'chapter'} disabled={plan.chapters.length === 0} onChange={() => setBaseKind('chapter')} />
                  章の先頭
                  <select value={chapterId} disabled={baseKind !== 'chapter'} onChange={(event) => setChapterId(event.target.value)} style={{ maxWidth: 170 }}>
                    {plan.chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title || '章'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={baseKind === 'scene'} disabled={plan.scenes.length === 0} onChange={() => setBaseKind('scene')} />
                  シーンの先頭
                  <select value={sceneId} disabled={baseKind !== 'scene'} onChange={(event) => setSceneId(event.target.value)} style={{ maxWidth: 170 }}>
                    {plan.scenes.map((scene, index) => (
                      <option key={scene.id} value={scene.id}>
                        {index + 1}. {scene.label || 'シーン'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="lv-field">
              <span>ずらす</span>
              <div className="row">
                <input type="number" step={0.1} value={shiftSec} style={{ width: 80 }} onChange={(event) => setShiftSec(Number(event.target.value) || 0)} />
                秒（負の値で前へ）
              </div>
            </div>
            <div className="lv-field">
              <span>言語</span>
              <span className="seg">
                {LONG_LANGUAGES.map((item) => (
                  <button key={item} type="button" aria-pressed={language === item} onClick={() => setLanguage(item)}>
                    {LONG_LANGUAGE_LABEL[item]}
                  </button>
                ))}
              </span>
            </div>
            <div className="lv-field">
              <span>種類</span>
              <span className="seg">
                <button type="button" aria-pressed={kind === 'speech'} onClick={() => setKind('speech')}>
                  発話字幕
                </button>
                <button type="button" aria-pressed={kind === 'explain'} onClick={() => setKind('explain')}>
                  解説
                </button>
              </span>
            </div>
            <div className="lv-field">
              <span>取り込み方</span>
              <div>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
                  新しい字幕として追加
                </label>
                <label className="row" style={{ gap: 4 }} title="例：日本語の字幕に、英語の SRT を訳として入れる">
                  <input type="radio" checked={mode === 'translate'} onChange={() => setMode('translate')} />
                  既存の字幕に訳として入れる（開始±0.5秒）
                </label>
              </div>
            </div>
          </div>
          <div className="scroll" style={{ minHeight: 0 }}>
            {!parsed ? (
              <p className="muted">SRTファイルを選ぶと、取り込む字幕と完成動画での位置を一覧で確認できます。</p>
            ) : (
              <>
                <div className="row wrap" style={{ marginBottom: 6 }}>
                  <span className="badge ok">{mode === 'new' ? `追加 ${count('add')}` : `訳 ${count('translate')}`}</span>
                  <span className="badge warn">取り込まない {count('skip')}</span>
                  {parsed.problems.length > 0 ? <span className="badge err">読めないブロック {parsed.problems.length}</span> : null}
                  <span className="dim" style={{ fontSize: 11 }}>行をクリックすると、プレビューがその位置へ移動します</span>
                </div>
                {parsed.problems.map((problem) => (
                  <div key={`p-${problem.block}`} className="diag error">
                    {problem.line}行目付近（{problem.block}番目のブロック）：{problem.message}
                  </div>
                ))}
                <table className="lv-srt">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SRT の時刻</th>
                      <th>完成動画</th>
                      <th>字幕</th>
                      <th>結果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr
                        key={`${item.cue.index}-${index}`}
                        className={item.action === 'skip' ? 'skip' : ''}
                        onClick={() => (item.action !== 'skip' ? player.seek(ticksToFrame(item.at, plan.fps)) : undefined)}
                      >
                        <td className="mono dim">{item.cue.index}</td>
                        <td className="mono">
                          {formatTicks(item.cue.start)}
                          <br />
                          <span className="dim">{formatTicks(item.cue.end)}</span>
                        </td>
                        <td className="mono">{item.action === 'skip' ? '—' : formatTicks(item.at)}</td>
                        <td style={{ whiteSpace: 'pre-wrap' }}>{item.cue.text}</td>
                        <td style={{ fontSize: 11 }}>
                          {item.action === 'add' ? (
                            <span>追加{item.note ? <div style={{ color: 'var(--warn)' }}>{item.note}</div> : null}</span>
                          ) : item.action === 'translate' ? (
                            <span>訳を入れる：{project.captions.find((caption) => caption.id === item.captionId)?.text.ja?.slice(0, 16) ?? ''}</span>
                          ) : (
                            <span style={{ color: 'var(--warn)' }}>{item.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
        <div className="df">
          <span className="dim" style={{ marginRight: 'auto', fontSize: 11 }}>
            {baseKind === 'asset'
              ? '録画の時刻：字幕は配置に追従します（シーンの移動・速度変更・フリーズの後も同じ発話に付きます）'
              : '完成動画・章・シーンの時刻：字幕はその先頭からの時刻で置きます'}
          </span>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="pri" disabled={usable === 0} onClick={confirm}>
            {usable > 0 ? `${usable}件を取り込む` : '取り込める字幕がありません'}
          </button>
        </div>
      </div>
    </div>
  );
};
