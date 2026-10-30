// Generates PNG app icons with no native dependencies (pure Node + zlib).
// Draws the same fish mark as public/icon.svg on a solid green background.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [0x0f, 0x51, 0x32];
const FG = [0xe8, 0xf5, 0xec];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inTriangle(px, py, a, b, c) {
  const s = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  const t = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  if (s < 0 !== t < 0 && s !== 0 && t !== 0) return false;
  const d = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  return d === 0 || d < 0 === s + t <= 0;
}

function pixel(u, v) {
  // u, v in 512-space
  const eye = inEllipse(u, v, 150, 238, 14, 14);
  if (eye) return BG;
  const body = inEllipse(u, v, 236, 256, 150, 82);
  const tailA = inTriangle(u, v, [352, 256], [446, 186], [420, 256]);
  const tailB = inTriangle(u, v, [352, 256], [420, 256], [446, 326]);
  return body || tailA || tailB ? FG : BG;
}

function makePng(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const scale = 512 / size;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel((x + 0.5) * scale, (y + 0.5) * scale);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(outDir, name), makePng(size));
  console.log(`wrote public/${name}`);
}
