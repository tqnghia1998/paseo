import { expect, test, vi } from "vitest";
import { createChiefBotBridge, CHIEF_BOT_TOOLS } from "./chief-bot.js";

test("the managed bridge never accepts a tool outside its fixed ceiling", async () => {
  const invoke = vi.fn(async () => ({ text: "ok" }));
  const bridge = createChiefBotBridge(invoke);
  await expect(bridge.call("agent", "ask_bot", {})).rejects.toThrow("Unsupported Chief Bot tool");
  await expect(bridge.call("agent", "propose_changes", {})).rejects.toThrow();
  // Chief never reads a handed-off chat's replies.
  await expect(bridge.call("agent", "check_chat", { chat_id: "x" })).rejects.toThrow(
    "Unsupported Chief Bot tool",
  );
  expect(invoke).not.toHaveBeenCalled();
  expect(CHIEF_BOT_TOOLS).toContain("read_memory");
  expect(CHIEF_BOT_TOOLS).not.toContain("check_chat");
});

test("handoffs reach the Bots plugin with the private broker secret", async () => {
  const invoke = vi.fn(async (method: string, input: Record<string, unknown>) =>
    method === "bots.chief.handoff"
      ? { chatId: input.agentId, botId: "reviewer", name: "Reviewer" }
      : { systemPrompt: "Chief" },
  );
  const bridge = createChiefBotBridge(invoke);
  const input = {
    agentId: "6f1c3b0e-8f6a-4a52-9a3f-0c1d2e3f4a5b",
    bot: "Reviewer",
    path: "/repo/feature",
    workspaceId: "wks",
    prompt: "Review",
    titleSuffix: "Review !1",
    labels: { "paseo-chief.app": "app" },
  };
  expect(await bridge.handoff(input)).toEqual({
    chatId: input.agentId,
    botId: "reviewer",
    name: "Reviewer",
  });
  expect(invoke).toHaveBeenCalledWith("bots.chief.handoff", {
    ...input,
    bridgeToken: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

test("prepare and service calls carry one private broker secret, never in the prompt", async () => {
  const invoke = vi.fn(async (_method: string, input: Record<string, unknown>) => {
    expect(input.bridgeToken).toMatch(/^[a-f0-9]{64}$/);
    return _method.endsWith("prepare")
      ? { systemPrompt: "My saved instructions and memory" }
      : { text: "saved" };
  });
  const bridge = createChiefBotBridge(invoke);
  expect(await bridge.prepare({ agentId: "host-minted-id", cwd: "/app" })).toBe(
    "My saved instructions and memory",
  );
  expect(
    await bridge.call("host-minted-id", "write_memory", {
      name: "MEMORY.md",
      text: "Preference",
    }),
  ).toBe("saved");
  expect(invoke.mock.calls[0]![1].bridgeToken).toBe(invoke.mock.calls[1]![1].bridgeToken);
});

test("missing or incompatible Bot plugin fails closed", async () => {
  await expect(
    createChiefBotBridge(async () => null).prepare({
      agentId: "chief",
      cwd: "/app",
    }),
  ).rejects.toThrow();
  await expect(
    createChiefBotBridge(async () => ({ systemPrompt: 4 })).prepare({
      agentId: "chief",
      cwd: "/app",
    }),
  ).rejects.toThrow();
});

test("plugin restart rebinds the same private capability before retrying a rejected call", async () => {
  let bound = false;
  const invoke = vi.fn(async (method: string) => {
    if (method === "bots.chief.prepare") {
      bound = true;
      return { systemPrompt: "Chief" };
    }
    if (!bound) throw new Error("Chief broker authorization failed");
    return { text: "memory" };
  });
  const bridge = createChiefBotBridge(invoke);
  await bridge.prepare({ agentId: "host-minted-id", cwd: "/app" });
  bound = false;
  expect(await bridge.call("host-minted-id", "read_memory", { name: "MEMORY.md" })).toBe("memory");
  expect(invoke.mock.calls.map(([method]) => method)).toEqual([
    "bots.chief.prepare",
    "bots.chief.call",
    "bots.chief.prepare",
    "bots.chief.call",
  ]);
});

test("uncertain writes are never retried", async () => {
  const invoke = vi.fn(async () => {
    throw new Error("Connection lost after write");
  });
  const bridge = createChiefBotBridge(invoke);
  await expect(
    bridge.call("canonical", "write_memory", { name: "MEMORY.md", text: "x" }),
  ).rejects.toThrow();
  expect(invoke).toHaveBeenCalledOnce();
});
