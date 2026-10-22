import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const clutchVaultRoot =
  process.env.CLUTCHVAULT_ROOT ?? resolve(projectRoot, '..', 'ValorantClutchVault');
const sourcePath = resolve(
  clutchVaultRoot,
  'packages',
  'shared-utils',
  'src',
  'data',
  'valorant-mappings.json',
);
const outputPath = resolve(projectRoot, 'src', 'data', 'valorant-master.json');

if (!existsSync(sourcePath)) {
  if (existsSync(outputPath)) {
    console.warn(
      `[valorant-master] ClutchVaultが見つからないため同梱済みデータを使用します: ${sourcePath}`,
    );
    process.exit(0);
  }
  throw new Error(`ClutchVaultのマスターデータが見つかりません: ${sourcePath}`);
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const master = {
  schemaVersion: 1,
  source: {
    application: 'ValorantClutchVault',
    apiVersion: source.apiVersion,
    lastUpdated: source.lastUpdated,
  },
  maps: source.maps.map((map) => ({
    id: map.name,
    displayName: map.displayName,
    uuid: map.uuid,
    iconUrl: map.listViewIconUrl || map.displayIconUrl || null,
  })),
  agents: source.agents.map((agent) => ({
    id: agent.name,
    displayName: agent.displayName,
    uuid: agent.uuid,
    iconUrl: agent.displayIconUrl || null,
    abilities: (agent.abilities ?? []).map((ability) => ({
      id: ability.displayName,
      displayName: ability.displayName,
      slot: ability.slot,
      iconUrl: ability.displayIconUrl || null,
    })),
  })),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(master, null, 2)}\n`, 'utf8');
console.log(
  `[valorant-master] ${master.maps.length} maps / ${master.agents.length} agents を同期しました`,
);
