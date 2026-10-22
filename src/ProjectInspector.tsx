import type { ReactNode } from 'react';
import { bounceChargeLabel, bounceChargeOptions } from '../shared/bounce-charge';
import { HOOK_PATTERNS, defaultPublishing } from '../shared/production';
import type { Platform } from '../shared/schema/audio';
import type { Language, Project, SceneKey } from '../shared/schema/project';
import {
  THROW_TYPE_ENCODING,
  THROW_TYPE_LABELS,
  getAbilityOptionLabel,
  getAgentOptionLabel,
  getCanonicalAbilityId,
  getCanonicalAgentId,
  getCanonicalMapId,
  getLineupAbilities,
  getMapOptionLabel,
  getMapSites,
  getThrowTypeOptions,
  isSovaChargeAbility,
  valorantMaster,
  type ThrowTypeId,
} from './valorantMaster';

type Change = (updater: (project: Project) => Project) => void;

export const BgmGainFields = ({ project, onChange }: { project: Project; onChange: Change }): ReactNode => {
  const placement = project.audio.bgm;
  if (!placement) return null;
  const percent = Math.round((placement.gain ?? 0.02) * 100);
  const setPercent = (next: number): void => {
    const gain = Math.min(1, Math.max(0, next / 100));
    onChange((current) => {
      if (!current.audio.bgm) return current;
      return {
        ...current,
        audio: { ...current.audio, bgm: { ...current.audio.bgm, gain } },
      };
    });
  };
  return (
    <div className="inspector-fields">
      <label>
        BGM全体の音量（%）
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(event) => setPercent(Number(event.target.value))}
        />
      </label>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label="BGM全体の音量"
        value={percent}
        onChange={(event) => setPercent(Number(event.target.value))}
      />
      <p className="inspector-note">
        各シーンのBGMは「個別の数値 × この％」です。フックだけ小さくしたいときは、シーン側のBGMを下げてください。
      </p>
    </div>
  );
};

const updateLineup = (onChange: Change, patch: Partial<Project['lineup']>): void =>
  onChange((project) => ({
    ...project,
    lineup: { ...project.lineup, ...patch },
  }));

const encodedThrowForAbility = (
  agent: string,
  ability: string,
): { charge: number; bounce: number; crouch: boolean; throwType: { ja: string; en: string } } => {
  if (isSovaChargeAbility(agent, ability)) {
    return { charge: 0, bounce: 0, crouch: false, throwType: bounceChargeLabel(0, 0) };
  }
  const throwType = getThrowTypeOptions(agent, ability)[0] ?? 'normal';
  const encoded =
    throwType === 'leftClick' ? { charge: 0, bounce: 0 } : THROW_TYPE_ENCODING[throwType];
  return {
    charge: encoded.charge,
    bounce: encoded.bounce,
    crouch: false,
    throwType: THROW_TYPE_LABELS[throwType],
  };
};

