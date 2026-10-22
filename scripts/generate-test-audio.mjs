import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'resources', 'test-audio');

if (!ffmpegPath) throw new Error('FFmpegバイナリが見つかりません');
await mkdir(output, { recursive: true });

const generate = async (name, source) => {
  await execFileAsync(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    '-c:a',
    'pcm_s16le',
    path.join(output, name),
  ]);
  console.log(`[test-audio] ${name}`);
};

await generate(
  'sine-30s.wav',
  'sine=frequency=1000:sample_rate=48000:duration=30',
);
await generate(
  'clicks-60s.wav',
  'aevalsrc=if(lt(mod(t\\,1)\\,0.02)\\,0.7*sin(2*PI*1000*t)\\,0):s=48000:d=60',
);
await generate(
  'beep-300ms.wav',
  'sine=frequency=1600:sample_rate=48000:duration=0.3,volume=0.2',
);
