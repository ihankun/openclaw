#!/usr/bin/env node
/**
 * Generate a placeholder 22x22 tray icon for macOS menu bar.
 * Saves to apps/electron/assets/tray-icon.png
 * Replace this file with your own design when ready.
 * Skips if a custom icon already exists at assets/tray-icon.png
 */
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "assets", "tray-icon.png");

// Skip if custom icon already exists
if (existsSync(OUT)) {
  console.log(`[tray-icon] Custom icon exists at ${OUT}, skipping generation.`);
  process.exit(0);
}

const SIZE = 22;
const cx = SIZE / 2;
const cy = SIZE / 2;
const r = SIZE / 2 - 1;

// RGBA pixel data (white circle on transparent)
const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx + 0.5;
    const dy = y - cy + 0.5;
    if (dx * dx + dy * dy <= r * r) {
      const i = (y * SIZE + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }
  }
}

// Build PNG manually
function crc32(buf) {
  let c = 0xffffffff;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let cc = n;
    for (let k = 0; k < 8; k++) {
      cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
    }
    table[n] = cc;
  }
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeB, data, crcB]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);  // width
ihdr.writeUInt32BE(SIZE, 4); // height
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
ihdr[10] = 0; // deflate
ihdr[11] = 0; // default filter
ihdr[12] = 0; // no interlace

// IDAT: filter byte (0=none) per row + pixels
const rawRows = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const off = y * (1 + SIZE * 4);
  rawRows[off] = 0; // filter: None
  pixels.copy(rawRows, off + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const compressed = deflateSync(rawRows);

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  signature,
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`Tray icon created: ${OUT}`);
