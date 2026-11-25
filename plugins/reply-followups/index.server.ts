import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { INSTRUCTIONS, readSuggestions, ROW_KIND } from "./shared/suggestions.js";

const PROMPT_PROVIDERS = new Set(["claude", "pi", "antigravity"]);
const CODEX_DIAGNOSTIC_TIMEOUT_MS = 1500;

async function supportsInstructions(
  provider: string,
  context: PluginHookContext,
): Promise<boolean> {
  if (PROMPT_PROVIDERS.has(provider)) return true;
  // Ask the daemon about its configured binary, not a codex found on the worker's PATH.
  // This also covers custom provider IDs backed by Codex.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const { diagnostic } = await Promise.race([
      context.paseo.providers.diagnostic(provider),
      new Promise<{ diagnostic: string }>((resolve) => {
        timeout = setTimeout(() => resolve({ diagnostic: "" }), CODEX_DIAGNOSTIC_TIMEOUT_MS);
      }),
    ]);
    if (!/^Codex\r?\n/.test(diagnostic)) return false;
    const version = /^  Version: (?:codex(?:-cli)? )?(\d+)\.(\d+)\.\d+(?:[-+\w.]*)\r?$/m.exec(
      diagnostic,
    );
    return !!version && (Number(version[1]) > 0 || Number(version[2]) >= 121);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export default function contribute(server: PluginServerContext) {
  const pending = new Map<string, object>();
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
  const stop = [
    server.addHook("agent.open.before", async ({ request }, context) => {
      if (request.background || request.purpose !== "interactive") return;
      if (!(await supportsInstructions(request.provider, context)) || context.signal.aborted)
        return;
      return {
        ...request,
        appendSystemPrompt: [...(request.appendSystemPrompt ?? []), INSTRUCTIONS],
      };
    }),
    server.addHook("agent.turn.before", async ({ agent }, context) => {
      pending.delete(agent.id);
      if (!agent.background && !context.signal.aborted) await write(agent.id, context, []);
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      pending.delete(agent.id);
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      pending.delete(agent.id);
    }),
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
        await write(agent.id, context, prompts);
      } finally {
        if (pending.get(agent.id) === token) pending.delete(agent.id);
      }
    }),
  ];
  return () => {
    pending.clear();
    stop.forEach((remove) => remove());
  };
}
