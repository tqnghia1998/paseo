import { describe, expect, it, vi } from "vitest";
import { canAutoTitleBotChat, prepareBotChatTitle, suggestBotChatTitle } from "./bot-chat-title.js";

it("waits for a substantive message and excludes explicitly named or background bots", () => {
  const chat = { labels: { "paseo-bots.bot": "general" } };
  const greeting = { type: "user_message", text: "Hi!" };
  const request = { type: "user_message", text: "Tell me the names of ten cats" };
  expect(canAutoTitleBotChat(chat, [greeting])).toBe(false);
  expect(canAutoTitleBotChat(chat, [greeting, request])).toBe(true);
  expect(canAutoTitleBotChat({ ...chat, background: true }, [request])).toBe(false);
  expect(canAutoTitleBotChat({ labels: { "paseo-bots.bot": "vibing-chief" } }, [request])).toBe(
    false,
  );
});

describe("prepareBotChatTitle", () => {
  it("uses the live model and exact provider profile with only bounded user text", () => {
    const result = prepareBotChatTitle(
      {
        provider: "custom-codex",
        labels: { "paseo-bots.bot": "general" },
        runtimeInfo: { model: "routed--current" },
        config: { model: "old-model", thinkingOptionId: "high" },
      },
      [
        { type: "user_message", text: "Fix login" },
        { type: "assistant_message", text: "Do not send this" },
        { type: "user_message", text: "x".repeat(10_000) },
      ],
      "/isolated",
    );
    expect(result.agentConfig).toMatchObject({
      provider: "custom-codex",
      model: "routed--current",
      thinkingOptionId: "high",
      cwd: "/isolated",
      internal: true,
      providerOptions: { restrictToConfiguredMcp: true },
      mcpServers: {},
    });
    const { userRequests } = JSON.parse(result.prompt);
    expect(userRequests[0]).toBe("Fix login");
    expect(userRequests[1]).toHaveLength(800);
    expect(result.prompt).not.toContain("Do not send this");
    expect(result.agentConfig.systemPrompt).toContain("2-4 words");
    expect(result.agentConfig.systemPrompt).toContain("Pet Names");
  });

  it("does not stage a request without an explicit effective model or text", () => {
    const chat = { provider: "codex", labels: { "paseo-bots.bot": "general" }, config: {} };
    expect(() => prepareBotChatTitle(chat, [], "/isolated")).toThrow(/model/);
    expect(() =>
      prepareBotChatTitle({ ...chat, config: { model: "gpt" } }, [], "/isolated"),
    ).toThrow(/messages/);
    expect(() => prepareBotChatTitle({ ...chat, labels: {} }, [], "/isolated")).toThrow(
      /Bots chat/,
    );
  });
});

describe("suggestBotChatTitle", () => {
  const load = async () => ({
    provider: "codex",
    labels: { "paseo-bots.bot": "general" },
    config: { model: "relay--example" },
    internal: false,
  });

  function setup() {
    return {
      getProviderAdapter: vi.fn(() => "codex"),
      getTimelineRows: vi.fn(async () => [
        { seq: 1, timestamp: "", item: { type: "user_message" as const, text: "Fix login" } },
      ]),
      createAgent: vi.fn(async () => ({
        id: "temporary",
        provider: "codex",
        config: { model: "relay--example" },
      })),
      runAgent: vi.fn(async () => ({
        sessionId: "temporary",
        finalText: '{"title":"Fix the login flow"}',
        timeline: [],
      })),
      closeAgent: vi.fn(async () => {}),
      deleteAgentState: vi.fn(async () => {}),
    };
  }

  it("runs once in a non-persisted agent and returns a suggestion without renaming", async () => {
    const manager = setup();
    await expect(suggestBotChatTitle(manager, "chat", load)).resolves.toBe("Fix the login flow");
    expect(manager.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "relay--example", internal: true }),
      undefined,
      { persistSession: false, workspaceId: undefined },
    );
    expect(manager.runAgent).toHaveBeenCalledOnce();
    expect(manager.closeAgent).toHaveBeenCalledWith("temporary");
    expect(manager.deleteAgentState).toHaveBeenCalledWith("temporary");
  });

  it("fails closed on unsupported providers and model substitution", async () => {
    const manager = setup();
    manager.getProviderAdapter.mockReturnValueOnce("opencode");
    await expect(suggestBotChatTitle(manager, "chat", load)).rejects.toThrow(/tool-free/);
    expect(manager.createAgent).not.toHaveBeenCalled();
    manager.createAgent.mockResolvedValueOnce({
      id: "temporary",
      provider: "codex",
      config: { model: "fallback" },
    });
    await expect(suggestBotChatTitle(manager, "chat", load)).rejects.toThrow(/exact model/);
    expect(manager.runAgent).not.toHaveBeenCalled();
    expect(manager.deleteAgentState).toHaveBeenCalledWith("temporary");
  });
});
