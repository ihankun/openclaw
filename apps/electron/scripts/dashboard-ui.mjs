#!/usr/bin/env node

import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptDir, "..", "..", "..");
const dashboardDist = path.join(projectRoot, "dashboard", "dist");

function assertDashboardBuild() {
  const indexPath = path.join(dashboardDist, "index.html");
  const assetsPath = path.join(dashboardDist, "assets");
  if (
    !existsSync(indexPath) ||
    !existsSync(assetsPath) ||
    !statSync(assetsPath).isDirectory()
  ) {
    throw new Error(
      `Electron dashboard assets are missing at ${dashboardDist}. Run \`pnpm electron:ui:build\` first.`,
    );
  }
}

export function installDashboardControlUi(targetDir) {
  assertDashboardBuild();
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(dashboardDist, targetDir, { recursive: true, force: true });
  console.log(`[dashboard] Installed Control UI assets at ${targetDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv[2] !== "--dev" || process.argv.length !== 3) {
    console.error("Usage: node apps/electron/scripts/dashboard-ui.mjs --dev");
    process.exit(1);
  }
  installDashboardControlUi(path.join(projectRoot, "dist", "control-ui"));
}
