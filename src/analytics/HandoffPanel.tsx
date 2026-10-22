import { applySafeValue } from '../../shared/analytics';
import type { AnalyticsExperiment, Decision, Insight, PrimaryVariable } from '../../shared/schema/analytics';
import type { Project } from '../../shared/schema/project';
import { useStudioStore } from '../store';
import { useAnalyticsOptional } from './context';

const chipFor = (insight: Insight): string => insight.conclusion || insight.title;

export const HandoffPanel = ({ project }: { project: Project }) => {
  const analytics = useAnalyticsOptional();
  const updateProject = useStudioStore((state) => state.updateProject);
  if (!analytics?.bundle) return null;
  const { bundle, reload, openDetail } = analytics;
  const applied = bundle.insights.filter((item) => project.appliedInsightIds.includes(item.id));
  const decision = bundle.decisions
    .filter(
      (item) =>
        item.applyToNextProjects &&
        (item.remainingApplyCount ?? 0) > 0 &&
        !project.skippedCandidateIds.includes(item.id) &&
        item.id !== project.appliedDecisionId,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const testing = bundle.insights.find(
    (item) =>
      item.status === 'testing' &&
      item.suggestNext &&
      !project.skippedCandidateIds.includes(item.id) &&
      !project.appliedInsightIds.includes(item.id),
  );
  const experiments = bundle.experiments.filter((item) => item.status === 'running' || item.status === 'planned');
  const selected = project.experimentRef
    ? bundle.experiments.find((item) => item.id === project.experimentRef?.experimentId)
    : undefined;
  const warnings = bundle.insights.filter(
    (item) => item.status === 'rejected' && item.warnOnUse && item.value && matches(project, item.variable, item.value),
  );

  const applyDecision = (item: Decision) => {
    updateProject((current) => {
      const next = applySafeValue(current, item.variable, item.value);
      next.appliedDecisionId = item.id;
      if (item.experimentId && item.arm) {
        next.experimentRef = { experimentId: item.experimentId, arm: item.arm };
      }
      return next;
    });
    void window.studio.consumeAnalyticsDecision(item.id).then(() => reload());
  };

  return (
    <div className="an-handoff">
      <section className="an-panel" aria-label="いまの制作方針">
        <strong>いまの制作方針を初期値に入れました</strong>
        <span className="an-muted">Insights の「採用」から</span>
        <button type="button" className="an-ghost" onClick={() => openDetail('insights')}>Insights を開く</button>
        <div className="an-chips">
          {applied.length === 0 && <span className="an-muted">採用の方針はまだありません</span>}
          {applied.map((item) => (
            <span key={item.id} className="an-chip">✓ {chipFor(item)}</span>
          ))}
        </div>
      </section>
      {(decision || testing) && (
        <section className="an-panel" aria-label="次に試す候補">
          <strong>次に試す候補 · 前回の振り返りから</strong>
          <p>{decision?.summary || testing?.conclusion || testing?.title}</p>
          {decision?.experimentId && <span className="an-muted">この実験の Variant になります</span>}
          <div className="an-row">
            <button
              type="button"
              className="an-ghost"
              onClick={() =>
                updateProject((current) => {
                  const id = decision?.id || testing?.id;
                  if (id && !current.skippedCandidateIds.includes(id)) current.skippedCandidateIds.push(id);
                  return current;
                })
              }
            >
              今回は外す
            </button>
            <button
              type="button"
              className="an-primary"
              onClick={() => {
                if (decision) applyDecision(decision);
                else if (testing) {
                  updateProject((current) => {
                    const next = applySafeValue(current, testing.variable, testing.value);
                    if (!next.appliedInsightIds.includes(testing.id)) next.appliedInsightIds.push(testing.id);
                    return next;
                  });
                }
              }}
            >
              この条件で作る
            </button>
          </div>
          <p className="an-muted">ほかの条件は前回と同じです。シーン順とテロップ本文は自動では変えません。</p>
        </section>
      )}
      <section className="an-panel" aria-label="この動画の実験">
        <strong>この動画の実験</strong>
        <label>
          実験
          <select
            className="an-select is-inline"
            aria-label="この動画の実験"
            value={project.experimentRef?.experimentId ?? ''}
            onChange={(event) =>
              updateProject((current) => {
                const experimentId = event.target.value;
                current.experimentRef = experimentId
                  ? { experimentId, arm: current.experimentRef?.arm ?? 'variant' }
                  : undefined;
                return current;
              })
            }
          >
            <option value="">実験なし</option>
            {experiments.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        {selected && (
          <div className="an-row" role="radiogroup" aria-label="Control または Variant">
            <ArmButton project={project} experiment={selected} arm="control" />
            <ArmButton project={project} experiment={selected} arm="variant" />
          </div>
        )}
        <button type="button" className="an-ghost" onClick={() => openDetail('experiments')}>実験を管理</button>
        {warnings.map((item) => (
          <p key={item.id} className="an-warn">非採用の条件です：{item.title}。同じ条件を繰り返さないための注意です。</p>
        ))}
      </section>
    </div>
  );
};

const ArmButton = ({
  project,
  experiment,
  arm,
}: {
  project: Project;
  experiment: AnalyticsExperiment;
  arm: 'control' | 'variant';
}) => {
  const updateProject = useStudioStore((state) => state.updateProject);
  const label = arm === 'control' ? experiment.controlLabel : experiment.variantLabels[0];
  return (
    <button
      type="button"
      className="an-radio"
      role="radio"
      aria-checked={project.experimentRef?.arm === arm}
      onClick={() =>
        updateProject((current) => {
          if (!current.experimentRef) return current;
          current.experimentRef.arm = arm;
          const value = arm === 'variant' ? experiment.variantLabels[0] : experiment.controlLabel;
          return applySafeValue(current, experiment.primaryVariable, value);
        })
      }
    >
      {arm === 'control' ? 'Control' : 'Variant'} · {label}
    </button>
  );
};

const matches = (project: Project, variable: PrimaryVariable | undefined, value: string): boolean => {
  if (!variable) return false;
  if (variable === 'map') return project.lineup.map === value;
  if (variable === 'agent') return project.lineup.agent === value;
  if (variable === 'ability') return project.lineup.ability === value;
  if (variable === 'hook') return project.hookPattern === value;
  if (variable === 'opening') return project.analytics.openingType === value;
  if (variable === 'cta') return project.analytics.ctaType === value || project.analytics.durationLabel === value;
  if (variable === 'length') return project.analytics.durationLabel === value;
  return false;
};
