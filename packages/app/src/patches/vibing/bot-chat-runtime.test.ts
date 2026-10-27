import { describe, expect, it } from "vitest";
import { botChatStartSettings, type BotChatRuntimeSelection } from "./bot-chat-runtime";

const resolvedDefault: BotChatRuntimeSelection = {
  selectedProvider: "codex",
  effectiveModelId: "resolved-provider-default",
  effectiveModeId: "full-access",
  effectiveThinkingOptionId: "high",
  isModelLoading: false,
  modelError: null,
  featureValues: { planMode: true },
  hasUserModifiedAgentSettings: false,
};

describe("Bots starting runtime", () => {
  it("keeps automatic defaults local to the lead", () => {
    const result = botChatStartSettings(resolvedDefault);
    expect(result.inheritAgentSettings).toBe(false);
    expect(result.agentSettings).toEqual({
      provider: "codex",
      model: "resolved-provider-default",
      modeId: "full-access",
      thinkingOptionId: "high",
      featureValues: { planMode: true },
    });
  });

  it("freezes an explicitly selected provider default for the lead and members", () => {
    const selection = { ...resolvedDefault, hasUserModifiedAgentSettings: true };
    const result = botChatStartSettings(selection);
    selection.effectiveModelId = "later-default";
    expect(result.inheritAgentSettings).toBe(true);
    expect(result.agentSettings?.model).toBe("resolved-provider-default");
  });

  it("keeps a specific chosen model and thinking level for delegation", () => {
    const result = botChatStartSettings({
      ...resolvedDefault,
      effectiveModelId: "gpt-chosen",
      effectiveThinkingOptionId: "max",
      hasUserModifiedAgentSettings: true,
    });
    expect(result).toMatchObject({
      inheritAgentSettings: true,
      agentSettings: { provider: "codex", model: "gpt-chosen", thinkingOptionId: "max" },
    });
  });

  it.each([
    null,
    { ...resolvedDefault, selectedProvider: null },
    { ...resolvedDefault, effectiveModelId: "" },
    { ...resolvedDefault, isModelLoading: true },
    { ...resolvedDefault, modelError: "Models unavailable" },
  ])("rejects unresolved or failed choices before creating a chat", (selection) => {
    expect(() => botChatStartSettings(selection)).toThrow();
  });
});
