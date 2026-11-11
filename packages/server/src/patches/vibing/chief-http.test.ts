import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { registerChiefRoutes } from "./chief-http.js";
import { createChiefTools } from "./chief-tools.js";
import { ChiefProviderUnavailableError, type createChiefSession } from "./chief-session.js";

const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0).toReversed()) await dispose();
});
const apps = [
  { id: "app", name: "App", gitRepo: "", workspaces: [{ id: "branch/one", name: "Feature" }] },
];
async function fixture(handoffs?: Parameters<typeof registerChiefRoutes>[0]["handoffs"]) {
  const app = express();
  const router = express.Router();
  app.use("/api/chief", express.json({ limit: "2mb" }), router);
  const tools = createChiefTools();
  const connect = vi.fn(async () => ({
    protocol: 1,
    status: "ready",
    policy: "chief-v1",
    serverId: "fixture",
    agentId: "agent",
    workspaceId: "workspace",
    cwd: "/fixture",
    provider: "claude",
  }));
  const isConnected = vi.fn(() => true);
  const ready = vi.fn(() => true);
  const restart = vi.fn(async () => ({
    protocol: 1,
    status: "ready",
    policy: "chief-v1",
    serverId: "fixture",
    agentId: "fresh-agent",
    workspaceId: "workspace",
    cwd: "/fixture",
    provider: "claude",
  }));
  const session = {
    connect,
    restart,
    isConnected,
    agentToken: () => "fixture-agent-token",
  } as unknown as ReturnType<typeof createChiefSession>;
  const chats = {
    list: vi.fn(async () => ({ total: 0, chats: [] })),
    read: vi.fn(async (): Promise<unknown> => ({ chat: { id: "c" }, messages: [] })),
    remove: vi.fn(async () => ({ deleted: ["c"], skipped: [] })),
    send: vi.fn(async () => ({ ok: true })),
  };
  registerChiefRoutes({
    router,
    hostToken: "fixture-host-token",
    session,
    tools,
    ready,
    handoffs,
    chats: chats as never,
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  disposals.push(async () => {
    tools.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chief`;
  const host = (route: string, body: unknown) =>
    fetch(url + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paseo-worktree-cleanup-token": "fixture-host-token",
      },
      body: JSON.stringify(body),
    });
  return { url, host, connect, restart, isConnected, ready, tools, chats };
}

test("cold plugin startup returns starting without attempting Chief launch", async () => {
  const { host, connect, ready } = await fixture();
  ready.mockReturnValue(false);
  const response = await host("/connect", { apps });
  expect(await response.json()).toEqual({ status: "starting" });
  expect(connect).not.toHaveBeenCalled();
});

test("connect reports a missing Claude provider distinctly and other failures generically", async () => {
  const { host, connect } = await fixture();
  connect.mockRejectedValueOnce(new ChiefProviderUnavailableError());
  const missing = await host("/connect", { apps });
  expect(missing.status).toBe(200);
  expect(await missing.json()).toEqual({ status: "unavailable", reason: "provider-unavailable" });
  connect.mockRejectedValueOnce(new Error("Provider 'claude' is not available."));
  const failed = await host("/connect", { apps });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "Chief session unavailable" });
});

test("restart is host-only, needs a connected Chief and answers with the fresh descriptor", async () => {
  const { url, host, restart, isConnected } = await fixture();
  // Neither the agent's capability nor no capability at all can ask for a restart.
  for (const headers of [
    { authorization: "Bearer fixture-agent-token" },
    {} as Record<string, string>,
  ]) {
    const refused = await fetch(url + "/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: "{}",
    });
    expect(refused.status).toBe(403);
  }
  expect(restart).not.toHaveBeenCalled();
  isConnected.mockReturnValueOnce(false);
  expect((await host("/restart", {})).status).toBe(503);
  expect(restart).not.toHaveBeenCalled();
  const fresh = await host("/restart", {});
  expect(fresh.status).toBe(200);
  expect(await fresh.json()).toMatchObject({ status: "ready", agentId: "fresh-agent" });
  expect(restart).toHaveBeenCalledTimes(1);
});

test("restart reports a missing Claude provider distinctly and other failures generically", async () => {
  const { host, restart } = await fixture();
  restart.mockRejectedValueOnce(new ChiefProviderUnavailableError());
  expect(await (await host("/restart", {})).json()).toEqual({
    status: "unavailable",
    reason: "provider-unavailable",
  });
  restart.mockRejectedValueOnce(new Error("boom"));
  const failed = await host("/restart", {});
  expect(failed.status).toBe(503);
  expect(JSON.stringify(await failed.json())).not.toContain("boom");
});

test("restart answers the host requests the old conversation was waiting on as unknown", async () => {
  const { host, tools } = await fixture();
  await host("/connect", { apps });
  const waiting = tools.openWorkspace({
    appId: "app",
    workspaceId: "branch/one",
    destination: "bots",
  });
  await host("/restart", {});
  expect(await waiting).toEqual({ outcome: "unknown" });
});

test("chat routes are host-only, need a connected Chief and validate their input", async () => {
  const { url, host, chats, isConnected } = await fixture();
  for (const route of ["/chats/list", "/chats/read", "/chats/delete", "/chats/send"]) {
    for (const headers of [
      { authorization: "Bearer fixture-agent-token" },
      {} as Record<string, string>,
    ]) {
      const refused = await fetch(url + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
      });
      expect(refused.status, route).toBe(403);
    }
  }
  expect(chats.list).not.toHaveBeenCalled();
  isConnected.mockReturnValueOnce(false);
  expect((await host("/chats/list", {})).status).toBe(503);
  // Unknown keys, empty ids and oversize input are refused before anything runs.
  expect((await host("/chats/list", { extra: 1 })).status).toBe(400);
  expect((await host("/chats/read", {})).status).toBe(400);
  expect((await host("/chats/delete", { chatIds: [] })).status).toBe(400);
  expect((await host("/chats/delete", { chatIds: Array(101).fill("a") })).status).toBe(400);
  expect((await host("/chats/send", { chatId: "a", text: "x".repeat(4001) })).status).toBe(400);
  expect(chats.remove).not.toHaveBeenCalled();
  expect(chats.send).not.toHaveBeenCalled();
});

test("chat routes answer through the chats module, and a missing chat is a 404", async () => {
  const { host, chats } = await fixture();
  expect(await (await host("/chats/list", { status: "idle" })).json()).toEqual({
    total: 0,
    chats: [],
  });
  expect(chats.list).toHaveBeenCalledWith({ status: "idle" });
  expect(await (await host("/chats/delete", { chatIds: ["c"] })).json()).toEqual({
    deleted: ["c"],
    skipped: [],
  });
  expect(chats.remove).toHaveBeenCalledWith(["c"]);
  expect(await (await host("/chats/send", { chatId: "c", text: "hi" })).json()).toEqual({
    ok: true,
  });
  chats.read.mockResolvedValueOnce(null);
  expect((await host("/chats/read", { chatId: "nope" })).status).toBe(404);
  chats.list.mockRejectedValueOnce(new Error("secret detail"));
  const failed = await host("/chats/list", {});
  expect(failed.status).toBe(503);
  expect(JSON.stringify(await failed.json())).not.toContain("secret detail");
});

test("a cold same-port runtime refuses navigation polling until host reconciliation", async () => {
  const { host, isConnected } = await fixture();
  isConnected.mockReturnValue(false);
  expect((await host("/navigation/poll", { apps })).status).toBe(503);
});

test("agent and host capabilities cannot substitute for one another", async () => {
  const { url, host, connect } = await fixture();
  expect(
    (
      await fetch(url + "/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paseo-worktree-cleanup-token": "fixture-agent-token",
        },
        body: JSON.stringify({ apps }),
      })
    ).status,
  ).toBe(403);
  expect(connect).not.toHaveBeenCalled();
  expect(
    (
      await fetch(url + "/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer fixture-host-token" },
      })
    ).status,
  ).toBe(401);
  expect((await host("/connect", { apps })).status).toBe(200);
  expect(
    (
      await host("/navigation/poll", {
        apps: [{ ...apps[0], workspaces: [{ id: "bad\nidentity", name: "Name" }] }],
      })
    ).status,
  ).toBe(400);
});

test("open_feature carries a preparation diagnostic through the HTTP and MCP boundaries", async () => {
  const { url, host } = await fixture();
  await host("/connect", { apps });
  const client = new Client({ name: "chief-fixture", version: "1" });
  disposals.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Authorization: "Bearer fixture-agent-token" } },
    }),
  );
  const opening = client.callTool({
    name: "open_feature",
    arguments: { appId: "app", branch: "feat/protocol-0.9" },
  });
  let request: { id: string } | undefined;
  await vi.waitFor(async () => {
    const body = (await (await host("/navigation/poll", { apps })).json()) as {
      requests: Array<{ id: string }>;
    };
    request ??= body.requests[0];
    expect(request).toMatchObject({ kind: "open-branch" });
  });
  const error = "Branch 'feat/protocol-0.9' is already checked out at '/repo-worktrees/p09'.";
  const ack = await host(`/navigation/${request!.id}`, {
    outcome: "unavailable",
    reason: "failed",
    error,
  });
  expect(ack.status).toBe(200);
  expect(JSON.stringify(await opening)).toContain(error);
});

test("stateless MCP lists the host tools and navigation awaits an authenticated host ack", async () => {
  const { url, host } = await fixture();
  await host("/connect", { apps });
  const client = new Client({ name: "chief-fixture", version: "1" });
  disposals.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Authorization: "Bearer fixture-agent-token" } },
    }),
  );
  expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
    "list_apps",
    "list_workspaces",
    "open_feature",
    "open_workspace",
    "resolve_merge_request",
    "vibing_api",
    "vibing_api_catalog",
    "vibing_api_result",
  ]);
  // Without a configured Vibing backend the relay tools report a generic error.
  vi.stubEnv("PASEO_CHIEF_BACKEND_URL", "");
  const offline = await client.callTool({
    name: "vibing_api",
    arguments: { method: "GET", path: "/api/apps/live" },
  });
  vi.unstubAllEnvs();
  expect(offline.isError).toBe(true);
  expect(JSON.stringify(offline)).toContain("Vibing API is not connected");
  expect(JSON.stringify(offline)).not.toContain("fixture-host-token");
  const inventory = await client.callTool({ name: "list_apps", arguments: {} });
  expect(JSON.stringify(inventory)).toContain("App");
  const navigating = client.callTool({
    name: "open_workspace",
    arguments: { appId: "app", workspaceId: "branch/one", destination: "vscode" },
  });
  let request: { id: string; kind: string } | undefined;
  await vi.waitFor(async () => {
    const response = await host("/navigation/poll", { apps });
    const body = (await response.json()) as {
      requests: Array<{ id: string; kind: string }>;
      handoffs: unknown[];
    };
    expect(body.handoffs).toEqual([]);
    request ??= body.requests[0];
    expect(request).toBeDefined();
  });
  expect(request!.kind).toBe("navigate");
  expect((await host(`/navigation/${request!.id}`, { outcome: "resolved" })).status).toBe(409);
  const ack = await host(`/navigation/${request!.id}`, { outcome: "opened" });
  expect(await ack.json()).toEqual({ success: true });
  expect(JSON.stringify(await navigating)).toContain("opened");
});

test("merge request resolution round-trips through the host and the poll lists handoffs", async () => {
  const handoff = {
    chatId: "6f1c3b0e-8f6a-4a52-9a3f-0c1d2e3f4a5b",
    appId: "app",
    workspaceId: "branch/one",
    bot: "Reviewer",
    title: "Reviewer · Review !12",
    status: "working",
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  const handoffs = {
    list: vi.fn(async () => [handoff]),
    startFeatureTask: vi.fn(),
    checkFeatureTask: vi.fn(async (chatId: string) => ({ chatId, status: "idle" })),
  } as unknown as NonNullable<Parameters<typeof registerChiefRoutes>[0]["handoffs"]>;
  const { url, host } = await fixture(handoffs);
  await host("/connect", { apps });
  const client = new Client({ name: "chief-fixture", version: "1" });
  disposals.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Authorization: "Bearer fixture-agent-token" } },
    }),
  );
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["start_feature_task", "check_feature_task"]));
  expect(names).not.toContain("ask_feature_bot");
  const mrUrl = "https://git.example.test/team/repo/-/merge_requests/12";
  const resolving = client.callTool({ name: "resolve_merge_request", arguments: { url: mrUrl } });
  let request: { id: string } | undefined;
  await vi.waitFor(async () => {
    const body = (await (await host("/navigation/poll", { apps })).json()) as {
      requests: Array<{ id: string }>;
      handoffs: unknown[];
    };
    expect(body.handoffs).toEqual([handoff]);
    request ??= body.requests[0];
    expect(request).toEqual({ id: expect.any(String), kind: "resolve-merge-request", url: mrUrl });
  });
  const ack = await host(`/navigation/${request!.id}`, {
    outcome: "unavailable",
    reason: "not-found",
  });
  expect(ack.status).toBe(200);
  expect(JSON.stringify(await resolving)).toContain("not-found");
  expect(
    JSON.stringify(
      await client.callTool({ name: "check_feature_task", arguments: { chatId: handoff.chatId } }),
    ),
  ).toContain("idle");
  expect((await fetch(url + "/review/mcp", { method: "POST" })).status).toBe(404);
});
