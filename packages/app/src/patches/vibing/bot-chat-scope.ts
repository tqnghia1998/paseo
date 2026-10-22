import { isEmbeddedLiveDesignMessaging } from "./focus-mode";

/** Private contract with the Bots plugin's CHAT_CONTEXT_LABEL. */
export function isBotChatContext(agent: { labels?: Record<string, string> }): boolean {
  return (
    (agent.labels?.["paseo-bots.context"] ?? "workspace") ===
    (isEmbeddedLiveDesignMessaging ? "live-design" : "workspace")
  );
}

export function botChatDraftId(botId: string, workspaceId: string): string {
  const prefix = isEmbeddedLiveDesignMessaging ? "paseo-bots-live-design" : "paseo-bots";
  return `${prefix}:${botId}:${workspaceId}`;
}

export function botChatSelectionKey(prefix: string, directory: string): string {
  return `${prefix}${isEmbeddedLiveDesignMessaging ? "live-design:" : ""}${directory}`;
}
