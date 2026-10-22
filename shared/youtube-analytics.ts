import {
  ADDITIVE_METRICS,
  type DailyMetric,
  type DailyMetrics,
  type DateRange,
  type SyncErrorKind,
  type WindowKind,
} from './schema/youtube';

export const ANALYTICS_TIME_ZONE = 'America/Los_Angeles';

const pacificFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Analytics の日付（太平洋時間の暦日）を YYYY-MM-DD で返す。夏時間は Intl に任せる。 */
export const pacificDate = (instant: string | number | Date): string => {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error(`日時を読めません: ${String(instant)}`);
  const parts = Object.fromEntries(
    pacificFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const toUtcDay = (ymd: string): number => {
  const match = YMD.exec(ymd);
  if (!match) throw new Error(`日付の形式が不正です: ${ymd}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
};

const fromUtcDay = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** 暦日の加算。タイムゾーンを介さないので夏時間の影響を受けない。 */
export const addDays = (ymd: string, days: number): string => fromUtcDay(toUtcDay(ymd) + days);

export const daysBetween = (from: string, to: string): number => toUtcDay(to) - toUtcDay(from);

export const minDate = (a: string, b: string): string => (a <= b ? a : b);
export const maxDate = (a: string, b: string): string => (a >= b ? a : b);

export const rangeLength = (range: DateRange): number => daysBetween(range.start, range.end) + 1;

export const WINDOW_DAYS: Partial<Record<WindowKind, number>> = {
  'publish-calendar-7d': 7,
  'publish-calendar-28d': 28,
};

export const WINDOW_LABELS: Record<WindowKind, string> = {
  'publish-calendar-7d': '公開日を含む7日間',
  'publish-calendar-28d': '公開日を含む28日間',
  'calendar-range': '指定した期間',
  'available-range': '取得済みの全期間',
};

/** 公開日Dを含む D〜D+(n-1)。公開後168時間ではない。 */
export const publishWindow = (publishedAt: string, kind: 'publish-calendar-7d' | 'publish-calendar-28d'): DateRange => {
  const start = pacificDate(publishedAt);
  return { start, end: addDays(start, (WINDOW_DAYS[kind] ?? 7) - 1) };
};

/** horizon はAPIが行を返した最終日。そこまで届いていない期間は集計途中。 */
export const windowComplete = (window: DateRange, horizon: string | undefined): boolean =>
  Boolean(horizon) && window.end <= (horizon as string);

export const normalizeRanges = (ranges: DateRange[]): DateRange[] => {
  const sorted = ranges
    .filter((range) => range.start <= range.end)
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const merged: DateRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= addDays(last.end, 1)) {
      last.end = maxDate(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
};

export const subtractRanges = (target: DateRange, covered: DateRange[]): DateRange[] => {
  if (target.start > target.end) return [];
  const gaps: DateRange[] = [];
  let cursor = target.start;
  for (const range of normalizeRanges(covered)) {
    if (range.end < cursor) continue;
    if (range.start > target.end) break;
    if (range.start > cursor) gaps.push({ start: cursor, end: minDate(addDays(range.start, -1), target.end) });
    cursor = maxDate(cursor, addDays(range.end, 1));
    if (cursor > target.end) return gaps;
  }
  if (cursor <= target.end) gaps.push({ start: cursor, end: target.end });
  return gaps;
};

export const chunkRange = (range: DateRange, maxDays: number): DateRange[] => {
  const chunks: DateRange[] = [];
  let start = range.start;
  while (start <= range.end) {
    const end = minDate(addDays(start, maxDays - 1), range.end);
    chunks.push({ start, end });
    start = addDays(end, 1);
  }
  return chunks;
};

/**
 * 取得すべき範囲。未取得の区間に加え、確定日から refetchDays 日前以降は訂正に追従するため毎回取り直す。
 */
export const plannedDailyRanges = (input: {
  desired: DateRange;
  covered: DateRange[];
  horizon?: string;
  refetchDays: number;
  maxDaysPerRequest?: number;
}): DateRange[] => {
  const { desired, covered, horizon, refetchDays } = input;
  if (desired.start > desired.end) return [];
  const recentStart = horizon ? addDays(horizon, -(refetchDays - 1)) : desired.start;
  const keep = covered
    .map((range) => ({ start: range.start, end: minDate(range.end, addDays(recentStart, -1)) }))
    .filter((range) => range.start <= range.end);
  const gaps = subtractRanges(desired, keep);
  return gaps.flatMap((gap) => chunkRange(gap, input.maxDaysPerRequest ?? 90));
};

export const syncStartFor = (
  publishedAt: string,
  today: string,
  settings: { initialDays: number; fromPublish: boolean },
): string => {
  const publish = pacificDate(publishedAt);
  if (settings.fromPublish) return publish;
  return maxDate(publish, addDays(today, -(settings.initialDays - 1)));
};

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export const parseIsoDuration = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = ISO_DURATION.exec(value);
  if (!match) return undefined;
  const [, d = '0', h = '0', m = '0', s = '0'] = match;
  return Number(d) * 86_400 + Number(h) * 3_600 + Number(m) * 60 + Number(s);
};

export type ResultTable = {
  columnHeaders?: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows?: Array<Array<string | number>>;
};

/** rows が無い応答は空配列。0件と「行なし」は呼び出し側で区別する。 */
export const tableRows = (table: ResultTable): Array<Record<string, string | number>> => {
  const headers = (table.columnHeaders ?? []).map((header) => header.name);
  return (table.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((name, index) => [name, row[index] as string | number])),
  );
};

export const dailyMetricsFromRow = (row: Record<string, string | number>): DailyMetrics => {
  const metrics: DailyMetrics = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'day') continue;
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) metrics[key as DailyMetric] = number;
  }
  return metrics;
};

/** 加算できる指標だけ合計する。平均視聴時間・平均視聴率は期間指定のAPI値を使う。 */
export const sumAdditive = (rows: DailyMetrics[]): Partial<Record<DailyMetric, number>> => {
  const total: Partial<Record<DailyMetric, number>> = {};
  for (const row of rows) {
    for (const key of ADDITIVE_METRICS) {
      const value = row[key];
      if (typeof value !== 'number') continue;
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
};

export type ClassifiedError = { kind: SyncErrorKind; retryable: boolean; message: string };

const reasonOf = (body: unknown): { reason?: string; message?: string; status?: string } => {
  if (!body || typeof body !== 'object') return {};
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') {
    return { reason: error, message: (body as { error_description?: string }).error_description };
  }
  if (!error || typeof error !== 'object') return {};
  const record = error as { message?: string; status?: string; errors?: Array<{ reason?: string }> };
  return { reason: record.errors?.[0]?.reason, message: record.message, status: record.status };
};

export const classifyHttpError = (status: number, body: unknown): ClassifiedError => {
  const { reason, message, status: apiStatus } = reasonOf(body);
  const text = message || reason || `HTTP ${status}`;
  if (status === 401 || reason === 'invalid_grant' || reason === 'authError') {
    return { kind: 'auth', retryable: false, message: text };
  }
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return { kind: 'rate-limit', retryable: true, message: text };
  }
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || apiStatus === 'RESOURCE_EXHAUSTED') {
    return { kind: 'quota', retryable: false, message: text };
  }
  if (status === 403) return { kind: 'permission', retryable: false, message: text };
  if (status === 404) return { kind: 'not-found', retryable: false, message: text };
  if (status === 400) return { kind: 'unsupported-query', retryable: false, message: text };
  if (status >= 500) return { kind: 'server', retryable: true, message: text };
  return { kind: 'unknown', retryable: false, message: text };
};

/** 実行全体を止めるべきエラー。ほかは対象ごとに記録して続ける。 */
export const isFatalForRun = (kind: SyncErrorKind): boolean =>
  kind === 'auth' || kind === 'quota' || kind === 'cancelled';

export const SYNC_ERROR_LABELS: Record<SyncErrorKind, string> = {
  auth: '認証が切れています',
  permission: '権限がありません',
  quota: 'APIの利用上限に達しました',
  'rate-limit': '短時間のリクエストが多すぎます',
  network: '通信に失敗しました',
  server: 'YouTube側のエラー',
  'unsupported-query': 'この組み合わせは取得できません',
  'not-found': '見つかりません',
  cancelled: '中止しました',
  unknown: '不明なエラー',
};
