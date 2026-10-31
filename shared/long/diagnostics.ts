/**
 * 横動画の診断。UIは entity を使って該当箇所へ移動する。
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'MAIN_MEDIA_MISSING'
  | 'ASSET_MISSING'
  | 'INVALID_RANGE'
  | 'INVALID_RECT'
  | 'BROKEN_REFERENCE'
  | 'ANCHOR_CYCLE'
  | 'SECONDARY_RANGE_GAP'
  | 'EVENT_OUT_OF_RANGE'
  | 'NEGATIVE_START'
  | 'SOURCE_REPLACED'
  | 'CAPTION_MISSING_TRANSLATION'
  | 'AUDIO_DUPLICATE_RISK'
  | 'AVATAR_EXPRESSION_MISSING'
  | 'AVATAR_OVERLAP'
  | 'TEXT_OVERFLOW'
  | 'ZERO_LENGTH'
  | 'CHAPTER_TOO_CLOSE'
  | 'CHAPTER_RULES'
  | 'DURATION_OUT_OF_GUIDE'
  | 'NO_CONTENT'
  | 'SYNC_UNLINKED'
  | 'AUDIO_TRACK_MISSING';

export type DiagnosticEntityKind =
  | 'project'
  | 'chapter'
  | 'scene'
  | 'placement'
  | 'caption'
  | 'overlay'
  | 'avatar'
  | 'audio'
  | 'asset'
  | 'marker'
  | 'sync';

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  entity: { kind: DiagnosticEntityKind; id: string };
  field?: string;
  message: string;
  suggestedAction?: string;
  /** 言語に依存する診断（字幕の未訳など） */
  language?: string;
};

export const diagnostic = (
  code: DiagnosticCode,
  severity: DiagnosticSeverity,
  entity: Diagnostic['entity'],
  message: string,
  extra: Partial<Pick<Diagnostic, 'field' | 'suggestedAction' | 'language'>> = {},
): Diagnostic => ({ code, severity, entity, message, ...extra });

export const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((item) => item.severity === 'error');

export const dedupeDiagnostics = (diagnostics: readonly Diagnostic[]): Diagnostic[] => {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const item of diagnostics) {
    const key = `${item.code}|${item.entity.kind}|${item.entity.id}|${item.field ?? ''}|${item.language ?? ''}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

export const sortDiagnostics = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
