/**
 * OpenClaw Desktop - Electron Main Process
 *
 * Architecture (Path B):
 * - Electron manages the native window and tray icon
 * - Gateway runs as a child_process using a bundled or system Node.js
 * - The window loads the OpenClaw control UI via http:// once gateway is ready
 * - Closing the window hides to tray; gateway keeps running
 */
const { app, BrowserWindow, Menu, MenuItem, ipcMain, shell, dialog, Tray, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const process = require("node:process");

// ============================================================================
// Debug Logging (for packaged-mode troubleshooting)
// ============================================================================
const LOG_PATH = app.isPackaged
  ? path.join(app.getPath("userData"), "electron.log")
  : null;
function log(...args) {
  const msg = `[electron] ${args.join(" ")}`;
  if (LOG_PATH) {
    try { fs.appendFileSync(LOG_PATH, msg + "\n"); } catch {}
  }
  console.log(msg);
}

// ============================================================================
// Constants
// ============================================================================
const GATEWAY_PORT = 18789;
const GATEWAY_HOST = "127.0.0.1";
const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;
const GATEWAY_STARTUP_TIMEOUT_MS = 30_000;
const GATEWAY_HEALTH_CHECK_INTERVAL_MS = 500;
const GATEWAY_FORCE_KILL_TIMEOUT_MS = 5_000;

const isDevelopment = !app.isPackaged || process.env.NODE_ENV === "development";
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

// ============================================================================
// State
// ============================================================================
let gatewayProcess = null;
let mainWindow = null;
let appIcon = null;
let gatewayStarting = false;
let gatewayReady = false;
let needsSetup = false; // Track if initialization is needed

// ============================================================================
// Path Resolution
// ============================================================================

function resolveProjectRoot() {
  if (isDevelopment) {
    return path.resolve(__dirname, "..", "..", "..");
  }
  return path.join(process.resourcesPath, "gateway");
}

function resolveOpenClawEntry() {
  return path.join(resolveProjectRoot(), "openclaw.mjs");
}

function resolveTrayIcon() {
  // In packaged apps, the file is unpacked alongside app.asar
  const candidates = [
    path.join(__dirname, "..", "assets", "tray-icon.png"),
    // asarUnpack path: alongside app.asar
    path.join(__dirname.replace(".asar", ""), "..", "assets", "tray-icon.png"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// ============================================================================
// Initialization Check
// ============================================================================

const os = require("node:os");

function checkNeedsSetup() {
  try {
    // Use os.homedir() for all platforms - matches OpenClaw core behavior
    // Config is always at ~/.openclaw/openclaw.json
    const homedir = os.homedir();
    const stateDir = path.join(homedir, ".openclaw");
    const configPath = path.join(stateDir, "openclaw.json");
    const exists = fs.existsSync(configPath);
    
    log(`[setup-check] homedir: ${homedir}`);
    log(`[setup-check] stateDir: ${stateDir}`);
    log(`[setup-check] configPath: ${configPath}`);
    log(`[setup-check] exists: ${exists}`);
    
    return !exists;
  } catch (err) {
    log("Error checking setup:", err.message);
    return true; // Assume needs setup on error
  }
}

function setupPageURL() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin:0; display:flex; align-items:center; justify-content:center;
           height:100vh; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
           background:#1a1a2e; color:#e0e0e0; }
    .container { text-align:center; max-width:600px; padding:40px; }
    h1 { color:#6c63ff; margin-bottom:20px; }
    p { color:#aaa; line-height:1.6; margin-bottom:30px; }
    .btn { background:#6c63ff; color:white; border:none; padding:12px 30px;
           border-radius:6px; cursor:pointer; font-size:16px; margin:10px; }
    .btn:hover { background:#5a52d5; }
    .btn-secondary { background:#333; }
    .btn-secondary:hover { background:#444; }
    .status { margin-top:20px; color:#888; font-size:14px; min-height:20px; }
    .error { color:#ff6b6b; }
    .success { color:#51cf66; }
  </style>
</head>
<body>
  <div class="container">
    <h1>欢迎使用 OpenClaw</h1>
    <p>首次使用需要进行初始化配置，这将创建配置文件和 workspace 目录。</p>
    <div>
      <button class="btn" id="setupBtn">开始初始化</button>
      <button class="btn btn-secondary" id="quitBtn">退出</button>
    </div>
    <div class="status" id="status"></div>
  </div>
  <script>
    const statusEl = document.getElementById('status');

    document.getElementById('setupBtn').addEventListener('click', async () => {
      document.getElementById('setupBtn').disabled = true;
      statusEl.textContent = '正在初始化...';
      statusEl.className = 'status';

      try {
        const result = await window.electronAPI.runSetup();
        if (result.success) {
          statusEl.textContent = '初始化完成！正在启动网关...';
          statusEl.className = 'status success';
          setTimeout(() => {
            window.electronAPI.notifySetupComplete();
          }, 1500);
        } else {
          statusEl.textContent = '初始化失败：' + (result.error || '未知错误');
          statusEl.className = 'status error';
          document.getElementById('setupBtn').disabled = false;
        }
      } catch (err) {
        statusEl.textContent = '初始化出错：' + err.message;
        statusEl.className = 'status error';
        document.getElementById('setupBtn').disabled = false;
      }
    });
    
    document.getElementById('quitBtn').addEventListener('click', () => {
      window.electronAPI.quitApp();
    });
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// ============================================================================
// Loading Page
// ============================================================================

function loadingPageURL() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin:0; display:flex; align-items:center; justify-content:center;
           height:100vh; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
           background:#1a1a2e; color:#e0e0e0; }
    .spinner { width:40px; height:40px; border:4px solid #333; border-top-color:#6c63ff;
               border-radius:50%; animation:spin .8s linear infinite; margin:0 auto 20px; }
    @keyframes spin { to { transform:rotate(360deg); } }
    p { color:#888; font-size:14px; }
  </style>
</head>
<body><div style="text-align:center;">
  <div class="spinner"></div>
  <h2>正在启动 OpenClaw 网关...</h2>
  <p>请稍候，网关启动中</p>
</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// ============================================================================
// Node.js Binary
// ============================================================================

function resolveNodeBinary() {
  // System Node.js first (user's v24.8.0 — matches their working setup)
  const systemCandidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    path.join(process.env.HOME || "", ".nvm/versions/node", "v24.8.0", "bin", "node"),
    path.join(process.env.HOME || "", ".nvm/versions/node", "v24", "bin", "node"),
    path.join(process.env.HOME || "", ".nvm/versions/node", "v23", "bin", "node"),
    path.join(process.env.HOME || "", ".nvm/versions/node", "v22", "bin", "node"),
  ];
  for (const c of systemCandidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fallback: bundled Node.js
  const bundledPath = isWindows
    ? path.join(process.resourcesPath, "node", "node.exe")
    : path.join(process.resourcesPath, "node", "bin", "node");
  if (fs.existsSync(bundledPath)) return bundledPath;

  // Last resort: PATH
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    const bin = path.join(dir, "node" + (isWindows ? ".exe" : ""));
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

// ============================================================================
// Gateway
// ============================================================================

function gatewayURL() {
  return `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
}

async function checkGatewayHealth() {
  return new Promise((resolve) => {
    const req = http.get(gatewayURL(), { timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForGatewayReady() {
  const deadline = Date.now() + GATEWAY_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkGatewayHealth()) return true;
    await new Promise((r) => setTimeout(r, GATEWAY_HEALTH_CHECK_INTERVAL_MS));
  }
  return false;
}

function startGateway() {
  if (gatewayProcess || gatewayStarting) return;

  gatewayStarting = true;
  gatewayReady = false;

  const entryPath = resolveOpenClawEntry();
  const nodePath = resolveNodeBinary();

  if (!fs.existsSync(entryPath)) {
    dialog.showErrorBox("Gateway Error", `openclaw.mjs not found:\n${entryPath}\n\nRun "pnpm build" first.`);
    gatewayStarting = false;
    return;
  }
  if (!nodePath) {
    dialog.showErrorBox("Node.js Not Found", "Cannot find Node.js v22+.\nPlease install Node.js and try again.");
    gatewayStarting = false;
    return;
  }

  const cwd = isDevelopment ? resolveProjectRoot() : path.join(process.resourcesPath, "gateway");
  const env = {
    ...process.env,
    OPENCLAW_GATEWAY_PORT: String(GATEWAY_PORT),
    OPENCLAW_NO_RESPAWN: "1",
    OPENCLAW_ELECTRON_MODE: "1",
  };

  if (!isDevelopment) {
    log("entryPath:", entryPath, "exists:", fs.existsSync(entryPath));
    log("nodePath:", nodePath, "exists:", fs.existsSync(nodePath));
    log("cwd:", cwd);
    log("resourcesPath:", process.resourcesPath);
  }

  gatewayProcess = spawn(nodePath, [entryPath, "gateway", "--auth", "none"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

  log("Gateway spawned:", path.basename(nodePath), "gateway --auth none");

  gatewayProcess.stdout.on("data", (data) => {
    process.stdout.write(`[gateway] ${data}`);
    if (!gatewayReady && data.includes(GATEWAY_HOST) && data.includes(String(GATEWAY_PORT))) {
      gatewayReady = true;
      gatewayStarting = false;
      notifyGatewayReady();
    }
  });

  gatewayProcess.stderr.on("data", (data) => {
    process.stderr.write(`[gateway] ${data}`);
  });

  gatewayProcess.on("error", (err) => {
    dialog.showErrorBox("Gateway Error", `Failed to start: ${err.message}`);
    cleanupGateway();
  });

  gatewayProcess.on("exit", (code, signal) => {
    cleanupGateway();
    if (mainWindow && !app.isQuitting) {
      mainWindow.webContents.send("gateway:exited", { code, signal });
    }
  });

  waitForGatewayReady().then((healthy) => {
    if (healthy && !gatewayReady) {
      gatewayReady = true;
      gatewayStarting = false;
      notifyGatewayReady();
    }
  });
}

function cleanupGateway() {
  gatewayProcess = null;
  gatewayStarting = false;
  gatewayReady = false;
}

function stopGateway() {
  if (!gatewayProcess) return;
  gatewayProcess.kill("SIGTERM");
  const timeout = setTimeout(() => {
    if (gatewayProcess) gatewayProcess.kill("SIGKILL");
  }, GATEWAY_FORCE_KILL_TIMEOUT_MS);
  gatewayProcess.on("exit", () => clearTimeout(timeout));
}

function restartGateway() {
  stopGateway();
  const check = setInterval(() => {
    if (!gatewayProcess) { clearInterval(check); startGateway(); }
  }, 100);
}

function notifyGatewayReady() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("gateway:ready", { port: GATEWAY_PORT, host: GATEWAY_HOST });
    mainWindow.loadURL(gatewayURL());
  }
}

// ============================================================================
// Window
// ============================================================================

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "OpenClaw",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(loadingPageURL());

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Auto-open DevTools on navigation failure (useful for packaged debugging)
  mainWindow.webContents.on("did-fail-load", (_event, _code, desc) => {
    log("Navigation failed:", desc);
    if (!isDevelopment) mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Close hides to tray instead of quitting
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ============================================================================
// Tray
// ============================================================================

function createTray() {
  const iconPath = resolveTrayIcon();
  if (!iconPath) return;
  const icon = nativeImage.createFromPath(iconPath);
  // Template image: macOS auto-inverts for light/dark menu bar
  icon.setTemplateImage(true);
  appIcon = new Tray(icon);
  appIcon.setToolTip("OpenClaw");

  appIcon.on("click", () => showMainWindow());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示 / 隐藏",
      click: () => {
        if (mainWindow && mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          showMainWindow();
        }
      },
    },
    {
      label: "重启网关",
      click: () => restartGateway(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  appIcon.setContextMenu(contextMenu);
}

// ============================================================================
// Menu
// ============================================================================

function createApplicationMenu() {
  const template = [
    ...(isMac
      ? [
          new MenuItem({
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          }),
        ]
      : []),
    new MenuItem({
      label: "File",
      submenu: [
        { label: "Restart Gateway", accelerator: "CmdOrCtrl+Shift+R", click: () => restartGateway() },
        { type: "separator" },
        { role: "close" },
      ],
    }),
    new MenuItem({
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "delete" },
        { type: "separator" }, { role: "selectAll" },
      ],
    }),
    new MenuItem({
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    }),
    new MenuItem({
      label: "Window",
      submenu: [
        { role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" },
      ],
    }),
    new MenuItem({
      role: "help",
      submenu: [
        { label: "OpenClaw Documentation", click: () => shell.openExternal("https://docs.openclaw.ai") },
        { label: "Report Issue", click: () => shell.openExternal("https://github.com/openclaw/openclaw/issues") },
      ],
    }),
  ];
  return Menu.buildFromTemplate(template);
}

// ============================================================================
// IPC
// ============================================================================

function setupIpcHandlers() {
  ipcMain.handle("gateway:status", () => ({
    running: gatewayProcess !== null, ready: gatewayReady,
    starting: gatewayStarting, port: GATEWAY_PORT, host: GATEWAY_HOST,
  }));
  ipcMain.handle("gateway:restart", () => { restartGateway(); return { success: true }; });
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(), name: app.name,
    isPackaged: app.isPackaged, isDevelopment,
  }));
  ipcMain.handle("shell:openExternal", async (_event, url) => {
    await shell.openExternal(url);
    return { success: true };
  });
  
  // Handle setup command
  ipcMain.handle("run-setup", async () => {
    try {
      const entryPath = resolveOpenClawEntry();
      const nodePath = resolveNodeBinary();
      
      if (!fs.existsSync(entryPath)) {
        return { success: false, error: "openclaw.mjs not found" };
      }
      if (!nodePath) {
        return { success: false, error: "Node.js not found" };
      }
      
      const cwd = isDevelopment ? resolveProjectRoot() : path.join(process.resourcesPath, "gateway");
      const env = { ...process.env, OPENCLAW_NO_RESPAWN: "1" };
      
      return await new Promise((resolve) => {
        const setupProcess = spawn(nodePath, [entryPath, "setup"], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"]
        });
        
        let output = "";
        let errorOutput = "";
        
        setupProcess.stdout.on("data", (data) => {
          output += data.toString();
          log("[setup]", data.toString().trim());
        });
        
        setupProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
          log("[setup error]", data.toString().trim());
        });
        
        setupProcess.on("close", (code) => {
          if (code === 0) {
            needsSetup = false;
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorOutput || `Exit code: ${code}` });
          }
        });
        
        setupProcess.on("error", (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  // Handle setup completion
  ipcMain.on("setup-complete", () => {
    needsSetup = false;
    startGateway();
  });
  
  // Handle quit
  ipcMain.on("quit-app", () => {
    app.isQuitting = true;
    app.quit();
  });
}

// ============================================================================
// Lifecycle
// ============================================================================

async function onAppReady() {
  Menu.setApplicationMenu(createApplicationMenu());
  setupIpcHandlers();
  createTray();
  
  // Check if setup is needed
  needsSetup = checkNeedsSetup();
  
  createMainWindow();
  
  if (needsSetup) {
    // Show setup page
    mainWindow.loadURL(setupPageURL());
  } else {
    // Start gateway normally
    startGateway();
  }
}

app.whenReady().then(onAppReady);

// Clicking the dock icon on macOS shows the existing window
app.on("activate", (_event, hasVisibleWindows) => {
  if (hasVisibleWindows) return;
  showMainWindow();
});

// Don't quit on close — keep gateway running and tray alive
app.on("window-all-closed", () => {
  // macOS keeps running by default anyway; on other platforms, stay alive for tray
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopGateway();
});

app.on("will-quit", () => {
  if (gatewayProcess) gatewayProcess.kill("SIGKILL");
  if (appIcon) appIcon.destroy();
});

process.on("uncaughtException", (error) => {
  console.error("[electron]", error);
  dialog.showErrorBox("Unexpected Error", error.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("[electron] Unhandled rejection:", reason);
});
