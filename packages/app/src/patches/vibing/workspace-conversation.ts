import { useCallback, useRef } from "react";
import {
  FOCUSED_PANE_PLACEMENT,
  type useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import {
  findNearestEmbeddedConversationTabId,
  isEmbeddedFocusMode,
  isEmbeddedLiveDesignMessaging,
} from "./focus-mode";
import { useEmbeddedPromptActivation } from "./host-prompts";
import { useEmbeddedLiveDesignActivation } from "./live-design";

type WorkspaceActions = Pick<
  ReturnType<typeof useWorkspaceLayoutStore.getState>,
  "focusTab" | "openTab"
>;
type ConversationTab = Pick<WorkspaceTab, "tabId" | "target">;
interface WorkspaceConversationInput extends WorkspaceActions {
  enabled: boolean;
  workspaceId: string;
  persistenceKey: string | null;
  activeTabId: string | null;
  tabs: ConversationTab[];
  allTabs: ConversationTab[];
  openDraft: () => string | null;
}

export function useEmbeddedWorkspaceConversation(input: WorkspaceConversationInput): void {
  const {
    enabled,
    workspaceId,
    persistenceKey,
    activeTabId,
    tabs,
    allTabs,
    openDraft,
    openTab,
    focusTab,
  } = input;
  const openingEmbeddedLiveDesignDraftRef = useRef(false);
  const embeddedLiveDesignWorkspaceRef = useRef<string | null>(null);
  const activateConversation = useCallback(
    (preferredAgentId?: string, newAgent = false) => {
      if (!persistenceKey) return;
      if (embeddedLiveDesignWorkspaceRef.current !== persistenceKey) {
        embeddedLiveDesignWorkspaceRef.current = persistenceKey;
        openingEmbeddedLiveDesignDraftRef.current = false;
      }
      if (newAgent) {
        openingEmbeddedLiveDesignDraftRef.current = false;
        return openDraft();
      }
      const preferredTab = preferredAgentId
        ? allTabs.find(
            (tab) => tab.target.kind === "agent" && tab.target.agentId === preferredAgentId,
          )
        : undefined;
      const conversationTabId =
        preferredTab?.tabId ??
        (preferredAgentId
          ? openTab({
              workspaceKey: persistenceKey,
              target: { kind: "agent", agentId: preferredAgentId },
              intent: "reveal",
              placement: FOCUSED_PANE_PLACEMENT,
            })
          : findNearestEmbeddedConversationTabId(tabs, activeTabId));
      if (conversationTabId) {
        openingEmbeddedLiveDesignDraftRef.current = false;
        if (conversationTabId !== activeTabId) focusTab(persistenceKey, conversationTabId);
        return;
      }
      if (openingEmbeddedLiveDesignDraftRef.current) return;
      openingEmbeddedLiveDesignDraftRef.current = true;
      if (!openDraft()) openingEmbeddedLiveDesignDraftRef.current = false;
    },
    [activeTabId, focusTab, openDraft, openTab, persistenceKey, tabs, allTabs],
  );
  useEmbeddedPromptActivation({
    activateConversation,
    enabled: isEmbeddedFocusMode && enabled,
  });
  useEmbeddedLiveDesignActivation({
    activateConversation,
    enabled: isEmbeddedLiveDesignMessaging && enabled,
    workspaceId,
  });
}
