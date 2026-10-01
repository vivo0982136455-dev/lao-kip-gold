// Draw the app icons (PNG) for "install on the home screen" - no image library needed.
// The mark is the same as the logo in the menu: a dark kip sign (₭) on the gold brand colour.
// Usage: node scripts/make-icons.js   -> icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
// Run it again only when the logo or the colours change; the PNG files are part of the site.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "icons");
const GOLD = [224, 180, 60]; // --accent #e0b43c
const INK = [15, 17, 21]; // --page #0f1115
const SAMPLES = 4; // 4 x 4 samples per pixel = smooth edges

// The kip sign, in a 0..1 square: [x1, y1, x2, y2, stroke width]. Round line ends.
const STROKES = [
  [0.385, 0.25, 0.385, 0.75, 0.095], // stem
  [0.385, 0.535, 0.665, 0.25, 0.095], // upper arm
  [0.47, 0.45, 0.68, 0.75, 0.095], // lower arm
  [0.25, 0.5, 0.52, 0.5, 0.07], // the bar that makes K a kip sign
];

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Is the point inside a square with rounded corners (radius r, 0..0.5)?
function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// size in pixels; radius = corner radius of the gold square (0 = full square, for "maskable" icons that the phone
// cuts to its own shape); scale = size of the sign (maskable icons keep it inside the safe middle 80%)
function draw(size, { radius, scale }) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let ink = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          if (radius > 0 && !inRoundedSquare(u, v, radius)) continue;
          bg++;
          // the sign is drawn around the centre, scaled
          const gu = 0.5 + (u - 0.5) / scale;
          const gv = 0.5 + (v - 0.5) / scale;
          if (STROKES.some((s) => distToSegment(gu, gv, s) <= s[4] / 2)) ink++;
        }
      }
      const n = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      const a = bg / n;
      const k = bg ? ink / bg : 0;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(GOLD[c] * (1 - k) + INK[c] * k);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

// ---------- a minimal PNG writer (RGBA, 8 bit) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // colour type RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0 + the row
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ICONS = [
  ["icon-192.png", 192, { radius: 0.22, scale: 1 }],
  ["icon-512.png", 512, { radius: 0.22, scale: 1 }],
  ["icon-maskable-512.png", 512, { radius: 0, scale: 0.72 }], // full square, sign inside the safe zone
  ["apple-touch-icon.png", 180, { radius: 0, scale: 0.9 }], // iOS rounds the corners itself
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, shape] of ICONS) {
  const file = png(size, draw(size, shape));
  fs.writeFileSync(path.join(OUT_DIR, name), file);
  console.log(`${name}  ${size}x${size}  ${(file.length / 1024).toFixed(1)} KB`);
}
