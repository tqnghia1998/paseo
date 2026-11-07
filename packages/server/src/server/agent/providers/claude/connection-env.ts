import fs from "node:fs/promises";
import path from "node:path";

const CONNECTION_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
] as const;

export async function loadClaudeConnectionEnv(
  configDir: string,
  current: Record<string, string>,
): Promise<Record<string, string>> {
  let settings: unknown;
  try {
    const content = await fs.readFile(path.join(configDir, "settings.json"), "utf8");
    if (Buffer.byteLength(content) > 256 * 1024) throw new Error();
    settings = JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return current;
    settings = null;
  }
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Unable to read provider connection settings");
  }
  const environment = (settings as { env?: unknown }).env;
  if (environment === undefined) return current;
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error("Unable to read provider connection settings");
  }
  const configured: Record<string, string> = {};
  for (const key of CONNECTION_KEYS) {
    const value = (environment as Record<string, unknown>)[key];
    if (typeof value === "string") configured[key] = value;
  }
  return { ...configured, ...current };
}
