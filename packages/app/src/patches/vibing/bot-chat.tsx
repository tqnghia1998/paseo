import React, { useEffect, useLayoutEffect, useMemo, useId, useCallback } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";
import { View } from "react-native";
import { useIsFocused } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
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
import { prefetchProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { NativeBotChatDraft } from "./bot-chat-draft";
import { isEmbeddedFocusMode } from "./focus-mode";
import type { Theme } from "@/styles/theme";
import { getEmbeddedWorkspace, getEmbeddedWorkspaceDirectory } from "./workspace-boundary";
import { BotWorkspaceBridge } from "./bot-workspace";
import { BotChatForkProvider } from "./bot-chat-fork";
import type { NativeBotChatProps } from "./bot-chat-types";

const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function embeddedBotChatProps(pluginId: string) {
  if (!isEmbeddedFocusMode || pluginId !== "paseo-bots") return {};
  const bound = getEmbeddedWorkspace();
  const directory = getEmbeddedWorkspaceDirectory();
  return {
    nativeChat: NativeBotChat,
    botWorkspace: { id: bound?.workspaceId ?? "", directory: directory ?? "" },
    workspaceBridge: BotWorkspaceBridge,
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
  useEffect(() => {
    if (!agentId || !active) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [active, agentId, serverId]);
  useLayoutEffect(() => {
    if (!sync) return;
    sync.replaceVisibleAgentIds(owner, active && agentId ? [agentId] : []);
    return () => sync.replaceVisibleAgentIds(owner, []);
  }, [active, agentId, owner, sync]);
  const pane = useMemo<PaneContextValue>(() => {
    const openTab: PaneContextValue["openTab"] = (target) => {
      if (target.kind === "agent") onSelectChat(target.agentId);
      else if (target.kind === "draft") onSelectChat(null, target.draftId);
      else navigateToWorkspace({ serverId, workspaceId, target });
    };
    return {
      serverId,
      workspaceId,
      host: "main",
      tabId: agentId ?? owner,
      target: agentId ? { kind: "agent", agentId } : { kind: "draft", draftId: owner },
      openTab,
      openPreferredTarget: openTab,
      openTargetToSide: openTab,
      closeCurrentTab: () => onSelectChat(null),
      retargetCurrentTab: openTab,
      setCurrentTabState: () => {},
      openFileInWorkspace: ({ location }) => openTab({ kind: "file", ...location }),
      openImportSheet: () => {},
    };
  }, [agentId, onSelectChat, owner, serverId, workspaceId]);
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
    <View style={styles.container} testID="bots-native-chat">
      {!agentId && <NativeBotChatDraft {...props} active={active} />}
      {agentId && workspaceId && <AgentConversationPanel />}
      {agentId && !workspaceId && <ThemedLoadingSpinner uniProps={spinnerColor} />}
    </View>
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
                  isPaneFocused: active,
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

const styles = StyleSheet.create({ container: { flex: 1, minWidth: 0 } });
