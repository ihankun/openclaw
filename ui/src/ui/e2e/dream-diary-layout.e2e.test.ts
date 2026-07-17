import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  resolvePlaywrightChromiumExecutablePath,
} from "../../../../dashboard/src/test-helpers/control-ui-e2e.ts";
import { readStyleSheet } from "../../../../test/helpers/ui-style-fixtures.js";

const artifactDir = path.resolve(
  process.cwd(),
  ".artifacts/control-ui-e2e/dream-diary-date-filter",
);
const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const describeControlUiE2e = chromiumAvailable ? describe : describe.skip;

let browser: Browser;

function readDreamDiaryCss(): string {
  return [
    "dashboard/src/styles/base.css",
    "dashboard/src/styles/layout.css",
    "dashboard/src/styles/dreams.css",
  ]
    .map((file) => readStyleSheet(file))
    .join("\n");
}

function longDiaryHtml(): string {
  const paragraphs = Array.from(
    { length: 24 },
    (_, index) => `<p class="dreams-diary__para">Long diary paragraph ${index + 1}.</p>`,
  ).join("");

  return `
    <main class="content content--dreams" style="height: 540px;">
      <section class="content-header">
        <div><h1>Dreams</h1><p>Memory dreaming, consolidation, and reflection.</p></div>
      </section>
      <div class="dreams-page">
        <nav class="dreams__tabs"><button class="dreams__tab dreams__tab--active">Diary</button></nav>
        <section class="dreams-diary">
          <div class="dreams-diary__chrome">
            <div class="dreams-diary__header">
              <span class="dreams-diary__title">Dream Diary</span>
            </div>
            <p class="dreams-diary__explainer">A long diary should not collapse its date filter.</p>
          </div>
          <div class="dreams-diary__daychips">
            <button class="dreams-diary__day-chip dreams-diary__day-chip--active">July 17</button>
            <button class="dreams-diary__day-chip">July 16</button>
            <button class="dreams-diary__day-chip">July 15</button>
          </div>
          <article class="dreams-diary__entry">
            <time class="dreams-diary__date">July 17, 2026</time>
            <div class="dreams-diary__prose">${paragraphs}</div>
          </article>
        </section>
      </div>
    </main>
  `;
}

describeControlUiE2e("dream diary layout", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("keeps the date filter visible when a long diary needs vertical scrolling", async () => {
    mkdirSync(artifactDir, { recursive: true });
    const context = await browser.newContext({
      recordVideo: { dir: artifactDir, size: { height: 540, width: 1000 } },
      viewport: { height: 540, width: 1000 },
    });
    const page = await context.newPage();

    try {
      await page.setContent(
        `<!doctype html><html><head><style>${readDreamDiaryCss()}</style></head><body>${longDiaryHtml()}</body></html>`,
      );
      const layout = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(".content--dreams");
        const diary = document.querySelector<HTMLElement>(".dreams-diary");
        const chips = document.querySelector<HTMLElement>(".dreams-diary__daychips");
        const activeChip = document.querySelector<HTMLElement>(".dreams-diary__day-chip--active");
        const entry = document.querySelector<HTMLElement>(".dreams-diary__entry");
        if (!content || !diary || !chips || !activeChip || !entry) {
          throw new Error("Dream diary fixture did not render");
        }
        const chipsRect = chips.getBoundingClientRect();
        const activeChipRect = activeChip.getBoundingClientRect();
        const entryRect = entry.getBoundingClientRect();
        return {
          activeChipBottom: activeChipRect.bottom,
          activeChipHeight: activeChipRect.height,
          chipsHeight: chipsRect.height,
          contentClientHeight: content.clientHeight,
          contentOverflowY: getComputedStyle(content).overflowY,
          contentScrollHeight: content.scrollHeight,
          diaryClientHeight: diary.clientHeight,
          entryTop: entryRect.top,
          diaryScrollHeight: diary.scrollHeight,
        };
      });

      expect(layout.contentOverflowY).toBe("hidden");
      expect(layout.contentScrollHeight).toBeLessThanOrEqual(layout.contentClientHeight);
      expect(layout.diaryScrollHeight).toBeGreaterThan(layout.diaryClientHeight);
      expect(layout.chipsHeight).toBeGreaterThanOrEqual(layout.activeChipHeight);
      expect(layout.activeChipBottom).toBeLessThanOrEqual(layout.entryTop + 1);

      await page.waitForTimeout(1_500);
      await page.screenshot({
        path: path.join(artifactDir, "long-diary-date-filter.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
});
