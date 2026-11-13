import fs from "node:fs/promises";
import path from "node:path";

const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

interface ContextOptions {
  provider: Record<string, unknown>;
  home: string;
  env: Record<string, string>;
  originator: string;
  clientVersion?: string;
  signal?: AbortSignal;
}

function catalogUrl({ provider, clientVersion }: ContextOptions) {
  // These auth mechanisms belong to Codex; do not run login or credential commands here.
  if (provider.auth || provider.gateway_oauth || provider.aws || provider.credential_file) return;
  const endpoint = provider.model_catalog_url ?? provider.base_url;
  if (typeof endpoint !== "string" || typeof provider.base_url !== "string") return;
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
  // Never forward the provider's credentials to a separate catalog origin.
  if (new URL(provider.base_url).origin !== url.origin) return;
  if (!provider.model_catalog_url) url.pathname = url.pathname.replace(/\/$/, "") + "/models";
  for (const [key, value] of Object.entries(provider.query_params ?? {}))
    if (typeof value === "string") url.searchParams.set(key, value);
  if (clientVersion) url.searchParams.set("client_version", clientVersion);
  return url;
}

async function catalogHeaders({ provider, env, home, originator }: ContextOptions) {
  const headers = new Headers({ originator });
  for (const [key, value] of Object.entries(provider.http_headers ?? {}))
    if (typeof value === "string") headers.set(key, value);
  for (const [key, variable] of Object.entries(provider.env_http_headers ?? {}))
    if (typeof variable === "string" && env[variable]) headers.set(key, env[variable]);
  let token: unknown = provider.experimental_bearer_token;
  if (typeof provider.env_key === "string") {
    token = env[provider.env_key];
    if (!token) return;
  } else if (!token && !headers.has("authorization") && provider.requires_openai_auth === true) {
    try {
      const auth = JSON.parse(await fs.readFile(path.join(home, "auth.json"), "utf8"));
      token = auth.OPENAI_API_KEY ?? auth.tokens?.access_token;
    } catch {
      return;
    }
    if (typeof token !== "string" || !token) return;
  }
  if (typeof token === "string" && token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

async function readCatalog(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4_000_000) {
        await reader.cancel();
        return;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseContexts(catalog: Awaited<ReturnType<typeof readCatalog>>) {
  const contexts = new Map<string, number>();
  if (!Array.isArray(catalog?.models)) return contexts;
  for (const model of catalog.models) {
    if (typeof model?.slug !== "string" || !positiveInteger(model.context_window)) continue;
    // Codex's ModelInfo defaults to a 95% usable window; ignore max_context_window.
    const percent = model.effective_context_window_percent ?? 95;
    if (!positiveInteger(percent) || percent > 100) continue;
    const window = Math.floor((model.context_window * percent) / 100);
    if (positiveInteger(window)) contexts.set(model.slug, window);
  }
  return contexts;
}

/** Fetch only the explicitly configured catalog; shared Codex caches lack endpoint provenance. */
export async function fetchCodexModelContexts(
  options: ContextOptions,
): Promise<Map<string, number>> {
  try {
    const url = catalogUrl(options);
    if (!url) return new Map();
    const headers = await catalogHeaders(options);
    if (!headers) return new Map();
    const response = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(2000),
        ...(options.signal ? [options.signal] : []),
      ]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return new Map();
    }
    return parseContexts(await readCatalog(response));
  } catch {
    // Optional metadata failures preserve the explicit unknown-context fallback.
    return new Map();
  }
}
