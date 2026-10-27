import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";

// Private host slot consumed by the vendored Bots patch; older hosts keep its own UI.
export interface NativeBotChatProps {
  serverId: string;
  botId: string;
  draftId?: string;
  agentId: string | null;
  workspaceId?: string | null;
  cwd: string;
  provider: AgentProvider;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  active: boolean;
  onSelectChat(agentId: string | null, draftId?: string): void;
  /** Labels that file an imported session under this bot; absent hides Import session. */
  importLabels?: Record<string, string>;
  /** Opens a session imported into this bot once the bot can list it. */
  onImported?(agentId: string): void;
  onStart(message: {
    text: string;
    messageId: string;
    images: { data: string; mimeType: string }[];
    attachments: AgentAttachment[];
    agentSettings?: {
      provider: AgentProvider;
      model: string | null;
      modeId: string | null;
      thinkingOptionId: string | null;
      featureValues?: Record<string, unknown>;
    };
  }): Promise<string>;
}
