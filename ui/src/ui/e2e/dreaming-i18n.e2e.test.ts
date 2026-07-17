import { mkdirSync } from "node:fs";
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

const artifactDir = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/dreaming-i18n");
const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const describeControlUiE2e = chromiumAvailable ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

describeControlUiE2e("dreaming Simplified Chinese copy", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true });
    server = await startControlUiE2eServer();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("localizes diary guidance while preserving diary content", async () => {
    mkdirSync(artifactDir, { recursive: true });
    const context = await browser.newContext({
      locale: "zh-CN",
      recordVideo: { dir: artifactDir, size: { height: 800, width: 1280 } },
      serviceWorkers: "block",
      viewport: { height: 800, width: 1280 },
    });
    const page = await context.newPage();
    await installMockGateway(page, {
      methodResponses: {
        "doctor.memory.dreamDiary": {
          content: [
            "# Dream Diary",
            "",
            "<!-- openclaw:dreaming:diary:start -->",
            "",
            "---",
            "",
            "*July 18, 2026*",
            "",
            "Keep this user-authored diary content unchanged.",
            "",
            "<!-- openclaw:dreaming:diary:end -->",
          ].join("\n"),
          found: true,
          path: "DREAMS.md",
        },
        "doctor.memory.status": {
          dreaming: {
            enabled: true,
            groundedSignalCount: 0,
            promotedToday: 0,
            shortTermCount: 0,
            totalSignalCount: 0,
          },
        },
      },
    });

    try {
      await page.goto(`${server.baseUrl}dreaming`);
      await page.getByRole("button", { name: "日记", exact: true }).click();

      const explainer = page.locator(".dreams-diary__explainer");
      await explainer.waitFor();
      expect((await explainer.textContent())?.trim()).toBe(
        "这是系统在重放并整合记忆时写入的原始梦境日记，可用于查看记忆系统关注到了什么，以及哪些内容仍显得嘈杂或单薄。",
      );
      expect(
        (await page.locator(".dreams-diary__subtab").allTextContents()).map((text) => text.trim()),
      ).toEqual(["梦境", "导入洞察", "记忆宫殿"]);
      await page
        .getByText("Keep this user-authored diary content unchanged.")
        .waitFor({ state: "visible" });

      await page.waitForTimeout(1_500);
      await page.screenshot({
        path: path.join(artifactDir, "simplified-chinese-diary.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
});
