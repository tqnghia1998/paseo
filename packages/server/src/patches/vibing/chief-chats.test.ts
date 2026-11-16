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
    expect(read?.messages).toMatchObject([
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

describe("Chief chats: pending input", () => {
  const permission = () => ({
    id: "permission-1",
    provider: "codex" as const,
    name: "Bash",
    kind: "tool" as const,
    input: { command: "git status" },
    actions: [
      { id: "once", label: "Allow once", behavior: "allow" as const },
      { id: "no", label: "Deny", behavior: "deny" as const },
    ],
  });
  function inputFixture(verified = new Set(["a"])) {
    const request = permission();
    const pendingPermissions = new Map([[request.id, request]]);
    const respond = vi.fn(async (_id: string, _requestId: string, _response: unknown) => {});
    const notifyChief = vi.fn(async (_text: string) => true);
    const records = [
      record({ id: "a", labels: { "paseo-bots.bot": "bot-review", "paseo-chief.handoff": "yes" } }),
      record({ id: "chief" }),
      record({ id: "hidden", internal: true }),
    ];
    const chats = createChiefChats({
      agentStorage: {
        get: async (id) => records.find((r) => r.id === id) ?? null,
        listActive: async () => records,
      } as never,
      agentManager: {
        getAgent: (id: string) =>
          id === "a" ? { lifecycle: "running", pendingPermissions } : null,
      } as never,
      chiefOwns: (id) => id === "chief",
      readRows: async () => [],
      deleteAgent: async () => {},
      send: async () => {},
      respondToPermission: respond,
      notifyChief,
      delegatedChatIds: async () => verified,
    });
    return { chats, request, pendingPermissions, respond, notifyChief };
  }
  test("reads the exact pending request and protects hidden or Chief chats", async () => {
    const { chats, request } = inputFixture();
    const pending = await chats.pendingInput("a");
    expect(pending?.requests[0]).toMatchObject({
      request,
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await chats.pendingInput("chief")).toBeNull();
    expect(await chats.pendingInput("hidden")).toBeNull();
    expect(await chats.pendingInput("unknown")).toBeNull();
  });
  test("restores native pending input before reading an unloaded chat", async () => {
    const request = permission();
    let loaded = false;
    const loadAgent = vi.fn(async () => {
      loaded = true;
    });
    const chats = createChiefChats({
      agentStorage: { get: async () => record({ id: "a" }), listActive: async () => [] } as never,
      agentManager: {
        getAgent: () =>
          loaded
            ? { lifecycle: "idle", pendingPermissions: new Map([[request.id, request]]) }
            : null,
      } as never,
      chiefOwns: () => false,
      readRows: async () => [],
      deleteAgent: async () => {},
      send: async () => {},
      loadAgent,
    });
    expect((await chats.pendingInput("a"))!.requests[0]).toMatchObject({ request });
    expect(loadAgent).toHaveBeenCalledExactlyOnceWith("a");
  });
  test("answers exactly the current request once and refuses changed requests and invalid actions", async () => {
    const { chats, request, pendingPermissions, respond } = inputFixture();
    const [{ requestDigest }] = (await chats.pendingInput("a"))!.requests;
    expect(
      await chats.respond("a", request.id, requestDigest, {
        behavior: "allow",
        selectedActionId: "always",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await chats.respond("a", request.id, requestDigest, {
        behavior: "deny",
        selectedActionId: "once",
      }),
    ).toMatchObject({ ok: false });
    pendingPermissions.set(request.id, { ...request, input: { command: "git push" } });
    expect(
      await chats.respond("a", request.id, requestDigest, {
        behavior: "allow",
        selectedActionId: "once",
      }),
    ).toMatchObject({ ok: false });
    const [current] = (await chats.pendingInput("a"))!.requests;
    expect(
      await chats.respond("a", request.id, current.requestDigest, {
        behavior: "allow",
        selectedActionId: "once",
      }),
    ).toEqual({ ok: true });
    expect(
      await chats.respond("a", request.id, current.requestDigest, {
        behavior: "allow",
        selectedActionId: "once",
      }),
    ).toMatchObject({ ok: false });
    expect(respond).toHaveBeenCalledExactlyOnceWith("a", request.id, {
      behavior: "allow",
      selectedActionId: "once",
    });
  });
  test("rejects concurrent answers while the native permission handler is still running", async () => {
    const { chats, request, respond } = inputFixture();
    const [{ requestDigest }] = (await chats.pendingInput("a"))!.requests;
    let release!: () => void;
    respond.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = chats.respond("a", request.id, requestDigest, {
      behavior: "allow",
      selectedActionId: "once",
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(
      await chats.respond("a", request.id, requestDigest, {
        behavior: "allow",
        selectedActionId: "once",
      }),
    ).toMatchObject({ ok: false });
    release();
    expect(await first).toEqual({ ok: true });
    expect(respond).toHaveBeenCalledTimes(1);
  });
  test("does not replay an uncertain native response after a provider error", async () => {
    const { chats, request, respond } = inputFixture();
    const [{ requestDigest }] = (await chats.pendingInput("a"))!.requests;
    respond.mockRejectedValueOnce(new Error("Provider disconnected after accepting input"));
    const response = { behavior: "allow", selectedActionId: "once" };
    expect(await chats.respond("a", request.id, requestDigest, response)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("unknown"),
    });
    expect(await chats.respond("a", request.id, requestDigest, response)).toMatchObject({
      ok: false,
    });
    expect(respond).toHaveBeenCalledTimes(1);
  });
  test("redacts credential fields and strings before exposing pending input", async () => {
    const { chats, request, pendingPermissions } = inputFixture();
    pendingPermissions.set(request.id, {
      ...request,
      input: { command: "read glpat-" + "x".repeat(24), apiKey: "hidden-value" },
    } as never);
    const pending = await chats.pendingInput("a");
    expect(JSON.stringify(pending)).not.toContain("hidden-value");
    expect(JSON.stringify(pending)).not.toContain("x".repeat(24));
    expect(pending!.requests[0]!.requestDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  test("validates structured question answers without changing tool inputs", async () => {
    const { chats, pendingPermissions, respond } = inputFixture();
    const question = {
      id: "question-1",
      provider: "codex",
      name: "request_user_input",
      kind: "question",
      input: {
        questions: [
          {
            id: "mode",
            header: "Mode",
            question: "Which mode?",
            multiSelect: false,
            options: [
              { label: "Fast", description: "Quick" },
              { label: "Deep", description: "Thorough" },
            ],
          },
        ],
      },
    };
    pendingPermissions.clear();
    pendingPermissions.set(question.id, question as never);
    const [{ requestDigest }] = (await chats.pendingInput("a"))!.requests;
    expect(
      await chats.respond("a", question.id, requestDigest, {
        behavior: "allow",
        updatedInput: { answers: { Wrong: "Fast" } },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await chats.respond("a", question.id, requestDigest, {
        behavior: "allow",
        updatedPermissions: [{ allow: "everything" }],
      }),
    ).toMatchObject({ ok: false });
    const response = { behavior: "allow", updatedInput: { answers: { Mode: "Deep" } } };
    expect(await chats.respond("a", question.id, requestDigest, response)).toEqual({ ok: true });
    expect(respond).toHaveBeenCalledWith("a", question.id, {
      ...response,
      updatedInput: { ...question.input, answers: { Mode: "Deep" } },
    });
  });
  test("does not notify Chief for an unverified handoff label", async () => {
    const { chats, notifyChief } = inputFixture(new Set());
    await chats.notifyPending();
    expect(notifyChief).not.toHaveBeenCalled();
  });
  test("defers notification while Chief is busy and delivers each delegated input once", async () => {
    const { chats, notifyChief } = inputFixture();
    notifyChief.mockResolvedValueOnce(false);
    await chats.notifyPending();
    await chats.notifyPending();
    await chats.notifyPending();
    expect(notifyChief).toHaveBeenCalledTimes(2);
    expect(notifyChief.mock.calls[1][0]).toContain("/api/ui/bot-chat/pending-input");
    expect(notifyChief.mock.calls[1][0]).toContain('"chatId":"a"');
  });
});
