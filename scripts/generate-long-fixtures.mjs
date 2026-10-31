// 横動画の検証素材を生成する（決定的）。
//   A: 1920x1080 60fps 20秒。12.0秒に白フラッシュ（2フレーム）とクリック音。音声3本（混合・ゲーム・声）
//   B: 1280x720 30fps 15秒。7.5秒に白フラッシュとクリック音。音声1本
//   C: 音声なし 1280x720 30fps 6秒
//   V: VFR（前半30fps・後半60fps）8秒。4.0秒にフラッシュ
//   click.wav: SE 用の短いクリック
// 使い方: node scripts/generate-long-fixtures.mjs [出力ワークスペース]（既定 out/long-fixtures）
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(process.argv[2] ?? 'out/long-fixtures');
const footage = path.join(root, 'library', 'footage', 'long-h0');
const se = path.join(root, 'library', 'se', 'long-h0');
mkdirSync(footage, { recursive: true });
mkdirSync(se, { recursive: true });
mkdirSync(path.join(root, 'projects'), { recursive: true });

const font = process.platform === 'win32' ? 'C\\:/Windows/Fonts/arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

const video = ({ w, h, fps, dur, flashAt, label, color }) =>
  [
    `testsrc2=size=${w}x${h}:rate=${fps}:duration=${dur}`,
    `drawgrid=w=${Math.round(w / 8)}:h=${Math.round(h / 8)}:t=2:c=white@0.25`,
    `drawbox=x=${Math.round(w * 0.015)}:y=${Math.round(h * 0.025)}:w=${Math.round(w * 0.13)}:h=${Math.round(w * 0.13)}:c=${color}@0.9:t=fill`,
    `drawtext=fontfile='${font}':text='MAP':x=${Math.round(w * 0.05)}:y=${Math.round(h * 0.1)}:fontsize=${Math.round(h / 20)}:fontcolor=white`,
    `drawbox=x=${Math.round(w * 0.76)}:y=${Math.round(h * 0.03)}:w=${Math.round(w * 0.22)}:h=${Math.round(h * 0.09)}:c=black@0.6:t=fill`,
    `drawtext=fontfile='${font}':text='KILL ${label}':x=${Math.round(w * 0.77)}:y=${Math.round(h * 0.05)}:fontsize=${Math.round(h / 24)}:fontcolor=red`,
    `drawtext=fontfile='${font}':text='${label} t=%{pts\\:flt} n=%{n}':x=${Math.round(w * 0.3)}:y=${Math.round(h * 0.8)}:fontsize=${Math.round(h / 14)}:fontcolor=yellow:box=1:boxcolor=black@0.6`,
    `drawbox=x=0:y=0:w=iw:h=ih:c=white:t=fill:enable='between(t,${flashAt},${flashAt + 1.5 / fps})'`,
    `format=yuv420p`,
  ].join(',');

const click = (at, freq = 1000) => `0.9*sin(2*PI*${freq}*t)*between(t,${at},${at + 0.02})`;

// A
run([
  '-f', 'lavfi', '-i', video({ w: 1920, h: 1080, fps: 60, dur: 20, flashAt: 12, label: 'A', color: 'green' }),
  '-f', 'lavfi', '-i', `aevalsrc='0.15*sin(2*PI*440*t)+${click(12)}':s=48000:d=20:c=stereo`,
  '-f', 'lavfi', '-i', `aevalsrc='0.15*sin(2*PI*660*t)+${click(12)}':s=48000:d=20:c=stereo`,
  '-f', 'lavfi', '-i', `aevalsrc='0.15*sin(2*PI*220*t)':s=48000:d=20`,
  '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '60',
  '-c:a', 'aac', '-b:a', '160k',
  '-metadata:s:a:0', 'title=Mixed', '-metadata:s:a:1', 'title=Game', '-metadata:s:a:2', 'title=Mic',
  '-movflags', '+faststart',
  path.join(footage, 'a.mp4'),
]);

// B
run([
  '-f', 'lavfi', '-i', video({ w: 1280, h: 720, fps: 30, dur: 15, flashAt: 7.5, label: 'B', color: 'blue' }),
  '-f', 'lavfi', '-i', `aevalsrc='0.1*sin(2*PI*330*t)+${click(7.5, 1500)}':s=48000:d=15:c=stereo`,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
  path.join(footage, 'b.mp4'),
]);

// C（音声なし）
run([
  '-f', 'lavfi', '-i', video({ w: 1280, h: 720, fps: 30, dur: 6, flashAt: 3, label: 'C', color: 'purple' }),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-an', '-movflags', '+faststart',
  path.join(footage, 'c-noaudio.mp4'),
]);

// V（VFR）：30fps 4秒 + 60fps 4秒 を連結（タイムスタンプはそのまま）
const tmp = path.join(footage, '_vfr');
mkdirSync(tmp, { recursive: true });
run(['-f', 'lavfi', '-i', video({ w: 1280, h: 720, fps: 30, dur: 4, flashAt: 99, label: 'V30', color: 'orange' }), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-video_track_timescale', '15360', path.join(tmp, 'p1.mp4')]);
run(['-f', 'lavfi', '-i', video({ w: 1280, h: 720, fps: 60, dur: 4, flashAt: 0, label: 'V60', color: 'orange' }), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-video_track_timescale', '15360', path.join(tmp, 'p2.mp4')]);
writeFileSync(path.join(tmp, 'list.txt'), `file 'p1.mp4'\nfile 'p2.mp4'\n`);
run(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', path.join(footage, 'v-vfr.mp4')]);
if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });

// SE
run(['-f', 'lavfi', '-i', `aevalsrc='${click(0, 2000)}':s=48000:d=0.3:c=stereo`, path.join(se, 'click.wav')]);
// BGM（低い持続音）
run(['-f', 'lavfi', '-i', `aevalsrc='0.2*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.5*t))':s=48000:d=30:c=stereo`, '-c:a', 'aac', '-b:a', '128k', path.join(se, 'bgm.m4a')]);

console.log(`fixtures: ${root}`);
