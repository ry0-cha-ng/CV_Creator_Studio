/**
 * 横動画の時間表現。
 *
 * 編集データの時刻はすべて整数 tick（1 tick = 1/120000 秒）で持つ。
 * 24・25・30・60fps と NTSC系（23.976 = 5005 tick、29.97 = 4004 tick、59.94 = 2002 tick）、
 * ミリ秒（120 tick）を整数で表せる。出力フレームへの丸めは描画計画で一度だけ行う。
 * 区間は常に [start, end)。
 */

export const TICKS_PER_SECOND = 120_000;

export type Ticks = number;

export type Interval = { start: Ticks; end: Ticks };

export const isTicks = (value: number): boolean => Number.isSafeInteger(value);

export const secToTicks = (seconds: number): Ticks => {
  if (!Number.isFinite(seconds)) throw new Error('時刻が数値ではありません');
  return Math.round(seconds * TICKS_PER_SECOND);
};

export const ticksToSec = (ticks: Ticks): number => ticks / TICKS_PER_SECOND;

/**
 * 全体時刻 → 出力フレーム。四捨五入（0.5 は切り上げ）を整数演算で行い、
 * 隣接する区間の終端と始端が必ず同じフレームになるようにする。
 */
export const ticksToFrame = (ticks: Ticks, fps: number): number => {
  const numerator = ticks * fps * 2 + TICKS_PER_SECOND;
  return Math.floor(numerator / (2 * TICKS_PER_SECOND));
};

export const frameToTicks = (frame: number, fps: number): Ticks =>
  Math.round((frame * TICKS_PER_SECOND) / fps);

export const intervalLength = (interval: Interval): Ticks => interval.end - interval.start;

export const intervalContains = (interval: Interval, ticks: Ticks): boolean =>
  ticks >= interval.start && ticks < interval.end;

export const intervalsOverlap = (a: Interval, b: Interval): boolean =>
  a.start < b.end && b.start < a.end;

export const clampTicks = (value: Ticks, min: Ticks, max: Ticks): Ticks =>
  Math.min(max, Math.max(min, value));

