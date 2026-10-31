import { addCalendarDay, localDate, METRIC_DEFINITION_VERSION, type VideoFormat, type VideoOrientation } from './competitor';

/**
 * CVCS独自の計算。YouTube公式指標としては表示しない。
 * 呼び出し可否はサービス側の利用条件で止める。ここは式だけ。
 */

export type CountPoint = { at: string; value: string | null; definitionVersion: string };

const asBig = (value: string | null): bigint | null => {
  if (value === null || !/^\d+$/.test(value)) return null;
  return BigInt(value);
};

export const countDelta = (
  before: CountPoint,
  after: CountPoint,
): { value: string | null; negative: boolean; gapHours: number | null; comparable: boolean; reason?: string } => {
  const gapHours =
    Number.isFinite(Date.parse(before.at)) && Number.isFinite(Date.parse(after.at))
      ? Math.round(((Date.parse(after.at) - Date.parse(before.at)) / 3_600_000) * 10) / 10
      : null;
  if (before.definitionVersion !== after.definitionVersion) {
    return { value: null, negative: false, gapHours, comparable: false, reason: '指標の定義が違います' };
  }
  const left = asBig(before.value);
  const right = asBig(after.value);
  if (left === null || right === null) {
    return { value: null, negative: false, gapHours, comparable: true, reason: 'どちらかの観測がありません' };
  }
  const delta = right - left;
  return { value: delta.toString(), negative: delta < 0n, gapHours, comparable: true };
};

export type FrequencyResult = {
  perWeek: number | null;
  count: number;
  days: number;
  partial: boolean;
  label: string;
  unknownPublished: number;
};

export const postFrequency = (input: {
  publishedAt: Array<string | null>;
  startDate: string;
  endDateExclusive: string;
  timeZone: string;
  coverageComplete: boolean;
}): FrequencyResult => {
  let days = 0;
  for (let cursor = input.startDate; cursor < input.endDateExclusive && days < 4000; cursor = addCalendarDay(cursor)) {
    days += 1;
  }
  let count = 0;
  let unknownPublished = 0;
  for (const publishedAt of input.publishedAt) {
    if (!publishedAt) {
      unknownPublished += 1;
      continue;
    }
    const day = localDate(publishedAt, input.timeZone);
    if (day >= input.startDate && day < input.endDateExclusive) count += 1;
  }
  const partial = !input.coverageComplete;
  const perWeek = days > 0 ? (count / days) * 7 : null;
  return {
    perWeek,
    count,
    days,
    partial,
    label: partial ? '取得済み分' : '指定した期間',
    unknownPublished,
  };
};

const quantile = (sorted: number[], p: number): number | null => {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low] ?? null;
  const left = sorted[low] ?? 0;
  const right = sorted[high] ?? left;
  return left * (high - index) + right * (index - low);
};

export type DurationSummary = {
  format: VideoFormat;
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  missingDuration: number;
  reference: boolean;
};

export const durationByFormat = (
  rows: Array<{ format: VideoFormat; seconds: number | null }>,
): DurationSummary[] => {
  const formats: VideoFormat[] = ['shorts', 'standard', 'live', 'unknown'];
  return formats.map((format) => {
    const group = rows.filter((row) => row.format === format);
    const seconds = group.flatMap((row) => (row.seconds === null ? [] : [row.seconds])).sort((a, b) => a - b);
    return {
      format,
      n: group.length,
      median: quantile(seconds, 0.5),
      q1: quantile(seconds, 0.25),
      q3: quantile(seconds, 0.75),
      missingDuration: group.length - seconds.length,
      reference: group.length > 0 && group.length < 5,
    };
  });
};

export type FormatRatio = {
  counts: Record<VideoFormat, number>;
  orientation: Record<VideoOrientation, number>;
  shortsRatio: number | null;
  confirmedDenominator: number;
  confirmationRate: number | null;
  total: number;
};

export const formatRatio = (
  rows: Array<{ format: VideoFormat; orientation: VideoOrientation }>,
): FormatRatio => {
  const counts: Record<VideoFormat, number> = { shorts: 0, standard: 0, live: 0, unknown: 0 };
  const orientation: Record<VideoOrientation, number> = { vertical: 0, horizontal: 0, square: 0, unknown: 0 };
  for (const row of rows) {
    counts[row.format] += 1;
    orientation[row.orientation] += 1;
  }
  const confirmedDenominator = counts.shorts + counts.standard;
  const confirmed = counts.shorts + counts.standard + counts.live;
  return {
    counts,
    orientation,
    shortsRatio: confirmedDenominator > 0 ? counts.shorts / confirmedDenominator : null,
    confirmedDenominator,
    confirmationRate: rows.length > 0 ? confirmed / rows.length : null,
    total: rows.length,
  };
};

