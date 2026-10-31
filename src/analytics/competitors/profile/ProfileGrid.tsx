import { DEFAULT_PROFILE_OPTIONS, PROFILE_THEMES } from '../../../../shared/competitor-observation';
import { keyOf, useResource } from '../api';
import { ProfileCard } from './ProfileCard';

/** 1つの subject（競合チャンネルか自分）の観察プロフィール6テーマ。 */
export const ProfileGrid = ({ subject, vidiqUrl }: { subject: string; vidiqUrl?: string | null }) => {
  const matrix = useResource(keyOf('matrix', [subject]), () => window.studio.competitorProfileMatrix([subject]));
  const options = useResource(keyOf('options'), () => window.studio.competitorProfileOptions());
  if (matrix.error) return <p className="cp-message">{matrix.error}</p>;
  return (
    <div className="cp-grid-auto">
      {PROFILE_THEMES.map((theme) => (
        <ProfileCard
          key={theme.key}
          subject={subject}
          theme={theme.key}
          label={theme.label}
          hint={theme.hint}
          entry={matrix.data?.entries.find((entry) => entry.subject === subject && entry.theme === theme.key)}
          options={options.data?.[theme.key] ?? DEFAULT_PROFILE_OPTIONS[theme.key]}
          vidiqUrl={vidiqUrl}
        />
      ))}
    </div>
  );
};
