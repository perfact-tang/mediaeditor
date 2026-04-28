import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const size = 1024;
const raw = Buffer.alloc((size * 4 + 1) * size);

for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < size; x += 1) {
    const i = row + 1 + x * 4;
    const vignette = Math.max(0, 1 - Math.hypot(x - size / 2, y - size / 2) / 760);
    const accent = x > 220 && x < 804 && y > 422 && y < 602;
    raw[i] = accent ? 0 : Math.round(16 + 12 * vignette);
    raw[i + 1] = accent ? 245 : Math.round(18 + 18 * vignette);
    raw[i + 2] = accent ? 160 : Math.round(22 + 18 * vignette);
    raw[i + 3] = 255;
  }
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crcInput = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0))
]);

const iconDir = join(process.cwd(), "src-tauri", "icons");
mkdirSync(iconDir, { recursive: true });
writeFileSync(join(iconDir, "icon.png"), png);
