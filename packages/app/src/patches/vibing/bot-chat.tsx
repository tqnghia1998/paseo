import React, { useEffect, useLayoutEffect, useMemo, useId, useCallback } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";
import { useIsFocused } from "expo-router";
import { withUnistyles } from "react-native-unistyles";
import { AgentConversationPanel } from "@/panels/agent-panel";
import {
  PaneProvider,
  PaneFocusProvider,
  createPaneFocusContextValue,
  type PaneContextValue,
} from "@/panels/pane-context";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { AssistantFileLinkResolverProvider, type InlinePathTarget } from "@/assistant-file-links";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { prefetchProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { NativeBotChatDraft } from "./bot-chat-draft";
import { isEmbeddedFocusMode, isEmbeddedLiveDesignMessaging } from "./focus-mode";
import type { Theme } from "@/styles/theme";
import { getEmbeddedWorkspace, getEmbeddedWorkspaceDirectory } from "./workspace-boundary";
import { BotWorkspaceBridge } from "./bot-workspace";
import { BotChatForkProvider } from "./bot-chat-fork";
import {
  BotChatPanelLayer,
  useBotChatPanelStack,
  type BotChatPanelEntry,
  type BotChatPanelPane,
} from "./bot-chat-panels";
import { registerEmbeddedTargetOpener } from "./embedded-targets";
import { openFileInHost } from "./host-file-open";
import { BotUsageCard } from "./bot-usage-card";
import type { NativeBotChatProps } from "./bot-chat-types";

const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function embeddedBotChatProps(pluginId: string) {
  if (!isEmbeddedFocusMode || pluginId !== "paseo-bots") return {};
  const bound = getEmbeddedWorkspace();
  const directory = getEmbeddedWorkspaceDirectory();
  return {
    nativeChat: NativeBotChat,
    botWorkspace: {
      id: bound?.workspaceId ?? "",
      directory: directory ?? "",
      ...(isEmbeddedLiveDesignMessaging ? { chatContext: "live-design" as const } : {}),
    },
    workspaceBridge: BotWorkspaceBridge,
    sidebarFooter: BotUsageCard,
  };
}

export function NativeBotChat(props: NativeBotChatProps) {
  // Plugin surfaces have their own cache. Native controls must share the app's
  // provider catalogs, invalidation and preferences with ordinary Agent panels.
  return (
    <QueryClientProvider client={queryClient}>
      <NativeBotChatContent {...props} />
    </QueryClientProvider>
  );
}

function NativeBotChatContent(props: NativeBotChatProps) {
  const { serverId, agentId, botId, onSelectChat } = props;
  const active = useIsFocused() && props.active;
  const cachedWorkspaceId = useSessionStore((state) => {
    if (!agentId) return null;
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.workspaceId ?? null
    );
  });
  const workspaceId = props.workspaceId || cachedWorkspaceId || "";
  const cachedCwd = useSessionStore((state) => {
    if (!agentId) return "";
    const session = state.sessions[serverId];
    return (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.cwd ?? "";
  });
  const cwd = cachedCwd || props.cwd;
  const sync = useSessionStore((state) => state.sessions[serverId]?.viewedTimelineSync ?? null);
  const instanceId = useId();
  const owner = `paseo-bots:${serverId}:${botId}:${instanceId}`;
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  useEffect(() => {
    if (active && connected && client && cwd) {
      prefetchProvidersSnapshot(serverId, client, { cwd });
    }
  }, [active, connected, client, cwd, serverId]);
  const panels = useBotChatPanelStack(agentId);
  const panel = panels.top;
  const panelAgentId = panel?.target.kind === "agent" ? panel.target.agentId : null;
  const panelAgentWorkspaceId = useSessionStore((state) => {
    if (!panelAgentId) return null;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(panelAgentId) ?? session?.agentDetails.get(panelAgentId);
    return agent?.workspaceId ?? null;
  });
  // An open child agent owns the live timeline; the parent chat waits hidden.
  const visibleAgentId = panelAgentId ?? agentId;
  useEffect(() => {
    if (!visibleAgentId || !active) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, visibleAgentId)
      .catch(() => undefined);
  }, [active, visibleAgentId, serverId]);
  useLayoutEffect(() => {
    if (!sync) return;
    sync.replaceVisibleAgentIds(owner, active && visibleAgentId ? [visibleAgentId] : []);
    return () => sync.replaceVisibleAgentIds(owner, []);
  }, [active, visibleAgentId, owner, sync]);
  const { open: openPanel, back: closePanel, close: closePanels, setEntryState } = panels;
  // Bots has no workspace tabs: files open in Vibing's VS Code tab, everything else in the chat.
  const openTarget = useCallback(
    (target: WorkspaceTabTarget): boolean => {
      if (target.kind === "draft") {
        onSelectChat(null, target.draftId);
        return true;
      }
      if (target.kind === "agent" && target.agentId === agentId) {
        closePanels();
        return true;
      }
      if (target.kind === "file" && openFileInHost(target, cwd)) return true;
      return openPanel(target);
    },
    [agentId, closePanels, cwd, onSelectChat, openPanel],
  );
  useEffect(() => {
    if (!active) return;
    return registerEmbeddedTargetOpener({ serverId, agentId, open: openTarget });
  }, [active, agentId, openTarget, serverId]);
  const { pane, panelPanes } = useMemo(() => {
    const openTab: PaneContextValue["openTab"] = (target) => {
      if (!openTarget(target)) navigateToWorkspace({ serverId, workspaceId, target });
    };
    const shared = {
      serverId,
      host: "main" as const,
      openTab,
      openPreferredTarget: openTab,
      openTargetToSide: openTab,
      openFileInWorkspace: ({ location }: Parameters<PaneContextValue["openFileInWorkspace"]>[0]) =>
        openTab({ kind: "file", ...location }),
      openImportSheet: () => {},
    };
    const panePanel = (entry: BotChatPanelEntry): BotChatPanelPane => ({
      ...shared,
      workspaceId:
        (entry.target.kind === "agent" && entry.target.agentId === panelAgentId
          ? panelAgentWorkspaceId
          : null) || workspaceId,
      tabId: `${owner}:${entry.id}`,
      target: entry.target,
      state: entry.state,
      retargetCurrentTab: openTab,
      setCurrentTabState: (state) => setEntryState(entry.id, state),
      closeCurrentTab: closePanel,
    });
    return {
      pane: {
        ...shared,
        workspaceId,
        tabId: agentId ?? owner,
        target: agentId ? { kind: "agent", agentId } : { kind: "draft", draftId: owner },
        // A started draft becomes this bot's chat.
        retargetCurrentTab: (target) =>
          target.kind === "agent" ? onSelectChat(target.agentId) : openTab(target),
        setCurrentTabState: () => {},
        closeCurrentTab: () => onSelectChat(null),
      } satisfies PaneContextValue,
      panelPanes: [
        ...(panel ? [{ pane: panePanel(panel), visible: true }] : []),
        ...(panels.retained ? [{ pane: panePanel(panels.retained), visible: false }] : []),
      ],
    };
  }, [
    agentId,
    closePanel,
    onSelectChat,
    openTarget,
    owner,
    panel,
    panelAgentId,
    panelAgentWorkspaceId,
    panels.retained,
    serverId,
    setEntryState,
    workspaceId,
  ]);
  const openForkDraft = useCallback(
    (draftId: string) => {
      pane.openTab({ kind: "draft", draftId });
    },
    [pane],
  );
  const openFileLink = useCallback(
    (target: InlinePathTarget, disposition: OpenFileDisposition) => {
      pane.openFileInWorkspace({
        location: { path: target.path, lineStart: target.lineStart, lineEnd: target.lineEnd },
        disposition,
      });
    },
    [pane],
  );
  const content = (
    <BotChatPanelLayer
      panes={panelPanes}
      active={active}
      onBack={closePanel}
      testID="bots-native-chat"
    >
      {!agentId && <NativeBotChatDraft {...props} active={active && !panel} />}
      {agentId && workspaceId && <AgentConversationPanel />}
      {agentId && !workspaceId && <ThemedLoadingSpinner uniProps={spinnerColor} />}
    </BotChatPanelLayer>
  );
  return (
    <AssistantFileLinkResolverProvider
      client={client}
      serverId={serverId}
      workspaceRoot={cwd || undefined}
      onOpenWorkspaceFile={openFileLink}
    >
      <RetainedPanelActivity active={active}>
        <WorkspaceFocusProvider workspaceKey={null}>
          <DiffDocumentWorkspaceCacheProvider>
            <PaneProvider value={pane}>
              <PaneFocusProvider
                value={createPaneFocusContextValue({
                  isWorkspaceFocused: active,
                  isPaneFocused: active && !panel,
                })}
              >
                <BotChatForkProvider openDraft={openForkDraft}>{content}</BotChatForkProvider>
              </PaneFocusProvider>
            </PaneProvider>
          </DiffDocumentWorkspaceCacheProvider>
        </WorkspaceFocusProvider>
      </RetainedPanelActivity>
    </AssistantFileLinkResolverProvider>
  );
}
