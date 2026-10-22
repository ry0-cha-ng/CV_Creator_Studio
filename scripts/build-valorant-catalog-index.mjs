import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const catalogRoot = resolve(projectRoot, 'resources', 'valorant-catalog');
const masterPath = resolve(projectRoot, 'src', 'data', 'valorant-master.json');
const indexPath = resolve(catalogRoot, 'index.json');
const cardIconsRoot = resolve(catalogRoot, 'card-icons');

const AGENT_SIZE = 256;
const ABILITY_SIZE = 128;

const findCatalogVersionDir = () => {
  const entries = readdirSync(catalogRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) {
    throw new Error(`版ディレクトリが見つかりません: ${catalogRoot}`);
  }
  return entries[entries.length - 1];
};

const resolveFfmpeg = () => {
  try {
    const ffmpegPath = require(resolve(projectRoot, 'node_modules', 'ffmpeg-static'));
    if (typeof ffmpegPath === 'string' && existsSync(ffmpegPath)) return ffmpegPath;
  } catch {
    // fall through
  }
  try {
    const ffmpegPath = require('ffmpeg-static');
    if (typeof ffmpegPath === 'string' && existsSync(ffmpegPath)) return ffmpegPath;
  } catch {
    // fall through
  }
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'ffmpeg';
  return null;
};

const listLowerMap = (directory) => {
  const map = new Map();
  if (!existsSync(directory)) return map;
  for (const name of readdirSync(directory)) {
    map.set(name.toLowerCase(), name);
  }
  return map;
};

const writeCardIconBatch = (jobs, ffmpegPath) => {
  if (ffmpegPath) {
    let mode = 'scale';
    for (const job of jobs) {
      mkdirSync(dirname(job.outputPath), { recursive: true });
      const result = spawnSync(
        ffmpegPath,
        [
          '-y',
          '-i',
          job.inputPath,
          '-vf',
          `scale=${job.size}:${job.size}:force_original_aspect_ratio=decrease,pad=${job.size}:${job.size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
          '-frames:v',
          '1',
          job.outputPath,
        ],
        { encoding: 'utf8' },
      );
      if (result.status !== 0 || !existsSync(job.outputPath)) {
        copyFileSync(job.inputPath, job.outputPath);
        mode = 'copy-fallback';
      }
    }
    return mode;
  }

  if (process.platform === 'win32') {
    const listPath = join(cardIconsRoot, '_jobs.json');
    mkdirSync(cardIconsRoot, { recursive: true });
    writeFileSync(listPath, JSON.stringify(jobs), 'utf8');
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$jobs = Get-Content -Raw -Encoding UTF8 '${listPath.replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($job in $jobs) {
  $dir = Split-Path -Parent $job.outputPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $src = New-Object System.Drawing.Bitmap $job.inputPath
  $size = [int]$job.size
  $dst = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $scale = [Math]::Min($size / $src.Width, $size / $src.Height)
  $w = [int]($src.Width * $scale)
  $h = [int]($src.Height * $scale)
  $x = [int](($size - $w) / 2)
  $y = [int](($size - $h) / 2)
  $g.DrawImage($src, $x, $y, $w, $h)
  $dst.Save($job.outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $dst.Dispose(); $src.Dispose()
}
`;
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    rmSync(listPath, { force: true });
    if (result.status === 0) return 'scale-dotnet';
    console.warn('[valorant-catalog] .NET 縮小に失敗したため原寸コピーします', result.stderr || result.stdout);
  }

  for (const job of jobs) {
    mkdirSync(dirname(job.outputPath), { recursive: true });
    copyFileSync(job.inputPath, job.outputPath);
  }
  return 'copy';
};

const safeFileSegment = (value) =>
  value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'unknown';

const versionDir = findCatalogVersionDir();
const versionRoot = join(catalogRoot, versionDir);
const charactersDir = join(versionRoot, 'Characters');
const abilitiesDir = join(versionRoot, 'Abilities');
const characterFiles = listLowerMap(charactersDir);
const abilityFiles = listLowerMap(abilitiesDir);
const master = JSON.parse(readFileSync(masterPath, 'utf8'));
const ffmpegPath = resolveFfmpeg();
if (!ffmpegPath) {
  console.warn(
    '[valorant-catalog] ffmpeg が見つかりません。Windows では .NET で縮小します。',
  );
}

let catalogVersion = versionDir;
const pccPath = join(versionRoot, 'PublicContentCatalog.json');
if (existsSync(pccPath)) {
  const head = readFileSync(pccPath, 'utf8').slice(0, 200);
  const match = /"version"\s*:\s*"([^"]+)"/.exec(head);
  if (match) catalogVersion = match[1];
}

if (existsSync(cardIconsRoot)) {
  rmSync(cardIconsRoot, { recursive: true, force: true });
}
mkdirSync(join(cardIconsRoot, 'agents'), { recursive: true });
mkdirSync(join(cardIconsRoot, 'abilities'), { recursive: true });

const index = {
  schemaVersion: 1,
  catalogVersion,
  versionDir,
  generatedAt: new Date().toISOString(),
  agentSize: AGENT_SIZE,
  abilitySize: ABILITY_SIZE,
  agents: {},
  abilities: {},
};

let agentCount = 0;
let abilityCount = 0;
const missingAgents = [];
const missingAbilities = [];
const jobs = [];

for (const agent of master.agents) {
  const sourceName = characterFiles.get(`${agent.uuid}.png`.toLowerCase());
  if (!sourceName) {
    missingAgents.push(agent.id);
    continue;
  }
  const source = `${versionDir}/Characters/${sourceName}`;
  const cardIcon = `card-icons/agents/${safeFileSegment(agent.id)}.png`;
  jobs.push({
    inputPath: join(catalogRoot, source),
    outputPath: join(catalogRoot, cardIcon),
    size: AGENT_SIZE,
  });
  index.agents[agent.id] = { uuid: agent.uuid, source, cardIcon };
  agentCount += 1;

  const abilityMap = {};
  for (const ability of agent.abilities ?? []) {
    if (!ability.slot || ability.slot === 'Passive') continue;
    const abilitySourceName = abilityFiles.get(
      `${agent.uuid}_${ability.slot}.png`.toLowerCase(),
    );
    if (!abilitySourceName) {
      missingAbilities.push(`${agent.id}/${ability.id}`);
      continue;
    }
    const abilitySource = `${versionDir}/Abilities/${abilitySourceName}`;
    const abilityCardIcon = `card-icons/abilities/${safeFileSegment(agent.id)}__${safeFileSegment(ability.id)}.png`;
    jobs.push({
      inputPath: join(catalogRoot, abilitySource),
      outputPath: join(catalogRoot, abilityCardIcon),
      size: ABILITY_SIZE,
    });
    abilityMap[ability.id] = {
      slot: ability.slot,
      source: abilitySource,
      cardIcon: abilityCardIcon,
    };
    abilityCount += 1;
  }
  index.abilities[agent.id] = abilityMap;
}

const writeMode = writeCardIconBatch(jobs, ffmpegPath);
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(
  `[valorant-catalog] ${catalogVersion}: agents ${agentCount}, abilities ${abilityCount} (${writeMode}) → ${indexPath}`,
);
if (missingAgents.length > 0) {
  console.warn(`[valorant-catalog] エージェント画像なし: ${missingAgents.join(', ')}`);
}
if (missingAbilities.length > 0) {
  console.warn(
    `[valorant-catalog] アビリティ画像なし (${missingAbilities.length}): ${missingAbilities.slice(0, 8).join(', ')}${missingAbilities.length > 8 ? '…' : ''}`,
  );
}
