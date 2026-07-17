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

const artifactDir = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/skills-nodes-i18n");
const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const describeControlUiE2e = chromiumAvailable ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

describeControlUiE2e("skills and nodes Simplified Chinese copy", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true });
    server = await startControlUiE2eServer();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("localizes skills and nodes while preserving technical values", async () => {
    mkdirSync(artifactDir, { recursive: true });
    const context = await browser.newContext({
      locale: "zh-CN",
      recordVideo: { dir: artifactDir, size: { height: 900, width: 1440 } },
      serviceWorkers: "block",
      viewport: { height: 900, width: 1440 },
    });
    const page = await context.newPage();
    await installMockGateway(page, {
      methodResponses: {
        "config.get": {
          config: { agents: { list: [{ id: "main", name: "Main" }] } },
          hash: "config-hash",
          raw: "{}",
          valid: true,
        },
        "device.pair.list": {
          paired: [
            {
              deviceId: "device-1",
              displayName: "Studio iPhone",
              roles: ["operator"],
              scopes: ["operator.read"],
              tokens: [],
            },
          ],
          pending: [],
        },
        "exec.approvals.get": {
          exists: true,
          file: {
            agents: {},
            defaults: {
              ask: "on-miss",
              askFallback: "deny",
              autoAllowSkills: false,
              security: "deny",
            },
          },
          hash: "approvals-hash",
          path: "/tmp/exec-approvals.json",
        },
        "node.list": {
          nodes: [
            {
              caps: ["system.run"],
              commands: ["system.run"],
              connected: true,
              displayName: "Studio Mac",
              nodeId: "node-1",
              paired: true,
              version: "2026.6.14",
            },
          ],
        },
        "skills.status": {
          managedSkillsDir: "/tmp/skills",
          skills: [
            {
              always: false,
              blockedByAgentFilter: false,
              blockedByAllowlist: false,
              bundled: false,
              configChecks: [],
              description: "User-authored skill description remains unchanged.",
              disabled: false,
              eligible: true,
              filePath: "/tmp/workspace/SKILL.md",
              install: [],
              missing: { bins: [], config: [], env: [], os: [] },
              name: "Workspace Helper",
              requirements: { bins: [], config: [], env: [], os: [] },
              skillKey: "workspace-helper",
              source: "openclaw-workspace",
            },
          ],
          workspaceDir: "/tmp/workspace",
        },
      },
    });

    try {
      await page.goto(`${server.baseUrl}skills`);
      await page.getByText("已安装的技能及其状态。").waitFor();
      await page.getByText("工作区技能").waitFor();
      await page.getByText("User-authored skill description remains unchanged.").waitFor();
      expect(await page.locator(".sidebar-utility-link").count()).toBe(0);
      await page.screenshot({
        path: path.join(artifactDir, "skills-zh-CN.png"),
        fullPage: true,
      });

      await page.goto(`${server.baseUrl}nodes`);
      await page.getByText("配置 exec host=gateway/node 的允许列表和审批策略。").waitFor();
      await page.getByText("配对请求和角色令牌。").waitFor();
      await page.getByText("已配对的设备和实时连接。").waitFor();
      await page.getByText("Studio Mac", { exact: true }).waitFor();
      await page.getByText("system.run", { exact: true }).first().waitFor();
      await page.screenshot({
        path: path.join(artifactDir, "nodes-zh-CN.png"),
        fullPage: true,
      });
      await page.getByText("已配对的设备和实时连接。").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifactDir, "nodes-list-zh-CN.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
});
