import { useMemo, useState, type ReactNode } from 'react';
import {
  AUDIO_SOURCE_DEFAULTS,
  type AudioRegistration,
  type AudioSource,
  type AudioTrack,
} from '../shared/schema/audio';
import type { AudioUsageRecord } from '../shared/ipc';
import type { Project } from '../shared/schema/project';
import { getDurationInFrames } from '../remotion/LineupShortStandard';
import { defaultBgmPlacement } from '../shared/timeline';
import { BgmGainFields } from './ProjectInspector';
import { AUDIO_DRAG_TYPE, encodeAudioDrag } from './timeline-model';

type Props = {
  project: Project;
  tracks: AudioTrack[];
  usage: AudioUsageRecord[];
  busy: boolean;
  defaultBgmTrackId: string | null;
  onRegister: (registration: AudioRegistration, sourcePath?: string) => void;
  onChange: (updater: (project: Project) => Project) => void;
  onSetDefaultBgm: (trackId: string | null) => void;
};

const today = (): string => new Date().toISOString().slice(0, 10);
const sourceLabels: Record<AudioSource, string> = {
  bgmer: 'BGMer',
  musmus: 'MusMus',
  opentracks: 'OpenTracks',
  ytal: 'YouTube Audio Library',
  other: 'その他',
};

