import {
  applyAspect,
  clampRect,
  cornerRect,
  ease,
  fitLayout,
  lerpRectLocked,
  outputToSource,
  pxAspect,
  rectProblem,
  sourceToOutput,
  splitRects,
  toPx,
  zoomCrop,
} from '../shared/long/geometry';
import { expect, expectClose, expectEqual } from './long-test-utils';

const source = { w: 1920, h: 1080 };

// --- 指示書 4.1 の数値例：正規化 w=0.25, h=4/9 → 480×480
const crop = { x: 0.25, y: 0.25, w: 0.25, h: 4 / 9 };
const cropPx = toPx(crop, source);
expectClose(cropPx.w, 480, 1e-9, '切り抜き幅 480px');
expectClose(cropPx.h, 480, 1e-9, '切り抜き高さ 480px');
expectClose(pxAspect(crop, source), 1, 1e-9, '比率は実寸で 1:1（正規化値の比ではない）');

// 表示枠 600×300（出力 1920×1080 上）
const dest = { x: 300 / 1920, y: 200 / 1080, w: 600 / 1920, h: 300 / 1080 };
const contain = fitLayout(crop, dest, 'contain', source);
expectClose(contain.scale, 0.625, 1e-9, 'contain のスケール = min(600/480, 300/480)');
expectClose(contain.content.w, 300, 1e-9, 'contain の幅 300');
expectClose(contain.content.h, 300, 1e-9, 'contain の高さ 300');
expectClose(contain.content.x - contain.dest.x, 150, 1e-9, 'contain 左の余白 150px');
expectClose(contain.dest.x + contain.dest.w - (contain.content.x + contain.content.w), 150, 1e-9, 'contain 右の余白 150px');

const cover = fitLayout(crop, dest, 'cover', source);
expectClose(cover.scale, 1.25, 1e-9, 'cover のスケール = max(600/480, 300/480)');
expectClose(cover.content.w, 600, 1e-9, 'cover の幅 600');
expectClose(cover.content.h, 600, 1e-9, 'cover の高さ 600');
expectClose(cover.dest.y - cover.content.y, 150, 1e-9, 'cover 上が 150px 見切れる');
expectClose(cover.visible.h, 300, 1e-9, 'cover の見える高さは表示枠と同じ');

// 等方スケール：素材全体の表示サイズの比率が素材比と一致（縦横に潰さない）
expectClose(contain.frame.w / contain.frame.h, 1920 / 1080, 1e-9, 'contain で非等方の伸縮をしない');
expectClose(cover.frame.w / cover.frame.h, 1920 / 1080, 1e-9, 'cover で非等方の伸縮をしない');

// 図形：切り抜きの中心は表示枠の中心へ
const center = sourceToOutput({ x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 }, contain);
expectClose(center.x, 300 + 300, 1e-9, '切り抜き中心 → 表示枠中心（x）');
expectClose(center.y, 200 + 150, 1e-9, '切り抜き中心 → 表示枠中心（y）');
const back = outputToSource(center, contain);
expectClose(back.x, crop.x + crop.w / 2, 1e-12, '逆変換（x）');
expectClose(back.y, crop.y + crop.h / 2, 1e-12, '逆変換（y）');
// 切り抜きの左上隅は contain の内容枠の左上
const corner = sourceToOutput({ x: crop.x, y: crop.y }, contain);
expectClose(corner.x, contain.content.x, 1e-9, '切り抜き左上 → 内容枠左上');
// cover で枠外になる点は visible の外
const outside = sourceToOutput({ x: crop.x + crop.w / 2, y: crop.y }, cover);
expect(outside.y < cover.visible.y, 'cover で見切れる位置のマーカーは表示枠の外（描かない）');

// --- 範囲検証
expectEqual(rectProblem({ x: 0, y: 0, w: 0, h: 0.5 }), '幅と高さは0より大きくしてください', '幅0を拒否');
expectEqual(rectProblem({ x: 0, y: 0, w: -0.1, h: 0.5 }), '幅と高さは0より大きくしてください', '負値を拒否');
expectEqual(rectProblem({ x: Number.NaN, y: 0, w: 0.1, h: 0.5 }), '数値ではない値があります', 'NaN を拒否');
expectEqual(rectProblem({ x: 0.9, y: 0, w: 0.2, h: 0.5 }), '範囲の外にはみ出しています', 'はみ出しを拒否');
expectEqual(rectProblem({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }), null, '正常な矩形');

// --- 端のクランプと比率
const clamped = clampRect({ x: 0.9, y: -0.1, w: 0.3, h: 0.3 });
expectEqual(rectProblem(clamped), null, 'クランプ後は範囲内');
expectClose(clamped.w, 0.3, 1e-12, 'クランプで大きさは保つ');

const square = applyAspect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1, source);
expectClose(pxAspect(square, source), 1, 1e-9, '1:1 を実寸で当てはめる');
expectClose(square.x + square.w / 2, 0.5, 1e-9, '比率変更で中心を保つ（x）');
expectClose(square.y + square.h / 2, 0.5, 1e-9, '比率変更で中心を保つ（y）');
const tall = applyAspect({ x: 0, y: 0, w: 1, h: 1 }, 9 / 16, source);
expectClose(pxAspect(tall, source), 9 / 16, 1e-9, '9:16 でも比率を保ったまま素材内に縮小');
expectEqual(rectProblem(tall), null, '9:16 は素材内に収まる');
const wide = applyAspect({ x: 0.85, y: 0.02, w: 0.14, h: 0.1 }, 4, source);
expectClose(pxAspect(wide, source), 4, 1e-9, 'キルログ 4:1');
expectEqual(rectProblem(wide), null, '端でも範囲内');

const zoomed = zoomCrop({ x: 0, y: 0, w: 0.2, h: 0.2 }, 2);
expectClose(zoomed.w, 0.1, 1e-12, '2倍拡大で切り抜きが半分');
expectEqual(rectProblem(zoomed), null, '端の拡大でも範囲内');

// --- 補間
expectEqual(ease(0, 'ease'), 0, 'イーズの始点');
expectEqual(ease(1, 'ease'), 1, 'イーズの終点');
expectEqual(ease(0.5, 'step'), 0, '即時は終点まで切り替えない');
const a = { x: 0.1, y: 0.1, w: 0.2, h: (0.2 * 1920) / 1080 };
const b = { x: 0.5, y: 0.3, w: 0.3, h: (0.3 * 1920) / 1080 };
for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  const mid = lerpRectLocked(a, b, t, 1, { w: 1920, h: 1080 });
  expectClose(pxAspect(mid, { w: 1920, h: 1080 }), 1, 1e-9, `比率ロック中の補間 t=${t}`);
}

// --- PiP の枠
const tr = cornerRect('tr');
expectEqual(rectProblem(tr), null, '右上の PiP は画面内');
expectClose(pxAspect(tr, { w: 1920, h: 1080 }), 16 / 9, 1e-9, 'PiP は 16:9');
const split = splitRects('split-h', 0.5);
expectClose(split.main.w + split.secondary.w, 1, 1e-12, '左右分割の合計幅');

console.log('long geometry ok');
