import type { SyncErrorKind } from '../../../shared/schema/youtube';

/** 同期・認証の失敗。message にトークン等を含めない。 */
export class YoutubeError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'YoutubeError';
  }
}

export const asYoutubeError = (error: unknown): YoutubeError => {
  if (error instanceof YoutubeError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new YoutubeError('cancelled', '中止しました');
  if (error instanceof TypeError) return new YoutubeError('network', `通信に失敗しました: ${error.message}`, true);
  return new YoutubeError('unknown', error instanceof Error ? error.message : String(error));
};
