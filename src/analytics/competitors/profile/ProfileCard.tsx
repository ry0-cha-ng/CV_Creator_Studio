import { useEffect, useState } from 'react';
import { VIDIQ_HOME } from '../../../../shared/competitor';
import type { ProfileTheme } from '../../../../shared/competitor-observation';
import type { ProfileEntry } from '../../../../shared/schema/competitor-observation';
import { mutate } from '../api';
import { useCompetitors } from '../state';
import { dateOnly } from '../ui';

/**
 * 観察プロフィールの1テーマ。ラベルは自分の判断で選び、メモは自分の言葉で書く。
 * vidIQ などの数値を書き写す欄は作らない。
 */
export const ProfileCard = ({
  subject,
  theme,
  label,
  hint,
  entry,
  options,
  vidiqUrl,
}: {
  subject: string;
  theme: ProfileTheme;
  label: string;
  hint: string;
  entry: ProfileEntry | undefined;
  options: string[];
  /** そのチャンネルの vidIQ ページ。無ければ vidIQ のトップを開く。 */
  vidiqUrl?: string | null;
}) => {
  const { say } = useCompetitors();
  const [labels, setLabels] = useState<string[]>(entry?.labels ?? []);
  const [note, setNote] = useState(entry?.note ?? '');
  const [sourceUrl, setSourceUrl] = useState(entry?.sourceUrl ?? '');
  const [extra, setExtra] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLabels(entry?.labels ?? []);
    setNote(entry?.note ?? '');
    setSourceUrl(entry?.sourceUrl ?? '');
  }, [entry?.updatedAt, subject]);

  const dirty =
    JSON.stringify(labels) !== JSON.stringify(entry?.labels ?? []) || note !== (entry?.note ?? '') || sourceUrl !== (entry?.sourceUrl ?? '');
  const choices = [...new Set([...options, ...labels])];

  const save = async (confirmed: boolean) => {
    setSaving(true);
    const result = await mutate(
      window.studio.saveCompetitorProfile({ subject, theme, labels, note, sourceUrl, confirmed }),
      ['matrix', 'options', 'overview'],
    );
    setSaving(false);
    if (!result.ok) say(result.message);
  };

  const open = async (url: string) => {
    const result = await window.studio.openCompetitorUrl(url);
    if (!result.ok) say('開けるのは YouTube と vidIQ のページだけです');
  };

  return (
    <div className="cp-profile-card">
      <div className="cp-row" style={{ alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span className="cp-spacer" />
        {entry?.confirmedAt ? (
          <span className={`cp-faint${entry.stale ? ' cp-stale' : ''}`}>
            確認 {dateOnly(entry.confirmedAt)}
            {entry.stale ? ' · 見直し時期' : ''}
          </span>
        ) : (
          <span className="cp-faint">未記入</span>
        )}
      </div>
      <div role="group" aria-label={`${label}のラベル`} className="cp-row" style={{ gap: 4 }}>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className="cp-chip-btn"
            style={{ height: 26, fontSize: 11 }}
            aria-pressed={labels.includes(choice)}
            onClick={() => setLabels((current) => (current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice]))}
          >
            {choice}
          </button>
        ))}
        <input
          className="cp-input"
          style={{ height: 26, width: 110, fontSize: 11, borderRadius: 13 }}
          value={extra}
          placeholder="+ ラベルを作る"
          aria-label={`${label}に新しいラベルを作る`}
          onChange={(event) => setExtra(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const value = extra.trim().slice(0, 30);
            if (value && !labels.includes(value)) setLabels((current) => [...current, value]);
            setExtra('');
          }}
        />
      </div>
      <textarea
        className="cp-textarea"
        rows={2}
        value={note}
        placeholder={hint}
        aria-label={`${label}についての自分の言葉`}
        onChange={(event) => setNote(event.target.value)}
        style={{ fontSize: 12 }}
      />
      <div className="cp-row" style={{ gap: 6 }}>
        <input
          className="cp-input"
          style={{ flex: 1, minWidth: 140, height: 30, fontSize: 12 }}
          value={sourceUrl}
          placeholder="確かめたページの URL（任意）"
          aria-label="確かめたページの URL"
          onChange={(event) => setSourceUrl(event.target.value)}
        />
        <button
          type="button"
          className="cp-link"
          title={sourceUrl.trim() ? undefined : vidiqUrl ? 'このチャンネルの vidIQ ページを開きます' : 'ハンドルが分からないため vidIQ のトップを開きます'}
          onClick={() => void open(sourceUrl.trim() || vidiqUrl || VIDIQ_HOME)}
        >
          {sourceUrl.trim() ? '開く ↗' : 'vidIQ ↗'}
        </button>
      </div>
      {(dirty || entry?.stale) && (
        <div className="cp-row" style={{ gap: 6 }}>
          {dirty && (
            <button type="button" className="cp-btn is-primary is-small" disabled={saving} onClick={() => void save(true)}>
              保存（確認日を今日に）
            </button>
          )}
          {dirty && entry && (
            <button type="button" className="cp-btn is-small" disabled={saving} onClick={() => void save(false)}>
              直しただけ
            </button>
          )}
          {!dirty && entry?.stale && (
            <button type="button" className="cp-btn is-small" disabled={saving} onClick={() => void save(true)}>
              いまも同じだった
            </button>
          )}
        </div>
      )}
    </div>
  );
};
