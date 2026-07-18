#!/usr/bin/env node

/**
 * Download Node.js binary for Electron packaging.
 *
 * Downloads the Node.js prebuilt binary for the current platform
 * and extracts it to apps/electron/resources/node/ so electron-builder
 * can bundle it via extraResources.
 *
 * Usage: node scripts/download-node.mjs [version]
 *   Default version: v22.14.0 (LTS)
 */

import { chmodSync, createWriteStream, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { get } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = path.resolve(__dirname, "..", "resources");
const NODE_DIR = path.join(RESOURCES_DIR, "node");
const VERSION_FILE = path.join(RESOURCES_DIR, ".node-version");
// Minimum required by openclaw.mjs is v22.19+. Default to latest v22 LTS.
const DEFAULT_VERSION = "v22.19.0";

const PLATFORM_MAP = { darwin: "darwin", linux: "linux", win32: "win" };
const ARCH_MAP = { arm64: "arm64", x64: "x64" };

const version = process.argv[2] || DEFAULT_VERSION;
const plat = PLATFORM_MAP[process.platform];
const arch = ARCH_MAP[process.arch];

if (!plat || !arch) {
  console.error(`Unsupported platform: ${process.platform} ${process.arch}`);
  process.exit(1);
}

const ext = plat === "win" ? "zip" : "tar.gz";
const dirName = `node-${version}-${plat}-${arch}`;
const fileName = `${dirName}.${ext}`;

// Use npmmirror (China) as primary, fallback to official
const MIRRORS = [
  `https://npmmirror.com/mirrors/node/${version}/${fileName}`,
  `https://registry.npmmirror.com/-/binary/node/${version}/${fileName}`,
  `https://nodejs.org/dist/${version}/${fileName}`,
];
const url = MIRRORS[0];
const archivePath = path.join(RESOURCES_DIR, `${dirName}.${ext}`);

// ---- helpers ----

async function getCurrentVersion() {
  try {
    return (await readFile(VERSION_FILE, "utf-8")).trim();
  } catch {
    return null;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        const redirect = new URL(res.headers.location, url).toString();
        console.log(`  Redirect -> ${redirect}`);
        return downloadFile(redirect, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        rmSync(dest, { force: true });
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    };
    get(url, handleResponse).on("error", (err) => { file.close(); reject(err); });
  });
}

async function downloadWithFallbacks(dest) {
  for (let i = 0; i < MIRRORS.length; i++) {
    const mirrorUrl = MIRRORS[i];
    console.log(`  Trying mirror ${i + 1}/${MIRRORS.length}: ${mirrorUrl}`);
    try {
      await downloadFile(mirrorUrl, dest);
      return;
    } catch (err) {
      console.warn(`  Failed: ${err.message}`);
      if (i < MIRRORS.length - 1) {
        console.log(`  Falling back to next mirror...`);
      }
    }
  }
  throw new Error(`All mirrors failed. Tried:\n${MIRRORS.map(u => `  - ${u}`).join("\n")}`);
}

// ---- main ----

const currentVersion = await getCurrentVersion();
if (currentVersion === version && existsSync(path.join(NODE_DIR, "bin", "node"))) {
  console.log(`Node.js ${version} already downloaded for ${plat}-${arch}. Skipping.`);
  process.exit(0);
}

console.log(`Downloading Node.js ${version} for ${plat}-${arch}...`);
mkdirSync(RESOURCES_DIR, { recursive: true });
if (existsSync(NODE_DIR)) rmSync(NODE_DIR, { recursive: true });

try {
  await downloadWithFallbacks(archivePath);

  console.log("  Extracting...");
  mkdirSync(NODE_DIR, { recursive: true });

  if (plat === "win") {
    // Use PowerShell Expand-Archive on Windows
    const psPath = archivePath.replace(/\\/g, '\\\\');
    const psDest = RESOURCES_DIR.replace(/\\/g, '\\\\');
    execSync(`powershell -Command "Expand-Archive -Path '${psPath}' -DestinationPath '${psDest}' -Force"`, { stdio: "inherit" });
    
    // Move contents from extracted dir to node dir
    const extractedDir = path.join(RESOURCES_DIR, dirName);
    const entries = readdirSync(extractedDir);
    for (const entry of entries) {
      cpSync(path.join(extractedDir, entry), path.join(NODE_DIR, entry), { recursive: true });
    }
    rmSync(extractedDir, { recursive: true });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${RESOURCES_DIR}"`, { stdio: "inherit" });
    execSync(`mv "${RESOURCES_DIR}/${dirName}"/* "${NODE_DIR}"`, { stdio: "inherit" });
  }

  rmSync(archivePath);
  
  // Set executable permissions (skip on Windows)
  if (plat !== "win") {
    chmodSync(path.join(NODE_DIR, "bin", "node"), 0o755);
  }
  
  await writeFile(VERSION_FILE, version);

  console.log(`Node.js ${version} ready at ${NODE_DIR}`);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  if (existsSync(archivePath)) rmSync(archivePath);
  if (existsSync(NODE_DIR)) rmSync(NODE_DIR, { recursive: true });
  process.exit(1);
}
