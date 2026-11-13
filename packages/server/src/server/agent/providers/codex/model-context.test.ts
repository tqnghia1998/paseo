import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { fetchCodexModelContexts } from "./model-context.js";

const input = {
  provider: { base_url: "https://gateway.example.test/v1", env_key: "CATALOG_KEY" },
  home: "/missing",
  env: { CATALOG_KEY: "test-token" },
  originator: "paseo",
  clientVersion: "0.167.0",
};
afterEach(() => vi.unstubAllGlobals());

test("fetches context from the exact configured endpoint with its auth and effective window", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          models: [
            { slug: "selected", context_window: 500000, max_context_window: 872000 },
            { slug: "smaller", context_window: 100000, effective_context_window_percent: 80 },
            { slug: "invalid", context_window: -1 },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const contexts = await fetchCodexModelContexts(input);
  expect([...contexts]).toEqual([
    ["selected", 475000],
    ["smaller", 80000],
  ]);
  const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://gateway.example.test/v1/models?client_version=0.167.0");
  expect(new Headers(options.headers).get("authorization")).toBe("Bearer test-token");
  expect(new Headers(options.headers).get("originator")).toBe("paseo");
  expect(options.redirect).toBe("error");
});

test("uses the effective Codex home's stored login without exposing it in the catalog", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codex-context-auth-"));
  try {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: "fixture-token" } }),
    );
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [{ slug: "selected", context_window: 500000 }] })),
    );
    vi.stubGlobal("fetch", fetcher);
    const contexts = await fetchCodexModelContexts({
      ...input,
      home,
      provider: { base_url: input.provider.base_url, requires_openai_auth: true },
      env: {},
    });
    expect(contexts.get("selected")).toBe(475000);
    expect(JSON.stringify([...contexts])).not.toContain("fixture-token");
    expect(
      new Headers((fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1].headers).get(
        "authorization",
      ),
    ).toBe("Bearer fixture-token");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.each(["missing-key", "command-auth", "cross-origin", "invalid-scheme"])(
  "does not use login or request metadata for %s",
  async (reason) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const provider = {
      ...input.provider,
      ...(reason === "command-auth" ? { auth: { command: "do-not-run" } } : {}),
      ...(reason === "cross-origin"
        ? { model_catalog_url: "https://other.example.test/models" }
        : {}),
      ...(reason === "invalid-scheme" ? { base_url: "file:///tmp/models" } : {}),
    };
    const contexts = await fetchCodexModelContexts({
      ...input,
      provider,
      env: reason === "missing-key" ? {} : input.env,
    });
    expect(contexts.size).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test.each(["error", "unauthorized", "malformed", "oversized", "unsupported"])(
  "leaves context unknown for %s catalogs",
  async (reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (reason === "error") throw new Error("fixture network failure");
        if (reason === "unauthorized") return new Response("unauthorized", { status: 401 });
        if (reason === "malformed") return new Response("<html>not JSON</html>");
        if (reason === "oversized") return new Response("x".repeat(4_000_001));
        return new Response(
          JSON.stringify({ models: [{ slug: "selected", max_context_window: 872000 }] }),
        );
      }),
    );
    expect((await fetchCodexModelContexts(input)).size).toBe(0);
  },
);

test("never borrows stored OpenAI login credentials for an anonymous custom provider", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "codex-context-anonymous-"));
  try {
    await writeFile(
      path.join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: "unrelated-login" } }),
    );
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ models: [] })));
    vi.stubGlobal("fetch", fetcher);
    await fetchCodexModelContexts({
      ...input,
      home,
      provider: { base_url: input.provider.base_url },
      env: {},
    });
    const options = (fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(new Headers(options.headers).has("authorization")).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
