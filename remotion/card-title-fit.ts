import { MONT_LATIN, ZEN_LATIN } from './card-title-latin-widths';

export type CardTitleLatin = 'zen' | 'montserrat';

/** 完成カード（9:16）の見出し。これより小さくするとスマホ幅で読みにくくなる。 */
export const CARD_TITLE_MIN_PX = 36;
/** X用カード（4:5）の見出し。フィードで見たときの下限。 */
export const X_TITLE_MIN_PX = 32;

export const cardTitleBox = {
  stack: { width: 625, maxJa: 68, maxEn: 52, min: CARD_TITLE_MIN_PX, latin: 'zen' as const },
  stackX: { width: 750, maxJa: 42, maxEn: 36, min: X_TITLE_MIN_PX, latin: 'zen' as const },
  aim: { width: 625, maxJa: 68, maxEn: 74, min: CARD_TITLE_MIN_PX, latin: 'montserrat' as const },
  aimX: { width: 750, maxJa: 44, maxEn: 38, min: X_TITLE_MIN_PX, latin: 'montserrat' as const },
};

const LINE_SLACK_PX = 4;

/** 行頭に置けない（line-break: strict と日本語の約物）。 */
const NO_START = new Set(
  Array.from('、。，．・：；？！ヽヾゝゞ々ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ）」』】〕〉》］｝〗〙〛'),
);
/** 行末に置けない開き括弧。 */
const NO_END = new Set(Array.from('「『【〔〈《［｛〖〘〚（'));

const isLatinWordChar = (ch: string): boolean => /[A-Za-z0-9]/.test(ch);

const visibleTitle = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '');

const latinTable = (latin: CardTitleLatin): Record<string, number> =>
  latin === 'montserrat' ? MONT_LATIN : ZEN_LATIN;

/** 指定サイズで、見出しが何行になるか。改行はハードブレイク。 */
export const cardTitleVisualLines = (
  text: string,
  fontSize: number,
  maxWidth: number,
  latin: CardTitleLatin,
): number => {
  const table = latinTable(latin);
  const limit = Math.max(1, maxWidth - LINE_SLACK_PX);
  const paragraphs = visibleTitle(text).split('\n');
  if (paragraphs.length === 1 && paragraphs[0] === '') return 1;
  return paragraphs.reduce(
    (total, paragraph) => total + wrapParagraph(paragraph, fontSize, limit, table),
    0,
  );
};

const wrapParagraph = (
  paragraph: string,
  fontSize: number,
  limit: number,
  table: Record<string, number>,
): number => {
  if (paragraph.length === 0) return 1;
  const chars = Array.from(paragraph);
  const widths = chars.map((ch) => (table[ch] ?? 1) * fontSize);
  const canBreakBefore = chars.map((ch, index) => {
    if (index === 0) return false;
    if (NO_START.has(ch)) return false;
    const previous = chars[index - 1] ?? '';
    if (NO_END.has(previous)) return false;
    if (isLatinWordChar(previous) && isLatinWordChar(ch)) return false;
    return true;
  });

  let lines = 1;
  let start = 0;
  let used = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const width = widths[index] ?? 0;
    if (used > 0 && used + width > limit) {
      let breakAt = index;
      if (!canBreakBefore[index]) {
        for (let cursor = index; cursor > start; cursor -= 1) {
          if (canBreakBefore[cursor]) {
            breakAt = cursor;
            break;
          }
        }
      }
      if (breakAt <= start) breakAt = index;
      lines += 1;
      start = breakAt;
      used = 0;
      index = breakAt - 1;
      continue;
    }
    used += width;
  }
  return lines;
};

/**
 * 2行（呼び出し側の maxLines）に収まる最大のフォントサイズ。
 * 収まらなければ minSize を返し、表示側の行数制限で省略する。
 */
export const fitCardTitleFontSize = (
  text: string,
  options: {
    maxWidth: number;
    maxLines: number;
    maxSize: number;
    minSize: number;
    latin: CardTitleLatin;
  },
): number => {
  const maxSize = Math.round(options.maxSize);
  const minSize = Math.min(Math.round(options.minSize), maxSize);
  const sample = visibleTitle(text);
  if (!sample.trim()) return maxSize;
  const fits = (size: number): boolean =>
    cardTitleVisualLines(text, size, options.maxWidth, options.latin) <= options.maxLines;
  if (fits(maxSize)) return maxSize;
  let best = minSize;
  let low = minSize;
  let high = maxSize - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
};
