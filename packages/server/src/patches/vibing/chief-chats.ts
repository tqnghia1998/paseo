import type { AgentManager, ManagedAgent } from "../../server/agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../../server/agent/agent-storage.js";
import type { AgentTimelineRow } from "../../server/agent/agent-timeline-store-types.js";

/**
 * Bot chats as Chief sees them: list them, read what was said, delete idle ones and message
 * one. The Vibing backend owns the policy: reads are untrusted text and deletes and messages
 * wait for the user's approval there. This module still refuses what is never allowed
 * (Chief's own chat, hidden utility agents, a chat that is running or waiting on a person).
 */
export type ChatStatus = "working" | "needs-input" | "idle" | "failed";

export interface ChiefChatSummary {
  id: string;
  title: string;
  /** The Bot's id (`paseo-bots.bot`), or the name Chief saw when it handed the task off. */
  bot: string;
  botId: string | null;
  status: ChatStatus;
  workspaceId: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  /** Chief started it (a hand-off). */
  handedOff: boolean;
}

export interface ChiefChatDependencies {
  agentStorage: Pick<AgentStorage, "get" | "listActive">;
  agentManager: Pick<AgentManager, "getAgent">;
  /** Chief's own agent and anything retired by a restart: never listed or touched. */
  chiefOwns(id: string): boolean;
  /** The chat's timeline, loading the chat first when it is not in memory. */
  readRows(id: string): Promise<AgentTimelineRow[]>;
  /** Permanently deletes a chat like the user's own Delete. */
  deleteAgent(id: string): Promise<void>;
  /** Sends a message as a new turn. */
  send(id: string, text: string): Promise<void>;
}

const MAX_LISTED = 200;
const MAX_DELETE = 100;
const MAX_MESSAGE_TEXT = 4000;
const MAX_READ_CHARS = 30_000;
const MAX_SEND = 4000;
const HANDOFF_LABEL = "paseo-chief.handoff";
const HANDOFF_BOT_NAME_LABEL = "paseo-chief.bot-name";

function statusOf(
  live: ManagedAgent | null,
  record: StoredAgentRecord | null | undefined,
): ChatStatus {
  if (live) {
    if (live.pendingPermissions.size > 0) return "needs-input";
    if (live.lifecycle === "running" || live.lifecycle === "initializing" || live.activeTurnId)
      return "working";
    if (live.lifecycle === "error" || live.lastError) return "failed";
    return "idle";
  }
  if (record?.lastStatus === "error" || record?.lastError || record?.attentionReason === "error")
    return "failed";
  return "idle";
}

