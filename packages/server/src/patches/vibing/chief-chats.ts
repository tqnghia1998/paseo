import type { AgentManager } from "../../server/agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../../server/agent/agent-storage.js";
import { chiefChatStatus, type ChiefChatStatus } from "./chief-chat-status.js";
import type { AgentTimelineRow } from "../../server/agent/agent-timeline-store-types.js";

/**
 * Bot chats as Chief sees them: list them, read what was said, delete idle ones and message
 * one. The Vibing backend owns the policy: reads are untrusted text and deletes and messages
 * follow the gateway's effective approval mode there. This module still refuses what is never allowed
 * (Chief's own chat, hidden utility agents, a chat that is running or waiting on a person).
 */
export type ChatStatus = ChiefChatStatus;

/** Positions are UTF-16 offsets in redacted text; callers should pass the returned cursor unchanged. */
export interface ChiefChatCursor {
  messageIndex: number;
  offset: number;
}

export interface ChiefChatSummary {
  id: string;
  title: string;
  /** The Bot's id (`paseo-bots.bot`), or the name Chief saw when it handed the task off. */
  bot: string;
  botId: string;
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
  agentManager: Pick<AgentManager, "getAgent"> & Partial<Pick<AgentManager, "hasInFlightRun">>;
  /** Chief's own agent and anything retired by a restart: never listed or touched. */
  chiefOwns(id: string): boolean;
  /** Shared cancellation evidence from the handoff observer. */
  isCanceled?(id: string): boolean;
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
const MAX_READ_BYTES = 30_000;
const MAX_SEND = 4000;
const HANDOFF_LABEL = "paseo-chief.handoff";
const HANDOFF_BOT_NAME_LABEL = "paseo-chief.bot-name";

interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
}

/** Join streamed assistant chunks before applying any response/page budget. */
function collectChatMessages(rows: readonly AgentTimelineRow[]): {
  messages: ChatMessage[];
  toolCalls: number;
} {
  const messages: ChatMessage[] = [];
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
  // Filter assembled replies before exposing offsets or splitting pages. A credential
  // crossing a streamed chunk/page boundary must never become two unrecognized fragments.
  for (const message of messages) {
    message.text = message.text.replace(
      /\b(?:glpat-|ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
      "[redacted]",
    );
  }
  return { messages, toolCalls };
}

export const isChiefBotChat = (record: StoredAgentRecord, chiefOwns: (id: string) => boolean) =>
  !record.internal &&
  !record.archivedAt &&
  !chiefOwns(record.id) &&
  typeof record.labels["paseo-bots.bot"] === "string" &&
  /^[a-z0-9-]+$/.test(record.labels["paseo-bots.bot"]) &&
  record.labels["paseo-bots.bot"] !== "vibing-chief";

export function createChiefChats(deps: ChiefChatDependencies) {
  const statusOf = (record: StoredAgentRecord) =>
    chiefChatStatus(
      deps.agentManager.getAgent(record.id),
      record,
      deps.isCanceled?.(record.id),
      deps.agentManager.hasInFlightRun?.(record.id),
    );
  function summarize(record: StoredAgentRecord): ChiefChatSummary {
    const botId = record.labels["paseo-bots.bot"]!;
    const handedOff = Boolean(record.labels[HANDOFF_LABEL]);
    return {
      id: record.id,
      title: (record.title?.trim() || "Untitled chat").slice(0, 200),
      bot: (record.labels[HANDOFF_BOT_NAME_LABEL] ?? botId).slice(0, 100),
      botId,
      status: statusOf(record),
      workspaceId: record.workspaceId ?? null,
      cwd: record.cwd,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt ?? record.createdAt).toISOString(),
      handedOff,
    };
  }
  const visible = (record: StoredAgentRecord) => isChiefBotChat(record, deps.chiefOwns);

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
      cursor?: string;
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
        // Creation order is immutable: activity must not move unseen chats ahead
        // of a continuation cursor, or move that cursor ahead of already-seen chats.
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      const start = filter.cursor ? chats.findIndex((chat) => chat.id === filter.cursor) + 1 : 0;
      if (filter.cursor && start === 0)
        throw new Error("Chat cursor no longer exists; restart listing");
      const page: ChiefChatSummary[] = [];
      // Budget the complete encoded envelope, preserving every included summary and cursor.
      for (const chat of chats.slice(start, start + MAX_LISTED)) {
        const candidate = [...page, chat];
        const envelope = { total: chats.length, chats: candidate, nextCursor: chat.id };
        if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_READ_BYTES) {
          if (!page.length) throw new Error("Chat summary exceeds response budget");
          break;
        }
        page.push(chat);
      }
      return {
        total: chats.length,
        chats: page,
        nextCursor: start + page.length < chats.length ? page.at(-1)!.id : null,
      };
    },

    /** What was said, oldest first among the most recent `limit` messages. */
    async read(chatId: string, limit = 12, cursor?: ChiefChatCursor) {
      const record = await lookup(chatId);
      if (!record) return null;
      const rows = await deps.readRows(chatId);
      const { messages, toolCalls } = collectChatMessages(rows);
      const wanted = Math.min(Math.max(Math.floor(limit), 1), 50);
      const indices = cursor
        ? [cursor.messageIndex]
        : Array.from(
            { length: Math.min(wanted, messages.length) },
            (_, index) => messages.length - index - 1,
          );
      const kept: Array<{
        role: "user" | "assistant" | "error";
        text: string;
        index: number;
        offset: number;
        totalCharacters: number;
        truncated: boolean;
        next: ChiefChatCursor | null;
      }> = [];
      // Bound encoded text, including JSON escapes, so the gateway retains the page metadata.
      let budget = MAX_READ_BYTES;
      for (const index of indices) {
        const message = messages[index];
        if (!message) continue;
        const offset = cursor?.offset ?? 0;
        if (offset > message.text.length) continue;
        let text = "";
        for (const character of message.text.slice(offset)) {
          const bytes = Buffer.byteLength(JSON.stringify(character)) - 2;
          if (text.length + character.length > MAX_MESSAGE_TEXT || bytes > budget) break;
          text += character;
          budget -= bytes;
        }
        if (!text && offset < message.text.length) break;
        const end = offset + text.length;
        kept.push({
          role: message.role,
          text,
          index,
          offset,
          totalCharacters: message.text.length,
          truncated: offset > 0 || end < message.text.length,
          next: end < message.text.length ? { messageIndex: index, offset: end } : null,
        });
      }
      kept.reverse();
      return {
        chat: summarize(record),
        messages: kept,
        totalMessages: messages.length,
        omittedEarlierMessages: kept[0]?.index ?? messages.length,
        omittedLaterMessages: kept.length ? messages.length - kept[kept.length - 1]!.index - 1 : 0,
        truncated: kept.some((message) => message.truncated) || kept.length < indices.length,
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
        const status = statusOf(record);
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
      const status = statusOf(record);
      if (status === "working" || status === "needs-input")
        return { ok: false as const, reason: `The chat is ${status}; wait until it is idle.` };
      try {
        await deps.send(
          chatId,
          `Chief, the user's app-wide manager, sends you this message for the user:\n\n${trimmed}`,
        );
      } catch {
        return { ok: false as const, reason: "The chat is no longer available for an idle turn." };
      }
      return { ok: true as const };
    },
  };
}

export type ChiefChats = ReturnType<typeof createChiefChats>;
