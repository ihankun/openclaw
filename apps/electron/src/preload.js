/**
 * OpenClaw Desktop - Preload Script
 *
 * Bridges the isolated renderer process with the Electron main process
 * via contextBridge. The exposed `window.electronAPI` is the only way
 * for the web UI to interact with native capabilities.
 */
const { contextBridge, ipcRenderer } = require("electron");

const electronAPI = {
  /** Get current gateway status. */
  getGatewayStatus: () => ipcRenderer.invoke("gateway:status"),

  /** Restart the gateway process. */
  restartGateway: () => ipcRenderer.invoke("gateway:restart"),

  /** Get app info (version, dev mode, etc.). */
  getAppInfo: () => ipcRenderer.invoke("app:info"),

  /** Open a URL in the system browser. */
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  /** Run setup command (for first-time initialization). */
  runSetup: () => ipcRenderer.invoke("run-setup"),

  /** Run setup command with custom args array. */
  runSetupWithArgs: (args) => ipcRenderer.invoke("run-setup-args", args),

  /** Write provider config directly to openclaw.json. */
  writeProviderConfig: (provider, apiKey) => ipcRenderer.invoke("write-provider-config", { provider, apiKey }),

  /** Notify that setup is complete. */
  notifySetupComplete: () => ipcRenderer.send("setup-complete"),

  /** Quit the application. */
  quitApp: () => ipcRenderer.send("quit-app"),

  /** Load electron config. */
  getConfig: () => ipcRenderer.invoke("config:get"),

  /** Save electron config (partial merge). */
  saveConfig: (partial) => ipcRenderer.invoke("config:save", partial),

  /** Listen for gateway-ready event. Returns unsubscribe function. */
  onGatewayReady: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("gateway:ready", handler);
    return () => ipcRenderer.removeListener("gateway:ready", handler);
  },

  /** Listen for gateway-exited event. Returns unsubscribe function. */
  onGatewayExited: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("gateway:exited", handler);
    return () => ipcRenderer.removeListener("gateway:exited", handler);
  },

  /** Listen for gateway-progress event (startup stages). Returns unsubscribe function. */
  onGatewayProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("gateway:progress", handler);
    return () => ipcRenderer.removeListener("gateway:progress", handler);
  },

  /** Minimize the window. */
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),

  /** Maximize or restore the window. Returns new maximized state. */
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),

  /** Close the window. */
  closeWindow: () => ipcRenderer.invoke("window:close"),

  /** Listen for maximize state changes. Returns unsubscribe function. */
  onMaximizeChange: (callback) => {
    const handler = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximize-changed", handler);
    return () => ipcRenderer.removeListener("window:maximize-changed", handler);
  },

  /** Detect if running inside Electron. */
  isElectron: () => true,

  /** Current platform (e.g. "win32", "darwin", "linux"). */
  platform: () => process.platform,

  /** Get the gateway URL. */
  getGatewayUrl: () => "http://127.0.0.1:18789",
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
