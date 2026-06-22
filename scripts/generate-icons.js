// 用纯 Node 内置模块（zlib）生成 PNG 图标，无需任何第三方依赖。
// 渲染一个深色圆角方块 + 雷达同心环 + 扫描扇区 + 中心光点，呼应"跑路雷达"。
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// over 合成：把 (r,g,b,a) 叠到 dst 上
function over(dst, r, g, b, a) {
  const na = a + dst[3] * (1 - a);
  if (na <= 0) return;
  dst[0] = (r * a + dst[0] * dst[3] * (1 - a)) / na;
  dst[1] = (g * a + dst[1] * dst[3] * (1 - a)) / na;
  dst[2] = (b * a + dst[2] * dst[3] * (1 - a)) / na;
  dst[3] = na;
}

function shade(u, v, px) {
  // u,v ∈ [-1,1]，px 为当前渲染像素尺寸（用于抗锯齿宽度）
  const aa = 2.2 / px;
  const out = [0, 0, 0, 0];

  // 圆角方块背景
  const cr = 0.42;
  const qx = Math.abs(u) - (1 - cr);
  const qy = Math.abs(v) - (1 - cr);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr;
  const bgA = smooth(aa, -aa, d);
  if (bgA > 0) {
    const g = clamp((v + 1) / 2, 0, 1); // 顶部偏亮，底部偏深
    const r = 18 + (28 - 18) * (1 - g);
    const gg = 30 + (46 - 30) * (1 - g);
    const bb = 40 + (62 - 40) * (1 - g);
    over(out, r, gg, bb, bgA);
  }
  if (out[3] <= 0) return out;

  const r = Math.hypot(u, v);
  const ang = Math.atan2(-v, u); // 屏幕 y 向下，取负让角度更直观

  // 同心雷达环
  const rings = [0.34, 0.62, 0.9];
  for (const rr of rings) {
    const ringA = smooth(0.045, 0.0, Math.abs(r - rr)) * 0.55;
    if (ringA > 0) over(out, 70, 209, 138, ringA * bgA);
  }

  // 扫描扇区：从右上方向逆时针淡出
  const sweepStart = -0.35; // 弧度
  const span = 1.5;
  let rel = ang - sweepStart;
  while (rel < 0) rel += Math.PI * 2;
  if (rel < span && r < 0.96) {
    const fade = (1 - rel / span) * smooth(0.96, 0.6, r) * 0.5;
    over(out, 100, 181, 255, fade * bgA);
  }

  // 扫描前沿亮线
  const edge = smooth(0.02, 0.0, Math.abs(((ang - sweepStart + Math.PI) % (Math.PI * 2)) - Math.PI));
  if (r < 0.94 && r > 0.1) over(out, 150, 220, 255, edge * 0.8 * bgA);

  // 中心光点（blip）：偏向右上某个环上
  const bx = 0.44, by = -0.4;
  const bd = Math.hypot(u - bx, v - by);
  const blip = smooth(0.08, 0.0, bd);
  if (blip > 0) over(out, 130, 240, 180, blip * bgA);
  const halo = smooth(0.16, 0.06, bd) * 0.4;
  if (halo > 0) over(out, 130, 240, 180, halo * bgA);

  // 圆心
  const cd = Math.hypot(u, v);
  over(out, 235, 245, 245, smooth(0.05, 0.0, cd) * bgA);

  return out;
}

function render(size, ss = 3) {
  const R = size * ss;
  const big = Buffer.alloc(R * R * 4);
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const u = ((x + 0.5) / R) * 2 - 1;
      const v = ((y + 0.5) / R) * 2 - 1;
      const c = shade(u, v, R);
      const i = (y * R + x) * 4;
      big[i] = Math.round(clamp(c[0], 0, 255));
      big[i + 1] = Math.round(clamp(c[1], 0, 255));
      big[i + 2] = Math.round(clamp(c[2], 0, 255));
      big[i + 3] = Math.round(clamp(c[3], 0, 1) * 255);
    }
  }
  // 下采样（盒式平均）做抗锯齿
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * R + (x * ss + sx)) * 4;
          const pa = big[i + 3];
          r += big[i] * pa;
          g += big[i + 1] * pa;
          b += big[i + 2] * pa;
          a += pa;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / (ss * ss));
    }
  }
  return encodePng(size, size, out);
}

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const targets = [
  ['icon.png', 1024, 2],
  ['tray.png', 64, 4],
  ['tray@2x.png', 128, 4]
];

for (const [name, size, ss] of targets) {
  const png = render(size, ss);
  fs.writeFileSync(path.join(assetsDir, name), png);
  console.log(`generated assets/${name} (${size}x${size}, ${png.length} bytes)`);
}
