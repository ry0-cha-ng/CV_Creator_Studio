import catalogIndexJson from '../resources/valorant-catalog/index.json';

export type CatalogAbilityEntry = {
  slot: string;
  source: string;
  cardIcon: string;
};

export type CatalogAgentEntry = {
  uuid: string;
  source: string;
  cardIcon: string;
};

export type ValorantCatalogIndex = {
  schemaVersion: number;
  catalogVersion: string;
  versionDir: string;
  generatedAt: string;
  agentSize: number;
  abilitySize: number;
  agents: Record<string, CatalogAgentEntry>;
  abilities: Record<string, Record<string, CatalogAbilityEntry>>;
};

export const valorantCatalogIndex = catalogIndexJson as ValorantCatalogIndex;

const normalizeId = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');

const findAgentKey = (agentValue: string): string | undefined => {
  if (valorantCatalogIndex.agents[agentValue]) return agentValue;
  const normalized = normalizeId(agentValue);
  return Object.keys(valorantCatalogIndex.agents).find(
    (key) => normalizeId(key) === normalized,
  );
};

const findAbilityKey = (
  agentKey: string,
  abilityValue: string,
): string | undefined => {
  const abilities = valorantCatalogIndex.abilities[agentKey];
  if (!abilities) return undefined;
  if (abilities[abilityValue]) return abilityValue;
  const normalized = normalizeId(abilityValue);
  return Object.keys(abilities).find((key) => normalizeId(key) === normalized);
};

/** Relative path under resources/valorant-catalog (posix). */
export const getAgentCardIconPath = (agentValue: string): string | null => {
  const agentKey = findAgentKey(agentValue);
  if (!agentKey) return null;
  return valorantCatalogIndex.agents[agentKey]?.cardIcon ?? null;
};

/** Relative path under resources/valorant-catalog (posix). */
export const getAbilityCardIconPath = (
  agentValue: string,
  abilityValue: string,
): string | null => {
  const agentKey = findAgentKey(agentValue);
  if (!agentKey) return null;
  const abilityKey = findAbilityKey(agentKey, abilityValue);
  if (!abilityKey) return null;
  return valorantCatalogIndex.abilities[agentKey]?.[abilityKey]?.cardIcon ?? null;
};

export const CATALOG_MEDIA_PREFIX = 'cv-catalog';

export const catalogMediaRelativePath = (cardIconPath: string): string =>
  `${CATALOG_MEDIA_PREFIX}/${cardIconPath.replace(/^\/+/, '')}`;
