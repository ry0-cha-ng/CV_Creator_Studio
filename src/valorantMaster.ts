import { isSovaChargeLineup } from '../shared/bounce-charge';
import {
  ABILITY_NAMES_JA,
  AGENT_NAMES_JA,
  MAP_NAMES_JA,
} from './data/valorant-ja';
import masterData from './data/valorant-master.json';

type MasterAgent = (typeof masterData.agents)[number];
export type MasterAbility = MasterAgent['abilities'][number];
export type ThrowTypeId =
  | 'leftClick'
  | 'normal'
  | 'run'
  | 'jump'
  | 'runJump'
  | 'rightClick';

export const valorantMaster = masterData;

const normalizeId = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');

const EXCLUDED_ABILITIES: Record<string, string[]> = {
  Brimstone: ['Stim Beacon'],
  Chamber: ['Headhunter'],
  Clove: ['Pick-me-up'],
  Fade: ['Prowler'],
  Harbor: ['Cove'],
  Iso: ['Double Tap'],
  Jett: ['Updraft', 'Tailwind'],
  Miks: ['Harmonize'],
  Neon: ['High Gear'],
  Omen: ['Shrouded Step'],
  Phoenix: ['Curveball'],
  Reyna: ['Devour', 'Dismiss'],
  Sage: ['Healing Orb'],
  Skye: ['Trailblazer', 'Regrowth'],
  Tejo: ['Stealth Drone'],
  Waylay: ['Lightspeed', 'Refract'],
};

const ULTIMATE_ENABLED_AGENTS = new Set([
  'Astra',
  'Breach',
  'Brimstone',
  'Deadlock',
  'Fade',
  'Harbor',
  'Killjoy',
  'Miks',
  'Sova',
  'Tejo',
  'Viper',
  'Vyse',
  'Waylay',
]);

const THREE_SITE_MAPS = new Set(['Haven', 'Lotus']);

const THROW_VARIATIONS: Record<string, Record<string, ThrowTypeId[]>> = {
  'KAY/O': {
    'FRAG/ment': ['normal', 'run', 'jump', 'runJump', 'rightClick'],
    'FLASH/drive': ['normal', 'run', 'jump', 'runJump', 'rightClick'],
    'ZERO/point': ['normal', 'run', 'jump', 'runJump'],
  },
  Vyse: { Razorvine: ['normal', 'run', 'jump', 'runJump'] },
  Viper: {
    'Poison Cloud': ['normal', 'run', 'jump', 'runJump'],
    'Snake Bite': ['normal', 'run', 'jump', 'runJump'],
  },
  Veto: { Chokehold: ['normal', 'run', 'jump', 'runJump', 'rightClick'] },
  Killjoy: { Nanoswarm: ['normal', 'run', 'jump', 'runJump', 'rightClick'] },
  Clove: { Meddle: ['normal', 'run', 'jump', 'runJump'] },
  Gekko: { 'Mosh Pit': ['normal', 'run', 'jump', 'runJump', 'rightClick'] },
  Cypher: { 'Cyber Cage': ['normal', 'run', 'jump', 'runJump'] },
  Sage: { 'Slow Orb': ['normal', 'run', 'jump', 'runJump'] },
  Deadlock: {
    'Barrier Mesh': ['normal', 'run', 'jump', 'runJump'],
    GravNet: ['normal', 'run', 'jump', 'runJump'],
  },
  Tejo: { 'Special Delivery': ['normal', 'rightClick'] },
  Harbor: { 'Storm Surge': ['normal', 'run', 'jump', 'runJump'] },
  Fade: {
    Seize: ['normal', 'run', 'jump', 'runJump'],
    Haunt: ['normal', 'run', 'jump', 'runJump'],
  },
  Phoenix: { 'Hot Hands': ['normal', 'run', 'jump', 'runJump'] },
  Yoru: { BLINDSIDE: ['normal', 'run', 'jump', 'runJump'] },
  Raze: { 'Paint Shells': ['normal', 'run', 'jump', 'runJump', 'rightClick'] },
  Jett: { Cloudburst: ['normal', 'run', 'jump', 'runJump'] },
  Reyna: { Leer: ['normal', 'run', 'jump', 'runJump'] },
  Iso: { Undercut: ['normal', 'run', 'jump', 'runJump'] },
  Miks: { 'M-pulse': ['normal', 'run', 'jump', 'runJump', 'rightClick'] },
};

