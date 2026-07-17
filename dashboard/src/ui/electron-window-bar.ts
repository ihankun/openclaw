// Control UI module implements the Electron Windows title bar.
// On Windows the Electron BrowserWindow uses titleBarStyle: "hidden", so the
// minimize/maximize/close controls must be rendered by the web UI. This component
// renders a top bar with those controls on the right and lets the user drag the
// frameless window from the bar. It is a no-op outside Electron on Windows.
import { LitElement, html, css } from "lit";
import { state } from "lit/decorators.js";

declare global {
  interface Window {
    electronAPI?: {
      isElectron: () => boolean;
      platform: () => string;
      minimizeWindow: () => void | Promise<void>;
      maximizeWindow: () => void | Promise<boolean>;
      closeWindow: () => void | Promise<void>;
    };
  }
}

function isElectronWindows(): boolean {
  const api = window.electronAPI;
  if (!api || typeof api.isElectron !== "function" || !api.isElectron()) {
    return false;
  }
  return api.platform() === "win32";
}

export class ElectronWindowBar extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      z-index: 9999;
      -webkit-app-region: drag;
      user-select: none;
      background: transparent;
      border-bottom: none;
    }

    .btn {
      width: 46px;
      height: 32px;
      border: none;
      background: transparent;
      color: #000;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-app-region: no-drag;
    }

    :host(.dark) .btn {
      color: #fff;
    }

    .btn:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    :host(.dark) .btn:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .btn:active {
      background: rgba(0, 0, 0, 0.1);
    }

    :host(.dark) .btn:active {
      background: rgba(255, 255, 255, 0.1);
    }

    .btn--close:hover {
      background: #c42b1c;
      color: white;
    }

    .btn svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
  `;

  @state() private maximized = false;

  private updateTheme() {
    const mode = document.documentElement.getAttribute("data-theme-mode");
    if (mode === "dark") {
      this.classList.add("dark");
    } else {
      this.classList.remove("dark");
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    this.updateTheme();
    const observer = new MutationObserver(() => this.updateTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-mode"],
    });
  }

  private minimize() {
    void window.electronAPI?.minimizeWindow();
  }

  private toggleMaximize() {
    const result = window.electronAPI?.maximizeWindow();
    if (result && typeof (result as Promise<boolean>).then === "function") {
      void (result as Promise<boolean>).then((value) => {
        this.maximized = Boolean(value);
      });
    }
  }

  private close() {
    void window.electronAPI?.closeWindow();
  }

  override updated() {
    if (this.maximized) {
      this.classList.add("maximized");
    } else {
      this.classList.remove("maximized");
    }
  }

  override render() {
    return html`
      <button class="btn" aria-label="Minimize" title="最小化" @click=${this.minimize}>
        <svg viewBox="0 0 1024 1024" aria-hidden="true">
          <path
            d="M863.7 552.5H160.3c-10.6 0-19.2-8.6-19.2-19.2v-41.7c0-10.6 8.6-19.2 19.2-19.2h703.3c10.6 0 19.2 8.6 19.2 19.2v41.7c0 10.6-8.5 19.2-19.1 19.2z"
          />
        </svg>
      </button>
      <button class="btn" aria-label="Maximize" title="最大化" @click=${this.toggleMaximize}>
        ${this.maximized
          ? html`<svg viewBox="0 0 1024 1024" aria-hidden="true">
              <path
                d="M394.7 869.3H154.7c-83.8 0-151.9-68.2-151.9-151.9V477.5c0-83.8 68.2-151.9 151.9-151.9h134.6v134.6H192.3v354.8c0 39.7 32.3 71.9 71.9 71.9h130.5V869.3zM629.3 460.2H764c83.8 0 151.9 68.2 151.9 151.9v239.9c0 83.8-68.2 151.9-151.9 151.9H629.3v-134.6h130.5c-39.7 0-71.9-32.3-71.9-71.9V460.2zM394.7 460.2h134.6V325.6H394.7c-83.8 0-151.9 68.2-151.9 151.9v134.6h134.6V460.2zM629.3 153.7h134.6v134.6H629.3V153.7z"
              />
            </svg>`
          : html`<svg viewBox="0 0 1024 1024" aria-hidden="true">
              <path
                d="M770.9 923.3H253.1c-83.8 0-151.9-68.2-151.9-151.9V253.6c0-83.8 68.2-151.9 151.9-151.9h517.8c83.8 0 151.9 68.2 151.9 151.9v517.8c0 83.8-68.1 151.9-151.9 151.9zM253.1 181.7c-39.7 0-71.9 32.3-71.9 71.9v517.8c0 39.7 32.3 71.9 71.9 71.9h517.8c39.7 0 71.9-32.3 71.9-71.9V253.6c0-39.7-32.3-71.9-71.9-71.9H253.1z"
              />
            </svg>`}
      </button>
      <button class="btn btn--close" aria-label="Close" title="关闭" @click=${this.close}>
        <svg viewBox="0 0 1024 1024" aria-hidden="true">
          <path
            d="M240.448 168l2.346667 2.154667 289.92 289.941333 279.253333-279.253333a42.666667 42.666667 0 0 1 62.506667 58.026666l-2.133334 2.346667-279.296 279.210667 279.274667 279.253333a42.666667 42.666667 0 0 1-58.005333 62.528l-2.346667-2.176-279.253333-279.253333-289.92 289.962666a42.666667 42.666667 0 0 1-62.506667-58.005333l2.154667-2.346667 289.941333-289.962666-289.92-289.92a42.666667 42.666667 0 0 1 57.984-62.506667z"
          />
        </svg>
      </button>
    `;
  }
}

export function mountElectronWindowBar(): void {
  if (!isElectronWindows()) {
    return;
  }
  if (document.querySelector("openclaw-electron-window-bar")) {
    return;
  }
  document.documentElement.classList.add("electron-win");
  const bar = document.createElement("openclaw-electron-window-bar");
  document.body.appendChild(bar);
}

if (!customElements.get("openclaw-electron-window-bar")) {
  customElements.define("openclaw-electron-window-bar", ElectronWindowBar);
}
