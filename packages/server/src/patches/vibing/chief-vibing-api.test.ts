import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CHIEF_VIBING_API_TOOLS,
  VibingApiCallInput,
  VibingApiResultInput,
  createChiefVibingApi,
  registerChiefVibingApiTools,
} from "./chief-vibing-api.js";

const TOKEN = "fixture-host-capability-0123456789";
const BASE = "http://127.0.0.1:9000";
const ID = "6f1c3b0e-8f6a-4a52-9a3f-0c1d2e3f4a5b";
const fetchMock = vi.fn();
const text = (result: { content: Array<{ text: string }> }) => result.content[0]!.text;
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("PASEO_CHIEF_BACKEND_URL", BASE);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

const api = () => createChiefVibingApi({ hostToken: TOKEN });

test("the three tools are named for the Chief ceiling", () => {
  expect([...CHIEF_VIBING_API_TOOLS]).toEqual([
    "vibing_api_catalog",
    "vibing_api",
    "vibing_api_result",
  ]);
});

test("vibing_api posts the call with the host capability and returns the answer verbatim", async () => {
  const answer = {
    outcome: "completed",
    id: ID,
    status: 200,
    body: { apps: [{ id: 1 }] },
    truncated: false,
  };
  fetchMock.mockResolvedValueOnce(reply(answer));
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const result = await api().call({
    method: "POST",
    path: "/api/dev-server/start",
    body: { gitUrl: "git@example.test:team/repo.git", worktreeName: "feature" },
  });
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(text(result))).toEqual(answer);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(`${BASE}/api/paseo/chief/api/call`);
  expect(init.method).toBe("POST");
  expect(init.redirect).toBe("manual");
  expect(init.headers["x-paseo-worktree-cleanup-token"]).toBe(TOKEN);
  expect(init.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(init.body)).toEqual({
    method: "POST",
    path: "/api/dev-server/start",
    body: { gitUrl: "git@example.test:team/repo.git", worktreeName: "feature" },
  });
  expect(timeout).toHaveBeenCalledWith(110_000);
});

test("vibing_api omits the body when none is given and passes every outcome through", async () => {
  const outcomes = [
    { outcome: "running", id: ID },
    {
      outcome: "approval_required",
      id: ID,
      summary: "Push",
      reason: "checkpoint",
      expiresAt: "2026-11-07T00:00:00Z",
    },
    { outcome: "denied", reason: "credentials" },
    { outcome: "invalid", reason: "unknown route" },
  ];
  for (const outcome of outcomes) {
    fetchMock.mockResolvedValueOnce(reply(outcome));
    const result = await api().call({ method: "GET", path: "/api/apps/live" });
    expect(JSON.parse(text(result))).toEqual(outcome);
  }
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
    method: "GET",
    path: "/api/apps/live",
  });
});

