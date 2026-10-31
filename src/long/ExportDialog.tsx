import { useMemo, useState } from 'react';
import { hasErrors, sortDiagnostics } from '../../shared/long/diagnostics';
import type { LongExportResult } from '../../shared/long/ipc';
import { buildChapters, LONG_LANGUAGE_LABEL, longBasename } from '../../shared/long/outputs';
import { buildRenderPlan, type RenderPlan } from '../../shared/long/render-plan';
import type { LongLanguage } from '../../shared/long/schema';
import { frameToTicks } from '../../shared/long/time';
import { useStudioStore } from '../store';
import { DiagnosticList } from './Inspector';
import { saveLongNow, useLongStore } from './store';
import { errorText, formatClock, tracksMap } from './util';

/** W8：書き出し。開始時の Project を固定し、その後の編集は次回の書き出しに反映される */
export const ExportDialog = ({ plan, onClose }: { plan: RenderPlan; onClose: () => void }) => {
  const project = useLongStore((state) => state.project)!;
  const frame = useLongStore((state) => state.frame);
  const progress = useLongStore((state) => state.exportProgress);
  const audioTracks = useStudioStore((state) => state.audioTracks);
  const [languages, setLanguages] = useState<LongLanguage[]>(project.output.languages);
  const [fps, setFps] = useState<30 | 60>(project.output.fps);
  const [range, setRange] = useState<'all' | 'chapter' | 'custom'>('all');
  const [chapterId, setChapterId] = useState(project.editor.chapterId ?? plan.chapters[0]?.id ?? '');
  const [customFrom, setCustomFrom] = useState(0);
  const [customTo, setCustomTo] = useState(Math.min(plan.durationInFrames, plan.fps * 30));
  const [captionMode, setCaptionMode] = useState(project.output.captionMode);
  const [withoutBgm, setWithoutBgm] = useState(project.output.withoutBgm);
  const [thumb, setThumb] = useState<'none' | 'frame' | 'image'>('frame');
  const [thumbFrame, setThumbFrame] = useState(frame);
  const [thumbImage, setThumbImage] = useState(project.assets.find((asset) => asset.kind === 'image')?.id ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LongExportResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const tracks = useMemo(() => tracksMap(audioTracks), [audioTracks]);

  // 言語ごとの確認（書き出し時と同じ描画計画）
  const diagnostics = useMemo(() => {
    const list = languages.flatMap((language) => {
      const languagePlan = buildRenderPlan({ ...project, output: { ...project.output, fps } }, { language, tracks, captionsOff: captionMode === 'srt' });
      return languagePlan.diagnostics.filter((item) => !item.language || item.language === language).map((item) => ({ ...item, message: item.language ? `[${LONG_LANGUAGE_LABEL[language]}] ${item.message}` : item.message }));
    });
    const seen = new Set<string>();
    return sortDiagnostics(list.filter((item) => {
      const key = `${item.code}|${item.entity.id}|${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }, [project, languages, fps, captionMode, tracks]);
  const chapters = buildChapters(plan, project.id);
  const blocked = hasErrors(diagnostics) || languages.length === 0;
  const scale = fps / plan.fps;
  const selectedRange = (): { from: number; to: number } | undefined => {
    if (range === 'chapter') {
      const chapter = plan.chapters.find((item) => item.id === chapterId);
      return chapter ? { from: Math.round(chapter.from * scale), to: Math.round(chapter.to * scale) } : undefined;
    }
    if (range === 'custom') return { from: Math.round(customFrom * scale), to: Math.round(customTo * scale) };
    return undefined;
  };
  const partial = range !== 'all';
  const previewName = longBasename({ date: new Date(), slug: project.slug || project.title, language: languages[0] ?? 'ja', version: 1, part: partial ? 'part' : undefined });

  const start = async (): Promise<void> => {
    setRunning(true);
    setFailure(null);
    setResult(null);
    try {
      await saveLongNow();
      const thumbnail =
        partial || thumb === 'none'
          ? undefined
          : thumb === 'frame'
            ? { kind: 'frame' as const, frame: Math.round(thumbFrame * scale) }
            : { kind: 'image' as const, path: project.assets.find((asset) => asset.id === thumbImage)?.path ?? '' };
      const response = await window.studio.long.exportVideo({
        project: useLongStore.getState().project!,
        languages,
        fps,
        range: selectedRange(),
        captionMode,
        withoutBgm,
        thumbnail: thumbnail && (thumbnail.kind === 'frame' || thumbnail.path) ? thumbnail : undefined,
      });
      setResult(response);
      if (response.jobs.length > 0) {
        // 書き出した版を記録（公開版の詳細はDBに固定保存済み。後の編集で上書きしない）
        useLongStore.getState().transact('書き出しの記録', (current) => ({
          ...current,
          status: !partial && current.status === 'editing' ? 'exported' : current.status,
          output: { ...current.output, fps, captionMode, withoutBgm },
          editor: { ...current.editor, guideStep: Math.max(current.editor.guideStep, 8) },
          exports: [
            ...current.exports,
            ...response.jobs.map((job) => ({
              exportId: job.exportId,
              at: new Date().toISOString(),
              language: job.language,
              fps,
              range: job.partial ? { start: frameToTicks(selectedRange()?.from ?? 0, fps), end: frameToTicks(selectedRange()?.to ?? 1, fps) } : undefined,
              files: job.files,
              basename: job.basename,
              durationTicks: job.durationTicks,
            })),
          ],
        }));
      }
      useLongStore.getState().setExportProgress(null);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setRunning(false);
    }
  };

  const toggle = (language: LongLanguage): void =>
    setLanguages((list) => (list.includes(language) ? list.filter((item) => item !== language) : [...list, language]));

  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 1180, height: '88vh' }}>
        <div className="dh">
          書き出す：{project.title}
          <span className="badge long">yt-long · 1920×1080</span>
          <span className="sp" />
          <button type="button" className="sm ghost" disabled={running} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 1fr', gap: 16, flex: 1 }}>
          <div>
            <h4 style={{ fontSize: 12, marginBottom: 6 }}>出力設定</h4>
            <div className="lv-field">
              <span>言語</span>
              <div className="row wrap">
                {(['ja', 'en', 'ko'] as LongLanguage[]).map((language) => (
                  <label key={language} className="row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={languages.includes(language)} onChange={() => toggle(language)} />
                    {LONG_LANGUAGE_LABEL[language]}
                  </label>
                ))}
              </div>
            </div>
            <div className="lv-field">
              <span>fps</span>
              <span className="seg">
                <button type="button" aria-pressed={fps === 60} onClick={() => setFps(60)}>
                  60fps（20Mbps）
                </button>
                <button type="button" aria-pressed={fps === 30} onClick={() => setFps(30)}>
                  30fps（12Mbps）
                </button>
              </span>
            </div>
            <div className="lv-field">
              <span>範囲</span>
              <div>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={range === 'all'} onChange={() => setRange('all')} />
                  動画全体
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={range === 'chapter'} onChange={() => setRange('chapter')} />
                  章を選ぶ
                  <select value={chapterId} disabled={range !== 'chapter'} onChange={(event) => setChapterId(event.target.value)}>
                    {plan.chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title || '章'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={range === 'custom'} onChange={() => setRange('custom')} />
                  区間
                  <button type="button" className="sm" disabled={range !== 'custom'} onClick={() => setCustomFrom(frame)}>
                    開始=再生位置
                  </button>
                  <button type="button" className="sm" disabled={range !== 'custom'} onClick={() => setCustomTo(Math.max(frame + 1, customFrom + 1))}>
                    終了=再生位置
                  </button>
                </label>
                {range === 'custom' ? (
                  <div className="mono dim" style={{ fontSize: 11 }}>
                    {formatClock(customFrom, plan.fps)} – {formatClock(customTo, plan.fps)}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="lv-field">
              <span>字幕</span>
              <span className="seg">
                <button type="button" aria-pressed={captionMode === 'burn'} onClick={() => setCaptionMode('burn')}>
                  焼き込み＋SRT
                </button>
                <button type="button" aria-pressed={captionMode === 'srt'} onClick={() => setCaptionMode('srt')}>
                  SRTのみ
                </button>
              </span>
            </div>
            <div className="lv-field">
              <span>BGMなし版</span>
              <label className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={withoutBgm} onChange={(event) => setWithoutBgm(event.target.checked)} />
                作る（BGMだけを除き、ゲーム音・声・効果音は残す）
              </label>
            </div>
            <div className="lv-field">
              <span>サムネイル</span>
              <div>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={thumb === 'frame'} onChange={() => setThumb('frame')} disabled={partial} />
                  動画のフレーム（{formatClock(thumbFrame, plan.fps)}）
                  <button type="button" className="sm" disabled={partial} onClick={() => setThumbFrame(frame)}>
                    再生位置にする
                  </button>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={thumb === 'image'} onChange={() => setThumb('image')} disabled={partial} />
                  外部画像
                  <select value={thumbImage} disabled={thumb !== 'image'} onChange={(event) => setThumbImage(event.target.value)}>
                    {project.assets
                      .filter((asset) => asset.kind === 'image')
                      .map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={thumb === 'none'} onChange={() => setThumb('none')} />
                  作らない
                </label>
              </div>
            </div>
            <div className="lv-field">
              <span>ファイル名</span>
              <span className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>
                {previewName}.mp4
              </span>
            </div>
            <p className="dim" style={{ fontSize: 10.5 }}>
              出力：MP4（H.264 High・AAC 48kHz 192kbps・faststart）、SRT、meta.json、投稿文、チャプター草案。横動画では TikTok・X・縦カードは出しません。
              {partial ? ' 部分書き出しは別名で保存し、全体の書き出し・公開版を上書きしません。' : ''}
            </p>
          </div>
          <div className="scroll" style={{ minHeight: 0 }}>
            <h4 style={{ fontSize: 12, marginBottom: 6 }}>
              確認 <span className="badge err">エラー {diagnostics.filter((item) => item.severity === 'error').length}</span>{' '}
              <span className="badge warn">警告 {diagnostics.filter((item) => item.severity === 'warning').length}</span>
            </h4>
            <DiagnosticList plan={plan} diagnostics={diagnostics} />
            <div className="diag info">尺 {formatClock(plan.durationInFrames, plan.fps)}（目安 8〜12分。範囲外でも書き出せます）</div>
          </div>
          <div className="scroll" style={{ minHeight: 0 }}>
            <h4 style={{ fontSize: 12, marginBottom: 6 }}>チャプター草案</h4>
            <pre className="mono" style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--input)', padding: 8, borderRadius: 4 }}>
              {chapters.text || '（章がありません）'}
            </pre>
            <h4 style={{ fontSize: 12, margin: '12px 0 6px' }}>ジョブ</h4>
            {progress && running ? (
              <div className="card" style={{ padding: 8 }}>
                <div className="row">
                  <b>{LONG_LANGUAGE_LABEL[progress.language]}</b>
                  <span className="sp" />
                  <span className="muted">
                    {progress.phase} {Math.round(progress.ratio * 100)}%{progress.remainingSec ? ` · 残り約${Math.ceil(progress.remainingSec / 60)}分` : ''}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--line2)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${progress.ratio * 100}%`, background: 'var(--accent)' }} />
                </div>
                <div className="dim" style={{ fontSize: 10.5, marginTop: 4 }}>開始時の内容で書き出しています。この間の編集は次回の書き出しに反映されます。</div>
              </div>
            ) : null}
            {failure ? <div className="diag error">{failure}（もう一度書き出すと最初からやり直します）</div> : null}
            {result && result.jobs.length > 0 ? (
              <div className="diag info" style={{ flexDirection: 'column' }}>
                <b>書き出しました</b>
                {result.jobs.map((job) => (
                  <div key={job.exportId}>
                    {LONG_LANGUAGE_LABEL[job.language]}：{job.files.length} ファイル{' '}
                    <button type="button" className="sm" onClick={() => void window.studio.revealPath(job.files[0] ?? job.outputDir)}>
                      フォルダを開く
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {result && result.jobs.length === 0 ? <div className="diag error">エラーを解決してから書き出してください</div> : null}
          </div>
        </div>
        <div className="df">
          <span className="dim" style={{ marginRight: 'auto', fontSize: 11 }}>
            書き出すと、その版を固定して記録します（公開版の記録は後の編集で上書きしません）
          </span>
          {running ? (
            <button type="button" onClick={() => void window.studio.long.cancelExport()}>
              キャンセル
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          )}
          <button type="button" className="pri" disabled={blocked || running} onClick={() => void start()}>
            {running ? '書き出し中…' : blocked ? `書き出す（エラー ${diagnostics.filter((item) => item.severity === 'error').length} を解決）` : partial ? '部分書き出し' : '書き出す'}
          </button>
        </div>
      </div>
    </div>
  );
};