export const LineupPage = ({
  project,
  language,
  busy,
  onChange,
  onImportVideo,
}: {
  project: Project;
  language: Language;
  busy: boolean;
  onChange: Change;
  onImportVideo: (sceneKey?: SceneKey) => void;
}): ReactNode => {
  const selectedMap = getCanonicalMapId(project.lineup.map);
  const selectedAgent = getCanonicalAgentId(project.lineup.agent);
  const selectedAbility = getCanonicalAbilityId(selectedAgent, project.lineup.ability);
  const availableSites = getMapSites(selectedMap);
  const availableAbilities = getLineupAbilities(selectedAgent);
  const availableThrowTypes = getThrowTypeOptions(selectedAgent, selectedAbility);
  const selectedThrowType =
    availableThrowTypes.find((type) => {
      const label = THROW_TYPE_LABELS[type];
      return label.ja === project.lineup.throwType.ja || label.en === project.lineup.throwType.en;
    }) ?? availableThrowTypes[0];
  const showChargeBounce = isSovaChargeAbility(selectedAgent, selectedAbility);
  const selectedBounce = project.lineup.bounce ?? 0;
  const selectedCharge = project.lineup.charge ?? 0;
  const selectedCrouch = Boolean(project.lineup.crouch);

  return (
    <div className="inspector-fields">
      <button type="button" onClick={() => onImportVideo()} disabled={busy}>
        ＋ 録画を取り込む
      </button>
      <label>
        タイトル
        <input
          value={project.title}
          onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
        />
      </label>
      <div className="inspector-pair">
        <label>
          マップ
          <select
            value={selectedMap}
            onChange={(event) => {
              const map = event.target.value;
              const sites = getMapSites(map);
              onChange((current) => {
                current.lineup.map = map;
                if (!sites.includes(current.lineup.site)) current.lineup.site = sites[0];
                return current;
              });
            }}
          >
            {valorantMaster.maps.map((map) => (
              <option key={map.id} value={map.id}>
                {getMapOptionLabel(map.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          サイト
          <select
            value={project.lineup.site}
            onChange={(event) => updateLineup(onChange, { site: event.target.value as 'A' | 'B' | 'C' | 'Mid' })}
          >
            {availableSites.map((site) => (
              <option key={site} value={site}>
                {site} SITE
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="inspector-pair">
        <label>
          攻守
          <select
            value={project.lineup.side}
            onChange={(event) =>
              updateLineup(onChange, { side: event.target.value as 'attack' | 'defense' })
            }
          >
            <option value="attack">攻め / ATTACK</option>
            <option value="defense">守り / DEFENSE</option>
          </select>
        </label>
        <label>
          エージェント
          <select
            value={selectedAgent}
            onChange={(event) => {
              const agent = event.target.value;
              const firstAbility = getLineupAbilities(agent)[0]?.id ?? '';
              const encodedThrow = encodedThrowForAbility(agent, firstAbility);
              onChange((current) => {
                current.lineup.agent = agent;
                current.lineup.ability = firstAbility;
                current.lineup.charge = encodedThrow.charge;
                current.lineup.bounce = encodedThrow.bounce;
                current.lineup.crouch = encodedThrow.crouch;
                current.lineup.throwType = encodedThrow.throwType;
                return current;
              });
            }}
          >
            {valorantMaster.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {getAgentOptionLabel(agent.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        アビリティ
        <select
          value={selectedAbility}
          onChange={(event) => {
            const ability = event.target.value;
            const encodedThrow = encodedThrowForAbility(selectedAgent, ability);
            onChange((current) => {
              current.lineup.ability = ability;
              current.lineup.charge = encodedThrow.charge;
              current.lineup.bounce = encodedThrow.bounce;
              current.lineup.crouch = encodedThrow.crouch;
              current.lineup.throwType = encodedThrow.throwType;
              return current;
            });
          }}
        >
          {availableAbilities.map((ability) => (
            <option key={ability.id} value={ability.id}>
              {getAbilityOptionLabel(selectedAgent, ability.id)}
            </option>
          ))}
        </select>
      </label>
      <div className="inspector-pair">
        <label>
          チャージ
          <select
            disabled={!showChargeBounce}
            value={selectedCharge}
            onChange={(event) => {
              const charge = Number(event.target.value);
              updateLineup(onChange, {
                charge,
                ...(showChargeBounce
                  ? { throwType: bounceChargeLabel(selectedBounce, charge, selectedCrouch) }
                  : {}),
              });
            }}
          >
            {!showChargeBounce && <option value={0}>対象外</option>}
            {showChargeBounce &&
              [0, 1, 2, 3].map((charge) => (
                <option key={charge} value={charge}>
                  {charge === 3 ? 'フルチャージ' : charge}
                </option>
              ))}
          </select>
        </label>
        <label>
          バウンス
          <select
            disabled={!showChargeBounce}
            value={selectedBounce}
            onChange={(event) => {
              const bounce = Number(event.target.value);
              updateLineup(onChange, {
                bounce,
                ...(showChargeBounce
                  ? { throwType: bounceChargeLabel(bounce, selectedCharge, selectedCrouch) }
                  : {}),
              });
            }}
          >
            {!showChargeBounce && <option value={0}>対象外</option>}
            {showChargeBounce &&
              [0, 1, 2].map((bounce) => (
                <option key={bounce} value={bounce}>
                  {bounce}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="inspector-note">
        説明文はプレビューの言語（{language === 'ja' ? '日本語' : 'English'}）を編集しています。
      </p>
      <label>
        立ち位置の説明
        <textarea
          rows={2}
          value={project.lineup.standDescription[language]}
          onChange={(event) =>
            onChange((current) => {
              current.lineup.standDescription[language] = event.target.value;
              return current;
            })
          }
        />
      </label>
      <label>
        狙い方の説明
        <textarea
          rows={2}
          value={project.lineup.aimDescription[language]}
          onChange={(event) =>
            onChange((current) => {
              current.lineup.aimDescription[language] = event.target.value;
              return current;
            })
          }
        />
      </label>
      {showChargeBounce ? (
        <>
          <label>
            バウンス・チャージ
            <select
              value={`${selectedBounce}-${selectedCharge}`}
              onChange={(event) => {
                const [bounce, charge] = event.target.value.split('-').map(Number);
                updateLineup(onChange, {
                  bounce,
                  charge,
                  throwType: bounceChargeLabel(bounce, charge, selectedCrouch),
                });
              }}
            >
              {bounceChargeOptions(selectedCrouch).map((option) => (
                <option key={`${option.bounce}-${option.charge}`} value={`${option.bounce}-${option.charge}`}>
                  {option.label[language]}
                </option>
              ))}
            </select>
          </label>
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={selectedCrouch}
              onChange={(event) => {
                const crouch = event.target.checked;
                updateLineup(onChange, {
                  crouch,
                  throwType: bounceChargeLabel(selectedBounce, selectedCharge, crouch),
                });
              }}
            />
            しゃがみ
          </label>
        </>
      ) : (
        <label>
          投げ方
          <select
            value={selectedThrowType}
            onChange={(event) => {
              const throwType = event.target.value as ThrowTypeId;
              const encodedThrow = throwType === 'leftClick' ? null : THROW_TYPE_ENCODING[throwType];
              onChange((current) => {
                current.lineup.throwType = THROW_TYPE_LABELS[throwType];
                if (encodedThrow) {
                  current.lineup.charge = encodedThrow.charge;
                  current.lineup.bounce = encodedThrow.bounce;
                }
                return current;
              });
            }}
          >
            {availableThrowTypes.map((throwType) => (
              <option key={throwType} value={throwType}>
                {THROW_TYPE_LABELS[throwType][language]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        フックの型
        <select
          value={project.hookPattern}
          onChange={(event) =>
            onChange((current) => {
              const pattern = event.target.value as Project['hookPattern'];
              current.hookPattern = pattern;
              if (pattern !== 'custom') {
                const hook = current.captions.find((caption) => caption.id === 'hook');
                if (hook) hook.text = { ...HOOK_PATTERNS[pattern] };
              }
              return current;
            })
          }
        >
          <option value="custom">自由入力</option>
          <option value="result">結果型</option>
          <option value="number">数字型</option>
          <option value="question">問いかけ型</option>
          <option value="scarcity">希少性</option>
          <option value="score">実利・スコア</option>
          <option value="versatile">汎用性</option>
          <option value="newmap">新マップ</option>
        </select>
      </label>
      <div className="inspector-pair">
        <label>
          アクセント色
          <input
            type="color"
            value={project.templateParams.accent}
            onChange={(event) =>
              onChange((current) => {
                current.templateParams.accent = event.target.value;
                return current;
              })
            }
          />
        </label>
        <label>
          フレームレート
          <select
            value={project.templateParams.fps}
            onChange={(event) =>
              onChange((current) => {
                current.templateParams.fps = Number(event.target.value) as 30 | 60;
                return current;
              })
            }
          >
            <option value={60}>60 fps</option>
            <option value={30}>30 fps</option>
          </select>
        </label>
      </div>
      <p className="inspector-note">
        選択肢: ClutchVaultマスター · 更新 {valorantMaster.source.lastUpdated.slice(0, 10)}
      </p>
    </div>
  );
};

export const PublishPage = ({
  project,
  language,
  defaultPostPlatform,
  onChange,
}: {
  project: Project;
  language: Language;
  defaultPostPlatform: Platform;
  onChange: Change;
}): ReactNode => (
  <div className="inspector-fields">
    <p className="inspector-note">
      投稿文はプレビューの言語（{language === 'ja' ? '日本語' : 'English'}）を編集しています。
    </p>
    {([
      'title',
      'description',
      ...(language === 'en' ? (['hashtags'] as const) : []),
    ] as const).map((field) => (
      <label key={field}>
        {field === 'title' ? 'タイトル' : field === 'description' ? '説明文' : 'ハッシュタグ'}
        <textarea
          rows={field === 'title' ? 2 : 3}
          value={project.publishing[field][language]}
          placeholder={defaultPublishing(project)[field][language]}
          onChange={(event) =>
            onChange((current) => {
              current.publishing[field][language] = event.target.value;
              return current;
            })
          }
        />
      </label>
    ))}
    <button
      type="button"
      className="primary"
      onClick={() =>
        onChange((current) => {
          current.guide.mode = 'guide';
          current.guide.lastStep = 10;
          return current;
        })
      }
    >
      投稿運用を開く
    </button>
    <p className="inspector-note">URLの記録と公開確認は、ガイドの手順10で1件ずつ進みます。</p>
    {project.posts.map((post) => (
      <div className="post-row" key={post.id}>
        <span>{post.preset}</span>
        <span>{post.url || '未記録'}</span>
      </div>
    ))}
  </div>
);
