import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../../../../dashboard/src/test-helpers/control-ui-e2e.ts";

const require = createRequire(import.meta.url);
const { MAC_TRAFFIC_LIGHTS_CLEARANCE_PX, TITLE_BAR_PADDING_CSS } =
  require("../../../../apps/electron/src/title-bar-css.js") as {
    MAC_TRAFFIC_LIGHTS_CLEARANCE_PX: number;
    TITLE_BAR_PADDING_CSS: string;
  };
const artifactDir = path.resolve(
  process.cwd(),
  ".artifacts/control-ui-e2e/electron-responsive-shell",
);

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const describeControlUiE2e = chromiumAvailable ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

type LayoutRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

function expectViewportIntersection(
  rect: LayoutRect,
  viewport: { height: number; width: number },
  label: string,
) {
  expect(rect.width, `${label} width`).toBeGreaterThan(0);
  expect(rect.height, `${label} height`).toBeGreaterThan(0);
  expect(rect.right, `${label} right edge`).toBeGreaterThan(0);
  expect(rect.bottom, `${label} bottom edge`).toBeGreaterThan(0);
  expect(rect.left, `${label} left edge`).toBeLessThan(viewport.width);
  expect(rect.top, `${label} top edge`).toBeLessThan(viewport.height);
}

describeControlUiE2e("Electron dashboard responsive shell", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true });
    server = await startControlUiE2eServer();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("keeps the chat and composer visible through the tablet breakpoint", async () => {
    mkdirSync(artifactDir, { recursive: true });
    const context = await browser.newContext({
      locale: "en-US",
      recordVideo: { dir: artifactDir, size: { height: 760, width: 800 } },
      serviceWorkers: "block",
      viewport: { height: 760, width: 1200 },
    });
    const page = await context.newPage();
    await installMockGateway(page, {
      historyMessages: [
        {
          content: [{ text: "Responsive shell ready.", type: "text" }],
          role: "assistant",
          timestamp: Date.now(),
        },
      ],
    });

    try {
      await page.goto(`${server.baseUrl}chat`);
      await page.getByText("Responsive shell ready.").waitFor({ timeout: 10_000 });
      await page.addStyleTag({ content: TITLE_BAR_PADDING_CSS });

      for (const width of [1120, 1100, 1024, 900, 800]) {
        await page.setViewportSize({ height: 760, width });
        const layout = await page.locator(".content--chat").evaluate((content) => {
          const rectFor = (element: Element | null) => {
            const rect = element?.getBoundingClientRect();
            return {
              bottom: rect?.bottom ?? 0,
              height: rect?.height ?? 0,
              left: rect?.left ?? 0,
              right: rect?.right ?? 0,
              top: rect?.top ?? 0,
              width: rect?.width ?? 0,
            };
          };
          const nav = document.querySelector(".shell-nav");
          return {
            chat: rectFor(content.querySelector(".chat")),
            composer: rectFor(content.querySelector(".agent-chat__input")),
            content: rectFor(content),
            navToggle: rectFor(document.querySelector(".topbar-nav-toggle")),
            navPosition: nav ? getComputedStyle(nav).position : "missing",
            viewport: { height: window.innerHeight, width: window.innerWidth },
          };
        });

        expectViewportIntersection(layout.content, layout.viewport, `content at ${width}px`);
        expectViewportIntersection(layout.chat, layout.viewport, `chat at ${width}px`);
        expectViewportIntersection(layout.composer, layout.viewport, `composer at ${width}px`);
        expect(layout.composer.left).toBeGreaterThanOrEqual(layout.content.left - 1);
        expect(layout.composer.right).toBeLessThanOrEqual(layout.content.right + 1);
        expect(layout.composer.top).toBeGreaterThanOrEqual(layout.content.top - 1);
        expect(layout.composer.bottom).toBeLessThanOrEqual(layout.content.bottom + 1);

        if (width <= 1100) {
          expect(layout.navPosition, `nav positioning at ${width}px`).toBe("fixed");
          expect(layout.content.width, `content width at ${width}px`).toBeGreaterThanOrEqual(
            width - 1,
          );
          expectViewportIntersection(layout.navToggle, layout.viewport, `nav toggle at ${width}px`);
          expect(
            layout.navToggle.left,
            `traffic-light clearance at ${width}px`,
          ).toBeGreaterThanOrEqual(MAC_TRAFFIC_LIGHTS_CLEARANCE_PX);
        } else {
          expect(layout.navPosition, `nav positioning at ${width}px`).toBe("relative");
        }
      }
      await page.screenshot({
        path: path.join(artifactDir, "chat-at-800px.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
});
