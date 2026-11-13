import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

function baseProvider(id, providerOverrides) {
  const seen = new Set();
  while (id && !seen.has(id)) {
    if (["claude", "codex", "opencode", "pi"].includes(id)) return id;
    seen.add(id);
    id = providerOverrides[id]?.extends;
  }
  return null;
}

function supportedProvider(id, providerOverrides) {
  return ["claude", "codex", "pi"].includes(baseProvider(id, providerOverrides));
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

function decodePartialJsonString(rawSlice) {
  let clean = rawSlice;
  let trailingBackslashes = 0;
  for (let idx = clean.length - 1; idx >= 0 && clean[idx] === "\\"; idx -= 1) {
    trailingBackslashes += 1;
  }
  if (trailingBackslashes % 2 === 1) {
    clean = clean.slice(0, -1);
  }
  const trailingUnicode = /\\u[0-9a-fA-F]{0,3}$/.exec(clean);
  if (trailingUnicode) {
    clean = clean.slice(0, trailingUnicode.index);
  }
  try {
    return JSON.parse(`"${clean}"`);
  } catch {
    return clean
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function applyPlanStringField(top, rawValue, currentView, currentUnresolved) {
  if (top?.kind !== "object" || !top.lastKey) return;
  const key = top.lastKey;
  top.lastKey = null;
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!trimmed) return;
  switch (top.role) {
    case "view":
      if (key === "title" && currentView) currentView.title = trimmed;
      break;
    case "case":
      if (key === "purpose" && currentView) currentView.purposes.push(trimmed);
      break;
    case "unresolvedItem":
      if (currentUnresolved && ["file", "reason"].includes(key)) currentUnresolved[key] = trimmed;
      break;
  }
}

function readPlanString(source, start) {
  let end = start + 1;
  while (end < source.length) {
    if (source[end] === "\\") {
      end += 2;
      continue;
    }
    if (source[end] === '"')
      return { value: JSON.parse(source.slice(start, end + 1)), end, complete: true };
    end += 1;
  }
  return {
    value: decodePartialJsonString(source.slice(start + 1)),
    end,
    complete: false,
  };
}

function planContainerRole(top, kind) {
  if (kind === "array") {
    const roles = { "root:views": "views", "view:cases": "cases", "root:unresolved": "unresolved" };
    return roles[`${top?.role}:${top?.lastKey}`] ?? "other";
  }
  if (!top) return "root";
  return { views: "view", cases: "case", unresolved: "unresolvedItem" }[top.role] ?? "other";
}

function extractPartialPlanProgress(source) {
  const views = [];
  const unresolved = [];
  const stack = [];
  let currentView = null;
  let currentUnresolved = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const top = stack[stack.length - 1];
    if (ch === '"') {
      let token;
      try {
        token = readPlanString(source, i);
      } catch {
        break;
      }
      if (!token.complete) {
        applyPlanStringField(top, token.value, currentView, currentUnresolved);
        break;
      }
      i = token.end;
      let k = token.end + 1;
      while (k < source.length && /\s/.test(source[k])) k += 1;
      if (source[k] === ":" && top?.kind === "object") {
        top.lastKey = token.value;
        i = k;
        continue;
      }
      applyPlanStringField(top, token.value, currentView, currentUnresolved);
      continue;
    }
    if (ch === "{") {
      const role = planContainerRole(top, "object");
      if (role === "view") {
        currentView = { title: "", purposes: [] };
        views.push(currentView);
      } else if (role === "unresolvedItem") {
        currentUnresolved = { file: "", reason: "" };
        unresolved.push(currentUnresolved);
      }
      if (top?.kind === "object") top.lastKey = null;
      stack.push({ kind: "object", role, lastKey: null });
    } else if (ch === "[") {
      const role = planContainerRole(top, "array");
      if (top?.kind === "object") top.lastKey = null;
      stack.push({ kind: "array", role, lastKey: null });
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }
  return { views, unresolved };
}

export function createMockPlannerBridge({ manager, structured, catalog, providerOverrides }) {
  const active = new Map();
  const supported = (id) => supportedProvider(id, providerOverrides);
  const list = async () =>
    (await catalog())
      .filter((entry) => baseProvider(entry.provider, providerOverrides) !== "opencode")
      .map((entry) => ({
        provider: entry.provider,
        label: entry.label ?? entry.provider,
        supportsMockPlanning: supported(entry.provider),
        enabled: entry.enabled !== false && entry.status === "ready" && supported(entry.provider),
        reason: !supported(entry.provider)
          ? "Mock planning is not supported for this harness yet."
          : (entry.error ?? (entry.status === "ready" ? "" : "Harness unavailable.")),
        models: (entry.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .map(
            ({
              id,
              label,
              isDefault,
              thinkingOptions,
              defaultThinkingOptionId,
              contextWindowMaxTokens,
            }) => {
              const value = { id, label, isDefault: isDefault === true };
              if (Number.isSafeInteger(contextWindowMaxTokens) && contextWindowMaxTokens > 0)
                value.contextWindowMaxTokens = contextWindowMaxTokens;
              if (thinkingOptions) value.thinkingOptions = thinkingOptions;
              if (defaultThinkingOptionId) value.defaultThinkingOptionId = defaultThinkingOptionId;
              return value;
            },
          ),
      }));
  return {
    list,
    async cancel(id) {
      const entry = active.get(id);
      if (!entry) return;
      entry.cancelled = true;
      await manager.cancelAgentRun(entry.agentId).catch(() => {});
    },
    async generate(id, input, onProgress) {
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
            ...(baseProvider(input.provider, providerOverrides) === "pi"
              ? {}
              : { toolPolicy: { preapproved: [] } }),
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
            const emitted = new Map();
            const pending = new Map();
            let flushTimer = null;
            let reasoningText = "";
            let assistantText = "";
            let sawStreamEvent = false;
            let toolCallDetected = false;
            const sendProgress = (progressId, role, text) => {
              if (entry.cancelled || toolCallDetected || !onProgress) return;
              if (emitted.get(progressId) === text) return;
              emitted.set(progressId, text);
              onProgress({ id: progressId, role, text });
            };
            const flushPending = () => {
              if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              for (const [progressId, item] of pending) {
                pending.delete(progressId);
                sendProgress(progressId, item.role, item.text);
              }
            };
            const emit = (progressId, role, text) => {
              if (entry.cancelled || toolCallDetected || !onProgress) return;
              const trimmed = text.trim();
              if (!trimmed || emitted.get(progressId) === trimmed) return;
              if (!emitted.has(progressId)) {
                flushPending();
                sendProgress(progressId, role, trimmed);
                return;
              }
              pending.set(progressId, { role, text: trimmed });
              if (!flushTimer) {
                flushTimer = setTimeout(flushPending, 100);
                flushTimer.unref?.();
              }
            };
            const consumeTimelineItem = (item) => {
              if (!item || entry.cancelled || toolCallDetected) return;
              if (item.type === "tool_call") {
                toolCallDetected = true;
                pending.clear();
                return;
              }
              if (item.type === "reasoning" && typeof item.text === "string" && item.text) {
                reasoningText += item.text;
                const paragraphs = reasoningText
                  .replace(/\r\n/g, "\n")
                  .split(/\n{2,}/)
                  .map((part) => part.trim())
                  .filter(Boolean);
                paragraphs.forEach((paragraph, index) => {
                  emit(`reasoning-${index}`, "assistant", paragraph);
                });
                return;
              }
              if (item.type === "assistant_message" && typeof item.text === "string" && item.text) {
                assistantText += item.text;
                const fenceIndex = assistantText.indexOf("```");
                const braceIndex = assistantText.indexOf("{");
                const jsonStart =
                  fenceIndex >= 0 && (braceIndex < 0 || fenceIndex < braceIndex)
                    ? fenceIndex
                    : braceIndex;
                const proseSource =
                  jsonStart >= 0 ? assistantText.slice(0, jsonStart) : assistantText;
                const proseParagraphs = proseSource
                  .replace(/\r\n/g, "\n")
                  .split(/\n{2,}/)
                  .map((part) => part.trim())
                  .filter(Boolean);
                proseParagraphs.forEach((paragraph, index) => {
                  emit(`assistant-${index}`, "assistant", paragraph);
                });
                if (braceIndex >= 0) {
                  const partial = extractPartialPlanProgress(assistantText.slice(braceIndex));
                  partial.views.forEach((view, index) => {
                    if (view.title) {
                      emit(`view-${index}`, "assistant", [view.title, ...view.purposes].join("\n"));
                    }
                  });
                  const streamedUnresolved = partial.unresolved.filter(
                    (entryItem) => entryItem.file && entryItem.reason,
                  );
                  if (streamedUnresolved.length) {
                    emit(
                      "unresolved",
                      "assistant",
                      `Unresolved needs\n${streamedUnresolved.map((entryItem) => `${entryItem.file}: ${entryItem.reason}`).join("\n")}`,
                    );
                  }
                }
              }
            };
            const unsubscribe =
              typeof manager.subscribe === "function"
                ? manager.subscribe(
                    (event) => {
                      if (
                        event?.type === "agent_stream" &&
                        event.agentId === entry.agentId &&
                        event.event?.type === "timeline"
                      ) {
                        sawStreamEvent = true;
                        consumeTimelineItem(event.event.item);
                      }
                    },
                    { agentId: entry.agentId, replayState: false },
                  )
                : null;
            let result;
            try {
              result = await manager.runAgent(entry.agentId, prompt);
              if (
                !sawStreamEvent &&
                !entry.cancelled &&
                !result?.canceled &&
                Array.isArray(result?.timeline) &&
                !result.timeline.some((item) => item.type === "tool_call")
              ) {
                for (const item of result.timeline) consumeTimelineItem(item);
              }
            } finally {
              unsubscribe?.();
              flushPending();
            }
            if (entry.cancelled || result.canceled) throw new Error("Planning cancelled");
            if (toolCallDetected || result.timeline?.some((item) => item.type === "tool_call"))
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
        value = await bridge.generate(message.id, message.input, (progress) => {
          if (process.connected)
            process.send({ channel: "mock-planner", id: message.id, progress });
        });
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