test("vibing_api_catalog sends a GET with the prefix and limit", async () => {
  const answer = {
    routes: [{ method: "GET", path: "/api/dev-server/status", effect: "read" }],
    truncated: false,
  };
  fetchMock.mockResolvedValue(reply(answer));
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const narrowed = await api().catalog({ prefix: "/api/dev-server" });
  expect(JSON.parse(text(narrowed))).toEqual(answer);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(`${BASE}/api/paseo/chief/api/catalog?prefix=%2Fapi%2Fdev-server&limit=400`);
  expect(init.method).toBe("GET");
  expect(init.body).toBeUndefined();
  expect(init.headers["x-paseo-worktree-cleanup-token"]).toBe(TOKEN);
  expect(timeout).toHaveBeenCalledWith(15_000);
  await api().catalog({});
  expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/api/paseo/chief/api/catalog?limit=400`);
});

test("vibing_api_result maps wait to 45 seconds and sizes the timeout from it", async () => {
  const answer = { state: "completed", result: { status: 200, body: {}, truncated: false } };
  fetchMock.mockResolvedValue(reply(answer));
  const timeout = vi.spyOn(AbortSignal, "timeout");
  expect(JSON.parse(text(await api().result({ id: ID, wait: true })))).toEqual(answer);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(`${BASE}/api/paseo/chief/api/result`);
  expect(init.method).toBe("POST");
  expect(init.headers["x-paseo-worktree-cleanup-token"]).toBe(TOKEN);
  expect(JSON.parse(init.body)).toEqual({ id: ID, waitSeconds: 45 });
  expect(timeout).toHaveBeenLastCalledWith(55_000);
  await api().result({ id: ID });
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ id: ID, waitSeconds: 0 });
  expect(timeout).toHaveBeenLastCalledWith(10_000);
});

test("an unset or non-loopback base URL reports that the API is not connected", async () => {
  const request = { method: "GET", path: "/api/apps/live" } as const;
  vi.stubEnv("PASEO_CHIEF_BACKEND_URL", "");
  expect(await api().call(request)).toEqual({
    content: [{ type: "text", text: "Vibing API is not connected" }],
    isError: true,
  });
  for (const value of [
    "https://127.0.0.1:9000",
    "http://example.test:9000",
    "http://192.168.1.4:9000",
    "http://[::1]:9000",
    "http://user:pw@127.0.0.1:9000",
    "ftp://127.0.0.1",
    "not a url",
  ]) {
    vi.stubEnv("PASEO_CHIEF_BACKEND_URL", value);
    for (const result of [
      await api().call(request),
      await api().catalog({}),
      await api().result({ id: ID }),
    ]) {
      expect(text(result)).toBe("Vibing API is not connected");
      expect(result.isError).toBe(true);
    }
  }
  vi.stubEnv("PASEO_CHIEF_BACKEND_URL", "http://localhost:9000/ignored/path");
  fetchMock.mockResolvedValueOnce(reply({ outcome: "denied", reason: "x" }));
  await api().call(request);
  expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:9000/api/paseo/chief/api/call");
  // The environment is read per call, and a missing capability also fails closed.
  expect(text(await createChiefVibingApi({ hostToken: undefined }).call(request))).toBe(
    "Vibing API is not connected",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("401, timeout, network failure, redirects and malformed answers map to one generic error", async () => {
  const request = { method: "GET", path: "/api/apps/live" } as const;
  const failures: Array<() => Promise<Response>> = [
    async () => reply({ error: `bad token ${TOKEN}` }, 401),
    async () => reply({ error: "boom" }, 500),
    async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    },
    async () => {
      throw new TypeError(`fetch failed ${BASE} ${TOKEN}\n    at stack`);
    },
    async () => new Response(null, { status: 302, headers: { location: "http://example.test/" } }),
    async () => reply("<html>not json</html>"),
    async () => reply({ unexpected: true }),
    async () => reply({ outcome: "mystery" }),
    async () => reply(`{"outcome":"denied","reason":"echo ${TOKEN}"}`),
  ];
  for (const failure of failures) {
    fetchMock.mockImplementationOnce(failure);
    const result = await api().call(request);
    expect(result).toEqual({
      content: [{ type: "text", text: "Vibing API is unavailable" }],
      isError: true,
    });
  }
  fetchMock.mockResolvedValueOnce(reply({ routes: "nope" }));
  expect(text(await api().catalog({}))).toBe("Vibing API is unavailable");
  fetchMock.mockResolvedValueOnce(reply({ state: "mystery" }));
  expect(text(await api().result({ id: ID }))).toBe("Vibing API is unavailable");
});

test("the capability never appears in a result", async () => {
  fetchMock.mockResolvedValueOnce(
    reply({ outcome: "completed", id: ID, status: 200, body: "ok", truncated: false }),
  );
  const result = await api().call({ method: "GET", path: "/api/apps/live" });
  expect(JSON.stringify(result)).not.toContain(TOKEN);
});

test("input validation rejects non-API paths, oversized bodies, bad methods and bad ids", async () => {
  const ok = { method: "GET", path: "/api/apps/live" };
  expect(VibingApiCallInput.safeParse(ok).success).toBe(true);
  expect(VibingApiCallInput.safeParse({ ...ok, path: "/health" }).success).toBe(false);
  expect(VibingApiCallInput.safeParse({ ...ok, path: "api/apps" }).success).toBe(false);
  expect(VibingApiCallInput.safeParse({ ...ok, path: "" }).success).toBe(false);
  expect(VibingApiCallInput.safeParse({ ...ok, path: `/api/${"a".repeat(2048)}` }).success).toBe(
    false,
  );
  expect(VibingApiCallInput.safeParse({ ...ok, method: "TRACE" }).success).toBe(false);
  expect(VibingApiCallInput.safeParse({ ...ok, body: "x".repeat(256 * 1024) }).success).toBe(false);
  expect(VibingApiCallInput.safeParse({ ...ok, body: "x".repeat(256 * 1024 - 2) }).success).toBe(
    true,
  );
  expect(VibingApiCallInput.safeParse({ ...ok, body: [1, { a: null }] }).success).toBe(true);
  expect(VibingApiResultInput.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  expect(VibingApiResultInput.safeParse({ id: ID, wait: true }).success).toBe(true);
  // The relay applies the same checks before any request is made.
  expect(text(await api().call({ ...ok, path: "/health" }))).toBe("Invalid Vibing API request");
  expect(text(await api().call({ ...ok, body: "x".repeat(300 * 1024) }))).toBe(
    "Invalid Vibing API request",
  );
  expect(text(await api().result({ id: "nope" }))).toBe("Invalid Vibing API request");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the tools are served over MCP and return the relayed answer", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  registerChiefVibingApiTools(server, api());
  const client = new Client({ name: "fixture-client", version: "1" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
      [...CHIEF_VIBING_API_TOOLS].sort(),
    );
    fetchMock.mockResolvedValueOnce(reply({ outcome: "running", id: ID }));
    const called = await client.callTool({
      name: "vibing_api",
      arguments: { method: "GET", path: "/api/apps/live" },
    });
    expect(called.isError).toBeFalsy();
    expect(JSON.parse((called.content as Array<{ text: string }>)[0]!.text)).toEqual({
      outcome: "running",
      id: ID,
    });
    fetchMock.mockResolvedValueOnce(reply({ state: "running" }));
    const waited = await client.callTool({
      name: "vibing_api_result",
      arguments: { id: ID, wait: true },
    });
    expect(JSON.parse((waited.content as Array<{ text: string }>)[0]!.text)).toEqual({
      state: "running",
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).waitSeconds).toBe(45);
    fetchMock.mockResolvedValueOnce(reply({ routes: [], truncated: false }));
    const catalog = await client.callTool({ name: "vibing_api_catalog", arguments: {} });
    expect(JSON.parse((catalog.content as Array<{ text: string }>)[0]!.text)).toEqual({
      routes: [],
      truncated: false,
    });
    // Schema validation happens before the relay runs.
    const rejected = await client
      .callTool({ name: "vibing_api", arguments: { method: "GET", path: "/health" } })
      .catch(() => ({ isError: true }));
    expect(rejected.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    await client.close();
    await server.close();
  }
});
