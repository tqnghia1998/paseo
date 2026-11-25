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
  it("uses the live model and exact provider profile without forwarding stale thinking options", () => {
    const result = prepareBotChatTitle(
      {
        provider: "custom-codex",
        labels: { "paseo-bots.bot": "general" },
        runtimeInfo: { model: "routed--current" },
        config: { model: "old-model", thinkingOptionId: "xhigh" },
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
      cwd: "/isolated",
      internal: true,
      providerOptions: { restrictToConfiguredMcp: true },
      mcpServers: {},
    });
    expect(result.agentConfig.thinkingOptionId).toBeUndefined();
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
      createAgent: vi.fn(
        async (): Promise<{
          id: string;
          provider: string;
          config: { model?: string };
          runtimeInfo?: { model?: string | null };
        }> => ({
          id: "temporary",
          provider: "codex",
          config: { model: "relay--example" },
        }),
      ),
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

  it("supports Antigravity chats including legacy combined model IDs and default model selection", async () => {
    const manager = setup();
    manager.getProviderAdapter.mockReturnValue("antigravity");
    manager.createAgent.mockResolvedValueOnce({
      id: "temporary-agy",
      provider: "antigravity",
      config: { model: "gemini-4-neon-high" },
      runtimeInfo: { model: "gemini-4-neon" },
    });
    await expect(
      suggestBotChatTitle(manager, "chat-agy", async () => ({
        provider: "antigravity",
        labels: { "paseo-bots.bot": "general" },
        config: { model: "gemini-4-neon-high", thinkingOptionId: "high" },
        internal: false,
      })),
    ).resolves.toBe("Fix the login flow");
    expect(manager.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "antigravity",
        model: "gemini-4-neon-high",
        internal: true,
        providerOptions: { restrictToConfiguredMcp: true },
        mcpServers: {},
      }),
      undefined,
      { persistSession: false, workspaceId: undefined },
    );
    expect(manager.createAgent.mock.calls[0]?.[0].thinkingOptionId).toBeUndefined();
    expect(manager.closeAgent).toHaveBeenCalledWith("temporary-agy");
    expect(manager.deleteAgentState).toHaveBeenCalledWith("temporary-agy");

    manager.createAgent.mockResolvedValueOnce({
      id: "temporary-default",
      provider: "antigravity",
      config: { model: "gemini-4-neon" },
      runtimeInfo: { model: "gemini-4-neon" },
    });
    await expect(
      suggestBotChatTitle(manager, "chat-default", async () => ({
        provider: "antigravity",
        labels: { "paseo-bots.bot": "general" },
        config: { model: "default" },
        internal: false,
      })),
    ).resolves.toBe("Fix the login flow");
  });

  it("fails closed on unsupported providers and config or runtime model substitution", async () => {
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

    manager.createAgent.mockResolvedValueOnce({
      id: "temporary-runtime-fallback",
      provider: "codex",
      config: { model: "relay--example" },
      runtimeInfo: { model: "different-runtime-model" },
    });
    await expect(suggestBotChatTitle(manager, "chat", load)).rejects.toThrow(/exact model/);
    expect(manager.deleteAgentState).toHaveBeenCalledWith("temporary-runtime-fallback");
  });

  it("times out hung agent creation or runs without unhandled rejections and cleans up late agents", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const manager = setup();
      let rejectRun: ((error: Error) => void) | undefined;
      manager.runAgent.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRun = reject;
          }),
      );
      manager.closeAgent.mockImplementationOnce(async () => {
        rejectRun?.(new Error("Agent closed"));
      });
      const pendingRun = suggestBotChatTitle(manager, "chat-timeout-run", load);
      const assertion = expect(pendingRun).rejects.toThrow(/timed out/);
      await vi.waitFor(() => expect(manager.runAgent).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      await Promise.resolve();
      expect(manager.closeAgent).toHaveBeenCalledWith("temporary");
      expect(unhandled).toEqual([]);

      let resolveLateCreate:
        | ((agent: { id: string; provider: string; config: { model?: string } }) => void)
        | undefined;
      manager.createAgent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLateCreate = resolve;
          }),
      );
      const pendingCreate = suggestBotChatTitle(manager, "chat-timeout-create", load);
      const createAssertion = expect(pendingCreate).rejects.toThrow(/timed out/);
      await vi.waitFor(() => expect(manager.createAgent).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(30_000);
      await createAssertion;
      resolveLateCreate?.({
        id: "late-agent",
        provider: "codex",
        config: { model: "relay--example" },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.closeAgent).toHaveBeenCalledWith("late-agent");
      expect(manager.deleteAgentState).toHaveBeenCalledWith("late-agent");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });
});
