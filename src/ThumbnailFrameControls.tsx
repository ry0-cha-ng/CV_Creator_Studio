import { useState } from 'react';
import { thumbnailFrameStatus, thumbnailSourceAt } from '../shared/thumbnail';
import type { Project } from '../shared/schema/project';
import { useStudioStore } from './store';

export const ThumbnailFrameControls = ({
  project,
  frameAt,
  onApplied,
}: {
  project: Project;
  frameAt: () => number;
  onApplied?: (frame: number) => void;
}) => {
  const [message, setMessage] = useState<string | null>(null);
  const apply = (): void => {
    const frame = frameAt();
    const pick = thumbnailSourceAt(project, frame / project.templateParams.fps);
    if (!pick) {
      setMessage('この位置には元の映像がありません。動画の場面まで移動してください');
      return;
    }
    setMessage(null);
    onApplied?.(frame);
    useStudioStore.getState().updateProject((current) => {
      current.thumbnailFrame = { assetId: pick.assetId, sourceTime: pick.sourceTime };
      return current;
    });
  };
  const reset = (): void => {
    const frame = frameAt();
    setMessage(null);
    onApplied?.(frame);
    useStudioStore.getState().updateProject((current) => {
      current.thumbnailFrame = undefined;
      return current;
    });
  };

  return (
    <div className="thumb-frame-controls">
      <p>{thumbnailFrameStatus(project)}</p>
      {message ? <p className="gd-review-thumb-note">{message}</p> : null}
      <div>
        <button type="button" onClick={apply}>
          再生位置をサムネイルにする
        </button>
        {project.thumbnailFrame ? (
          <button type="button" onClick={reset}>
            フックの先頭に戻す
          </button>
        ) : null}
      </div>
    </div>
  );
};
