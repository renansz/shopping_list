/**
 * Gera os ícones PNG do app sem depender de nenhuma biblioteca:
 * desenha as formas por distância (SDF) com anti-aliasing por supersampling
 * e escreve o PNG na mao (chunks + deflate do próprio Node).
 *
 *   npm run icons
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const GREEN_DARK = [12, 94, 61];
const GREEN_LIGHT = [31, 178, 119];
const WHITE = [255, 255, 255];

/* ------------------------------------------------------------- formas -- */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function sdRoundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Arco: meio anel aberto para baixo (a alca da sacola). */
function sdArcTop(px, py, cx, cy, radius) {
  const dx = px - cx;
  const dy = py - cy;
  if (dy > 0) {
    // abaixo do centro: distância até as pontas do arco
    return Math.min(Math.hypot(dx - radius, dy), Math.hypot(dx + radius, dy));
  }
  return Math.abs(Math.hypot(dx, dy) - radius);
}

/**
 * Desenha o ícone em coordenadas 0..1.
 * @param {boolean} fullBleed true para maskable/apple: fundo ocupa o quadrado todo
 */
function shade(x, y, fullBleed) {
  const bgDistance = fullBleed
    ? -1
    : sdRoundedRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.235);
  if (bgDistance > 0.004) return null;

  // Fundo em degrade diagonal.
  const mix = clamp((x + y) / 2, 0, 1);
  const bg = GREEN_DARK.map((channel, index) => channel + (GREEN_LIGHT[index] - channel) * mix);

  // Glifo menor no maskable: precisa caber na área segura circular.
  const scale = fullBleed ? 0.78 : 1;
  const gx = (x - 0.5) / scale + 0.5;
  const gy = (y - 0.5) / scale + 0.5;

  // Corpo da sacola.
  const body = sdRoundedRect(gx, gy, 0.5, 0.605, 0.225, 0.2, 0.06);
  const bodyOutline = Math.abs(body) - 0.032;

  // Alca.
  const handle = Math.abs(sdArcTop(gx, gy, 0.5, 0.405, 0.115)) - 0.03;

  // Tique dentro da sacola.
  const checkStroke = 0.036;
  const check =
    Math.min(
      sdSegment(gx, gy, 0.405, 0.6, 0.475, 0.668),
      sdSegment(gx, gy, 0.475, 0.668, 0.61, 0.535),
    ) - checkStroke;

  const glyph = Math.min(bodyOutline, handle, check);
  return { bg, glyph, bgDistance };
}

function renderPixel(x, y, fullBleed, pixelSize) {
  const shaded = shade(x, y, fullBleed);
  if (!shaded) return [0, 0, 0, 0];
  const { bg, glyph, bgDistance } = shaded;
  const edge = pixelSize * 0.75;
  const bgAlpha = fullBleed ? 1 : clamp(0.5 - bgDistance / edge, 0, 1);
  const glyphAlpha = clamp(0.5 - glyph / edge, 0, 1);
  const color = bg.map((channel, index) => channel + (WHITE[index] - channel) * glyphAlpha);
  return [...color.map(Math.round), Math.round(bgAlpha * 255)];
}

function renderIcon(size, { fullBleed = false, samples = 3 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const pixelSize = 1 / size;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          const [pr, pg, pb, pa] = renderPixel(x, y, fullBleed, pixelSize);
          const weight = pa / 255;
          r += pr * weight;
          g += pg * weight;
          b += pb * weight;
          a += pa;
        }
      }
      const total = samples * samples;
      const alpha = a / total;
      const norm = a > 0 ? a / 255 : 1;
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(r / norm);
      pixels[offset + 1] = Math.round(g / norm);
      pixels[offset + 2] = Math.round(b / norm);
      pixels[offset + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

/* ---------------------------------------------------------------- PNG -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(pixels, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- SVG -- */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Lista de compras">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c5e3d"/>
      <stop offset="1" stop-color="#1fb277"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="23.5" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="27.5" y="40.5" width="45" height="40" rx="6"/>
    <path d="M38.5 40.5a11.5 11.5 0 0 1 23 0"/>
    <path d="M40.5 60l7 6.8 13.5-13.3"/>
  </g>
</svg>
`;

/* --------------------------------------------------------------- main -- */

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), SVG);

const targets = [
  { file: 'icon-192.png', size: 192, fullBleed: false },
  { file: 'icon-512.png', size: 512, fullBleed: false },
  { file: 'maskable-192.png', size: 192, fullBleed: true },
  { file: 'maskable-512.png', size: 512, fullBleed: true },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true },
  { file: 'favicon-32.png', size: 32, fullBleed: false },
];

for (const target of targets) {
  const pixels = renderIcon(target.size, { fullBleed: target.fullBleed, samples: 4 });
  const png = encodePng(pixels, target.size);
  fs.writeFileSync(path.join(OUT_DIR, target.file), png);
  console.log(`${target.file.padEnd(24)} ${String(png.length).padStart(7)} bytes`);
}
console.log('icon.svg                  pronto');
