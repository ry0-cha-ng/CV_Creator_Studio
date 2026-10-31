import type { ReactNode } from 'react';
import type { CompetitorVideo } from '../../../shared/schema/competitor';

/** 公開値は文字列のまま来る。表示だけ「万・億」に丸める。 */
export const countShort = (value: string | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  if (!/^\d+$/.test(value)) return value;
  const n = Number(value);
  if (n >= 100_000_000) return `${trim(n / 100_000_000)}億`;
  if (n >= 10_000) return `${trim(n / 10_000)}万`;
  return n.toLocaleString('ja-JP');
};

const trim = (value: number): string => (value >= 100 ? Math.round(value).toLocaleString('ja-JP') : value.toFixed(1).replace(/\.0$/, ''));

export const ago = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return '';
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}日前`;
  return `${Math.floor(days / 30)}か月前`;
};

export const dateTime = (iso: string | null | undefined, timeZone = 'Asia/Tokyo'): string => {
  if (!iso) return 'まだありません';
  return new Intl.DateTimeFormat('ja-JP', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
};

export const dateOnly = (iso: string | null | undefined, timeZone = 'Asia/Tokyo'): string => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ja-JP', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
};

export const clock = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/** "1:23" や "1:02:03" を秒にする。読めなければ null。 */
export const parseClock = (text: string): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  return trimmed.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

export const isShorts = (video: CompetitorVideo): boolean => video.format === 'shorts';

export const FORMAT_LABEL: Record<string, string> = {
  shorts: 'Shorts',
  standard: '通常',
  live: 'ライブ',
  unknown: '不明',
};

export const requestId = (): string => crypto.randomUUID();

type IconName =
  | 'plus'
  | 'refresh'
  | 'search'
  | 'grid'
  | 'list'
  | 'external'
  | 'more'
  | 'close'
  | 'left'
  | 'right'
  | 'clock'
  | 'lock'
  | 'star'
  | 'spark'
  | 'compare';

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  list: <path d="M3 6h18M3 12h18M3 18h18" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </>
  ),
  compare: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
};

export const Icon = ({ name, size = 16 }: { name: IconName; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {PATHS[name]}
  </svg>
);

export const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
  sunk,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  sunk?: boolean;
}) => (
  <div role="group" aria-label={label} className={`cp-seg${sunk ? ' is-sunk' : ''}`}>
    {options.map((option) => (
      <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
        {option.label}
        {option.count !== undefined && <span className="cp-count">{option.count}</span>}
      </button>
    ))}
  </div>
);

export const Thumb = ({
  video,
  rank,
  mark,
  width,
}: {
  video: CompetitorVideo;
  rank?: number;
  mark?: string;
  width?: number;
}) => (
  <div className="cp-thumb" style={width ? { width } : undefined}>
    {video.thumbnailUrl ? (
      <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    ) : (
      <span className="cp-thumb-empty">{video.availability === 'not_in_session' ? '未取得' : '画像なし'}</span>
    )}
    {isShorts(video) && <span className="cp-thumb-badge is-shorts">SHORTS</span>}
    {mark && <span className="cp-thumb-badge is-mark">{mark}</span>}
    {rank !== undefined && <span className="cp-thumb-badge is-rank">{rank}</span>}
    {video.durationSec !== null && <span className="cp-thumb-badge is-duration">{clock(video.durationSec)}</span>}
  </div>
);

export const videoTitle = (video: CompetitorVideo): string =>
  video.title ?? (video.availability === 'unavailable' ? '取得できない動画（削除とは断定しない）' : video.userUrl);

export const Stat = ({ label, value, note, large }: { label: string; value: ReactNode; note?: ReactNode; large?: boolean }) => (
  <div>
    <span className="cp-stat-label">{label}</span>
    <span className={`cp-stat-value${large ? ' is-large' : ''}`}>{value}</span>
    {note && <span className="cp-faint">{note}</span>}
  </div>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="cp-empty">
    <strong>{title}</strong>
    {children}
  </div>
);
