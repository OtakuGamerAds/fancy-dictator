// Draws build/icon.png (512×512): T3's blue with a white mic, like the tray icon.
// electron-builder turns it into the installer and app .ico. Run: node scripts/make-icon.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SIZE = 512;
const s = SIZE / 32; // drawn on the tray icon's 32-unit grid
const rgba = Buffer.alloc(SIZE * SIZE * 4);
const cover = (inside) => Math.max(0, Math.min(1, inside + 0.5));

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const x = (px + 0.5) / s;
    const y = (py + 0.5) / s;
    // A rounded square background (squircle-ish), like modern app icons.
    const r = 7;
    const dx = Math.max(Math.abs(x - 16) - (16 - r), 0);
    const dy = Math.max(Math.abs(y - 16) - (16 - r), 0);
    const bg = cover((r - Math.hypot(dx, dy)) * s);
    // Mic: capsule head, U-shaped holder, stem and base.
    const cy = Math.max(11.5, Math.min(14.5, y));
    const head = cover((4 - Math.hypot(x - 15.5 - 0.5, y - cy)) * s);
    const ring = Math.abs(Math.hypot(x - 16, y - 14) - 6.5);
    const holder = y > 14 && y < 21.5 ? cover((1 - ring) * s) : 0;
    const stem = Math.abs(x - 16) < 1 && y > 20 && y < 24.5 ? 1 : 0;
    const base = Math.abs(y - 24.5) < 1 && Math.abs(x - 16) < 4 ? 1 : 0;
    const white = Math.min(1, Math.max(head, holder, stem, base));
    const i = (py * SIZE + px) * 4;
    rgba[i] = Math.round(0x3b * (1 - white) + 255 * white);
    rgba[i + 1] = Math.round(0x6e * (1 - white) + 255 * white);
    rgba[i + 2] = Math.round(0xf5 * (1 - white) + 255 * white);
    rgba[i + 3] = Math.round(255 * bg);
  }
}

// Minimal PNG encoder: IHDR + one IDAT (filter 0 per row) + IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(import.meta.dirname, "..", "build", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log("wrote", out);
