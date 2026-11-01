import { useEffect, useState, type DragEvent } from 'react';
import { assignCandidate, upsert, removeItem } from '../../shared/long/commands';
import { LONG_IMAGE_EXTENSIONS, LONG_VIDEO_EXTENSIONS, longMediaKindOf, type LongMediaKind } from '../../shared/long/ipc';
import { CANDIDATE_TAGS, type Candidate, type LongAsset, type LongLineup } from '../../shared/long/schema';
import { formatTicks, secToTicks } from '../../shared/long/time';
import { useStudioStore } from '../store';
import { AudioStreamsDialog } from './AudioStreamsDialog';
import { AvatarManager } from './AvatarManager';
import { CandidateEditor } from './CandidateEditor';
import { LineupEditor } from './LineupEditor';
import { useLongPlayer } from './player';
import { useLongStore } from './store';
import { TAG_CLASS, errorText } from './util';

type Tab = 'video' | 'candidates' | 'lineups' | 'images' | 'avatars' | 'audio';

export const CANDIDATE_MIME = 'application/x-cvcs-candidate';

const hasFiles = (event: { dataTransfer: DataTransfer | null }): boolean => Boolean(event.dataTransfer?.types.includes('Files'));

/** 素材パネル：録画・候補区間・定点・画像・アバター・音源（W2 左） */
export const AssetPanel = () => {
  const project = useLongStore((state) => state.project)!;
  const selection = useLongStore((state) => state.selection);
  const missing = useLongStore((state) => state.missingAssets);
  const proxyProgress = useLongStore((state) => state.proxyProgress);
  const frame = useLongStore((state) => state.frame);
  const audioTracks = useStudioStore((state) => state.audioTracks);
  const player = useLongPlayer();
  const [tab, setTab] = useState<Tab>('candidates');
  const [filter, setFilter] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ candidate?: Candidate; asset?: LongAsset } | null>(null);
  const [streams, setStreams] = useState<LongAsset | null>(null);
  const [lineup, setLineup] = useState<LongLineup | 'new' | null>(null);
  const [avatars, setAvatars] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const transact = useLongStore((state) => state.transact);

  // 素材パネルの外にファイルを落としても、ウィンドウがそのファイルへ移動しないようにする
  // （各ドロップ先が先に preventDefault した場合はそのまま通す）
  useEffect(() => {
    const guard = (event: globalThis.DragEvent): void => {
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  const videos = project.assets.filter((asset) => asset.kind === 'video');
  const images = project.assets.filter((asset) => asset.kind === 'image');
  const usage = (candidateId: string): number =>
    project.placements.filter((placement) => placement.role === 'main' && placement.candidateId === candidateId).length;
  const candidates = project.candidates.filter(
    (candidate) =>
      (filter.length === 0 || filter.every((tag) => (tag === '未使用' ? usage(candidate.id) === 0 : candidate.tags.includes(tag)))) &&
      (!query.trim() || `${candidate.name} ${candidate.memo}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const selectedSceneId =
    selection.kind === 'scene'
      ? selection.id
      : selection.kind === 'placement'
        ? project.placements.find((item) => item.id === selection.id)?.sceneId
        : undefined;
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId);

  const importVideo = async (): Promise<void> => {
    try {
      const result = await window.studio.long.importMedia(project.id, 'video');
      if (!result) return;
      transact('録画の取り込み', (current) => ({ ...current, assets: [...current.assets, ...result.assets] }));
      if (result.assets[0]) setEditing({ asset: result.assets[0] });
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  const importImages = async (): Promise<void> => {
    try {
      const result = await window.studio.long.importMedia(project.id, 'image');
      if (!result) return;
      transact('画像の取り込み', (current) => ({ ...current, assets: [...current.assets, ...result.assets] }));
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  /** エクスプローラからドロップされた複数ファイルを、拡張子で録画・画像に振り分けて1件ずつ取り込む */
  const importDropped = async (files: File[]): Promise<void> => {
    if (importing) {
      useLongStore.getState().setMessage('取り込み中です。完了してから追加してください');
      return;
    }
    const projectId = project.id;
    const entries = files.map((file) => ({ name: file.name, path: window.studio.getPathForFile(file), kind: longMediaKindOf(file.name) }));
    const targets = entries.filter((entry): entry is { name: string; path: string; kind: LongMediaKind } => Boolean(entry.kind && entry.path));
    const skipped = entries.filter((entry) => !entry.kind || !entry.path).map((entry) => entry.name);
    const formats = `録画 ${LONG_VIDEO_EXTENSIONS.join('・')}／画像 ${LONG_IMAGE_EXTENSIONS.join('・')}`;
    if (targets.length === 0) {
      useLongStore.getState().setMessage(`取り込める形式のファイルがありません（${formats}）：${skipped.join('、')}`);
      return;
    }
    const added: LongAsset[] = [];
    const failed: string[] = [];
    setImporting({ done: 0, total: targets.length });
    for (const [index, target] of targets.entries()) {
      try {
        const result = await window.studio.long.importMedia(projectId, target.kind, [target.path]);
        if (result) added.push(...result.assets);
      } catch (error) {
        failed.push(`${target.name}（${errorText(error)}）`);
      }
      setImporting({ done: index + 1, total: targets.length });
    }
    setImporting(null);
    // 取り込み中に別のプロジェクトへ切り替えた場合は、元のプロジェクトへ反映しない
    if (useLongStore.getState().project?.id !== projectId) return;
    if (added.length > 0) {
      transact('素材の取り込み', (current) => ({ ...current, assets: [...current.assets, ...added] }));
      setTab(added.some((asset) => asset.kind === 'video') ? 'video' : 'images');
    }
    const videoCount = added.filter((asset) => asset.kind === 'video').length;
    const imageCount = added.length - videoCount;
    const parts = [
      added.length > 0 ? `${[videoCount ? `録画 ${videoCount}件` : '', imageCount ? `画像 ${imageCount}件` : ''].filter(Boolean).join('・')}を取り込みました` : '',
      failed.length > 0 ? `取り込めませんでした：${failed.join('、')}` : '',
      skipped.length > 0 ? `対応外の形式のため除外：${skipped.join('、')}` : '',
    ].filter(Boolean);
    useLongStore.getState().setMessage(parts.join('。'));
  };

  const onDragOver = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };

  const onDragLeave = (event: DragEvent): void => {
    // 子要素の間を移動しただけなら表示を消さない
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDropActive(false);
  };

  const onDrop = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void importDropped(files);
  };

  const relink = async (asset: LongAsset): Promise<void> => {
    try {
      const result = await window.studio.long.relink(project.id, asset);
      if (!result) return;
      transact(result.sameMedia ? '素材の再リンク' : '素材の差し替え', (current) => ({
        ...current,
        assets: current.assets.map((item) => (item.id === asset.id ? result.asset : item)),
        // 別素材への差し替えでは、素材時刻に結び付いたマーカーを再確認対象にする
        markers: result.sameMedia
          ? current.markers
          : current.markers.map((marker) => {
              const placement = current.placements.find((item) => item.id === marker.placementId);
              return placement && 'assetId' in placement && placement.assetId === asset.id ? { ...marker, needsReview: true } : marker;
            }),
      }));
      useLongStore.getState().setMissingAssets(useLongStore.getState().missingAssets.filter((id) => id !== asset.id));
      useLongStore
        .getState()
        .setMessage(result.sameMedia ? '同じ素材として再リンクしました' : `別の素材として差し替えました（${result.changes.join('、')}）。同期点・字幕・マーカーを確認してください`);
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  const assign = (candidate: Candidate): void => {
    if (!selectedScene) {
      useLongStore.getState().setMessage('割り当てるシーンを、ストーリーボードかタイムラインで選んでください');
      return;
    }
    transact('素材の割り当て', (current) => assignCandidate(current, selectedScene.id, candidate));
  };

  const thumbStyle = (asset: LongAsset | undefined) => (asset && asset.kind === 'image' ? { backgroundImage: `url("${encodeURI(`studio-media://root/${asset.path}`)}")` } : undefined);

  return (
    <div className={`lv-assets ${dropActive ? 'drop' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="lv-ph">
        素材
        {importing ? (
          <span className="badge" style={{ fontWeight: 400 }}>
            取り込み中 {importing.done}/{importing.total}
          </span>
        ) : null}
        <span className="sp" />
        <button type="button" className="sm" title="エクスプローラから録画・画像をこのパネルへドラッグしても取り込めます（複数可）" onClick={() => void importVideo()}>
          ＋ 録画
        </button>
      </div>
      <div className="lv-tabs" style={{ fontSize: 11 }}>
        {(
          [
            ['video', '録画'],
            ['candidates', '候補区間'],
            ['lineups', '定点'],
            ['images', '画像'],
            ['avatars', 'アバター'],
            ['audio', '音源'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'candidates' ? (
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
          <input placeholder="名前・メモで検索" value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: '100%', marginBottom: 4 }} />
          {[...CANDIDATE_TAGS, '未使用'].map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip"
              aria-pressed={filter.includes(tag)}
              onClick={() => setFilter((list) => (list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag]))}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
      <div className="scroll" style={{ flex: 1 }}>
        {tab === 'video' &&
          (videos.length === 0 ? (
            <p className="muted" style={{ padding: 10 }}>
              長い録画や切り出し済みの動画を取り込みます。元のファイルは変更しません。
              <br />
              エクスプローラから複数のファイルをこのパネルへドラッグ＆ドロップしても取り込めます。
            </p>
          ) : (
            videos.map((asset) => (
              <div key={asset.id} className="lv-item" style={{ cursor: 'default' }}>
                <div className="meta">
                  <div className="t1">{asset.name}</div>
                  <div className="t2 mono">
                    {asset.probe ? `${formatTicks(asset.probe.durationTicks, false)} · ${asset.probe.width}×${asset.probe.height} · ${Math.round(asset.probe.fps * 100) / 100}fps` : '—'}
                    {asset.probe?.vfr ? ' · VFR' : ''}
                  </div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 2 }}>
                    {missing.includes(asset.id) ? <span className="badge err">見つかりません</span> : null}
                    {proxyProgress[asset.id] !== undefined ? <span className="badge">プレビュー用 {Math.round(proxyProgress[asset.id]! * 100)}%</span> : null}
                    {asset.importedFrom ? <span className="badge">再利用：{asset.importedFrom.projectTitle}</span> : null}
                    <span className="badge">音声 {asset.probe?.audioStreams.length ?? 0}</span>
                  </div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                    <button type="button" className="sm" onClick={() => setEditing({ asset })}>
                      候補を作る
                    </button>
                    <button type="button" className="sm" onClick={() => setStreams(asset)}>
                      音声
                    </button>
                    <button type="button" className="sm ghost" onClick={() => void relink(asset)}>
                      再リンク
                    </button>
                  </div>
                </div>
              </div>
            ))
          ))}
        {tab === 'candidates' &&
          (candidates.length === 0 ? (
            <p className="muted" style={{ padding: 10 }}>
              録画タブの「候補を作る」で、名前・IN/OUT・タグ・メモ・見せ場マーカーを付けた候補区間を作ります。同じ候補を何度でも配置できます。
            </p>
          ) : (
            candidates.map((candidate) => {
              const asset = project.assets.find((item) => item.id === candidate.assetId);
              const used = usage(candidate.id);
              return (
                <div
                  key={candidate.id}
                  className="lv-item"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData(CANDIDATE_MIME, candidate.id)}
                  onDoubleClick={() => setEditing({ candidate, asset })}
                >
                  <div className="meta">
                    <div className="t1">{candidate.name || '（無題）'}</div>
                    <div className="t2 mono">
                      {asset?.name ?? '素材なし'} · {formatTicks(candidate.in, false)}–{formatTicks(candidate.out, false)}
                    </div>
                    <div>
                      {candidate.tags.map((tag) => (
                        <span key={tag} className={`lv-tag ${TAG_CLASS[tag] ?? ''}`}>
                          {tag}
                        </span>
                      ))}
                      <span className="dim" style={{ fontSize: 10 }}>
                        {used > 0 ? `使用 ${used}` : '未使用'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button type="button" className="sm" title={selectedScene ? `「${selectedScene.label}」へ割り当て` : 'シーンを選んでください'} onClick={() => assign(candidate)}>
                      割当
                    </button>
                    <button type="button" className="sm ghost" onClick={() => setEditing({ candidate, asset })}>
                      編集
                    </button>
                  </div>
                </div>
              );
            })
          ))}
        {tab === 'lineups' && (
          <div>
            {project.lineups.map((item) => (
              <div key={item.id} className="lv-item" style={{ cursor: 'default' }} onDoubleClick={() => setLineup(item)}>
                <div className="meta">
                  <div className="t1">{item.title || `${item.map} ${item.site} ${item.ability}`}</div>
                  <div className="t2">
                    {item.map} · {item.site} · {item.side === 'attack' ? '攻め' : '守り'} · {item.agent} · {item.ability}
                  </div>
                  {item.importedFrom ? <span className="badge">再利用：{item.importedFrom.projectTitle}</span> : null}
                </div>
                <button type="button" className="sm" onClick={() => setLineup(item)}>
                  編集
                </button>
              </div>
            ))}
            <div style={{ padding: 8 }}>
              <button type="button" className="sm" onClick={() => setLineup('new')}>
                ＋ 定点を追加
              </button>
            </div>
          </div>
        )}
        {tab === 'images' && (
          <div>
            {images.map((asset) => (
              <div key={asset.id} className="lv-item" style={{ cursor: 'default' }}>
                <div className="lv-thumb" style={thumbStyle(asset)} />
                <div className="meta">
                  <div className="t1">{asset.name}</div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 2 }}>
                    <button
                      type="button"
                      className="sm"
                      disabled={!selectedScene}
                      title="選択中のシーンを、この画像の静止画シーンにします"
                      onClick={() =>
                        selectedScene &&
                        transact('静止画を割り当て', (current) => ({
                          ...current,
                          scenes: current.scenes.map((scene) =>
                            scene.id === selectedScene.id
                              ? { ...scene, content: { kind: 'still', assetId: asset.id, color: '#0F1216', duration: scene.content.kind === 'still' ? scene.content.duration : secToTicks(5) } }
                              : scene,
                          ),
                        }))
                      }
                    >
                      静止画シーンに
                    </button>
                    <button
                      type="button"
                      className="sm ghost"
                      onClick={() => transact('画像の削除', (current) => ({ ...current, assets: current.assets.filter((item) => item.id !== asset.id) }))}
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ padding: 8 }}>
              <button type="button" className="sm" onClick={() => void importImages()}>
                ＋ 画像（説明カード・カットイン等）
              </button>
            </div>
          </div>
        )}
        {tab === 'avatars' && (
          <div style={{ padding: 8 }}>
            {project.avatarSets.length === 0 ? <p className="muted">外観セット（通常の猫・Phoenix風の猫など）と表情差分を登録します。</p> : null}
            {project.avatarSets.map((set) => (
              <div key={set.id} className="lv-item" style={{ cursor: 'default' }}>
                <div className="meta">
                  <div className="t1">{set.name}</div>
                  <div className="t2">
                    登録 {Object.keys(set.expressions).length} / {project.expressions.length} 表情
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="sm" onClick={() => setAvatars(true)}>
              アバターの登録・管理
            </button>
          </div>
        )}
        {tab === 'audio' && (
          <div>
            {audioTracks.length === 0 ? <p className="muted" style={{ padding: 10 }}>音源ライブラリに BGM・効果音がありません（ショート側の「音源」で登録した曲を共通で使えます）。</p> : null}
            {audioTracks.map((track) => (
              <div key={track.id} className="lv-item" style={{ cursor: 'default' }}>
                <div className="meta">
                  <div className="t1">{track.title}</div>
                  <div className="t2">
                    {track.kind === 'bgm' ? 'BGM' : '効果音'} · {Math.round(track.durationSec)}秒{track.licenseStatus !== 'confirmed' ? ' · ライセンス未確認' : ''}
                  </div>
                </div>
                {track.kind === 'bgm' ? (
                  <button
                    type="button"
                    className="sm"
                    title="動画全体（プロジェクト絶対）に流すBGMとして追加します。章ごとのBGMは章のインスペクターで指定します"
                    onClick={() =>
                      transact('BGMの追加', (current) =>
                        upsert(current, 'bgm', {
                          id: `bgm-${Date.now().toString(36)}`,
                          audioTrackId: track.id,
                          anchor: { kind: 'project', ticks: 0 },
                          duration: Math.max(secToTicks(10), current.chapters.length > 0 ? secToTicks(720) : secToTicks(60)),
                          offset: 0,
                          gainDb: -18,
                          fadeIn: secToTicks(1),
                          fadeOut: secToTicks(2),
                          loop: true,
                          volumePoints: [],
                        }),
                      )
                    }
                  >
                    全体BGM
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sm"
                    title="再生位置に効果音を置きます（全体時刻）"
                    onClick={() =>
                      transact('効果音の追加', (current) =>
                        upsert(current, 'se', {
                          id: `se-${Date.now().toString(36)}`,
                          audioTrackId: track.id,
                          anchor: { kind: 'project', ticks: Math.round((frame / current.output.fps) * 120_000) },
                          gainDb: -6,
                        }),
                      )
                    }
                  >
                    ここに置く
                  </button>
                )}
                <button type="button" className="sm ghost" onClick={() => void new Audio(`studio-media://root/${track.filePath.split('/').map(encodeURIComponent).join('/')}`).play()}>
                  ▶
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: '6px 8px', borderTop: '1px solid var(--line)' }} className="row wrap">
        <button type="button" className="sm" onClick={() => setTab('video')}>
          録画一覧
        </button>
        <button type="button" className="sm ghost" onClick={() => player.pause()}>
          ⏸
        </button>
      </div>
      {editing ? (
        <CandidateEditor
          asset={editing.asset ?? project.assets.find((item) => item.id === editing.candidate?.assetId)}
          candidate={editing.candidate}
          onClose={() => setEditing(null)}
          onSave={(candidate) => {
            transact('候補区間の保存', (current) => ({
              ...current,
              candidates: current.candidates.some((item) => item.id === candidate.id)
                ? current.candidates.map((item) => (item.id === candidate.id ? candidate : item))
                : [...current.candidates, candidate],
            }));
            setTab('candidates');
            setEditing(null);
          }}
          onDelete={
            editing.candidate
              ? () => {
                  transact('候補区間の削除', (current) => removeItem(current, 'candidates', editing.candidate!.id));
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : null}
      {streams ? <AudioStreamsDialog asset={streams} onClose={() => setStreams(null)} /> : null}
      {lineup ? <LineupEditor lineup={lineup === 'new' ? null : lineup} onClose={() => setLineup(null)} /> : null}
      {avatars ? <AvatarManager onClose={() => setAvatars(false)} /> : null}
      {dropActive ? (
        <div className="lv-dropzone">
          <b>ここにドロップして取り込み</b>
          <span>録画（{LONG_VIDEO_EXTENSIONS.join('・')}）と画像（{LONG_IMAGE_EXTENSIONS.join('・')}）。複数まとめて追加できます</span>
        </div>
      ) : null}
    </div>
  );
};
