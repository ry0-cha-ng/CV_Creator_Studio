import {
  deleteScene,
  duplicateScene,
  moveScene,
  placeAvatarEvent,
  removeItem,
  setSceneEnabled,
  unassignScene,
  updateScene,
  upsert,
} from '../../shared/long/commands';
import type { RenderPlan } from '../../shared/long/render-plan';
import {
  LONG_LANGUAGES,
  type Anchor,
  type AvatarEvent,
  type Caption,
  type CaptionKind,
  type LongLanguage,
  type LongProject,
  type MotionKind,
  type Overlay,
  type OverlayKind,
  type ScenePurpose,
} from '../../shared/long/schema';
import { SCENE_PURPOSE_LABEL } from '../../shared/long/templates';
import { formatTicks, secToTicks } from '../../shared/long/time';
import { useStudioStore } from '../store';
import { MOTION_LABEL } from './AvatarManager';
import { TimeInput } from './CandidateEditor';
import { Field, NumberInput, Section, Seg } from './fields';
import { useLongPlayer } from './player';
import { useLongStore } from './store';

const LANGUAGE_LABEL: Record<LongLanguage, string> = { ja: '日本語', en: 'English', ko: '한국어' };

export const anchorLabel = (project: LongProject, anchor: Anchor): string => {
  switch (anchor.kind) {
    case 'project':
      return `全体固定 ${formatTicks(anchor.ticks)}`;
    case 'scene':
      return `シーン「${project.scenes.find((scene) => scene.id === anchor.sceneId)?.label ?? '?'}」から ${formatTicks(anchor.offset)}`;
    case 'chapter':
      return `章「${project.chapters.find((chapter) => chapter.id === anchor.chapterId)?.title.ja ?? '?'}」から ${formatTicks(anchor.offset)}`;
    case 'source':
      return `素材時刻 ${formatTicks(anchor.ticks)}（配置に追従）`;
    case 'event': {
      const marker = project.markers.find((item) => item.id === anchor.markerId);
      return `マーカー「${marker?.label || marker?.kind || '?'}」${anchor.offset >= 0 ? '+' : '−'}${formatTicks(Math.abs(anchor.offset))}`;
    }
  }
};

const OffsetEditor = ({ anchor, onChange }: { anchor: Anchor; onChange: (anchor: Anchor) => void }) => {
  if (anchor.kind === 'project') return <TimeInput value={anchor.ticks} onChange={(ticks) => onChange({ ...anchor, ticks })} />;
  if (anchor.kind === 'source') return <TimeInput value={anchor.ticks} onChange={(ticks) => onChange({ ...anchor, ticks })} />;
  return <TimeInput value={anchor.offset} allowNegative onChange={(offset) => onChange({ ...anchor, offset })} />;
};

/** 1行に収まる文字数の目安（はみ出し確認） */
const overflowLines = (text: string, size: number, widthNorm: number): number => {
  const widthPx = widthNorm * 1920;
  return text.split('\n').reduce((sum, line) => {
    const units = [...line].reduce((total, char) => total + (/[\u0000-ÿ]/.test(char) ? 0.55 : 1), 0);
    return sum + Math.max(1, Math.ceil((units * size) / widthPx));
  }, 0);
};

