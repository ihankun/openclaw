/* @vitest-environment jsdom */
import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";

function baseProps(overrides: Partial<NodesProps> = {}): NodesProps {
  return {
    loading: false,
    nodes: [],
    devicesLoading: false,
    devicesError: null,
    devicesList: {
      pending: [],
      paired: [],
    },
    configForm: null,
    configLoading: false,
    configSaving: false,
    configDirty: false,
    configFormMode: "form",
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    execApprovalsTarget: "gateway",
    execApprovalsTargetNodeId: null,
    onRefresh: () => undefined,
    onDevicesRefresh: () => undefined,
    onDeviceApprove: () => undefined,
    onDeviceReject: () => undefined,
    onDeviceRotate: () => undefined,
    onDeviceRevoke: () => undefined,
    onLoadConfig: () => undefined,
    onLoadExecApprovals: () => undefined,
    onBindDefault: () => undefined,
    onBindAgent: () => undefined,
    onSaveBindings: () => undefined,
    onExecApprovalsTargetChange: () => undefined,
    onExecApprovalsSelectAgent: () => undefined,
    onExecApprovalsPatch: () => undefined,
    onExecApprovalsRemove: () => undefined,
    onSaveExecApprovals: () => undefined,
    ...overrides,
  };
}

function renderNodesContainer(overrides: Partial<NodesProps>): HTMLDivElement {
  const container = document.createElement("div");
  render(renderNodes(baseProps(overrides)), container);
  return container;
}

function getDevicesCard(container: Element): Element {
  const card = Array.from(container.querySelectorAll(".card")).find(
    (candidate) => candidate.querySelector(".card-title")?.textContent?.trim() === "Devices",
  );
  expect(card).toBeInstanceOf(Element);
  if (!(card instanceof Element)) {
    throw new Error("Expected devices card");
  }
  return card;
}

function getPendingDeviceDetails(container: Element): string[] {
  const item = getDevicesCard(container).querySelector(".list-item");
  expect(item).toBeInstanceOf(Element);
  if (!(item instanceof Element)) {
    throw new Error("Expected pending device item");
  }
  return Array.from(item.querySelectorAll(".list-main > .muted")).map(
    (line) => line.textContent?.trim() ?? "",
  );
}

describe("nodes devices pending rendering", () => {
  afterEach(async () => {
    await i18n.setLocale("en");
  });

  it("localizes the nodes menu chrome in Simplified Chinese", async () => {
    await i18n.setLocale("zh-CN");
    const container = renderNodesContainer({
      nodes: [
        {
          nodeId: "node-1",
          displayName: "Studio Mac",
          paired: true,
          connected: true,
          caps: ["system.run"],
        },
      ],
      devicesList: {
        pending: [],
        paired: [
          {
            deviceId: "device-1",
            displayName: "iPhone",
            roles: ["operator"],
            scopes: ["operator.read"],
          },
        ],
      },
    });
    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";

    expect(text).toContain("执行审批");
    expect(text).toContain("加载执行审批以编辑允许列表。");
    expect(text).toContain("设备 配对请求和角色令牌。");
    expect(text).toContain("已配对 iPhone");
    expect(text).toContain("角色：operator · 权限范围：operator.read");
    expect(text).toContain("节点 已配对的设备和实时连接。");
    expect(text).toContain("Studio Mac");
    expect(text).toContain("已配对 已连接 system.run");
  });

  it("shows requested and approved access for a scope upgrade", () => {
    const container = renderNodesContainer({
      devicesList: {
        pending: [
          {
            requestId: "req-1",
            deviceId: "device-1",
            displayName: "Device One",
            role: "operator",
            scopes: ["operator.admin", "operator.read"],
            ts: Date.now(),
          },
        ],
        paired: [
          {
            deviceId: "device-1",
            displayName: "Device One",
            roles: ["operator"],
            scopes: ["operator.read"],
          },
        ],
      },
    });
    const details = getPendingDeviceDetails(container);

    expect(details[0]).toMatch(/^scope upgrade requires approval \u00b7 requested /u);
    expect(details.slice(1)).toEqual([
      "requested: roles: operator \u00b7 scopes: operator.admin, operator.read, operator.write",
      "approved now: roles: operator \u00b7 scopes: operator.read",
    ]);
  });

  it("normalizes pending device ids before matching paired access", () => {
    const container = renderNodesContainer({
      devicesList: {
        pending: [
          {
            requestId: "req-1",
            deviceId: " device-1 ",
            displayName: "Device One",
            role: "operator",
            scopes: ["operator.admin", "operator.read"],
            ts: Date.now(),
          },
        ],
        paired: [
          {
            deviceId: "device-1",
            displayName: "Device One",
            roles: ["operator"],
            scopes: ["operator.read"],
          },
        ],
      },
    });
    const details = getPendingDeviceDetails(container);

    expect(details[0]).toMatch(/^scope upgrade requires approval \u00b7 requested /u);
    expect(details.at(-1)).toBe("approved now: roles: operator \u00b7 scopes: operator.read");
  });

  it("does not show upgrade context for key-mismatched pending requests", () => {
    const container = renderNodesContainer({
      devicesList: {
        pending: [
          {
            requestId: "req-1",
            deviceId: "device-1",
            publicKey: "new-key",
            displayName: "Device One",
            role: "operator",
            scopes: ["operator.admin"],
            ts: Date.now(),
          },
        ],
        paired: [
          {
            deviceId: "device-1",
            publicKey: "old-key",
            displayName: "Device One",
            roles: ["operator"],
            scopes: ["operator.read"],
          },
        ],
      },
    });
    const details = getPendingDeviceDetails(container);

    expect(details[0]).toMatch(/^new device pairing request \u00b7 requested /u);
    expect(details).toEqual([
      details[0] ?? "",
      "requested: roles: operator \u00b7 scopes: operator.admin, operator.read, operator.write",
    ]);
  });

  it("falls back to roles when role is absent", () => {
    const container = renderNodesContainer({
      devicesList: {
        pending: [
          {
            requestId: "req-2",
            deviceId: "device-2",
            roles: ["node", "operator"],
            scopes: ["operator.read"],
            ts: Date.now(),
          },
        ],
        paired: [],
      },
    });
    const details = getPendingDeviceDetails(container);

    expect(details[1]).toBe("requested: roles: node, operator \u00b7 scopes: operator.read");
  });
});
