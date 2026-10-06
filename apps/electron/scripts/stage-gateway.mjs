#!/usr/bin/env node
/**
 * Stage the OpenClaw gateway runtime for Electron packaging.
 *
 * Uses npm to create a self-contained runtime directory with flat
 * node_modules (no pnpm symlinks), following the same approach as k-claw.
 *
 * Usage: node scripts/stage-gateway.mjs
 */

import { cpSync, existsSync, globSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync, realpathSync } from "node:fs";
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
// `package.json` `files` is the authoritative list of what the runtime needs:
// it already covers the launcher modules (openclaw.mjs and its node-*.mjs
// imports), scripts/, patches/, and the bundled skill trees. Deriving the copy
// list from it keeps staging from silently dropping a newly added requirement.
console.log("── Artifacts ──");
const REQUIRED = (rootPkg.files ?? [])
  .filter((entry) => typeof entry === "string" && !entry.startsWith("!") && !entry.startsWith("."))
  .map((entry) => entry.replace(/\/+$/, ""));
// The Electron app supplies its own package.json for the staged runtime.
const SKIP_FROM_FILES = new Set(["package.json"]);
for (const item of REQUIRED) {
  if (SKIP_FROM_FILES.has(item)) continue;
  if (item.includes("*")) {
    // Glob entries (for example `dist/worker-artifacts/*.tar.gz`) are produced by
    // the npm prepack pipeline, not by `pnpm build`. Stage whatever exists and keep
    // going when the current build has nothing to copy.
    const matches = globSync(item, { cwd: PROJECT_ROOT });
    if (matches.length === 0) {
      console.warn(`  ⚠ ${item} — nothing to stage (npm prepack artifact, absent from pnpm build)`);
      continue;
    }
    for (const match of matches) {
      cpSync(path.join(PROJECT_ROOT, match), path.join(STAGING_DIR, match), {
        recursive: true,
        force: true,
      });
    }
    console.log(`  ✓ ${item} (${matches.length} ${matches.length === 1 ? "file" : "files"})`);
    continue;
  }
  const src = path.join(PROJECT_ROOT, item);
  const dst = path.join(STAGING_DIR, item);
  if (!existsSync(src)) {
    console.error(`[stage] MISSING: ${src} — run "pnpm build" first`);
    process.exit(1);
  }
  cpSync(src, dst, { recursive: true, force: true });
  console.log(`  ✓ ${item}`);
}
// The runtime reads its own package.json for dependencies/engines.
{
  const src = path.join(PROJECT_ROOT, "package.json");
  cpSync(src, path.join(STAGING_DIR, "package.json"), { force: true });
  console.log("  ✓ package.json");
}

// The gateway serves the Control UI from its own dist/control-ui, which is
// produced by the canonical `pnpm ui:build`. The staged runtime stays current
// because it is the same artifact tree; bundling a separate UI fork here would
// desync the runtime and UI build identities and make the gateway refuse to
// serve the UI.
const controlUiIndex = path.join(STAGING_DIR, "dist", "control-ui", "index.html");
if (!existsSync(controlUiIndex)) {
  console.error(
    `[stage] MISSING: ${controlUiIndex} — run "pnpm ui:build" before staging`,
  );
  process.exit(1);
}

// Workspace/agent templates (HEARTBEAT.md etc.) live in docs/reference/templates;
// the retired src/agents/templates tree is no longer resolved by the runtime.
const TEMPLATES = "docs/reference/templates";
const tmplSrc = path.join(PROJECT_ROOT, TEMPLATES);
const tmplDst = path.join(STAGING_DIR, TEMPLATES);
if (existsSync(tmplSrc)) {
  mkdirSync(path.dirname(tmplDst), { recursive: true });
  cpSync(tmplSrc, tmplDst, { recursive: true, force: true });
  console.log(`  ✓ ${TEMPLATES}`);
} else {
  console.warn(`  ⚠ ${TEMPLATES} not found — gateway may fail to create workspaces`);
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
