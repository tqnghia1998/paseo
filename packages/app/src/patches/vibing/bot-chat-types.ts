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
  onStart(message: {
    text: string;
    messageId: string;
    images: { data: string; mimeType: string }[];
    attachments: AgentAttachment[];
  }): Promise<string>;
}
