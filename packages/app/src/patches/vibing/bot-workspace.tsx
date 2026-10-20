import React, { useCallback } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useSessionStore } from "@/stores/session-store";
import { useEmbeddedWorkspace, getEmbeddedWorkspaceDirectory } from "./workspace-boundary";
import { useEmbeddedPromptActivation } from "./host-prompts";
import { useEmbeddedLiveDesignActivation } from "./live-design";
import { isEmbeddedLiveDesignMessaging } from "./focus-mode";

export interface BotWorkspaceBridgeProps {
  botId: string;
  selectedAgentId?: string | null;
  onActivate(target: { botId?: string; agentId?: string; draftId?: string }): void;
}

export function BotWorkspaceBridge({
  botId,
  selectedAgentId,
  onActivate,
}: BotWorkspaceBridgeProps) {
  const bound = useEmbeddedWorkspace();
  const activateConversation = useCallback(
    (agentId?: string, newChat = false) => {
      if (!bound) return;
      if (agentId) {
        const session = useSessionStore.getState().sessions[bound.serverId];
        const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
        if (!agent || agent.cwd !== getEmbeddedWorkspaceDirectory()) return;
        onActivate({ botId: agent.labels?.["paseo-bots.bot"] ?? "vibing-general", agentId });
        return;
      }
      const selected = selectedAgentId
        ? useSessionStore.getState().sessions[bound.serverId]?.agents.get(selectedAgentId)
        : null;
      if (newChat || (selectedAgentId && selected?.cwd !== getEmbeddedWorkspaceDirectory())) {
        const draftId = `paseo-bots:${botId}:${bound.workspaceId}:${crypto.randomUUID()}`;
        onActivate({ draftId });
        return draftId;
      }
      onActivate({});
    },
    [bound, botId, selectedAgentId, onActivate],
  );
  useEmbeddedPromptActivation({ enabled: Boolean(bound), activateConversation });
  useEmbeddedLiveDesignActivation({
    enabled: Boolean(bound) && isEmbeddedLiveDesignMessaging,
    workspaceId: bound?.workspaceId ?? "",
    activateConversation,
  });
  const openSettings = useCallback(() => router.push("/settings"), []);
  return (
    <View style={styles.actions}>
      <Button
        variant="ghost"
        size="xs"
        accessibilityRole="button"
        accessibilityLabel="Chat settings"
        onPress={openSettings}
      >
        Chat settings
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
  },
}));
