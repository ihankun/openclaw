#!/usr/bin/env node
/**
 * Convert black background to white in all iconset PNGs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import path from "node:path";
import { execSync } from "node:child_process";

function crc32(buf) {
  let c = 0xffffffff;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let cc = n;
    for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
    table[n] = cc;
  }
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readPNG(buf) {
  const chunks = [];
  let pos = 8; // skip signature
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    chunks.push({ type, data });
    pos += 12 + len;
  }
  return chunks;
}

function buildPNG(width, height, raw, chunks) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = deflateSync(raw);
  const result = [signature];

  for (const c of chunks) {
    if (c.type === "IDAT") {
      // Replace with our modified data
      const lenB = Buffer.alloc(4);
      lenB.writeUInt32BE(compressed.length);
      const typeB = Buffer.from("IDAT");
      const crcData = Buffer.concat([typeB, compressed]);
      const crcB = Buffer.alloc(4);
      crcB.writeUInt32BE(crc32(crcData));
      result.push(lenB, typeB, compressed, crcB);
    } else if (c.type === "IEND") {
      const iend = Buffer.alloc(4);
      const typeEnd = Buffer.from("IEND");
      const crcEnd = Buffer.alloc(4);
      crcEnd.writeUInt32BE(crc32(typeEnd));
      result.push(iend, typeEnd, crcEnd);
    } else {
      // Copy other chunks as-is
      const lenB = Buffer.alloc(4);
      lenB.writeUInt32BE(c.data.length);
      const typeB = Buffer.from(c.type);
      const crcData = Buffer.concat([typeB, c.data]);
      const crcB = Buffer.alloc(4);
      crcB.writeUInt32BE(crc32(crcData));
      result.push(lenB, typeB, c.data, crcB);
    }
  }
  return Buffer.concat(result);
}

// Process all PNGs in the iconset
const iconset = "/tmp/claude-501/openclaw-iconset.iconset";
const { readdirSync } = await import("node:fs");

for (const name of readdirSync(iconset)) {
  if (!name.endsWith(".png")) continue;
  const p = path.join(iconset, name);
  const buf = readFileSync(p);

  const chunks = readPNG(buf);
  const ihdr = chunks.find(c => c.type === "IHDR");
  if (!ihdr) { console.log(`  skip ${name}: no IHDR`); continue; }

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];

  if (colorType !== 2 && colorType !== 6) { console.log(`  skip ${name}: unsupported color type ${colorType}`); continue; }

  // Decompress IDAT
  const idatData = Buffer.concat(chunks.filter(c => c.type === "IDAT").map(c => c.data));
  const raw = inflateSync(idatData);

  const bytesPerPixel = colorType === 6 ? 4 : 3;

  // Modify pixels: replace near-black background with white
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * bytesPerPixel);
    const filter = raw[rowStart];
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * bytesPerPixel;
      const r = raw[px], g = raw[px + 1], b = raw[px + 2];
      let process = false;
      if (colorType === 6) {
        const a = raw[px + 3];
        process = (r < 50 && g < 50 && b < 50 && a > 128);
      } else {
        process = (r < 50 && g < 50 && b < 50);
      }
      if (process) {
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
        if (colorType === 6) raw[px + 3] = 255;
      }
    }
  }

  const out = buildPNG(width, height, raw, chunks);
  writeFileSync(p, out);
  console.log(`  ✓ ${name} (${width}x${height})`);
}

console.log("\nAll icons processed. Now creating icns...");
execSync(`iconutil -c icns "${iconset}" -o "${process.cwd()}/resources/icon.icns"`, { stdio: "inherit" });
console.log("✓ resources/icon.icns created");