/** 例：01:23.450 / 1:02:03.004 */
export const formatTicks = (ticks: Ticks, withMillis = true): string => {
  const negative = ticks < 0;
  const totalMs = Math.round(Math.abs(ticks) / (TICKS_PER_SECOND / 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  const body = hour > 0 ? `${hour}:${pad(min)}:${pad(sec)}` : `${pad(min)}:${pad(sec)}`;
  return `${negative ? '−' : ''}${body}${withMillis ? `.${pad(ms, 3)}` : ''}`;
};

/** チャプター用。秒単位で切り捨て。例：0:00 / 12:05 / 1:02:03 */
export const formatChapterTime = (ticks: Ticks): string => {
  const totalSec = Math.floor(Math.max(0, ticks) / TICKS_PER_SECOND);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hour > 0 ? `${hour}:${pad(min)}:${pad(sec)}` : `${min}:${pad(sec)}`;
};

/** SRT 用。例：00:01:02,345 */
export const formatSrtTime = (ticks: Ticks): string => {
  const totalMs = Math.round(Math.max(0, ticks) / (TICKS_PER_SECOND / 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return `${pad(hour)}:${pad(min)}:${pad(sec)},${pad(ms, 3)}`;
};

/** SRT の時刻を tick に戻す。"00:01:02,345" または "00:01:02.345" */
export const parseSrtTime = (value: string): Ticks | null => {
  const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*$/.exec(value);
  if (!match) return null;
  const [, h = '0', m = '0', s = '0', ms = '0'] = match;
  const millis =
    Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms.padEnd(3, '0'));
  return millis * (TICKS_PER_SECOND / 1000);
};

/** 文字列（秒または mm:ss.mmm）を tick にする。入力欄用。 */
export const parseTimecode = (value: string): Ticks | null => {
  const trimmed = value.trim().replace('−', '-');
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const parts = body.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  if (!Number.isFinite(seconds)) return null;
  const ticks = secToTicks(seconds);
  return negative ? -ticks : ticks;
};

// ---------------------------------------------------------------------------
// 配置の時間変換（速度・フリーズ）

export type Freeze = {
  id: string;
  /** フリーズする素材時刻 */
  at: Ticks;
  /** 出力上で止める長さ */
  duration: Ticks;
};

export type TimeMapInput = {
  sourceIn: Ticks;
  sourceOut: Ticks;
  speed: number;
  freezes: readonly Freeze[];
};

export type TimeSegment =
  | {
      kind: 'play';
      /** 配置内の出力時刻 [start, end) */
      start: Ticks;
      end: Ticks;
      sourceStart: Ticks;
      sourceEnd: Ticks;
      speed: number;
    }
  | {
      kind: 'freeze';
      start: Ticks;
      end: Ticks;
      /** 静止する素材時刻 */
      sourceAt: Ticks;
      freezeId: string;
    };

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export const validSpeed = (speed: number): boolean =>
  Number.isFinite(speed) && speed >= SPEED_MIN && speed <= SPEED_MAX;

/**
 * 素材区間 [sourceIn, sourceOut) を speed で再生し、範囲内のフリーズを挟んだ区分関数。
 * 出力尺は play 区間の長さを tick の整数へ丸めて合計する（丸めは区間ごとに1回、境界は共有）。
 */
export const buildTimeSegments = (input: TimeMapInput): TimeSegment[] => {
  const { sourceIn, sourceOut } = input;
  if (!(sourceOut > sourceIn)) return [];
  const speed = validSpeed(input.speed) ? input.speed : 1;
  const freezes = input.freezes
    .filter((freeze) => freeze.duration > 0 && freeze.at >= sourceIn && freeze.at <= sourceOut)
    .slice()
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const segments: TimeSegment[] = [];
  let cursorSource = sourceIn;
  let cursorOut = 0;
  // 出力位置は素材の進み量から毎回求め直す（区間ごとの丸め誤差を累積させない）。
  let frozenSoFar = 0;
  const outputAt = (sourceTicks: Ticks): Ticks =>
    Math.round((sourceTicks - sourceIn) / speed) + frozenSoFar;
  for (const freeze of freezes) {
    if (freeze.at > cursorSource) {
      const end = outputAt(freeze.at);
      if (end > cursorOut) {
        segments.push({
          kind: 'play',
          start: cursorOut,
          end,
          sourceStart: cursorSource,
          sourceEnd: freeze.at,
          speed,
        });
        cursorOut = end;
      }
      cursorSource = freeze.at;
    }
    segments.push({
      kind: 'freeze',
      start: cursorOut,
      end: cursorOut + freeze.duration,
      sourceAt: freeze.at,
      freezeId: freeze.id,
    });
    cursorOut += freeze.duration;
    frozenSoFar += freeze.duration;
  }
  if (sourceOut > cursorSource) {
    const end = outputAt(sourceOut);
    if (end > cursorOut) {
      segments.push({
        kind: 'play',
        start: cursorOut,
        end,
        sourceStart: cursorSource,
        sourceEnd: sourceOut,
        speed,
      });
    }
  }
  return segments;
};

export const segmentsDuration = (segments: readonly TimeSegment[]): Ticks =>
  segments.length === 0 ? 0 : segments[segments.length - 1]!.end;

/** 配置内の出力時刻 → 素材時刻。区間外は null。 */
export const sourceTimeAt = (segments: readonly TimeSegment[], local: Ticks): Ticks | null => {
  for (const segment of segments) {
    if (local < segment.start || local >= segment.end) continue;
    if (segment.kind === 'freeze') return segment.sourceAt;
    const offset = local - segment.start;
    return Math.min(
      segment.sourceEnd,
      segment.sourceStart + Math.round(offset * segment.speed),
    );
  }
  return null;
};

/**
 * 素材時刻 → 配置内の出力時刻（最初に到達した時刻）。
 * フリーズ中に同じ素材時刻が続いても、単発イベントはこの1点でだけ発火する。
 */
export const localTimeOfSource = (
  segments: readonly TimeSegment[],
  source: Ticks,
): Ticks | null => {
  for (const segment of segments) {
    if (segment.kind === 'freeze') {
      if (segment.sourceAt === source) return segment.start;
      continue;
    }
    if (source >= segment.sourceStart && source < segment.sourceEnd) {
      return segment.start + Math.round((source - segment.sourceStart) / segment.speed);
    }
  }
  const last = segments[segments.length - 1];
  if (last && last.kind === 'play' && source === last.sourceEnd) return last.end;
  return null;
};

/** 配置内の出力時刻が、フリーズ区間のどれかに入っているか */
export const isFrozenAt = (segments: readonly TimeSegment[], local: Ticks): boolean =>
  segments.some((segment) => segment.kind === 'freeze' && local >= segment.start && local < segment.end);