export const THROW_TYPE_LABELS: Record<
  ThrowTypeId,
  { ja: string; en: string }
> = {
  leftClick: { ja: '左クリック', en: 'LEFT CLICK' },
  normal: { ja: '通常投げ', en: 'NORMAL THROW' },
  run: { ja: '走り投げ', en: 'RUN THROW' },
  jump: { ja: 'ジャンプ投げ', en: 'JUMP THROW' },
  runJump: { ja: '走りジャンプ投げ', en: 'RUN JUMP THROW' },
  rightClick: { ja: '右クリック', en: 'RIGHT CLICK' },
};

export const THROW_TYPE_ENCODING: Record<
  Exclude<ThrowTypeId, 'leftClick'>,
  { charge: 0 | 1 | 2 | 3; bounce: 0 | 1 | 2 }
> = {
  normal: { charge: 0, bounce: 0 },
  run: { charge: 1, bounce: 0 },
  jump: { charge: 2, bounce: 0 },
  runJump: { charge: 3, bounce: 0 },
  rightClick: { charge: 0, bounce: 1 },
};

export const getMasterAgent = (value: string): MasterAgent | undefined =>
  valorantMaster.agents.find((agent) => normalizeId(agent.id) === normalizeId(value));

export const getCanonicalMapId = (value: string): string =>
  valorantMaster.maps.find((map) => normalizeId(map.id) === normalizeId(value))?.id ??
  value;

export const getCanonicalAgentId = (value: string): string =>
  getMasterAgent(value)?.id ?? value;

export const getCanonicalAbilityId = (agentValue: string, value: string): string => {
  const agent = getMasterAgent(agentValue);
  return (
    agent?.abilities.find(
      (ability) => normalizeId(ability.id) === normalizeId(value),
    )?.id ?? value
  );
};

export const getMapSites = (mapValue: string): Array<'A' | 'B' | 'C' | 'Mid'> => {
  const map = getCanonicalMapId(mapValue);
  return THREE_SITE_MAPS.has(map) ? ['A', 'B', 'C', 'Mid'] : ['A', 'B', 'Mid'];
};

export const getLineupAbilities = (agentValue: string): MasterAbility[] => {
  const agent = getMasterAgent(agentValue);
  if (!agent) return [];
  const excluded = EXCLUDED_ABILITIES[agent.id] ?? [];
  return agent.abilities.filter((ability) => {
    if (ability.slot === 'Passive' || excluded.includes(ability.id)) return false;
    if (ability.slot === 'Ultimate') return ULTIMATE_ENABLED_AGENTS.has(agent.id);
    return ['Ability1', 'Ability2', 'Grenade'].includes(ability.slot);
  });
};

export const getThrowTypeOptions = (
  agentValue: string,
  abilityValue: string,
): ThrowTypeId[] => {
  const agent = getCanonicalAgentId(agentValue);
  const ability = getCanonicalAbilityId(agent, abilityValue);
  if (agent === 'Sova' && ['Shock Bolt', 'Recon Bolt'].includes(ability)) {
    return ['leftClick'];
  }
  return THROW_VARIATIONS[agent]?.[ability] ?? ['normal'];
};

export const isSovaChargeAbility = (
  agentValue: string,
  abilityValue: string,
): boolean => {
  const agent = getCanonicalAgentId(agentValue);
  const ability = getCanonicalAbilityId(agent, abilityValue);
  return isSovaChargeLineup(agent, ability);
};

export const getMapOptionLabel = (mapId: string): string =>
  MAP_NAMES_JA[getCanonicalMapId(mapId)] ?? mapId;

export const getAgentOptionLabel = (agentId: string): string =>
  AGENT_NAMES_JA[getCanonicalAgentId(agentId)] ?? agentId;

export const getAbilityOptionLabel = (agentId: string, abilityId: string): string => {
  const agent = getCanonicalAgentId(agentId);
  const ability = getCanonicalAbilityId(agent, abilityId);
  return ABILITY_NAMES_JA[agent]?.[ability] ?? ability;
};
