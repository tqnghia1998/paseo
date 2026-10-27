import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type { AgentStreamEvent } from "../../server/agent/agent-sdk-types.js";

export const BOT_AUTO_RESUME_PROMPT =
  "Your previous turn was interrupted or failed before it completed. Continue the existing request from the saved conversation. First check the current work and any running commands; do not repeat completed actions. If the request is already complete or needs a user decision or permission, explain that and stop.";

interface Snapshot {
  labels: Record<string, string>;
  internal?: boolean;
  lifecycle: string;
  pendingPermissions: ReadonlyMap<string, unknown>;
}
interface Options {
  getAgent(id: string): Snapshot | null;
  // Admission is synchronous: null means busy; a promise owns an admitted run.
  resume(id: string, messageId: string): Promise<void> | null;
  logger: Pick<Logger, "info" | "warn">;
}
interface Recovery {
  turnId?: string;
  deadline?: number;
  messageId?: string;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
}
const INTERVAL_MS = 30_000;
const WINDOW_MS = 5 * 60_000;

/** Daemon-owned recovery survives hidden/unmounted Bots iframes, not daemon restarts. */
export function createBotAutoResume(options: Options) {
  const chats = new Map<string, Recovery>();
  const stopped = new WeakSet<Snapshot>();
  let closed = false;
  const eligible = (agent: Snapshot) =>
    !agent.internal &&
    Boolean(agent.labels["paseo-bots.bot"]) &&
    (agent.labels["paseo-bots.context"] ?? "workspace") === "workspace" &&
    !getParentAgentIdFromLabels(agent.labels) &&
    !agent.labels["paseo-bots.asked-by"];

  function clear(id: string) {
    const chat = chats.get(id);
    if (chat?.timer) clearTimeout(chat.timer);
    chats.delete(id);
  }
  function stop(id: string) {
    const agent = options.getAgent(id);
    if (agent && eligible(agent)) stopped.add(agent);
    clear(id);
  }
  function schedule(id: string, chat: Recovery) {
    if (chats.get(id) !== chat || closed) return;
    if (chat.timer) clearTimeout(chat.timer);
    if (chat.deadline === undefined || Date.now() > chat.deadline) {
      clear(id);
      return;
    }
    const delay = Math.min(INTERVAL_MS, chat.deadline - Date.now() + 1);
    chat.timer = setTimeout(() => retry(id, chat), delay);
    chat.timer.unref?.();
  }
  function retry(id: string, chat: Recovery) {
    if (closed || chats.get(id) !== chat) return;
    const agent = options.getAgent(id);
    if (
      !agent ||
      !eligible(agent) ||
      agent.lifecycle === "closed" ||
      agent.pendingPermissions.size > 0 ||
      chat.attempts >= 10 ||
      Date.now() > (chat.deadline ?? 0)
    ) {
      clear(id);
      return;
    }
    // Keep the original deadline even while a retry is running. Expiry never cancels it.
    schedule(id, chat);
    if (agent.lifecycle !== "idle" && agent.lifecycle !== "error") return;
    if (chats.get(id) !== chat) return;
    chat.messageId = randomUUID();
    try {
      const run = options.resume(id, chat.messageId);
      if (!run) return;
      chat.attempts++;
      options.logger.info(
        { agentId: id, attempt: chat.attempts },
        "Resuming interrupted Bots chat",
      );
      void run.catch((error) => {
        options.logger.warn({ agentId: id, err: error }, "Bots automatic resume failed");
      });
    } catch (error) {
      options.logger.warn({ agentId: id, err: error }, "Bots automatic resume admission failed");
    }
  }
  return {
    stop,
    prompt(id: string, messageId?: string) {
      if (!messageId || chats.get(id)?.messageId !== messageId) {
        clear(id);
        const agent = options.getAgent(id);
        if (agent) stopped.delete(agent);
      }
    },
    observe(id: string, event: AgentStreamEvent) {
      if (closed) return;
      if (event.type === "permission_requested") {
        stop(id);
        return;
      }
      if (event.type === "turn_started") {
        const agent = options.getAgent(id);
        if (!agent || !eligible(agent) || stopped.has(agent)) return;
        const chat = chats.get(id) ?? { attempts: 0 };
        chat.turnId = event.turnId;
        chats.set(id, chat);
        return;
      }
      if (
        event.type !== "turn_completed" &&
        event.type !== "turn_failed" &&
        event.type !== "turn_canceled"
      )
        return;
      const chat = chats.get(id);
      if (!chat || (event.turnId && chat.turnId && event.turnId !== chat.turnId)) return;
      if (event.type === "turn_completed") {
        clear(id);
        return;
      }
      chat.deadline ??= Date.now() + WINDOW_MS;
      schedule(id, chat);
    },
    close() {
      closed = true;
      for (const id of chats.keys()) clear(id);
    },
  };
}
