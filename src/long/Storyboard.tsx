import { useState } from 'react';
import { addChapter, deleteChapter, duplicateChapter, moveChapter, setChapterEnabled } from '../../shared/long/commands';
import { chapterDuration, orderedChapters, sceneDuration, type RenderPlan } from '../../shared/long/render-plan';
import type { ChapterRole } from '../../shared/long/schema';
import { CHAPTER_ROLE_LABEL, CONTENT_KIND_LABEL, LONG_DURATION_GUIDE, SHOW_ORDER_LABEL } from '../../shared/long/templates';
import { useLongPlayer } from './player';
import { useLongStore } from './store';
import { formatMinSec } from './util';

/** 章ストーリーボード：全章の順番・尺・未完成状態。追加・並べ替え・無効化（W2） */
export const Storyboard = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const player = useLongPlayer();
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const chapters = orderedChapters(project);
  const total = plan.totalTicks;
  const enabled = chapters.filter((chapter) => chapter.enabled).length;
  const totalSec = total / 120_000;
  const outOfGuide = totalSec < LONG_DURATION_GUIDE.minSec || totalSec > LONG_DURATION_GUIDE.maxSec;

  const selectChapter = (chapterId: string): void => {
    useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, chapterId } }));
    useLongStore.getState().select({ kind: 'chapter', id: chapterId });
    const resolved = plan.chapters.find((item) => item.id === chapterId);
    if (resolved) player.seek(resolved.from);
  };

  return (
    <div className="lv-story">
      <div className="sum">
        <div className="muted" style={{ fontSize: 11 }}>
          章ストーリーボード
        </div>
        <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
          {formatMinSec(total)}
        </div>
        <div className={outOfGuide ? '' : 'dim'} style={{ fontSize: 10.5, color: outOfGuide ? 'var(--warn)' : undefined }}>
          目安 8〜12分 · 有効{enabled}章
        </div>
      </div>
      <div className="chs">
        {chapters.map((chapter, index) => {
          const duration = chapterDuration(project, chapter.id);
          const scenes = chapter.sceneIds.map((id) => project.scenes.find((scene) => scene.id === id)).filter(Boolean);
          const unassigned = scenes.filter((scene) => scene!.enabled && scene!.content.kind === 'empty').length;
          const on = project.editor.chapterId === chapter.id;
          return (
            <div
              key={chapter.id}
              className={`lv-ch ${on ? 'on' : ''} ${chapter.enabled ? '' : 'off'} ${unassigned > 0 && chapter.enabled ? 'warn' : ''} ${dragOver === chapter.id ? 'drop' : ''}`}
              style={{ flex: Math.max(12, duration / 120_000), position: 'relative' }}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('application/x-cvcs-chapter', chapter.id)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('application/x-cvcs-chapter')) {
                  event.preventDefault();
                  setDragOver(chapter.id);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => {
                const moved = event.dataTransfer.getData('application/x-cvcs-chapter');
                setDragOver(null);
                if (moved && moved !== chapter.id) transact('章の並べ替え', (current) => moveChapter(current, moved, index));
              }}
              onClick={() => selectChapter(chapter.id)}
              title={chapter.note || undefined}
            >
              <div className="t">
                {chapter.title.ja || CHAPTER_ROLE_LABEL[chapter.role]}
                {chapter.enabled ? '' : '（無効）'}
              </div>
              <div className="m">
                {unassigned > 0 && chapter.enabled ? <span style={{ color: 'var(--warn)' }}>未割当 {unassigned} · </span> : null}
                {chapter.contentKind ? `${CONTENT_KIND_LABEL[chapter.contentKind]} · ` : ''}
                {chapter.showOrder ? `${SHOW_ORDER_LABEL[chapter.showOrder]} · ` : ''}
                <span className="mono">{formatMinSec(duration)}</span>
              </div>
              <div className="bar">
                {scenes.map((scene) => (
                  <i
                    key={scene!.id}
                    style={{ flex: Math.max(1, sceneDuration(project, scene!) / 120_000) }}
                    className={
                      !scene!.enabled
                        ? 'x'
                        : scene!.content.kind === 'empty'
                          ? 'u'
                          : scene!.purpose === 'fail' || scene!.purpose === 'unexpected'
                            ? 'f'
                            : scene!.purpose === 'replay'
                              ? 'r'
                              : ''
                    }
                  />
                ))}
              </div>
              <button
                type="button"
                className="sm ghost"
                style={{ position: 'absolute', right: 2, top: 2, padding: '0 4px' }}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu(menu === chapter.id ? null : chapter.id);
                }}
              >
                …
              </button>
              {menu === chapter.id ? (
                <div
                  className="card"
                  style={{ position: 'fixed', zIndex: 50, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, marginTop: -150 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button type="button" className="sm" onClick={() => { transact('章の複製', (current) => duplicateChapter(current, chapter.id).project); setMenu(null); }}>
                    複製
                  </button>
                  <button type="button" className="sm" onClick={() => { transact(chapter.enabled ? '章の無効化' : '章の有効化', (current) => setChapterEnabled(current, chapter.id, !chapter.enabled)); setMenu(null); }}>
                    {chapter.enabled ? '無効にする（内容は残す）' : '有効に戻す'}
                  </button>
                  <button type="button" className="sm" disabled={index === 0} onClick={() => { transact('章の並べ替え', (current) => moveChapter(current, chapter.id, index - 1)); setMenu(null); }}>
                    ← 前へ
                  </button>
                  <button type="button" className="sm" disabled={index === chapters.length - 1} onClick={() => { transact('章の並べ替え', (current) => moveChapter(current, chapter.id, index + 1)); setMenu(null); }}>
                    後ろへ →
                  </button>
                  <button type="button" className="sm danger" onClick={() => { transact('章の削除', (current) => deleteChapter(current, chapter.id)); setMenu(null); }}>
                    削除
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative' }}>
        <button type="button" style={{ height: '100%', width: 44, fontSize: 18 }} title="章を追加" onClick={() => setAdding((value) => !value)}>
          ＋
        </button>
        {adding ? (
          <div className="card" style={{ position: 'absolute', right: 0, bottom: '100%', zIndex: 50, display: 'flex', flexDirection: 'column', gap: 4, padding: 6, width: 180 }}>
            {(['set', 'hook', 'closing', 'ending', 'custom'] as ChapterRole[]).map((role) => (
              <button
                key={role}
                type="button"
                className="sm"
                onClick={() => {
                  transact('章の追加', (current) => {
                    const at = role === 'hook' ? 0 : role === 'set' ? current.chapterOrder.filter((id) => current.chapters.find((c) => c.id === id)?.role !== 'closing' && current.chapters.find((c) => c.id === id)?.role !== 'ending').length : undefined;
                    return addChapter(current, role, { at }).project;
                  });
                  setAdding(false);
                }}
              >
                {CHAPTER_ROLE_LABEL[role]}を追加
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