export const AudioPanel = ({
  project,
  tracks,
  usage,
  busy,
  defaultBgmTrackId,
  onRegister,
  onChange,
  onSetDefaultBgm,
}: Props): ReactNode => {
  const [kind, setKind] = useState<'bgm' | 'se'>('bgm');
  const [source, setSource] = useState<AudioSource>('other');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<'all' | 'youtube' | 'tiktok' | 'x'>('all');
  const defaults = AUDIO_SOURCE_DEFAULTS[source];
  const selected = tracks.find((track) => track.id === project.audio.bgm?.audioTrackId);
  const videoDuration = getDurationInFrames(project) / project.templateParams.fps;
  const availableDuration = selected
    ? Math.max(0, selected.durationSec - (project.audio.bgm?.offset ?? 0))
    : 0;
  const isTooShort = Boolean(selected && availableDuration < videoDuration);
  const canRegister = title.trim() && sourceUrl.trim() && termsConfirmed;
  const bgmTracks = tracks.filter((track) => track.kind === 'bgm');
  const defaultMissing = Boolean(
    defaultBgmTrackId && !bgmTracks.some((track) => track.id === defaultBgmTrackId),
  );
  const visibleTracks = tracks.filter((track) => {
    const haystack = `${track.title} ${track.artist} ${track.moods.join(' ')} ${track.tags.join(' ')}`.toLowerCase();
    return (
      track.kind === 'bgm' &&
      haystack.includes(query.trim().toLowerCase()) &&
      (platform === 'all' || track.allowedPlatforms.includes(platform))
    );
  });
  const selectedUsage = usage.filter((item) => item.audioTrackId === selected?.id);

  const registration = useMemo<AudioRegistration>(
    () => ({
      kind,
      title: title.trim(),
      artist: artist.trim(),
      source,
      sourceUrl: sourceUrl.trim(),
      downloadedAt: today(),
      termsCheckedAt: today(),
      creditRequired: defaults.creditRequired,
      creditText: defaults.creditText,
      allowedPlatforms: defaults.allowedPlatforms,
      authorTermsNote: '',
      licenseStatus: canRegister ? 'confirmed' : 'unconfirmed',
      moods: [],
      tags: [],
    }),
    [artist, canRegister, defaults, kind, source, sourceUrl, title],
  );

  return (
    <section className="audio-panel">
      <div className="subsection-heading">
        <div>
          <span className="eyebrow">AUDIO</span>
          <h3>BGM</h3>
        </div>
      </div>

      <div className="drag-chip-list" aria-label="タイムラインへドラッグできる音源">
        {tracks.map((track) => (
          <button
            key={track.id}
            type="button"
            className="drag-chip"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(AUDIO_DRAG_TYPE, encodeAudioDrag(track.kind, track.id));
              event.dataTransfer.effectAllowed = 'copy';
            }}
          >
            {track.kind === 'bgm' ? 'BGM' : '効果音'} {track.title}
          </button>
        ))}
      </div>
      <p className="drop-hint">BGMはA2へ、効果音はA3のブロックへドラッグします。</p>
      <div className="default-bgm">
        <label className="field">
          <span>新規プロジェクトのデフォルトBGM</span>
          <select
            value={defaultBgmTrackId ?? ''}
            onChange={(event) => onSetDefaultBgm(event.target.value || null)}
          >
            <option value="">未設定</option>
            {defaultMissing && <option value={defaultBgmTrackId ?? ''}>見つからない曲</option>}
            {bgmTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title} {track.artist ? `— ${track.artist}` : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="field-hint">
          新しく作るプロジェクトに、この曲が最初から入ります。開いているプロジェクトの曲は変わりません。
        </p>
        {defaultMissing && (
          <div className="notice error">
            デフォルトに設定した曲が見つかりません。別の曲を選ぶか、未設定にしてください。
          </div>
        )}
      </div>
      <div className="audio-grid">
        <label className="field">
          <span>検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="field">
          <span>使えるプラットフォーム</span>
          <select value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)}>
            <option value="all">すべて</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="x">X</option>
          </select>
        </label>
        <label className="field">
          <span>登録済みBGM</span>
          <select
            value={project.audio.bgm?.audioTrackId ?? ''}
            onChange={(event) =>
              onChange((current) => {
                const track = tracks.find((item) => item.id === event.target.value);
                current.audio.bgm = track ? defaultBgmPlacement(current, track.id) : null;
                return current;
              })
            }
          >
            <option value="">BGMなし</option>
            {visibleTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.title} {track.artist ? `— ${track.artist}` : ''}
                </option>
              ))}
          </select>
        </label>
        {selected && (
          <>
            <BgmGainFields project={project} onChange={onChange} />
            <label className="field">
              <span>動画内の開始位置（秒）</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={project.audio.bgm?.start ?? 0}
                onChange={(event) =>
                  onChange((current) => {
                    if (current.audio.bgm) current.audio.bgm.start = Math.max(0, Number(event.target.value));
                    return current;
                  })
                }
              />
            </label>
            <label className="field">
              <span>曲の開始位置（秒）</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, selected.durationSec - 0.1)}
                step={0.1}
                value={project.audio.bgm?.offset ?? 0}
                onChange={(event) =>
                  onChange((current) => {
                    if (current.audio.bgm) {
                      current.audio.bgm.offset = Math.max(0, Number(event.target.value));
                    }
                    return current;
                  })
                }
              />
            </label>
            <label className="field">
              <span>フェードイン（秒）</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={project.audio.bgm?.fadeIn ?? 0}
                onChange={(event) =>
                  onChange((current) => {
                    if (current.audio.bgm) {
                      current.audio.bgm.fadeIn = Math.max(0, Number(event.target.value));
                    }
                    return current;
                  })
                }
              />
            </label>
            <label className="field">
              <span>フェードアウト（秒）</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={project.audio.bgm?.fadeOut ?? 0}
                onChange={(event) =>
                  onChange((current) => {
                    if (current.audio.bgm) {
                      current.audio.bgm.fadeOut = Math.max(0, Number(event.target.value));
                    }
                    return current;
                  })
                }
              />
            </label>
            <audio
              className="audio-preview"
              controls
              src={`studio-media://root/${selected.filePath
                .split('/')
                .map(encodeURIComponent)
                .join('/')}`}
            />
            <div className="waveform" aria-hidden="true">
              {selected.waveform.map((level, index) => (
                <span key={`${selected.id}-${index}`} style={{ height: `${Math.max(8, level * 100)}%` }} />
              ))}
            </div>
            <div className="audio-meta">
              {selected.durationSec.toFixed(1)}秒 ·{' '}
              {selected.lufs === null ? 'LUFS解析不可' : `${selected.lufs.toFixed(1)} LUFS`} ·{' '}
              {sourceLabels[selected.source]}
            </div>
            {selectedUsage.length > 0 && (
              <div className="audio-meta">
                使用履歴: {selectedUsage.slice(0, 5).map((item) => item.variantId).join(' / ')}
              </div>
            )}
            {selected.id === defaultBgmTrackId ? (
              <p className="field-hint wide">この曲は新規プロジェクトのデフォルトです。</p>
            ) : (
              <button type="button" className="wide" onClick={() => onSetDefaultBgm(selected.id)}>
                この曲をデフォルトにする
              </button>
            )}
            {isTooShort && (
              <div className="notice error">
                曲が動画より短いため、途中で無音になります。別の曲を選ぶか開始位置を調整してください。
              </div>
            )}
          </>
        )}
      </div>

      <details className="audio-registration">
        <summary>新しいBGMを登録</summary>
        <div
          className="audio-grid registration-grid"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (!file || !canRegister) return;
            onRegister(registration, window.studio.getPathForFile(file));
          }}
        >
          <label className="field">
            <span>種類</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as 'bgm' | 'se')}>
              <option value="bgm">BGM</option>
              <option value="se">効果音</option>
            </select>
          </label>
          <label className="field">
            <span>入手元</span>
            <select value={source} onChange={(event) => setSource(event.target.value as AudioSource)}>
              {Object.entries(sourceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>曲名</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>作者</span>
            <input value={artist} onChange={(event) => setArtist(event.target.value)} />
          </label>
          <label className="field wide">
            <span>曲ページURL</span>
            <input
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
            />
          </label>
          <label className="check-field wide">
            <input
              type="checkbox"
              checked={termsConfirmed}
              onChange={(event) => setTermsConfirmed(event.target.checked)}
            />
            曲ページと現在の利用規約を確認しました
          </label>
          <button
            type="button"
            onClick={() => onRegister(registration)}
            disabled={busy || !canRegister}
          >
            音声ファイルを選択して登録
          </button>
          <p className="drop-hint wide">
            MP3・WAV・M4A・OGGをここへドロップしても登録できます
          </p>
        </div>
      </details>
    </section>
  );
};
