import { readFileSync, writeFileSync } from 'node:fs';

const catalog = JSON.parse(
  readFileSync('resources/valorant-catalog/13.06/PublicContentCatalog.json', 'utf8'),
);
const korean = (node) => node?.localizedByCulture?.['ko-KR'];
const maps = {};
for (const map of catalog.maps) {
  const name = map.name?.defaultText;
  const label = korean(map.name);
  if (name && label) maps[name] = label;
}
const agents = {};
const abilities = {};
for (const character of catalog.characters) {
  const name = character.name?.defaultText;
  const label = korean(character.name);
  if (!name || !label) continue;
  agents[name] = label;
  const bucket = {};
  for (const ability of Object.values(character.abilities ?? {})) {
    const abilityName = ability.name?.defaultText;
    const abilityLabel = korean(ability.name);
    if (abilityName && abilityLabel) bucket[abilityName] = abilityLabel;
  }
  abilities[name] = bucket;
}
const body = `/** Riot Public Content Catalog 13.06 の ko-KR。書き出しではこの辞書だけを参照する。 */
export const MAP_NAMES_KO: Record<string, string> = ${JSON.stringify(maps, null, 2)};

export const AGENT_NAMES_KO: Record<string, string> = ${JSON.stringify(agents, null, 2)};

export const ABILITY_NAMES_KO: Record<string, Record<string, string>> = ${JSON.stringify(abilities, null, 2)};
`;
writeFileSync('shared/valorant-ko.ts', body);
console.log(`maps ${Object.keys(maps).length} agents ${Object.keys(agents).length}`);
