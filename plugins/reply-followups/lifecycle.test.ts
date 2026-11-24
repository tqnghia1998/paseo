import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { expect, it, vi } from "vitest";
import contribute from "./index.server.js";

function setup() {
  const addHook = vi.fn();
  contribute({ addHook } as unknown as PluginServerContext);
  const hooks = Object.fromEntries(addHook.mock.calls);
  const append = vi.fn().mockResolvedValue(undefined);
  const refetch = vi.fn();
  const context = {
    signal: new AbortController().signal,
    paseo: { agents: { ref: () => ({ timeline: { refetch, append } }) } },
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
  return { hooks, append, refetch, context, agent, event, page };
}

it("publishes completed-turn prompts and clears them when another turn starts", async () => {
  const { hooks, append, refetch, context, agent, event, page } = setup();
  refetch.mockResolvedValue(page);
  await hooks["agent.turn.after"](event, context);
  await hooks["agent.turn.before"]({ agent }, context);
  expect(append.mock.calls.map(([row]) => row.data.prompts)).toEqual([["Run tests"], []]);
});

it("does not publish a completed turn if a newer turn starts during the history read", async () => {
  const { hooks, append, refetch, context, agent, event, page } = setup();
  const read = Promise.withResolvers<typeof page>();
  refetch.mockReturnValue(read.promise);
  const completed = hooks["agent.turn.after"](event, context);
  await hooks["agent.turn.before"]({ agent }, context);
  read.resolve(page);
  await completed;
  expect(append).not.toHaveBeenCalled();
});