export const CaptionInspector = ({ caption }: { caption: Caption }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const save = (label: string, next: Caption): void => transact(label, (current) => upsert(current, 'captions', next));
  return (
    <div style={{ padding: '8px 12px' }}>
      <div className="row">
        <b>字幕</b>
        <Seg
          value={caption.kind}
          options={[['speech', '発話字幕'], ['explain', '解説'], ['reaction', 'リアクション']] as ReadonlyArray<readonly [CaptionKind, string]>}
          onChange={(kind) => save('字幕の種類', { ...caption, kind })}
        />
      </div>
      <Field label="基準">
        <span className="dim">{anchorLabel(project, caption.anchor)}</span>
      </Field>
      <Field label="開始">
        <OffsetEditor anchor={caption.anchor} onChange={(anchor) => save('字幕の時刻', { ...caption, anchor })} />
      </Field>
      <Field label="表示時間">
        <TimeInput value={caption.duration} onChange={(duration) => save('字幕の長さ', { ...caption, duration: Math.max(12_000, duration) })} />
      </Field>
      {LONG_LANGUAGES.filter((language) => project.output.languages.includes(language) || caption.text[language]).map((language) => {
        const excluded = caption.excluded.includes(language);
        const text = caption.text[language] ?? '';
        const lines = overflowLines(text, caption.style.size, caption.style.width);
        return (
          <div key={language} className="lv-field wide">
            <div className="row">
              <span className="muted">{LANGUAGE_LABEL[language]}</span>
              {!text.trim() && !excluded && project.output.languages.includes(language) ? <span className="badge err">未入力</span> : null}
              {lines > 2 ? <span className="badge warn">{lines}行（はみ出し注意）</span> : null}
              <span className="sp" />
              <label className="row" style={{ gap: 3, fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={excluded}
                  onChange={(event) =>
                    save('言語の除外', { ...caption, excluded: event.target.checked ? [...caption.excluded, language] : caption.excluded.filter((item) => item !== language) })
                  }
                />
                この言語では出さない
              </label>
            </div>
            <textarea value={text} disabled={excluded} onChange={(event) => save('字幕の本文', { ...caption, text: { ...caption.text, [language]: event.target.value } })} />
          </div>
        );
      })}
      <Section title="位置・スタイル">
        <div className="grid2">
          <label className="row">X <NumberInput value={caption.style.x} min={0} max={1} onChange={(x) => save('字幕の位置', { ...caption, style: { ...caption.style, x } })} /></label>
          <label className="row">Y <NumberInput value={caption.style.y} min={0} max={1} onChange={(y) => save('字幕の位置', { ...caption, style: { ...caption.style, y } })} /></label>
          <label className="row">幅 <NumberInput value={caption.style.width} min={0.05} max={1} onChange={(width) => save('字幕の幅', { ...caption, style: { ...caption.style, width } })} /></label>
          <label className="row">文字 <NumberInput value={caption.style.size} min={12} max={200} step={1} digits={0} onChange={(size) => save('文字の大きさ', { ...caption, style: { ...caption.style, size } })} /></label>
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <Seg value={caption.style.align} options={[['left', '左'], ['center', '中央'], ['right', '右']] as const} onChange={(align) => save('字幕の揃え', { ...caption, style: { ...caption.style, align } })} />
          <label className="row" style={{ gap: 3 }}>
            <input type="checkbox" checked={caption.style.background} onChange={(event) => save('字幕の背景', { ...caption, style: { ...caption.style, background: event.target.checked } })} />
            背景
          </label>
          <input type="color" value={caption.style.color} onChange={(event) => save('字幕の色', { ...caption, style: { ...caption.style, color: event.target.value } })} />
        </div>
        <p className="dim" style={{ fontSize: 10.5 }}>画面の周囲5%（文字の目安）の内側に置くと安全です。プラットフォームの保証ではありません。</p>
      </Section>
      <button type="button" className="sm ghost danger" onClick={() => { transact('字幕の削除', (current) => removeItem(current, 'captions', caption.id)); useLongStore.getState().select({ kind: 'none' }); }}>
        削除
      </button>
    </div>
  );
};

const OVERLAY_LABEL: Record<OverlayKind, string> = { arrow: '矢印', rect: '矩形', circle: '円', marker: 'マーカー', image: '画像', card: '説明カード', cutin: '予告カットイン' };

export const OverlayInspector = ({ overlay, plan }: { overlay: Overlay; plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const audioTracks = useStudioStore((state) => state.audioTracks).filter((track) => track.kind === 'se');
  const player = useLongPlayer();
  const save = (label: string, next: Overlay): void => transact(label, (current) => upsert(current, 'overlays', next));
  const images = project.assets.filter((asset) => asset.kind === 'image');
  const planned = plan.overlays.find((item) => item.id === overlay.id);
  const sceneLayers = overlay.sceneId ? project.placements.filter((item) => item.sceneId === overlay.sceneId) : project.placements;
  return (
    <div style={{ padding: '8px 12px' }}>
      <div className="row">
        <b>{OVERLAY_LABEL[overlay.kind]}</b>
        {!planned ? <span className="badge warn">出力されません（診断を確認）</span> : null}
      </div>
      {overlay.kind !== 'cutin' ? (
        <Field label="種類">
          <select value={overlay.kind} onChange={(event) => save('図形の種類', { ...overlay, kind: event.target.value as OverlayKind })}>
            {(['arrow', 'rect', 'circle', 'marker', 'image', 'card'] as OverlayKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {OVERLAY_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="基準">
        <span className="dim">{anchorLabel(project, overlay.anchor)}</span>
      </Field>
      <Field label={overlay.kind === 'cutin' ? '見せ場から' : '開始'}>
        <OffsetEditor anchor={overlay.anchor} onChange={(anchor) => save('タイミング', { ...overlay, anchor })} />
      </Field>
      <Field label="表示時間">
        <TimeInput value={overlay.duration} onChange={(duration) => save('表示時間', { ...overlay, duration: Math.max(12_000, duration) })} />
      </Field>
      {overlay.kind === 'cutin' && overlay.anchor.kind === 'event' ? (
        <p className="dim" style={{ fontSize: 10.5, margin: 0 }}>
          消えてから見せ場まで {((-overlay.anchor.offset - overlay.duration) / 120_000).toFixed(2)} 秒（目安：表示0.6〜0.8秒・0.3〜1.0秒後に見せ場）
        </p>
      ) : null}
      {overlay.kind !== 'cutin' ? (
        <Field label="対象">
          <select value={overlay.target} onChange={(event) => save('図形の対象', { ...overlay, target: event.target.value })}>
            <option value="screen">画面に固定</option>
            {sceneLayers.map((placement) => (
              <option key={placement.id} value={placement.id}>
                映像に追従：{placement.role === 'main' ? '主映像' : placement.role === 'secondary' ? '副視点' : '拡大小窓'}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label={overlay.target === 'screen' ? '位置（画面）' : '位置（元映像）'}>
        <div className="grid2">
          {(['x', 'y', 'w', 'h'] as const).map((key) => (
            <label key={key} className="row" style={{ gap: 3 }}>
              <span className="dim mono">{key}</span>
              <NumberInput value={overlay.rect[key]} min={-1} max={2} onChange={(value) => save('図形の位置', { ...overlay, rect: { ...overlay.rect, [key]: value } })} />
            </label>
          ))}
        </div>
      </Field>
      {overlay.kind === 'image' || overlay.kind === 'card' || overlay.kind === 'cutin' ? (
        <Field label="画像">
          <select value={overlay.assetId ?? ''} onChange={(event) => save('画像', { ...overlay, assetId: event.target.value || undefined })}>
            <option value="">選んでください</option>
            {images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="色・太さ">
          <div className="row">
            <input type="color" value={overlay.color} onChange={(event) => save('図形の色', { ...overlay, color: event.target.value })} />
            <NumberInput value={overlay.strokeWidth} min={1} max={40} step={1} digits={0} width={48} onChange={(strokeWidth) => save('図形の太さ', { ...overlay, strokeWidth })} />
          </div>
        </Field>
      )}
      <Field label="文字">
        <input value={overlay.text.ja ?? ''} placeholder="日本語" onChange={(event) => save('図形の文字', { ...overlay, text: { ...overlay.text, ja: event.target.value } })} />
      </Field>
      <Field label="動き">
        <select value={overlay.motion} onChange={(event) => save('動き', { ...overlay, motion: event.target.value as MotionKind })}>
          {(Object.keys(MOTION_LABEL) as MotionKind[]).map((motion) => (
            <option key={motion} value={motion}>
              {MOTION_LABEL[motion]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="効果音">
        <div className="row">
          <select value={overlay.seTrackId ?? ''} onChange={(event) => save('効果音', { ...overlay, seTrackId: event.target.value || undefined })}>
            <option value="">なし</option>
            {audioTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
          <NumberInput value={overlay.seGainDb} min={-60} max={24} step={0.5} digits={1} width={50} onChange={(seGainDb) => save('効果音の音量', { ...overlay, seGainDb })} />
          dB
        </div>
      </Field>
      <div className="row" style={{ marginTop: 6 }}>
        {planned ? (
          <button type="button" className="sm" onClick={() => player.playRange(Math.max(0, planned.from - 2 * plan.fps), Math.min(plan.durationInFrames - 1, planned.from + planned.duration + 3 * plan.fps))}>
            前後を通しで確認 ▶
          </button>
        ) : null}
        <span className="sp" />
        <button type="button" className="sm ghost danger" onClick={() => { transact('図形の削除', (current) => removeItem(current, 'overlays', overlay.id)); useLongStore.getState().select({ kind: 'none' }); }}>
          削除
        </button>
      </div>
    </div>
  );
};

export const AvatarEventInspector = ({ event }: { event: AvatarEvent }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const audioTracks = useStudioStore((state) => state.audioTracks).filter((track) => track.kind === 'se');
  const save = (label: string, next: AvatarEvent): void => transact(label, (current) => placeAvatarEvent(current, next));
  const set = project.avatarSets.find((item) => item.id === event.setId) ?? project.avatarSets[0];
  return (
    <div style={{ padding: '8px 12px' }}>
      <b>アバターの表情</b>
      {project.reactionPresets.length > 0 ? (
        <Field label="プリセット">
          <select
            value=""
            onChange={(selectEvent) => {
              const preset = project.reactionPresets.find((item) => item.id === selectEvent.target.value);
              if (preset) save('リアクションの適用', { ...event, expressionId: preset.expressionId, motion: preset.motion, duration: preset.duration, seTrackId: preset.seTrackId, text: preset.text });
            }}
          >
            <option value="">選んで適用…</option>
            {project.reactionPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="外観セット">
        <select value={event.setId ?? ''} onChange={(selectEvent) => save('外観セット', { ...event, setId: selectEvent.target.value || undefined })}>
          <option value="">通常のセット</option>
          {project.avatarSets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="表情">
        <select value={event.expressionId} onChange={(selectEvent) => save('表情', { ...event, expressionId: selectEvent.target.value })}>
          {project.expressions.map((expression) => (
            <option key={expression.id} value={expression.id}>
              {expression.id} {expression.name}
              {set && !set.expressions[expression.id] ? '（未登録）' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="基準">
        <span className="dim">{anchorLabel(project, event.anchor)}</span>
      </Field>
      <Field label="開始">
        <OffsetEditor anchor={event.anchor} onChange={(anchor) => save('表情の時刻', { ...event, anchor })} />
      </Field>
      <Field label="長さ">
        <TimeInput value={event.duration} onChange={(duration) => save('表情の長さ', { ...event, duration: Math.max(12_000, duration) })} />
      </Field>
      <Field label="動き">
        <select value={event.motion} onChange={(selectEvent) => save('動き', { ...event, motion: selectEvent.target.value as MotionKind })}>
          {(Object.keys(MOTION_LABEL) as MotionKind[]).map((motion) => (
            <option key={motion} value={motion}>
              {MOTION_LABEL[motion]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="終了後">
        <Seg value={event.after} options={[['previous', '直前の状態'], ['base', '通常'], ['hidden', '非表示']] as const} onChange={(after) => save('終了後の状態', { ...event, after })} />
      </Field>
      <Field label="位置・高さ">
        <div className="row">
          <NumberInput value={event.x ?? project.avatarBase.x} min={0} max={1} width={52} onChange={(x) => save('位置', { ...event, x })} />
          <NumberInput value={event.y ?? project.avatarBase.y} min={0} max={1.2} width={52} onChange={(y) => save('位置', { ...event, y })} />
          <NumberInput value={event.height ?? project.avatarBase.height} min={0.05} max={1} width={52} onChange={(height) => save('大きさ', { ...event, height })} />
        </div>
      </Field>
      <Field label="効果音">
        <select value={event.seTrackId ?? ''} onChange={(selectEvent) => save('効果音', { ...event, seTrackId: selectEvent.target.value || undefined })}>
          <option value="">なし</option>
          {audioTracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="文字">
        <input value={event.text.ja ?? ''} placeholder="短い文字（日本語）" onChange={(inputEvent) => save('文字', { ...event, text: { ...event.text, ja: inputEvent.target.value } })} />
      </Field>
      <button type="button" className="sm ghost danger" onClick={() => { transact('表情の削除', (current) => removeItem(current, 'avatarEvents', event.id)); useLongStore.getState().select({ kind: 'none' }); }}>
        削除
      </button>
    </div>
  );
};

export const SceneInspector = ({ sceneId }: { sceneId: string }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return null;
  const chapter = project.chapters.find((item) => item.id === scene.chapterId);
  const index = chapter?.sceneIds.indexOf(scene.id) ?? 0;
  const placementId = scene.content.kind === 'placement' ? scene.content.placementId : undefined;
  return (
    <div style={{ padding: '8px 12px' }}>
      <b>シーン</b>
      {scene.hint ? <p className="dim" style={{ margin: '2px 0' }}>{scene.hint}</p> : null}
      <Field label="名前">
        <input value={scene.label} onChange={(event) => transact('シーン名', (current) => updateScene(current, scene.id, { label: event.target.value }))} />
      </Field>
      <Field label="用途">
        <select value={scene.purpose} onChange={(event) => transact('シーンの用途', (current) => updateScene(current, scene.id, { purpose: event.target.value as ScenePurpose }))}>
          {(Object.keys(SCENE_PURPOSE_LABEL) as ScenePurpose[]).map((purpose) => (
            <option key={purpose} value={purpose}>
              {SCENE_PURPOSE_LABEL[purpose]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="内容">
        {scene.content.kind === 'placement' ? (
          <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'placement', id: placementId! })}>
            主映像の設定を開く
          </button>
        ) : scene.content.kind === 'still' ? (
          <div className="row">
            静止画・カード
            <TimeInput value={scene.content.duration} onChange={(duration) => transact('静止画の長さ', (current) => updateScene(current, scene.id, { content: { ...(scene.content as { kind: 'still'; color: string; duration: number }), duration: Math.max(12_000, duration) } }))} />
            <input type="color" value={scene.content.color} onChange={(event) => transact('背景色', (current) => updateScene(current, scene.id, { content: { ...(scene.content as { kind: 'still'; color: string; duration: number }), color: event.target.value } }))} />
          </div>
        ) : (
          <div>
            <span className="badge warn">未割当</span>
            <span className="dim"> 候補区間をドロップするか、素材パネルの「割当」で割り当てます</span>
            <div className="row" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="sm"
                onClick={() => transact('静止画・間にする', (current) => updateScene(current, scene.id, { content: { kind: 'still', color: '#0F1216', duration: scene.content.kind === 'empty' ? scene.content.plannedDuration : secToTicks(3) } }))}
              >
                静止画・間にする
              </button>
            </div>
          </div>
        )}
      </Field>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={!scene.enabled} onChange={(event) => transact(event.target.checked ? 'シーンの無効化' : 'シーンの有効化', (current) => setSceneEnabled(current, scene.id, !event.target.checked))} />
          無効にする（尺と出力から外し、内容は残す）
        </label>
      </div>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <button type="button" className="sm" disabled={index === 0} onClick={() => chapter && transact('シーンの並べ替え', (current) => moveScene(current, scene.id, chapter.id, index - 1))}>
          ↑ 前へ
        </button>
        <button type="button" className="sm" disabled={!chapter || index >= chapter.sceneIds.length - 1} onClick={() => chapter && transact('シーンの並べ替え', (current) => moveScene(current, scene.id, chapter.id, index + 1))}>
          ↓ 後ろへ
        </button>
        <select
          value=""
          onChange={(event) => {
            const target = project.chapters.find((item) => item.id === event.target.value);
            if (target) transact('シーンを別の章へ', (current) => moveScene(current, scene.id, target.id, target.sceneIds.length));
          }}
        >
          <option value="">別の章へ…</option>
          {project.chapters
            .filter((item) => item.id !== scene.chapterId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title.ja || item.role}
              </option>
            ))}
        </select>
        <button type="button" className="sm" onClick={() => transact('シーンの複製', (current) => duplicateScene(current, scene.id).project)}>
          複製
        </button>
        {scene.content.kind === 'placement' ? (
          <button type="button" className="sm" onClick={() => transact('割り当てを外す', (current) => unassignScene(current, scene.id))}>
            割り当てを外す
          </button>
        ) : null}
        <button type="button" className="sm ghost danger" onClick={() => { transact('シーンの削除', (current) => deleteScene(current, scene.id)); useLongStore.getState().select({ kind: 'none' }); }}>
          削除
        </button>
      </div>
    </div>
  );
};

export const AudioItemInspector = ({ kind, id }: { kind: 'bgm' | 'se' | 'ducking'; id: string }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const tracks = useStudioStore((state) => state.audioTracks);
  if (kind === 'bgm') {
    const item = project.bgm.find((entry) => entry.id === id);
    if (!item) return null;
    const save = (label: string, patch: Partial<typeof item>): void => transact(label, (current) => upsert(current, 'bgm', { ...item, ...patch }));
    return (
      <div style={{ padding: '8px 12px' }}>
        <b>BGM</b>
        <Field label="曲">
          <select value={item.audioTrackId} onChange={(event) => save('BGMの曲', { audioTrackId: event.target.value })}>
            {tracks.filter((track) => track.kind === 'bgm').map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="基準">
          <span className="dim">{anchorLabel(project, item.anchor)}</span>
        </Field>
        <Field label="開始">
          <OffsetEditor anchor={item.anchor} onChange={(anchor) => save('BGMの開始', { anchor })} />
        </Field>
        <Field label="長さ">
          <TimeInput value={item.duration} onChange={(duration) => save('BGMの長さ', { duration: Math.max(12_000, duration) })} />
        </Field>
        <Field label="曲内の開始">
          <TimeInput value={item.offset} onChange={(offset) => save('曲内の開始', { offset })} />
        </Field>
        <Field label="音量">
          <div className="row">
            <NumberInput value={item.gainDb} min={-60} max={12} step={0.5} digits={1} width={56} onChange={(gainDb) => save('BGMの音量', { gainDb })} /> dB
          </div>
        </Field>
        <Field label="フェード">
          <div className="row">
            in <NumberInput value={item.fadeIn / 120_000} min={0} max={20} step={0.1} digits={2} width={50} onChange={(value) => save('フェード', { fadeIn: secToTicks(value) })} />
            out <NumberInput value={item.fadeOut / 120_000} min={0} max={20} step={0.1} digits={2} width={50} onChange={(value) => save('フェード', { fadeOut: secToTicks(value) })} />
          </div>
        </Field>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={item.loop} onChange={(event) => save('ループ', { loop: event.target.checked })} />
          曲が短いときはループする
        </label>
        <button type="button" className="sm ghost danger" onClick={() => { transact('BGMの削除', (current) => removeItem(current, 'bgm', id)); useLongStore.getState().select({ kind: 'none' }); }}>
          削除
        </button>
      </div>
    );
  }
  if (kind === 'se') {
    const item = project.se.find((entry) => entry.id === id);
    if (!item) return null;
    const save = (label: string, patch: Partial<typeof item>): void => transact(label, (current) => upsert(current, 'se', { ...item, ...patch }));
    return (
      <div style={{ padding: '8px 12px' }}>
        <b>効果音</b>
        <Field label="音源">
          <select value={item.audioTrackId} onChange={(event) => save('効果音', { audioTrackId: event.target.value })}>
            {tracks.filter((track) => track.kind === 'se').map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="基準">
          <span className="dim">{anchorLabel(project, item.anchor)}</span>
        </Field>
        <Field label="時刻">
          <OffsetEditor anchor={item.anchor} onChange={(anchor) => save('効果音の時刻', { anchor })} />
        </Field>
        <Field label="音量">
          <div className="row">
            <NumberInput value={item.gainDb} min={-60} max={12} step={0.5} digits={1} width={56} onChange={(gainDb) => save('効果音の音量', { gainDb })} /> dB
          </div>
        </Field>
        <button type="button" className="sm ghost danger" onClick={() => { transact('効果音の削除', (current) => removeItem(current, 'se', id)); useLongStore.getState().select({ kind: 'none' }); }}>
          削除
        </button>
      </div>
    );
  }
  const item = project.ducking.find((entry) => entry.id === id);
  if (!item) return null;
  const save = (label: string, patch: Partial<typeof item>): void => transact(label, (current) => upsert(current, 'ducking', { ...item, ...patch }));
  return (
    <div style={{ padding: '8px 12px' }}>
      <b>BGMを下げる区間（手動ダッキング）</b>
      <Field label="基準">
        <span className="dim">{anchorLabel(project, item.anchor)}</span>
      </Field>
      <Field label="開始">
        <OffsetEditor anchor={item.anchor} onChange={(anchor) => save('下げる区間', { anchor })} />
      </Field>
      <Field label="長さ">
        <TimeInput value={item.duration} onChange={(duration) => save('下げる長さ', { duration: Math.max(12_000, duration) })} />
      </Field>
      <Field label="下げ幅">
        <div className="row">
          <NumberInput value={item.depthDb} min={-60} max={0} step={1} digits={0} width={50} onChange={(depthDb) => save('下げ幅', { depthDb })} /> dB
        </div>
      </Field>
      <Field label="下げ／戻し">
        <div className="row">
          <NumberInput value={item.attack / 120_000} min={0} max={5} step={0.05} digits={2} width={50} onChange={(value) => save('下げる速さ', { attack: secToTicks(value) })} />
          <NumberInput value={item.release / 120_000} min={0} max={10} step={0.05} digits={2} width={50} onChange={(value) => save('戻す速さ', { release: secToTicks(value) })} />
          秒
        </div>
      </Field>
      <button type="button" className="sm ghost danger" onClick={() => { transact('下げる区間の削除', (current) => removeItem(current, 'ducking', id)); useLongStore.getState().select({ kind: 'none' }); }}>
        削除
      </button>
    </div>
  );
};