export function createChiefChats(deps: ChiefChatDependencies) {
  function summarize(record: StoredAgentRecord): ChiefChatSummary {
    const botId = record.labels["paseo-bots.bot"] ?? null;
    const handedOff = Boolean(record.labels[HANDOFF_LABEL]);
    return {
      id: record.id,
      title: (record.title?.trim() || "Untitled chat").slice(0, 200),
      bot: (record.labels[HANDOFF_BOT_NAME_LABEL] ?? botId ?? "Unknown").slice(0, 100),
      botId,
      status: statusOf(deps.agentManager.getAgent(record.id), record),
      workspaceId: record.workspaceId ?? null,
      cwd: record.cwd,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt ?? record.createdAt).toISOString(),
      handedOff,
    };
  }
  const visible = (record: StoredAgentRecord) =>
    !record.internal && !record.archivedAt && !deps.chiefOwns(record.id);

  async function lookup(id: string): Promise<StoredAgentRecord | null> {
    const record = await deps.agentStorage.get(id);
    return record && visible(record) ? record : null;
  }

  return {
    async list(filter: {
      botId?: string;
      status?: ChatStatus;
      workspaceId?: string;
      ids?: string[];
    }) {
      const wanted = filter.ids ? new Set(filter.ids) : null;
      const chats = (await deps.agentStorage.listActive())
        .filter(visible)
        .filter((record) => !wanted || wanted.has(record.id))
        .map(summarize)
        .filter(
          (chat) =>
            (!filter.botId || chat.botId === filter.botId) &&
            (!filter.status || chat.status === filter.status) &&
            (!filter.workspaceId || chat.workspaceId === filter.workspaceId),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { total: chats.length, chats: chats.slice(0, MAX_LISTED) };
    },

    /** What was said, oldest first among the most recent `limit` messages. */
    async read(chatId: string, limit = 12) {
      const record = await lookup(chatId);
      if (!record) return null;
      const rows = await deps.readRows(chatId);
      const messages: Array<{ role: "user" | "assistant" | "error"; text: string }> = [];
      let toolCalls = 0;
      let extendable = false;
      for (const { item } of rows) {
        if (item.type === "user_message") {
          messages.push({ role: "user", text: item.text });
          extendable = false;
        } else if (item.type === "assistant_message") {
          const last = messages.at(-1);
          // Streamed chunks of one reply arrive as consecutive items; a tool call in
          // between ends the reply.
          if (extendable && last?.role === "assistant") last.text += item.text;
          else messages.push({ role: "assistant", text: item.text });
          extendable = true;
        } else if (item.type === "error") {
          messages.push({ role: "error", text: item.message });
          extendable = false;
        } else if (item.type === "tool_call") {
          toolCalls += 1;
          extendable = false;
        }
      }
      const wanted = Math.min(Math.max(Math.floor(limit), 1), 50);
      const tail = messages.slice(-wanted);
      // Newest first while the character budget lasts, then back to reading order.
      let budget = MAX_READ_CHARS;
      const kept: typeof tail = [];
      for (const message of tail.toReversed()) {
        const text =
          message.text.length > MAX_MESSAGE_TEXT
            ? `${message.text.slice(0, MAX_MESSAGE_TEXT)}…`
            : message.text;
        const allowed = Math.max(budget, 0);
        budget -= text.length;
        const shown = text.length > allowed ? `${text.slice(0, allowed)}…` : text;
        if (shown.length > 0) kept.push({ role: message.role, text: shown });
      }
      return {
        chat: summarize(record),
        messages: kept.toReversed(),
        omittedEarlierMessages: Math.max(messages.length - tail.length, 0),
        toolCalls,
      };
    },

    /** Deletes chats that are not running or waiting on a person. Reports what it skipped. */
    async remove(chatIds: string[]) {
      const deleted: string[] = [];
      const skipped: Array<{ id: string; reason: string }> = [];
      for (const id of [...new Set(chatIds)].slice(0, MAX_DELETE)) {
        const record = await lookup(id);
        if (!record) {
          skipped.push({ id, reason: "not found, protected or already archived" });
          continue;
        }
        const status = statusOf(deps.agentManager.getAgent(id), record);
        if (status === "working" || status === "needs-input") {
          skipped.push({ id, reason: `it is ${status}` });
          continue;
        }
        try {
          await deps.deleteAgent(id);
          deleted.push(id);
        } catch {
          skipped.push({ id, reason: "deleting failed" });
        }
      }
      return { deleted, skipped };
    },

    /** A new turn in an idle chat. Never into one that is running or waiting on a person. */
    async send(chatId: string, text: string) {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > MAX_SEND)
        return { ok: false as const, reason: `The message must be 1 to ${MAX_SEND} characters.` };
      const record = await lookup(chatId);
      if (!record) return { ok: false as const, reason: "No such chat, or it is protected." };
      const status = statusOf(deps.agentManager.getAgent(chatId), record);
      if (status === "working" || status === "needs-input")
        return { ok: false as const, reason: `The chat is ${status}; wait until it is idle.` };
      await deps.send(
        chatId,
        `Chief, the user's app-wide manager, sends you this message for the user:\n\n${trimmed}`,
      );
      return { ok: true as const };
    },
  };
}

export type ChiefChats = ReturnType<typeof createChiefChats>;
