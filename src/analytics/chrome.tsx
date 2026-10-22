import { useEffect, useState } from 'react';
import type { PublishingSettings } from '../../shared/publishing';
import { DEFAULT_PUBLISHING_SETTINGS } from '../../shared/publishing';
import cvLogoUrl from '../../resources/brand/cv-logo.png';
import { AI_HELP, AI_PROVIDER_LABELS, type AiPlanUsage, type AiProviderChoice, type AiStatus } from '../../shared/ai';
import { ANALYTICS_SCREENS, type AnalyticsScreenId } from '../../shared/analytics-screens';
import { AiHelp } from '../ai/AiAssist';
import { YoutubeSettings } from './YoutubeSettings';

export const AppNav = ({
  area,
  readyCount,
  onCreate,
  onReview,
  onDetail,
  onHome,
}: {
  area: 'create' | 'review' | 'detail';
  readyCount: number;
  onCreate: () => void;
  onReview: () => void;
  onDetail: () => void;
  onHome: () => void;
}) => {
  const [gear, setGear] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [usage, setUsage] = useState<AiPlanUsage | null | undefined>(undefined);
  const [publishing, setPublishing] = useState<PublishingSettings>(DEFAULT_PUBLISHING_SETTINGS);
  useEffect(() => {
    const load = () => {
      void window.studio.getAiStatus().then(setStatus).catch(() => setStatus(null));
      void window.studio.getAiUsage().then(setUsage).catch(() => setUsage(null));
      void window.studio.getPublishingSettings().then(setPublishing).catch(() => setPublishing(DEFAULT_PUBLISHING_SETTINGS));
    };
    load();
    window.addEventListener('cv-ai-status', load);
    return () => window.removeEventListener('cv-ai-status', load);
  }, []);
  const choose = (provider: AiProviderChoice) => {
    void window.studio.setAiProvider(provider).then((next) => {
      setStatus(next);
      if (next.phase === 'ready') {
        setUsage(undefined);
        void window.studio.getAiUsage().then(setUsage).catch(() => setUsage(null));
      } else {
        setUsage(null);
      }
    });
  };
  return (
    <header className="an-nav">
      <button className="an-brand" type="button" onClick={onHome}>
        <img src={cvLogoUrl} alt="" />
        <strong>Creator Studio</strong>
      </button>
      <span className="an-nav-rule" aria-hidden="true" />
      <nav className="an-nav-links" aria-label="作業の切り替え">
        <button type="button" aria-pressed={area === 'create'} onClick={onCreate}>
          作る
        </button>
        <button type="button" aria-pressed={area === 'review'} onClick={onReview}>
          振り返る
          {readyCount > 0 && <span className="an-badge">{readyCount}</span>}
        </button>
        <button type="button" aria-pressed={area === 'detail'} onClick={onDetail}>
          詳細分析
        </button>
      </nav>
      <span className="an-spacer" />
      <span className="an-ai">
        <i className={`an-dot ${status?.phase === 'ready' ? 'is-on' : ''}`} />
        {status?.label ?? 'AI：確認中'}
      </span>
      {status?.phase === 'ready' && usage === undefined && <span className="an-usage">残りを確認中</span>}
      {status?.phase === 'ready' && usage && (
        <span className={`an-usage ${usage.low ? 'is-low' : ''}`} title={usageTitle(usage)}>
          {usage.headline}
        </span>
      )}
      <button className="an-gear" type="button" aria-label="設定" aria-expanded={gear} onClick={() => setGear((value) => !value)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
      {gear && (
        <div className="an-gear-pop" role="dialog" aria-label="設定">
          <strong>AI</strong>
          <p>{status?.detail ?? AI_HELP.settings.summary}</p>
          <label className="ai-field">
            経路
            <select
              className="ai-select"
              value={status?.provider ?? 'auto'}
              onChange={(event) => choose(event.target.value as AiProviderChoice)}
            >
              {(Object.keys(AI_PROVIDER_LABELS) as AiProviderChoice[]).map((provider) => (
                <option key={provider} value={provider}>
                  {AI_PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
          </label>
          {status?.phase === 'ready' && usage && (
            <div>
              {usage.windows.map((window) => (
                <p key={window.label}>
                  {window.label}の残り {window.remainingPercent}%{resetLabel(window.resetsAt)}
                </p>
              ))}
              <p className="an-muted">サブスクリプションの利用枠です。トークン残数ではなく、5時間と7日の枠の残りです。</p>
            </div>
          )}
          <p className="an-muted">従量課金のAPIへは切り替えません。APIキーの欄はありません。</p>
          <strong>投稿アカウント</strong>
          <p className="an-muted">URLのユーザー名がここを指していなければ、投稿時に確認を出します。空なら確認しません。</p>
          {(['youtube', 'tiktok', 'x'] as const).map((platform) => (
            <label key={platform} className="ai-field">
              {platform === 'youtube' ? 'YouTube のハンドル' : platform === 'tiktok' ? 'TikTok のユーザー名' : 'X のユーザー名'}
              <input
                value={publishing.accounts[platform]}
                onChange={(event) =>
                  setPublishing((current) => ({
                    ...current,
                    accounts: { ...current.accounts, [platform]: event.target.value },
                  }))
                }
                onBlur={(event) => {
                  const next = {
                    ...publishing,
                    accounts: { ...publishing.accounts, [platform]: event.target.value },
                  };
                  setPublishing(next);
                  void window.studio.setPublishingSettings(next);
                }}
              />
            </label>
          ))}
          <label className="ai-field">
            <input
              type="checkbox"
              checked={publishing.enable24hCheck}
              onChange={(event) => {
                const next = { ...publishing, enable24hCheck: event.target.checked };
                setPublishing(next);
                void window.studio.setPublishingSettings(next);
              }}
            />
            投稿の24時間後にも確認タスクを作る
          </label>
          <YoutubeSettings />
          <AiHelp id="settings" />
        </div>
      )}
    </header>
  );
};

const resetLabel = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const text = date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `（${text} に戻る）`;
};

const usageTitle = (usage: AiPlanUsage): string =>
  usage.windows.map((window) => `${window.label}の残り ${window.remainingPercent}%${resetLabel(window.resetsAt)}`).join('\n');

const STAGES = ['実験', '振り返り', '決定', 'Insight'] as const;

export const AboutButton = ({ screen }: { screen: AnalyticsScreenId }) => {
  const [open, setOpen] = useState(false);
  const copy = ANALYTICS_SCREENS[screen];
  return (
    <div className="an-about">
      <button
        type="button"
        className="an-about-btn"
        aria-expanded={open}
        aria-controls="about-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        この画面について
      </button>
      {open && (
        <section id="about-panel" className="an-about-pop" role="dialog" aria-label="この画面について">
          <div className="an-about-head">
            <div>
              <span className="an-about-kicker">この画面について</span>
              <strong>{copy.name}</strong>
            </div>
            <button type="button" className="an-about-close" aria-label="閉じる" onClick={() => setOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="an-flow" aria-label="流れの中の位置">
            {STAGES.map((stage, index) => (
              <span key={stage} className="an-flow-item">
                {index > 0 && <span className="an-flow-arrow" aria-hidden="true">→</span>}
                <span className={stage === copy.stage ? 'is-on' : ''}>{stage}</span>
              </span>
            ))}
          </div>
          <div className="an-about-grid">
            <span>役割</span>
            <span>{copy.role}</span>
            <span>目的</span>
            <span>{copy.purpose}</span>
            <span>ここで<br />すること</span>
            <span>{copy.does}</span>
            <span>ここで<br />しないこと</span>
            <span className="is-quiet">{copy.doesNot}</span>
          </div>
        </section>
      )}
    </div>
  );
};
