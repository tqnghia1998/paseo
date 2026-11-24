import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { INSTRUCTIONS, readSuggestions, ROW_KIND } from "./shared/suggestions.js";

export default function contribute(server: PluginServerContext) {
  const pending = new Map<string, object>();
  const visible = new Set<string>();
  const agentRef = (id: string, context: PluginHookContext) => context.paseo.agents.ref(id);
  async function write(id: string, context: PluginHookContext, prompts: string[]) {
    await agentRef(id, context).timeline.append({
      type: "plugin",
      id: ROW_KIND,
      kind: ROW_KIND,
      version: 1,
      data: { prompts },
    });
  }
  async function clear(id: string, context: PluginHookContext) {
    pending.delete(id);
    if (visible.delete(id)) await write(id, context, []);
  }

  const stop = [
    server.addHook("agent.open.before", async ({ request }) => {
      if (request.background || request.purpose !== "interactive") return;
      return {
        ...request,
        appendSystemPrompt: [...(request.appendSystemPrompt ?? []), INSTRUCTIONS],
      };
    }),
    server.addHook("agent.turn.before", ({ agent }, context) => clear(agent.id, context)),
    server.addHook("agent.close.after", ({ agent }, context) => clear(agent.id, context)),
    server.addHook("agent.archive.after", ({ agent }, context) => clear(agent.id, context)),
    server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, context) => {
      if (agent.background || turnId === null || outcome.kind !== "completed") return;
      const token = {};
      pending.set(agent.id, token);
      try {
        const { entries } = await agentRef(agent.id, context).timeline.refetch({
          direction: "tail",
          limit: 1,
          wholeTurns: true,
        });
        const reply = entries.findLast(
          ({ turnId: rowTurn, item }) => rowTurn === turnId && item.type === "assistant_message",
        )?.item;
        if (
          reply?.type !== "assistant_message" ||
          pending.get(agent.id) !== token ||
          context.signal.aborted
        )
          return;
        const prompts = readSuggestions(reply.text);
        if (prompts.length === 0) return;
        visible.add(agent.id);
        await write(agent.id, context, prompts);
      } finally {
        if (pending.get(agent.id) === token) pending.delete(agent.id);
      }
    }),
  ];
  return () => {
    pending.clear();
    visible.clear();
    stop.forEach((remove) => remove());
  };
}
