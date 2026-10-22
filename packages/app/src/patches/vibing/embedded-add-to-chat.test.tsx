// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const draft = vi.hoisted(() => ({ attachWorkspaceFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: true }));
vi.mock("@/stores/draft-store", () => ({ useDraftStore: { getState: () => draft } }));

import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { registerEmbeddedTargetOpener } from "./embedded-targets";

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
  draft.attachWorkspaceFile.mockClear();
});

it("adds files from Bots panels to the visible chat and returns to it", async () => {
  const open = vi.fn(() => true);
  const { result, rerender } = renderHook(() =>
    useAddFileToChat({ serverId: "host", workspaceId: "ws" }),
  );
  expect(result.current.canAddToChat).toBe(false);

  act(() => {
    unregister = registerEmbeddedTargetOpener({ serverId: "host", agentId: "chat", open });
  });
  rerender();
  expect(result.current.canAddToChat).toBe(true);
  await act(() => result.current.addFile("src/app.ts"));
  expect(draft.attachWorkspaceFile).toHaveBeenCalledWith({
    draftKey: buildDraftStoreKey({ serverId: "host", agentId: "chat" }),
    attachment: expect.objectContaining({ path: "src/app.ts" }),
  });
  expect(open).toHaveBeenCalledWith({ kind: "agent", agentId: "chat" });
});
