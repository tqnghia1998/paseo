import { describe, expect, test, vi } from "vitest";
import { createChiefChats } from "./chief-chats.js";

interface Fixture {
  id: string;
  title?: string;
  labels?: Record<string, string>;
  internal?: boolean;
  archivedAt?: string | null;
  lastStatus?: string;
  workspaceId?: string;
}
const record = (over: Fixture) => ({
  id: over.id,
  title: over.title ?? `Chat ${over.id}`,
  labels: over.labels ?? { "paseo-bots.bot": "bot-review" },
  internal: over.internal ?? false,
  archivedAt: over.archivedAt ?? null,
  lastStatus: over.lastStatus ?? "idle",
  workspaceId: over.workspaceId ?? "wks_1",
  cwd: "/work",
  createdAt: Date.UTC(2026, 10, 8, 4, 0, 0),
  updatedAt: Date.UTC(2026, 10, 8, 5, 0, 0),
});

function setup(
  records: ReturnType<typeof record>[],
  live: Record<string, Record<string, unknown>> = {},
  rows: unknown[] = [],
) {
  const deleteAgent = vi.fn(async () => {});
  const send = vi.fn(async () => {});
  const chats = createChiefChats({
    agentStorage: {
      get: async (id: string) => records.find((r) => r.id === id) ?? null,
      listActive: async () => records,
    } as never,
    agentManager: { getAgent: (id: string) => live[id] ?? null } as never,
    chiefOwns: (id) => id === "chief",
    readRows: async () => rows as never,
    deleteAgent,
    send,
  });
  return { chats, deleteAgent, send };
}
const running = { lifecycle: "running", pendingPermissions: new Map(), activeTurnId: "t" };
const waiting = { lifecycle: "idle", pendingPermissions: new Map([["p", {}]]) };

describe("Chief chats: list", () => {
  test("hides Chief itself, utility agents and archived chats, and reports each status", async () => {
    const { chats } = setup(
      [
        record({ id: "a" }),
        record({ id: "chief" }),
        record({ id: "hidden", internal: true }),
        record({ id: "old", archivedAt: "2026-01-01" }),
        record({ id: "run" }),
        record({ id: "ask" }),
        record({ id: "bad", lastStatus: "error" }),
      ],
      { run: running, ask: waiting },
    );
    const { chats: listed, total } = await chats.list({});
    expect(total).toBe(4);
    expect(Object.fromEntries(listed.map((c) => [c.id, c.status]))).toEqual({
      a: "idle",
      run: "working",
      ask: "needs-input",
      bad: "failed",
    });
  });

  test("filters by Bot, status, workspace and ids", async () => {
    const { chats } = setup([
      record({ id: "a", labels: { "paseo-bots.bot": "bot-a" } }),
      record({ id: "b", labels: { "paseo-bots.bot": "bot-b" }, workspaceId: "wks_2" }),
    ]);
    expect((await chats.list({ botId: "bot-b" })).chats.map((c) => c.id)).toEqual(["b"]);
    expect((await chats.list({ workspaceId: "wks_1" })).chats.map((c) => c.id)).toEqual(["a"]);
    expect((await chats.list({ ids: ["a"] })).chats.map((c) => c.id)).toEqual(["a"]);
    expect((await chats.list({ status: "working" })).total).toBe(0);
  });
});

describe("Chief chats: read", () => {
  const rows = [
    { item: { type: "user_message", text: "Review this" } },
    { item: { type: "assistant_message", text: "Looking " } },
    { item: { type: "assistant_message", text: "now." } },
    { item: { type: "tool_call", name: "Bash" } },
    { item: { type: "assistant_message", text: "Found 2 issues." } },
    { item: { type: "error", message: "boom" } },
  ];
  test("returns the most recent messages with streamed replies joined, and counts tool calls", async () => {
    const { chats } = setup([record({ id: "a" })], {}, rows);
    const read = await chats.read("a", 3);
    expect(read?.messages).toEqual([
      { role: "assistant", text: "Looking now." },
      { role: "assistant", text: "Found 2 issues." },
      { role: "error", text: "boom" },
    ]);
    expect(read).toMatchObject({ omittedEarlierMessages: 1, toolCalls: 1 });
    expect(read?.chat.id).toBe("a");
  });

  test("caps long messages and never reads Chief's own chat or an unknown one", async () => {
    const long = [{ item: { type: "assistant_message", text: "x".repeat(10_000) } }];
    const { chats } = setup([record({ id: "a" }), record({ id: "chief" })], {}, long);
    const read = await chats.read("a");
    expect(read?.messages[0]!.text.length).toBeLessThanOrEqual(4001);
    expect(await chats.read("chief")).toBeNull();
    expect(await chats.read("nope")).toBeNull();
  });
});

describe("Chief chats: delete", () => {
  test("deletes idle chats and skips running, waiting, protected and unknown ones", async () => {
    const { chats, deleteAgent } = setup(
      [record({ id: "a" }), record({ id: "run" }), record({ id: "ask" }), record({ id: "chief" })],
      { run: running, ask: waiting },
    );
    const result = await chats.remove(["a", "run", "ask", "chief", "nope", "a"]);
    expect(result.deleted).toEqual(["a"]);
    expect(result.skipped.map((s) => s.id).sort()).toEqual(["ask", "chief", "nope", "run"]);
    expect(deleteAgent).toHaveBeenCalledTimes(1);
    expect(deleteAgent).toHaveBeenCalledWith("a");
  });

  test("reports a failed deletion and keeps going", async () => {
    const { chats, deleteAgent } = setup([record({ id: "a" }), record({ id: "b" })]);
    deleteAgent.mockRejectedValueOnce(new Error("disk"));
    const result = await chats.remove(["a", "b"]);
    expect(result.deleted).toEqual(["b"]);
    expect(result.skipped).toEqual([{ id: "a", reason: "deleting failed" }]);
  });
});

describe("Chief chats: send", () => {
  test("sends to an idle chat, marked as from Chief", async () => {
    const { chats, send } = setup([record({ id: "a" })]);
    expect(await chats.send("a", "  also check the CSS  ")).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("a", expect.stringContaining("also check the CSS"));
    expect(send.mock.calls[0]![1]).toMatch(/^Chief, the user's app-wide manager/);
  });

  test("never interrupts a running chat or answers one waiting on a person", async () => {
    const { chats, send } = setup([record({ id: "run" }), record({ id: "ask" })], {
      run: running,
      ask: waiting,
    });
    expect(await chats.send("run", "hi")).toMatchObject({ ok: false });
    expect(await chats.send("ask", "yes")).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  test("refuses Chief's own chat, unknown chats and bad text", async () => {
    const { chats, send } = setup([record({ id: "chief" })]);
    expect(await chats.send("chief", "hi")).toMatchObject({ ok: false });
    expect(await chats.send("nope", "hi")).toMatchObject({ ok: false });
    expect(await chats.send("chief", "   ")).toMatchObject({ ok: false });
    expect(await chats.send("chief", "x".repeat(4001))).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
});
