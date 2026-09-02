/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
  window.history.replaceState(null, "", "/?embedded-live-design=1");
});

import {
  embeddedImportVisible,
  embeddedMessageInputFocusHintVisible,
  embeddedMessageInputFocusShortcutEnabled,
  embeddedModelSelectorManagementEnabled,
  embeddedWorkspaceActionsEnabled,
  findNearestEmbeddedConversationTabId,
  preserveEmbeddedLiveDesignMessagingQuery,
  resolveEmbeddedModelSelection,
  shouldUseEmbeddedFocusMode,
  shouldUseEmbeddedLiveDesignMessaging,
  useEmbeddedModelSelection,
} from "./embedded-focus-mode";

describe("embedded focus mode", () => {
  it("locks every standalone embed while limiting chat presentation to Live Design", () => {
    expect(shouldUseEmbeddedFocusMode(true)).toBe(true);
    expect(shouldUseEmbeddedFocusMode(false)).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "?embedded-live-design=1")).toBe(true);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "?embedded-live-design=0")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(true, "?embedded-live-design")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignMessaging(false, "?embedded-live-design=1")).toBe(false);
  });

  it("preserves Live Design messaging across the folder route replacement", () => {
    expect(preserveEmbeddedLiveDesignMessagingQuery("/h/server/workspace/id", true)).toBe(
      "/h/server/workspace/id?embedded-live-design=1",
    );
    expect(preserveEmbeddedLiveDesignMessagingQuery("/h/server/workspace/id", false)).toBe(
      "/h/server/workspace/id",
    );
  });

  it("keeps current-worktree workspace actions available", () => {
    expect(
      embeddedWorkspaceActionsEnabled({
        routeFocused: true,
        serverId: "server",
        workspaceId: "workspace",
      }),
    ).toBe(true);
    expect(embeddedImportVisible(true, true)).toBe(false);
    expect(embeddedModelSelectorManagementEnabled()).toBe(false);
    expect(embeddedMessageInputFocusShortcutEnabled()).toBe(false);
    expect(
      embeddedMessageInputFocusHintVisible({
        isWeb: true,
        isInputFocused: false,
        hasValue: false,
      }),
    ).toBe(false);
  });

  it("selects the first model from the highest-priority available provider", () => {
    const modelSelection = (provider: string, ...modelIds: string[]) => ({
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models" as const,
        rows: modelIds.map((modelId) => ({
          favoriteKey: `${provider}:${modelId}`,
          provider,
          providerLabel: provider,
          modelId,
          modelLabel: modelId,
        })),
      },
    });

    expect(
      resolveEmbeddedModelSelection([
        modelSelection("pi", "pi-first"),
        modelSelection("opencode", "opencode-first"),
        modelSelection("claude", "claude-first"),
        modelSelection("codex", "codex-first", "codex-second"),
      ]),
    ).toEqual({ provider: "codex", modelId: "codex-first" });

    expect(
      resolveEmbeddedModelSelection([
        modelSelection("codex"),
        modelSelection("pi", "pi-first"),
        modelSelection("opencode", "opencode-first"),
      ]),
    ).toEqual({ provider: "opencode", modelId: "opencode-first" });

    expect(
      resolveEmbeddedModelSelection([
        {
          id: "codex",
          label: "Codex",
          modelSelection: { kind: "loading" },
        },
        modelSelection("claude", "claude-first"),
      ]),
    ).toBeNull();

    expect(
      resolveEmbeddedModelSelection([modelSelection("codex", "codex-first")], "chosen"),
    ).toBeNull();
  });

  it("waits for a selectable provider before completing auto-selection", () => {
    const select = vi.fn();
    const loadingProvider: ProviderSelectorProvider = {
      id: "codex",
      label: "Codex",
      modelSelection: { kind: "loading" as const },
    };
    const readyProvider: ProviderSelectorProvider = {
      id: "codex",
      label: "Codex",
      modelSelection: {
        kind: "models" as const,
        rows: [
          {
            favoriteKey: "codex:auto",
            provider: "codex",
            providerLabel: "Codex",
            modelId: "auto",
            modelLabel: "Auto",
          },
        ],
      },
    };
    const { rerender } = renderHook(
      ({ providers }) =>
        useEmbeddedModelSelection({
          isInitialSelectionPending: false,
          providers,
          selectedModel: "",
          select,
        }),
      { initialProps: { providers: [loadingProvider] } },
    );

    rerender({ providers: [readyProvider] });

    expect(select).toHaveBeenCalledWith("codex", "auto");
  });

  it("restores a persisted model before deciding whether to auto-select", () => {
    const select = vi.fn();
    const providers = [
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models" as const,
          rows: [
            {
              favoriteKey: "codex:auto",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "auto",
              modelLabel: "Auto",
            },
          ],
        },
      },
    ];
    const { rerender } = renderHook(
      ({ pending, selectedModel }: { pending: boolean; selectedModel: string }) =>
        useEmbeddedModelSelection({
          isInitialSelectionPending: pending,
          providers,
          selectedModel,
          select,
        }),
      { initialProps: { pending: true, selectedModel: "" } },
    );

    rerender({ pending: false, selectedModel: "persisted" });
    rerender({ pending: false, selectedModel: "" });

    expect(select).not.toHaveBeenCalled();
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