export type WindowState = 'selected' | 'immature' | 'unobserved' | 'expired' | 'missing';

export type WindowPick = {
  state: WindowState;
  observedAt: string | null;
  actualAgeHours: number | null;
  offsetHours: number | null;
  definitionVersion: string;
};

const TARGET_HOURS = 168;
const TOLERANCE_HOURS = 12;

export const selectObserved7d = (
  publishedAt: string,
  observations: Array<{ observedAt: string; expiresAt: string; definitionVersion: string }>,
  nowIso: string,
): WindowPick => {
  const published = Date.parse(publishedAt);
  const now = Date.parse(nowIso);
  const target = published + TARGET_HOURS * 3_600_000;
  const same = observations.filter((item) => item.definitionVersion === METRIC_DEFINITION_VERSION);
  if (now < target) {
    return {
      state: 'immature',
      observedAt: null,
      actualAgeHours: null,
      offsetHours: null,
      definitionVersion: METRIC_DEFINITION_VERSION,
    };
  }
  const inWindow = same
    .map((item) => {
      const at = Date.parse(item.observedAt);
      const offsetHours = (at - target) / 3_600_000;
      return { ...item, at, offsetHours };
    })
    .filter((item) => Math.abs(item.offsetHours) <= TOLERANCE_HOURS + 1e-9);
  const readable = inWindow.filter((item) => item.expiresAt > nowIso);
  if (readable.length > 0) {
    readable.sort((a, b) => Math.abs(a.offsetHours) - Math.abs(b.offsetHours) || a.at - b.at);
    const picked = readable[0];
    if (!picked) {
      return { state: 'missing', observedAt: null, actualAgeHours: null, offsetHours: null, definitionVersion: METRIC_DEFINITION_VERSION };
    }
    return {
      state: 'selected',
      observedAt: picked.observedAt,
      actualAgeHours: Math.round(((picked.at - published) / 3_600_000) * 10) / 10,
      offsetHours: Math.round(picked.offsetHours * 10) / 10,
      definitionVersion: picked.definitionVersion,
    };
  }
  if (inWindow.length > 0) {
    return { state: 'expired', observedAt: null, actualAgeHours: null, offsetHours: null, definitionVersion: METRIC_DEFINITION_VERSION };
  }
  if (now > target + TOLERANCE_HOURS * 3_600_000) {
    return { state: 'unobserved', observedAt: null, actualAgeHours: null, offsetHours: null, definitionVersion: METRIC_DEFINITION_VERSION };
  }
  return { state: 'missing', observedAt: null, actualAgeHours: null, offsetHours: null, definitionVersion: METRIC_DEFINITION_VERSION };
};

export type HighlightContext = {
  basisLabel: string;
  buzzDate: null;
  before: string[];
  after: string[];
  ratio: number | null;
  eligible: boolean;
  reference: boolean;
};

/** 現在累計からの選択は「高い動画」とだけ言い、バズ日や活動開始日は断定しない。 */
export const highlightContext = (input: {
  orderedIds: string[];
  selectedId: string;
  basis: 'current_total' | 'window';
  peerMedian: number | null;
  peerCount: number;
  selectedValue: number | null;
  threshold: number;
}): HighlightContext => {
  const index = input.orderedIds.indexOf(input.selectedId);
  const before = index >= 0 ? input.orderedIds.slice(Math.max(0, index - 10), index) : [];
  const after = index >= 0 ? input.orderedIds.slice(index + 1, index + 6) : [];
  const eligible = input.peerCount >= 10 && (input.peerMedian ?? 0) > 0 && input.basis === 'window';
  const ratio =
    eligible && input.peerMedian && input.selectedValue !== null && input.peerMedian > 0
      ? input.selectedValue / input.peerMedian
      : null;
  return {
    basisLabel: input.basis === 'current_total' ? '現在の累計が高い動画' : '同じ観測窓での比較',
    buzzDate: null,
    before,
    after,
    ratio: ratio !== null && ratio >= input.threshold ? ratio : ratio,
    eligible,
    reference: input.peerCount < 5,
  };
};
