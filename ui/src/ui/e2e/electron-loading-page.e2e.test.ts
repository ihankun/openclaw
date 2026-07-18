import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  resolvePlaywrightChromiumExecutablePath,
} from "../../../../dashboard/src/test-helpers/control-ui-e2e.ts";

const artifactDir = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/electron-loading-page");
const loadingPageUrl = pathToFileURL(
  path.resolve(process.cwd(), "apps/electron/src/renderer/loading.html"),
).href;
const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const describeControlUiE2e = chromiumAvailable ? describe : describe.skip;

let browser: Browser;

describeControlUiE2e("Electron loading page", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("renders the OpenClaw glass launch card in light and dark themes", async () => {
    mkdirSync(artifactDir, { recursive: true });
    const bodyBackgrounds: string[] = [];

    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        colorScheme,
        recordVideo: { dir: artifactDir, size: { height: 600, width: 800 } },
        viewport: { height: 600, width: 800 },
      });
      const page = await context.newPage();

      try {
        await page.goto(loadingPageUrl);
        await page.getByRole("heading", { name: "正在启动本地网关" }).waitFor();
        await page.getByRole("status").waitFor();

        const logo = page.locator(".logo");
        await logo.waitFor();
        expect(await logo.getAttribute("src")).toBe("../../assets/openclaw-logo.png");
        expect(
          await logo.evaluate((element: HTMLImageElement) => element.naturalWidth),
        ).toBeGreaterThan(0);
        expect(await page.locator("body").textContent()).not.toContain("🦞");

        const glassStyle = await page.locator(".launch-card").evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            borderRadius: style.borderRadius,
          };
        });
        expect(glassStyle.backdropFilter).toContain("blur");
        expect(glassStyle.borderRadius).toBe("30px");

        bodyBackgrounds.push(
          await page
            .locator("body")
            .evaluate((element) => getComputedStyle(element).backgroundImage),
        );
        await page.screenshot({
          path: path.join(artifactDir, `${colorScheme}.png`),
          fullPage: true,
        });
      } finally {
        await context.close();
      }
    }

    expect(bodyBackgrounds[0]).not.toBe(bodyBackgrounds[1]);
  });
});
