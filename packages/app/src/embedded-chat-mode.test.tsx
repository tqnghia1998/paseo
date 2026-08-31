/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_CHAT_ONLY = "true";
});

import {
  embeddedImportVisible,
  embeddedWorkspaceActionsEnabled,
  findEmbeddedConversationTabId,
  useEmbeddedChatOnlyConversation,
} from "./embedded-chat-mode";

describe("embedded chat-only mode", () => {
  it("disables workspace navigation actions", () => {
    expect(
      embeddedWorkspaceActionsEnabled({
        routeFocused: true,
        serverId: "server",
        workspaceId: "workspace",
      }),
    ).toBe(false);
    expect(embeddedImportVisible(true, true)).toBe(false);
  });

  it("finds the first agent or draft conversation", () => {
    expect(
      findEmbeddedConversationTabId([
        { tabId: "changes", target: { kind: "changes" } },
        { tabId: "agent", target: { kind: "agent" } },
        { tabId: "draft", target: { kind: "draft" } },
      ]),
    ).toBe("agent");
  });

  it("returns to an existing conversation from another tab", () => {
    const focusTab = vi.fn();
    const openDraft = vi.fn();

    renderHook(() =>
      useEmbeddedChatOnlyConversation({
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

  it("opens a draft only after the workspace key is available", () => {
    const focusTab = vi.fn();
    const openDraft = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceKey }: { workspaceKey: string | null }) =>
        useEmbeddedChatOnlyConversation({
          activeKind: "changes",
          enabled: true,
          focusTab,
          openDraft,
          workspaceKey,
        }),
      { initialProps: { workspaceKey: null as string | null } },
    );

    expect(openDraft).not.toHaveBeenCalled();

    act(() => rerender({ workspaceKey: "server:workspace" }));

    expect(openDraft).toHaveBeenCalledOnce();
  });
});
