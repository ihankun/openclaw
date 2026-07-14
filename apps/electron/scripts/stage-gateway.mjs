#!/usr/bin/env node
/**
 * Stage the OpenClaw gateway runtime for Electron packaging.
 *
 * Uses npm to create a self-contained runtime directory with flat
 * node_modules (no pnpm symlinks), following the same approach as k-claw.
 *
 * Usage: node scripts/stage-gateway.mjs
 */

import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const STAGING_DIR = path.resolve(__dirname, "..", "build-staging", "gateway");
const ELECTRON_PKG = path.resolve(__dirname, "..", "package.json");

// Sync version from root package.json to electron package.json
const rootPkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
const electronPkg = JSON.parse(readFileSync(ELECTRON_PKG, "utf-8"));
electronPkg.version = rootPkg.version;
writeFileSync(ELECTRON_PKG, JSON.stringify(electronPkg, null, 2) + "\n");
console.log(`[stage] Synced version: ${rootPkg.version}\n`);

console.log("[stage] Staging OpenClaw gateway runtime...\n");

// Clean
if (existsSync(STAGING_DIR)) rmSync(STAGING_DIR, { recursive: true });
mkdirSync(STAGING_DIR, { recursive: true });

// ── 1. Copy built artifacts ──
console.log("── Artifacts ──");
const REQUIRED = ["dist", "openclaw.mjs", "package.json", "SKILLs"];
const TEMPLATES = "docs/reference/templates";
const AGENT_TEMPLATES = "src/agents/templates";
for (const item of REQUIRED) {
  const src = path.join(PROJECT_ROOT, item);
  const dst = path.join(STAGING_DIR, item);
  if (!existsSync(src)) {
    console.error(`[stage] MISSING: ${src} — run "pnpm build" first`);
    process.exit(1);
  }
  cpSync(src, dst, { recursive: true, force: true });
  console.log(`  ✓ ${item}`);
}

// Copy workspace templates (needed by gateway for agent workspace init)
const tmplSrc = path.join(PROJECT_ROOT, TEMPLATES);
const tmplDst = path.join(STAGING_DIR, TEMPLATES);
if (existsSync(tmplSrc)) {
  mkdirSync(path.dirname(tmplDst), { recursive: true });
  cpSync(tmplSrc, tmplDst, { recursive: true, force: true });
  console.log(`  ✓ ${TEMPLATES}`);
} else {
  console.warn(`  ⚠ ${TEMPLATES} not found — gateway may fail to create workspaces`);
}

// Copy agent templates (HEARTBEAT.md etc., new in 2026.5.27)
const agentTmplSrc = path.join(PROJECT_ROOT, AGENT_TEMPLATES);
const agentTmplDst = path.join(STAGING_DIR, AGENT_TEMPLATES);
if (existsSync(agentTmplSrc)) {
  mkdirSync(path.dirname(agentTmplDst), { recursive: true });
  cpSync(agentTmplSrc, agentTmplDst, { recursive: true, force: true });
  console.log(`  ✓ ${AGENT_TEMPLATES}`);
} else {
  console.warn(`  ⚠ ${AGENT_TEMPLATES} not found`);
}

// ── 2. Strip devDependencies from package.json (npm install --omit=dev) ──
console.log("\n── Dependencies ──");
const pkgPath = path.join(STAGING_DIR, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
delete pkg.devDependencies;
delete pkg.scripts;

// Resolve workspace protocol references (pnpm-only) for npm compatibility.
// Local workspace packages are not published to npm, so we drop them from
// package.json and copy them from root node_modules after npm install.
const workspaceDropped = [];
if (pkg.dependencies) {
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    if (typeof version === "string" && version.startsWith("workspace:")) {
      delete pkg.dependencies[name];
      workspaceDropped.push(name);
    }
  }
}
if (workspaceDropped.length > 0) {
  console.log(`  ✓ dropped ${workspaceDropped.length} workspace deps, will copy from root node_modules`);
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// ── 3. npm install production deps (produces flat node_modules) ──
console.log("  Running npm install --omit=dev...");
try {
  execSync(
    "npm install --omit=dev --no-audit --no-fund --legacy-peer-deps",
    {
      cwd: STAGING_DIR,
      stdio: "inherit",
      timeout: 180_000,
      env: { ...process.env, NPM_CONFIG_LEGACY_PEER_DEPS: "true" },
    },
  );
  console.log("  ✓ production dependencies installed");
} catch (err) {
  console.error(`[stage] npm install failed: ${err.message}`);
  process.exit(1);
}

// ── 4. Copy dropped workspace packages from root node_modules ──
const stagingNodeModules = path.join(STAGING_DIR, "node_modules");
for (const name of workspaceDropped) {
  const src = path.join(PROJECT_ROOT, "node_modules", name);
  const dst = path.join(stagingNodeModules, name);
  if (existsSync(src)) {
    // Resolve pnpm symlink to real path
    const realSrc = realpathSync(src);
    if (existsSync(dst)) rmSync(dst, { recursive: true });
    cpSync(realSrc, dst, { recursive: true, force: true });
    console.log(`  ✓ copied workspace package: ${name}`);
  } else {
    console.warn(`  ⚠ cannot find workspace package in root node_modules: ${name}`);
  }
}

// ── 5. Remove .package-lock.json to save space ──
const lockFile = path.join(STAGING_DIR, "package-lock.json");
if (existsSync(lockFile)) rmSync(lockFile);

// ── 6. Summary ──
console.log("\n── Summary ──");

// Cross-platform directory size calculation
function getDirSize(dirPath) {
  let size = 0;
  try {
    const items = readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        try {
          size += statSync(fullPath).size;
        } catch {
          // Skip files that can't be accessed
        }
      }
    }
  } catch {
    // Skip directories that can't be accessed
  }
  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

const totalSize = getDirSize(STAGING_DIR);
console.log(`  Location: ${STAGING_DIR}`);
console.log(`  Size: ${formatBytes(totalSize)}`);
