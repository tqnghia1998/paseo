import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { useCallback, useMemo } from "react";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { openEmbeddedTarget, useEmbeddedChatTarget } from "@/patches/vibing/embedded-targets";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function useAddFileToChat(input: { serverId: string; workspaceId?: string | null }) {
  const workspaceKey = input.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId: input.workspaceId })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const botsChat = useEmbeddedChatTarget(input.serverId);
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId: input.serverId, layout }) ?? botsChat,
    [botsChat, input.serverId, layout],
  );
  const addFile = useCallback(
    async (filePath: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: focusedChat.draftKey,
        attachment: createWorkspaceFileAttachment({ path: filePath }),
      });
      if (!revealWorkspaceTab(workspaceKey, focusedChat.tabId) && botsChat)
        openEmbeddedTarget({ kind: "agent", agentId: botsChat.agentId });
    },
    [botsChat, focusedChat, workspaceKey],
  );
  return { addFile, canAddToChat: focusedChat !== null };
}
