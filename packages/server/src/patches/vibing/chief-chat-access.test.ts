import { expect, test, vi } from "vitest";
import { createChiefChats } from "./chief-chats.js";

function fixture(
  text = "hello",
  labels: Record<string, string> = { "paseo-bots.bot": "reviewer" },
  canceled = false,
) {
  const record = {
    id: "chat",
    title: "Review",
    labels,
    cwd: "/work",
    createdAt: 1,
    internal: false,
  };
  const send = vi.fn(async () => {});
  const deleteAgent = vi.fn(async () => {});
  const chats = createChiefChats({
    agentStorage: { get: async () => record, listActive: async () => [record] },
    agentManager: { getAgent: () => null },
    chiefOwns: () => false,
    isCanceled: () => canceled,
    readRows: async () => [{ item: { type: "assistant_message", text } }],
    send,
    deleteAgent,
  } as never);
  return { chats, send, deleteAgent };
}

test("unlabeled native chats and Chief labels are excluded from every Bot-chat operation", async () => {
  for (const labels of [{}, { "paseo-bots.bot": "" }, { "paseo-bots.bot": "vibing-chief" }]) {
    const { chats, send, deleteAgent } = fixture("private native conversation", labels);
    expect((await chats.list({})).chats).toEqual([]);
    expect(await chats.read("chat")).toBeNull();
    expect(await chats.send("chat", "change it")).toMatchObject({ ok: false });
    expect((await chats.remove(["chat"])).deleted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(deleteAgent).not.toHaveBeenCalled();
  }
});

test("continuation pages recover the entire long reply including its conclusion", async () => {
  const original = "intro 🌍 ".repeat(1500) + "FINAL FINDING: incorrect authorization";
  const { chats } = fixture(original);
  let cursor: { messageIndex: number; offset: number } | undefined;
  let recovered = "";
  for (let page = 0; page < 20; page++) {
    const reply = await chats.read("chat", 12, cursor);
    const message = reply!.messages[0]!;
    expect(message.index).toBe(0);
    expect(message.offset).toBe(recovered.length);
    expect(message.totalCharacters).toBe(original.length);
    recovered += message.text;
    if (!message.next) break;
    expect(reply!.truncated).toBe(true);
    cursor = message.next;
  }
  expect(recovered).toBe(original);
  expect(recovered).toMatch(/FINAL FINDING: incorrect authorization$/);
});

test.each(["glpat-", "ghp_", "gho_", "ghs_", "github_pat_", "Bearer "])(
  "%s credential redaction precedes paging, including arbitrary continuation offsets",
  async (prefixType) => {
    const credential = prefixType + "x".repeat(24);
    const prefix = "a".repeat(3991) + " ";
    const { chats } = fixture(prefix + credential + " FINAL");
    const first = (await chats.read("chat"))!.messages[0]!;
    const second = (await chats.read("chat", 12, first.next!))!.messages[0]!;
    expect(first.text + second.text).toBe(prefix + "[redacted] FINAL");
    expect(first.totalCharacters).toBe((prefix + "[redacted] FINAL").length);
    // An offset selected by the caller must never expose the suffix of the original token.
    const middle = (await chats.read("chat", 12, { messageIndex: 0, offset: 3998 }))!;
    expect(middle.messages[0]!.text).not.toContain("x".repeat(16));
  },
);

test("budgeted reads count omitted messages without adding empty ellipsis messages", async () => {
  const { chats } = fixture();
  // Read a deliberately large stream through the real reader, without I/O.
  const reader = createChiefChats({
    agentStorage: {
      get: async () => ({
        id: "chat",
        title: "Review",
        labels: { "paseo-bots.bot": "reviewer" },
        cwd: "/work",
        createdAt: 1,
      }),
    },
    agentManager: { getAgent: () => null },
    chiefOwns: () => false,
    readRows: async () =>
      Array.from({ length: 50 }, () => [
        { item: { type: "assistant_message", text: "界".repeat(4000) } },
        { item: { type: "tool_call" } },
      ]).flat(),
    send: async () => {},
    deleteAgent: async () => {},
  } as never);
  const reply = await reader.read("chat", 50);
  expect(reply!.messages.every((message) => message.text.length > 1)).toBe(true);
  expect(reply!.omittedEarlierMessages).toBe(50 - reply!.messages.length);
  expect(reply!.truncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(64 * 1024);
  expect((await chats.read("chat"))!.messages[0]!.text).toBe("hello");
});

test("the chat reader reports canceled tasks with the same failed status as handoffs", async () => {
  const { chats } = fixture("cancelled task", { "paseo-bots.bot": "reviewer" }, true);
  expect((await chats.list({})).chats[0]!.status).toBe("failed");
  expect((await chats.read("chat"))!.chat.status).toBe("failed");
});

test("a failed final send admission is reported as unsent", async () => {
  const { chats, send } = fixture();
  send.mockRejectedValueOnce(new Error("Agent is archived"));
  expect(await chats.send("chat", "Follow up")).toMatchObject({ ok: false });
});

test.each(["none", "unseen", "cursor"] as const)(
  "chat-list continuation preserves all records once with %s activity updates",
  async (update) => {
    const records = Array.from({ length: 240 }, (_, index) => ({
      id: `chat-${String(index).padStart(3, "0")}`,
      title: `Chat ${index} `.padEnd(200, "界"),
      labels: { "paseo-bots.bot": "reviewer" },
      cwd: "/Users/fixture/Documents/space-app-vibing/" + "long-workspace-name/".repeat(15),
      workspaceId: "one-workspace",
      createdAt: index + 1,
      updatedAt: index + 1,
      internal: false,
    }));
    const chats = createChiefChats({
      agentStorage: { get: async () => null, listActive: async () => records },
      agentManager: { getAgent: () => null },
      chiefOwns: () => false,
      readRows: async () => [],
      deleteAgent: async () => {},
      send: async () => {},
    } as never);
    const list = chats.list as unknown as (input: {
      botId: string;
      workspaceId: string;
      cursor?: string;
    }) => Promise<{
      total: number;
      chats: Array<{ id: string; title: string; cwd: string }>;
      nextCursor: string | null;
    }>;
    const recovered: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < records.length; page++) {
      const reply = await list({ botId: "reviewer", workspaceId: "one-workspace", cursor });
      expect(reply.total).toBe(records.length);
      expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThanOrEqual(30_000);
      expect(reply.chats.length).toBeGreaterThan(0);
      for (const chat of reply.chats) {
        const original = records.find((record) => record.id === chat.id)!;
        expect(chat.title).toBe(original.title);
        expect(chat.cwd).toBe(original.cwd);
        recovered.push(chat.id);
      }
      if (page === 0 && update !== "none") {
        const changed =
          update === "unseen"
            ? records[0]!
            : records.find((record) => record.id === reply.nextCursor)!;
        changed.updatedAt = 10_000;
      }
      if (reply.nextCursor === null) break;
      expect(typeof reply.nextCursor).toBe("string");
      expect(cursors.has(reply.nextCursor)).toBe(false);
      cursors.add(reply.nextCursor);
      cursor = reply.nextCursor;
    }
    expect(new Set(recovered).size).toBe(records.length);
    expect(recovered).toEqual(records.map((record) => record.id).toReversed());
  },
);

test("deleting idle chats skips a pending run before the provider starts", async () => {
  const record = {
    id: "pending-chat",
    labels: { "paseo-bots.bot": "reviewer" },
    cwd: "/work",
    createdAt: 1,
    internal: false,
  };
  const deleteAgent = vi.fn(async () => {});
  const chats = createChiefChats({
    agentStorage: { get: async () => record, listActive: async () => [record] },
    agentManager: {
      getAgent: () => ({ lifecycle: "idle", activeTurnId: null, pendingPermissions: new Map() }),
      hasInFlightRun: () => true,
    },
    chiefOwns: () => false,
    readRows: async () => [],
    deleteAgent,
    send: async () => {},
  } as never);
  const result = await chats.remove([record.id]);
  expect(result.deleted).toEqual([]);
  expect(result.skipped).toEqual([
    { id: record.id, reason: expect.stringMatching(/working|busy|run/i) },
  ]);
  expect(deleteAgent).not.toHaveBeenCalled();
});

test("a failed final delete admission is reported as skipped instead of deleted", async () => {
  const { chats, deleteAgent } = fixture();
  deleteAgent.mockRejectedValueOnce(new Error("Agent has a pending run"));
  expect(await chats.remove(["chat"])).toMatchObject({
    deleted: [],
    skipped: [{ id: "chat", reason: expect.any(String) }],
  });
});
