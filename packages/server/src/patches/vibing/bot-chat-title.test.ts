import { describe, expect, it, vi } from "vitest";
import {
  canAutoTitleBotChat,
  prepareBotChatTitle,
  resolveLowestTitleThinkingOption,
  suggestBotChatTitle,
  TITLE_MODEL_LOOKUP_TIMEOUT_MS,
  TITLE_TIMEOUT_MS,
} from "./bot-chat-title.js";

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

  it("picks the lowest supported thinking option for title generation across models and falls back safely", async () => {
    const models = [
      {
        id: "gemini-4-carbon",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        id: "gemini-4-neon",
        isDefault: true,
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
          { id: "xhigh", label: "Extra" },
        ],
      },
      {
        id: "claude-sonnet-5-5",
        aliases: ["sonnet"],
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        id: "gemini-pro-orchestrator",
        thinkingOptions: [],
      },
    ];

    expect(resolveLowestTitleThinkingOption("antigravity", "gemini-4-carbon", models)).toBe("low");
    expect(resolveLowestTitleThinkingOption("antigravity", "gemini-4-neon-high", models)).toBe(
      "low",
    );
    expect(resolveLowestTitleThinkingOption("antigravity", "default", models)).toBe("low");
    expect(resolveLowestTitleThinkingOption("claude", "sonnet", models)).toBe("off");
    expect(
      resolveLowestTitleThinkingOption("antigravity", "gemini-pro-orchestrator", models),
    ).toBeUndefined();

    const manager = setup();
    manager.getProviderAdapter.mockReturnValue("antigravity");
    manager.createAgent.mockResolvedValueOnce({
      id: "temporary-carbon",
      provider: "antigravity",
      config: { model: "gemini-4-carbon" },
      runtimeInfo: { model: "gemini-4-carbon" },
    });
    const listModels = vi.fn(async () => models);
    await expect(
      suggestBotChatTitle(
        manager,
        "chat-carbon",
        async () => ({
          provider: "antigravity",
          cwd: "/workspace",
          labels: { "paseo-bots.bot": "general" },
          config: { model: "gemini-4-carbon", thinkingOptionId: "high" },
          internal: false,
        }),
        undefined,
        listModels,
      ),
    ).resolves.toBe("Fix the login flow");
    expect(listModels).toHaveBeenCalledWith("antigravity", "/workspace");
    expect(manager.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "antigravity",
        model: "gemini-4-carbon",
        thinkingOptionId: "low",
        providerOptions: { restrictToConfiguredMcp: true },
        mcpServers: {},
      }),
      undefined,
      { persistSession: false, workspaceId: undefined },
    );

    // Model catalog failure must not block title generation.
    manager.createAgent.mockResolvedValueOnce({
      id: "temporary-fallback",
      provider: "antigravity",
      config: { model: "gemini-4-carbon" },
      runtimeInfo: { model: "gemini-4-carbon" },
    });
    await expect(
      suggestBotChatTitle(
        manager,
        "chat-catalog-err",
        async () => ({
          provider: "antigravity",
          labels: { "paseo-bots.bot": "general" },
          config: { model: "gemini-4-carbon" },
          internal: false,
        }),
        undefined,
        async () => {
          throw new Error("catalog unavailable");
        },
      ),
    ).resolves.toBe("Fix the login flow");
    expect(manager.createAgent.mock.calls[1]?.[0].thinkingOptionId).toBeUndefined();
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
      await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
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
      await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
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

      // A stalled model catalog lookup must fall back after TITLE_MODEL_LOOKUP_TIMEOUT_MS
      // instead of consuming the entire TITLE_TIMEOUT_MS budget.
      const slowListModels = vi.fn(() => new Promise<never>(() => {}));
      const slowLookupPending = suggestBotChatTitle(
        manager,
        "chat-slow-models",
        load,
        undefined,
        slowListModels,
      );
      await vi.waitFor(() => expect(slowListModels).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(TITLE_MODEL_LOOKUP_TIMEOUT_MS);
      await expect(slowLookupPending).resolves.toBe("Fix the login flow");
      expect(manager.createAgent).toHaveBeenCalledTimes(3);
      expect(manager.createAgent.mock.calls[2]?.[0].thinkingOptionId).toBeUndefined();

      // If the overall timeout fires before createAgent (e.g. during loadChat), createAgent must not run.
      let resolveLateLoad: ((chat: Awaited<ReturnType<typeof load>>) => void) | undefined;
      const lateLoad = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<typeof load>>>((resolve) => {
            resolveLateLoad = resolve;
          }),
      );
      const pendingLoad = suggestBotChatTitle(manager, "chat-timeout-load", lateLoad);
      const loadAssertion = expect(pendingLoad).rejects.toThrow(/timed out/);
      await vi.waitFor(() => expect(lateLoad).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
      await loadAssertion;
      resolveLateLoad?.(await load());
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.createAgent).toHaveBeenCalledTimes(3);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });
});
