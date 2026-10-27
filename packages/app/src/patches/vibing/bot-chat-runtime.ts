import type { AgentInputDraft } from "@/composer/draft/input-draft";
import type { NativeBotChatProps } from "./bot-chat-types";

export type BotChatRuntimeSelection = Pick<
  NonNullable<AgentInputDraft["composerState"]>,
  | "selectedProvider"
  | "effectiveModelId"
  | "effectiveModeId"
  | "effectiveThinkingOptionId"
  | "isModelLoading"
  | "modelError"
  | "featureValues"
  | "hasUserModifiedAgentSettings"
>;

export function botChatStartSettings(
  selection: BotChatRuntimeSelection | null,
): Pick<Parameters<NativeBotChatProps["onStart"]>[0], "agentSettings" | "inheritAgentSettings"> {
  if (!selection?.selectedProvider || selection.isModelLoading || !selection.effectiveModelId)
    throw new Error("Choose an available provider and model before starting this chat.");
  if (selection.modelError) throw new Error(selection.modelError);
  return {
    inheritAgentSettings: selection.hasUserModifiedAgentSettings,
    agentSettings: {
      provider: selection.selectedProvider,
      model: selection.effectiveModelId,
      modeId: selection.effectiveModeId || null,
      thinkingOptionId: selection.effectiveThinkingOptionId || null,
      featureValues: selection.featureValues,
    },
  };
}
