import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

function supportedProvider(id, providerOverrides) {
  const seen = new Set();
  while (id && !seen.has(id)) {
    if (["claude", "codex", "opencode"].includes(id)) return true;
    seen.add(id);
    id = providerOverrides[id]?.extends;
  }
  return false;
}

// Read Paseo's existing snapshot. A GET already warms cold providers in the daemon;
// forcing a refresh here discards that cache and blocks on unrelated harnesses.
export function readMockPlannerCatalog(port, providerOverrides = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const requestId = randomUUID();
    let receivedSnapshot = false;
    const timer = setTimeout(
      () => finish(new Error("Models took too long to load. Try Refresh.")),
      timeoutMs,
    );
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    };
    socket.on("error", finish);
    socket.on("close", () => finish(new Error("Harness catalog disconnected")));
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          type: "hello",
          clientId: `mock-catalog-${requestId}`,
          clientType: "cli",
          protocolVersion: 1,
          capabilities: { all_providers: true },
        }),
      ),
    );
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const reply = message.message;
        if (reply?.type === "status" && reply.payload?.status === "server_info")
          socket.send(
            JSON.stringify({
              type: "session",
              message: { type: "get_providers_snapshot_request", requestId },
            }),
          );
        const snapshot =
          reply?.type === "get_providers_snapshot_response" &&
          reply.payload?.requestId === requestId;
        if (snapshot) receivedSnapshot = true;
        const update =
          receivedSnapshot && reply?.type === "providers_snapshot_update" && !reply.payload?.cwd;
        if (snapshot || update) {
          const entries = reply.payload.entries;
          if (!Array.isArray(entries)) throw new Error("Invalid harness catalog");
          const warming = entries.some(
            (entry) =>
              entry.enabled !== false &&
              supportedProvider(entry.provider, providerOverrides) &&
              entry.status === "loading",
          );
          if (!warming) finish(null, entries);
        }
      } catch (error) {
        finish(error);
      }
    });
  });
}

export function createMockPlannerBridge({ manager, structured, catalog, providerOverrides }) {
  const active = new Map();
  const supported = (id) => supportedProvider(id, providerOverrides);
  const list = async () =>
    (await catalog()).map((entry) => ({
      provider: entry.provider,
      label: entry.label ?? entry.provider,
      supportsMockPlanning: supported(entry.provider),
      enabled: entry.enabled !== false && entry.status === "ready" && supported(entry.provider),
      reason: !supported(entry.provider)
        ? "Mock planning is not supported for this harness yet."
        : (entry.error ?? (entry.status === "ready" ? "" : "Harness unavailable.")),
      models: (entry.models ?? [])
        .filter((model) => model.isSelectable !== false)
        .map(({ id, label, isDefault, thinkingOptions, defaultThinkingOptionId }) => {
          const value = { id, label, isDefault: isDefault === true };
          if (thinkingOptions) value.thinkingOptions = thinkingOptions;
          if (defaultThinkingOptionId) value.defaultThinkingOptionId = defaultThinkingOptionId;
          return value;
        }),
    }));
  return {
    list,
    async cancel(id) {
      const entry = active.get(id);
      if (!entry) return;
      entry.cancelled = true;
      await manager.cancelAgentRun(entry.agentId).catch(() => {});
    },
    async generate(id, input) {
      if (active.has(id)) throw new Error("Planner request already running");
      const entry = { agentId: randomUUID(), cancelled: false };
      active.set(id, entry);
      let cwd;
      let created = false;
      try {
        const provider = (await list()).find((item) => item.provider === input.provider);
        if (!provider?.enabled || !provider.models.some((model) => model.id === input.model))
          throw new Error(provider?.reason || "Selected harness/model is unavailable.");
        const model = provider.models.find((candidate) => candidate.id === input.model);
        if (
          input.thinkingOptionId !== undefined &&
          !model.thinkingOptions?.some((option) => option.id === input.thinkingOptionId)
        )
          throw new Error("Selected thinking effort is unavailable for this model.");
        if (entry.cancelled) throw new Error("Planning cancelled");
        cwd = await mkdtemp(path.join(tmpdir(), "vibing-mock-planner-"));
        await manager.createAgent(
          {
            provider: input.provider,
            model: input.model,
            cwd,
            internal: true,
            ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
            systemPrompt:
              "Follow only the fixed Mock System rulebook supplied in the request. Use only the supplied evidence and return structured plans. Do not use tools.",
            mcpServers: {},
            toolPolicy: { preapproved: [] },
            providerOptions: { restrictToConfiguredMcp: true },
          },
          entry.agentId,
          { persistSession: false },
        );
        created = true;
        if (entry.cancelled) throw new Error("Planning cancelled");
        const plan = await structured({
          prompt: input.prompt,
          schema: input.schema,
          maxRetries: 0,
          schemaName: "MockPlan",
          caller: async (prompt) => {
            const result = await manager.runAgent(entry.agentId, prompt);
            if (entry.cancelled || result.canceled) throw new Error("Planning cancelled");
            if (result.timeline?.some((item) => item.type === "tool_call"))
              throw new Error(
                "Planner attempted a tool call. Planning must use only the supplied evidence.",
              );
            return (
              result.finalText ??
              result.timeline?.findLast((item) => item.type === "assistant_message")?.text ??
              ""
            );
          },
        });
        if (entry.cancelled) throw new Error("Planning cancelled");
        return plan;
      } finally {
        if (created) {
          await manager.closeAgent(entry.agentId).catch(() => {});
          await manager.deleteAgentState(entry.agentId).catch(() => {});
        }
        active.delete(id);
        if (cwd) await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

export function attachMockPlannerIpc(bridge) {
  if (!process.send) return;
  process.on("message", async (message) => {
    if (message?.channel !== "mock-planner" || typeof message.id !== "string") return;
    try {
      let value;
      if (message.action === "catalog") value = await bridge.list();
      else if (message.action === "cancel") value = await bridge.cancel(message.targetId);
      else if (message.action === "generate")
        value = await bridge.generate(message.id, message.input);
      else throw new Error("Unknown planner action");
      if (process.connected) process.send({ channel: "mock-planner", id: message.id, value });
    } catch (error) {
      if (process.connected)
        process.send({
          channel: "mock-planner",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  });
}
