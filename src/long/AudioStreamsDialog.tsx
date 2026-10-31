import { useRef, useState } from 'react';
import type { AudioStreamRole, LongAsset } from '../../shared/long/schema';
import { useLongStore } from './store';
import { errorText, studioUrl } from './util';

const ROLE_LABEL: Record<AudioStreamRole, string> = {
  game: 'ゲーム音',
  voice: '本人の声',
  mixed: '混合（ゲーム＋声）',
  secondary: '副視点',
  unused: '使わない',
};

/**
 * W6：録画の音声ストリームを試聴し、役割をユーザーが付ける。トラック番号から内容を推測して固定しない。
 * ここで付けた役割は、新しく配置するときの既定の選択に使う（配置ごとの選択はインスペクター）。
 */
export const AudioStreamsDialog = ({ asset, onClose }: { asset: LongAsset; onClose: () => void }) => {
  const project = useLongStore((state) => state.project)!;
  const current = project.assets.find((item) => item.id === asset.id) ?? asset;
  const streams = current.probe?.audioStreams ?? [];
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const roles = new Set(streams.map((stream) => stream.role));
  const duplicate = roles.has('mixed') && (roles.has('game') || roles.has('voice'));

  const listen = (index: number, path?: string): void => {
    audio.current?.pause();
    if (playing === index || !path) {
      setPlaying(null);
      return;
    }
    const element = new Audio(studioUrl(path));
    element.currentTime = Math.min(30, (current.probe?.durationTicks ?? 0) / 120_000 / 2);
    void element.play();
    audio.current = element;
    setPlaying(index);
  };

  const setRole = (audioIndex: number, role: AudioStreamRole): void =>
    useLongStore.getState().transact('音声の役割を設定', (projectNow) => ({
      ...projectNow,
      assets: projectNow.assets.map((item) =>
        item.id === asset.id && item.probe
          ? { ...item, probe: { ...item.probe, audioStreams: item.probe.audioStreams.map((stream) => (stream.audioIndex === audioIndex ? { ...stream, role } : stream)) } }
          : item,
      ),
    }));

  const reextract = async (): Promise<void> => {
    try {
      const next = await window.studio.long.extractAudio(project.id, current);
      useLongStore.getState().transact('音声の抽出', (projectNow) => ({ ...projectNow, assets: projectNow.assets.map((item) => (item.id === next.id ? next : item)) }));
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 760 }}>
        <div className="dh">
          録画の音声ストリーム：{current.name}
          <span className="sp" />
          <button
            type="button"
            className="sm ghost"
            onClick={() => {
              audio.current?.pause();
              onClose();
            }}
          >
            ×
          </button>
        </div>
        <div className="db">
          {streams.length === 0 ? (
            <p className="muted">この録画には音声がありません。</p>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>#</th>
                  <th>形式</th>
                  <th>メタデータ</th>
                  <th>試聴</th>
                  <th>役割（手動）</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((stream) => (
                  <tr key={stream.audioIndex}>
                    <td className="mono">{stream.audioIndex}</td>
                    <td className="mono">
                      {stream.codec} {Math.round(stream.sampleRate / 1000)}k {stream.channels}ch
                    </td>
                    <td className="dim">
                      {stream.title ?? '—'}
                      {stream.language ? ` · ${stream.language}` : ''}
                    </td>
                    <td>
                      <button type="button" className="sm" disabled={!stream.extractedPath} onClick={() => listen(stream.audioIndex, stream.extractedPath)}>
                        {playing === stream.audioIndex ? '⏸' : '▶'}
                      </button>
                    </td>
                    <td>
                      <select value={stream.role ?? ''} onChange={(event) => setRole(stream.audioIndex, event.target.value as AudioStreamRole)}>
                        <option value="">未設定</option>
                        {(Object.keys(ROLE_LABEL) as AudioStreamRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {duplicate ? (
            <div className="diag info">ℹ 混合トラックと、その構成要素（ゲーム音・本人の声）を同時に使うと音が二重になります。配置ごとに、どちらかだけを使ってください。</div>
          ) : null}
          <p className="dim" style={{ fontSize: 11 }}>
            分離されていないボイスチャットは、個別に調整できません。各ストリームは取り込み時に別ファイルへ抽出し、プレビューと書き出しで同じものを鳴らします。
          </p>
          {streams.some((stream) => !stream.extractedPath) ? (
            <button type="button" className="sm" onClick={() => void reextract()}>
              音声を抽出し直す
            </button>
          ) : null}
        </div>
        <div className="df">
          <button
            type="button"
            onClick={() => {
              audio.current?.pause();
              onClose();
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
