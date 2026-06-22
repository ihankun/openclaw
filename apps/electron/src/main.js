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
const os = require("node:os");

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
// Electron Config
// ============================================================================
const ELECTRON_CONFIG_DIR = path.join(os.homedir(), ".openclaw", "electron");
const ELECTRON_CONFIG_PATH = path.join(ELECTRON_CONFIG_DIR, "config.json");
const ELECTRON_CONFIG_DEFAULTS = {
  hideDockOnClose: false,
};

let electronConfig = { ...ELECTRON_CONFIG_DEFAULTS };

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
// Electron Config
// ============================================================================

function loadElectronConfig() {
  try {
    if (fs.existsSync(ELECTRON_CONFIG_PATH)) {
      const raw = fs.readFileSync(ELECTRON_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      electronConfig = { ...ELECTRON_CONFIG_DEFAULTS, ...parsed };
      log("Config loaded from", ELECTRON_CONFIG_PATH, JSON.stringify(electronConfig));
    } else {
      electronConfig = { ...ELECTRON_CONFIG_DEFAULTS };
      log("Config not found, using defaults");
    }
  } catch (err) {
    log("Error loading config:", err.message);
    electronConfig = { ...ELECTRON_CONFIG_DEFAULTS };
  }
}

function saveElectronConfig(partial) {
  try {
    const updated = { ...electronConfig, ...partial };
    fs.mkdirSync(ELECTRON_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ELECTRON_CONFIG_PATH, JSON.stringify(updated, null, 2), "utf-8");
    electronConfig = updated;
    log("Config saved:", JSON.stringify(updated));
    return { success: true };
  } catch (err) {
    log("Error saving config:", err.message);
    return { success: false, error: err.message };
  }
}

function applyDockBehavior() {
  if (!isMac) return;
  if (electronConfig.hideDockOnClose && mainWindow && !mainWindow.isVisible()) {
    app.dock.hide();
  } else {
    app.dock.show();
  }
}

// ============================================================================
// Initialization Check
// ============================================================================

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

function resolveRendererPath(name) {
  return path.join(__dirname, "renderer", name);
}

// ============================================================================
// Loading Page
// ============================================================================

function loadingPageURL() {
  return resolveRendererPath("loading.html");
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
// Settings Window
// ============================================================================

let settingsWindow = null;

function settingsPageURL() {
  return resolveRendererPath("settings.html");
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 260,
    resizable: false,
    title: "OpenClaw 设置",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Load settings page from renderer file
  settingsWindow.loadFile(settingsPageURL());

  settingsWindow.once("ready-to-show", () => {
    settingsWindow.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  // Prevent hiding to tray for settings window
  settingsWindow.on("close", (event) => {
    if (!settingsWindow) return;
    // Allow normal close (no hide-to-tray for settings)
  });
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

const TITLE_BAR_PADDING_CSS = `
  /* Only push the left sidebar nav down by 38px to clear macOS traffic lights.
     The right column (topbar + content) stays at its natural position,
     avoiding the empty gap the user reported. */
  .shell-nav {
    padding-top: 38px !important;
  }
  /* Mobile: .shell-nav becomes position: fixed — use top offset instead */
  @media (max-width: 1100px) {
    .shell-nav {
      top: 38px !important;
      padding-top: 0 !important;
    }
  }
  /* Drag region: top 38px of the sidebar */
  .shell-nav {
    position: relative !important;
  }
  .shell-nav::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 38px;
    -webkit-app-region: drag;
    z-index: 100;
    pointer-events: auto;
  }
`;

function injectTitleBarPadding(contents) {
  try {
    contents.insertCSS(TITLE_BAR_PADDING_CSS);
  } catch (err) {
    log("Error injecting title bar CSS:", err.message);
  }
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    applyDockBehavior();
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
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile(loadingPageURL());

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Inject title-bar padding when gateway page loads
  mainWindow.webContents.on("did-navigate", (_event, url) => {
    if (url.includes(GATEWAY_HOST)) {
      injectTitleBarPadding(mainWindow.webContents);
    }
  });

  // Also catch in-page navigations and sub-frames
  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow.webContents.getURL();
    if (url.includes(GATEWAY_HOST)) {
      injectTitleBarPadding(mainWindow.webContents);
    }
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
      applyDockBehavior();
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
          applyDockBehavior();
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
      label: "配置",
      click: () => createSettingsWindow(),
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
              { label: `关于 ${app.name}`, role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { label: "隐藏", role: "hide" },
              { label: "隐藏其他", role: "hideOthers" },
              { label: "显示全部", role: "unhide" },
              { type: "separator" },
              { label: "退出", role: "quit" },
            ],
          }),
        ]
      : []),
    new MenuItem({
      label: "文件",
      submenu: [
        { label: "重启网关", accelerator: "CmdOrCtrl+Shift+R", click: () => restartGateway() },
        { label: "配置", accelerator: "CmdOrCtrl+,", click: () => createSettingsWindow() },
        { type: "separator" },
        { label: "关闭窗口", accelerator: "CmdOrCtrl+W", click: () => { if (mainWindow) mainWindow.close(); } },
      ],
    }),
    new MenuItem({
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "CmdOrCtrl+Shift+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "删除", role: "delete" },
        { type: "separator" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    }),
    new MenuItem({
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", role: "reload" },
        { label: "强制重新加载", accelerator: "CmdOrCtrl+Shift+R", role: "forceReload" },
        { type: "separator" },
        { label: "重置缩放", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "放大", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" },
        { type: "separator" },
        { label: "开发者工具", accelerator: "CmdOrCtrl+Shift+I", role: "toggleDevTools" },
      ],
    }),
    new MenuItem({
      label: "窗口",
      submenu: [
        { label: "最小化", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { label: "置于顶层", role: "front" },
      ],
    }),
    new MenuItem({
      label: "帮助",
      submenu: [
        { label: "OpenClaw 文档", click: () => shell.openExternal("https://docs.openclaw.ai") },
        { label: "报告问题", click: () => shell.openExternal("https://github.com/openclaw/openclaw/issues") },
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
  
  // Config
  ipcMain.handle("config:get", () => ({ ...electronConfig }));
  ipcMain.handle("config:save", (_event, partial) => {
    const result = saveElectronConfig(partial);
    // If hideDockOnClose changed, apply immediately
    if (result.success && "hideDockOnClose" in partial) {
      applyDockBehavior();
    }
    return result;
  });
}

// ============================================================================
// Lifecycle
// ============================================================================

async function onAppReady() {
  loadElectronConfig();
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
