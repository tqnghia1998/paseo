/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
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
  findEmbeddedConversationTabId,
  getEmbeddedConversationTabs,
  resolveEmbeddedModelSelection,
  shouldUseEmbeddedFocusMode,
  shouldUseEmbeddedLiveDesignPresentation,
  useEmbeddedLiveDesignConversation,
  useEmbeddedModelSelection,
} from "./embedded-focus-mode";

describe("embedded focus mode", () => {
  it("locks every standalone embed while limiting chat presentation to Live Design", () => {
    expect(shouldUseEmbeddedFocusMode(true)).toBe(true);
    expect(shouldUseEmbeddedFocusMode(false)).toBe(false);
    expect(shouldUseEmbeddedLiveDesignPresentation(true, "")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignPresentation(true, "?embedded-live-design=1")).toBe(true);
    expect(shouldUseEmbeddedLiveDesignPresentation(true, "?embedded-live-design=0")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignPresentation(true, "?embedded-live-design")).toBe(false);
    expect(shouldUseEmbeddedLiveDesignPresentation(false, "?embedded-live-design=1")).toBe(false);
  });

  it("disables workspace navigation actions", () => {
    expect(
      embeddedWorkspaceActionsEnabled({
        routeFocused: true,
        serverId: "server",
        workspaceId: "workspace",
      }),
    ).toBe(false);
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

  it("keeps only agent and draft tabs in the embedded tab strip", () => {
    const tabs = [
      { tabId: "changes", target: { kind: "changes" } },
      { tabId: "agent", target: { kind: "agent" } },
      { tabId: "draft", target: { kind: "draft" } },
    ];

    expect(getEmbeddedConversationTabs(tabs)).toEqual([tabs[1], tabs[2]]);
    expect(findEmbeddedConversationTabId(tabs)).toBe("agent");
  });

  it("returns to an existing conversation from another tab", () => {
    const focusTab = vi.fn();
    const openDraft = vi.fn();

    renderHook(() =>
      useEmbeddedLiveDesignConversation({
        activeKind: "changes",
        conversationTabId: "agent",
        enabled: true,
        focusTab,
        openDraft,
        workspaceKey: "server:workspace",
      }),
    );

    expect(focusTab).toHaveBeenCalledWith("server:workspace", "agent");
    expect(openDraft).not.toHaveBeenCalled();
  });

  it("opens one draft after the workspace key is available until a conversation exists", () => {
    const focusTab = vi.fn();
    const openDraft = vi.fn();
    const { rerender } = renderHook(
      ({
        workspaceKey,
        conversationTabId,
      }: {
        workspaceKey: string | null;
        conversationTabId?: string;
      }) =>
        useEmbeddedLiveDesignConversation({
          activeKind: "changes",
          conversationTabId,
          enabled: true,
          focusTab,
          openDraft,
          workspaceKey,
        }),
      {
        initialProps: {
          workspaceKey: null as string | null,
          conversationTabId: undefined as string | undefined,
        },
      },
    );

    expect(openDraft).not.toHaveBeenCalled();

    act(() => rerender({ workspaceKey: "server:workspace", conversationTabId: undefined }));
    act(() => rerender({ workspaceKey: "server:workspace", conversationTabId: undefined }));
    expect(openDraft).toHaveBeenCalledOnce();

    act(() => rerender({ workspaceKey: "server:workspace", conversationTabId: "draft" }));
    expect(focusTab).toHaveBeenCalledWith("server:workspace", "draft");
  });

  it("opens a draft after switching workspaces while the prior workspace is pending", () => {
    const focusTab = vi.fn();
    const openDraft = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceKey }: { workspaceKey: string }) =>
        useEmbeddedLiveDesignConversation({
          activeKind: "changes",
          enabled: true,
          focusTab,
          openDraft,
          workspaceKey,
        }),
      { initialProps: { workspaceKey: "server:workspace-a" } },
    );

    act(() => rerender({ workspaceKey: "server:workspace-b" }));
    expect(openDraft).toHaveBeenCalledTimes(2);
  });
});
