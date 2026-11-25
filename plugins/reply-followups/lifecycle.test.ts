import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { expect, it, vi } from "vitest";
import contribute from "./index.server.js";

function setup() {
  const addHook = vi.fn();
  contribute({ addHook } as unknown as PluginServerContext);
  const hooks = Object.fromEntries(addHook.mock.calls);
  const append = vi.fn().mockResolvedValue(undefined);
  const refetch = vi.fn();
  const diagnostic = vi.fn();
  const context = {
    signal: new AbortController().signal,
    paseo: {
      agents: { ref: () => ({ timeline: { refetch, append } }) },
      providers: { diagnostic },
    },
  } as unknown as PluginHookContext;
  const agent = { id: "chat", background: false };
  const event = { agent, turnId: "turn-1", outcome: { kind: "completed" } };
  const page = {
    entries: [
      {
        turnId: "turn-1",
        item: {
          type: "assistant_message",
          text: "Done.\n\n**Possible next prompts**\n- Run tests",
        },
      },
    ],
  };
  return { hooks, append, refetch, diagnostic, context, agent, event, page };
}

it.each([
  ["codex-cli 0.120.0", false],
  ["codex-cli 0.121.0", true],
  ["codex-cli 1.0.0", true],
  ["unknown", false],
])("gates Codex instructions for %s", async (version, supported) => {
  const { hooks, diagnostic, context } = setup();
  diagnostic.mockResolvedValue({ diagnostic: `Codex\n  Version: ${version}\n  Models: 8` });
  const result = await hooks["agent.open.before"](
    { request: { provider: "codex", purpose: "interactive" } },
    context,
  );
  expect(Boolean(result?.appendSystemPrompt?.length)).toBe(supported);
});

it("leaves chat startup intact when checking Codex fails", async () => {
  const { hooks, diagnostic, context } = setup();
  diagnostic.mockRejectedValue(new Error("not available"));
  await expect(
    hooks["agent.open.before"]({ request: { provider: "codex", purpose: "interactive" } }, context),
  ).resolves.toBeUndefined();
});

it("uses the daemon's diagnostic for a custom Codex provider ID", async () => {
  const { hooks, diagnostic, context } = setup();
  diagnostic.mockResolvedValue({ diagnostic: "Codex\n  Version: codex-cli 0.121.0" });
  const result = await hooks["agent.open.before"](
    { request: { provider: "work-codex", purpose: "interactive" } },
    context,
  );
  expect(diagnostic).toHaveBeenCalledWith("work-codex");
  expect(result?.appendSystemPrompt).toHaveLength(1);
});

it("does not hold chat startup open when diagnostics stall", async () => {
  vi.useFakeTimers();
  try {
    const { hooks, diagnostic, context } = setup();
    diagnostic.mockReturnValue(new Promise(() => {}));
    const opening = hooks["agent.open.before"](
      { request: { provider: "codex", purpose: "interactive" } },
      context,
    );
    await vi.advanceTimersByTimeAsync(1500);
    await expect(opening).resolves.toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it.each(["claude", "pi", "antigravity"])(
  "passes instructions to %s without a probe",
  async (provider) => {
    const { hooks, diagnostic, context } = setup();
    const result = await hooks["agent.open.before"](
      { request: { provider, purpose: "interactive" } },
      context,
    );
    expect(result?.appendSystemPrompt).toHaveLength(1);
    expect(diagnostic).not.toHaveBeenCalled();
  },
);

it("publishes completed-turn prompts under a turn-scoped id and keeps earlier turns when another turn starts", async () => {
  const { hooks, append, refetch, context, agent, event, page } = setup();
  refetch.mockResolvedValue(page);
  await hooks["agent.turn.before"]({ agent, turnId: "turn-1" }, context);
  await hooks["agent.turn.after"](event, context);
  await hooks["agent.turn.before"]({ agent, turnId: "turn-2" }, context);
  await hooks["agent.turn.after"]({ ...event, turnId: "turn-2" }, context);
  expect(append.mock.calls.map(([row]) => ({ id: row.id, prompts: row.data.prompts }))).toEqual([
    { id: "reply-followups:turn-1", prompts: ["Run tests"] },
  ]);
});

it("does not write a placeholder row on a fresh turn", async () => {
  const { hooks, append, refetch, context, event } = setup();
  refetch.mockResolvedValue({ entries: [] });
  await hooks["agent.turn.before"](event, context);
  await hooks["agent.turn.after"](event, context);
  expect(append).not.toHaveBeenCalled();
});

it("does not write to a closed agent's timeline", async () => {
  const { hooks, append, refetch, context, agent, event, page } = setup();
  refetch.mockResolvedValue(page);
  await hooks["agent.turn.after"](event, context);
  await hooks["agent.close.after"]({ agent }, context);
  expect(append).toHaveBeenCalledTimes(1);
});

it("does not publish a completed turn if a newer turn starts during the history read", async () => {
  const { hooks, append, refetch, context, agent, event, page } = setup();
  const read = Promise.withResolvers<typeof page>();
  refetch.mockReturnValueOnce(read.promise);
  const completed = hooks["agent.turn.after"](event, context);
  await hooks["agent.turn.before"]({ agent, turnId: "turn-2" }, context);
  read.resolve(page);
  await completed;
  expect(append).not.toHaveBeenCalled();
});
