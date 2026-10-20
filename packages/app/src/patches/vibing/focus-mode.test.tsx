/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
  window.history.replaceState(null, "", "/?embedded-live-design=1");
});

import {
  migrateEmbeddedPanelFocus,
  isEmbeddedShortcutAllowed,
  findNearestEmbeddedConversationTabId,
  preserveEmbeddedLiveDesignMessagingQuery,
  shouldUseDesktopWorkspaceTabs,
  isEmbeddedFocusMode,
  shouldUseEmbeddedLiveDesignMessaging,
} from "./focus-mode";

describe("embedded focus mode", () => {
  it("disables embedded policy in a standard build", async () => {
    vi.resetModules();
    vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
    try {
      expect((await import("./focus-mode")).isEmbeddedFocusMode).toBe(false);
      const { usePanelStore } = await import("@/stores/panel-store");
      await usePanelStore.persist.rehydrate();
      expect(usePanelStore.getState().desktop.agentListOpen).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("locks every standalone embed while limiting chat presentation to Live Design", () => {
    expect(isEmbeddedFocusMode).toBe(true);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "?embedded-live-design=1")).toBe(true);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "?embedded-live-design=0")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "?embedded-live-design")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(false, "?embedded-live-design=1")).toBe(false);
  });

  it("keeps Live Design workspace tabs in their desktop row", () => {
    expect(shouldUseDesktopWorkspaceTabs(true, true)).toBe(true);
    expect(shouldUseDesktopWorkspaceTabs(true, false)).toBe(false);
    expect(shouldUseDesktopWorkspaceTabs(false, false)).toBe(true);
  });

  it("preserves Live Design messaging across the folder route replacement", () => {
    expect(preserveEmbeddedLiveDesignMessagingQuery("/h/server/workspace/id", true)).toBe(
      "/h/server/workspace/id?embedded-live-design=1",
    );
    expect(preserveEmbeddedLiveDesignMessagingQuery("/h/server/workspace/id", false)).toBe(
      "/h/server/workspace/id",
    );
  });

  it("finds the nearest conversation tab by tab order", () => {
    const tabs = [
      { tabId: "agent-left", target: { kind: "agent" } },
      { tabId: "changes", target: { kind: "changes" } },
      { tabId: "draft-tie", target: { kind: "draft" } },
      { tabId: "browser", target: { kind: "browser" } },
      { tabId: "draft-right", target: { kind: "draft" } },
    ];

    expect(findNearestEmbeddedConversationTabId(tabs, "changes")).toBe("agent-left");
    expect(findNearestEmbeddedConversationTabId(tabs, "browser")).toBe("draft-tie");
    expect(findNearestEmbeddedConversationTabId(tabs, "draft-right")).toBe("draft-right");
    expect(
      findNearestEmbeddedConversationTabId(
        tabs.filter((tab) => tab.target.kind !== "agent" && tab.target.kind !== "draft"),
        "changes",
      ),
    ).toBeUndefined();
  });
});

describe("full embedded workspace", () => {
  it("starts with the sidebar hidden and restores the user's menu preference", async () => {
    const { default: storage } = await import("@react-native-async-storage/async-storage");
    await storage.removeItem("panel-state");
    const { usePanelStore } = await import("@/stores/panel-store");
    await usePanelStore.persist.rehydrate();
    expect(usePanelStore.getState().desktop).toEqual({
      agentListOpen: false,
      focusModeEnabled: false,
    });

    usePanelStore.getState().toggleDesktopAgentList();
    expect(usePanelStore.getState().desktop.agentListOpen).toBe(true);
    const saved = await storage.getItem("panel-state");
    expect(saved).not.toBeNull();
    usePanelStore.getState().closeDesktopAgentList();
    await storage.setItem("panel-state", saved!);
    await usePanelStore.persist.rehydrate();
    expect(usePanelStore.getState().desktop.agentListOpen).toBe(true);
    await storage.removeItem("panel-state");
  });

  it("clears legacy forced focus once while preserving other panel state", () => {
    const state = { desktop: { focusModeEnabled: true, agentListOpen: false }, sidebarWidth: 280 };
    expect(migrateEmbeddedPanelFocus(state, 16)).toEqual({
      desktop: { focusModeEnabled: false, agentListOpen: false },
      sidebarWidth: 280,
    });
    expect(migrateEmbeddedPanelFocus(state, 17)).toEqual(state);
  });

  it("allows workspace tools but excludes global navigation shortcuts", () => {
    for (const action of [
      "command-center.toggle",
      "command-center.files",
      "theme.cycle",
      "settings.toggle",
      "shortcuts.dialog.toggle",
      "workspace.tab.new",
      "workspace.tab.navigate.relative",
      "view.toggle.focus",
      "sidebar.toggle.left",
      "sidebar.toggle.both",
      "sidebar.toggle.right",
      "message-input.action",
    ]) {
      expect(isEmbeddedShortcutAllowed(action)).toBe(true);
    }
    for (const action of ["workspace.navigate.index", "workspace.navigate.relative", "agent.new"]) {
      expect(isEmbeddedShortcutAllowed(action)).toBe(false);
    }
  });
});

it("retains Live Design messaging when its named iframe reloads Settings", async () => {
  const name = window.name;
  const search = window.location.search;
  window.name = "paseo-workspace:live-design:test";
  window.history.replaceState(null, "", "/settings/general");
  vi.resetModules();
  try {
    expect((await import("./focus-mode")).isEmbeddedLiveDesignMessaging).toBe(true);
  } finally {
    window.name = name;
    window.history.replaceState(null, "", `/${search}`);
    vi.resetModules();
  }
});
