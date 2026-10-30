import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Prebundled under plugins/ and copied beside the runner as community-plugins/.
export const communityPluginIds = [
  "paseo-chat-polish",
  "annotations",
  "paseo-doc-viewer",
  "shell-yeah",
  "paseo-recap",
  "paseo-quick-prompts",
  "genui",
];

// Chat Polish replaced Beautiful Chat as the bundled chat restyler. The Beautiful Chat copy Vibing
// installed is swapped for Chat Polish once, keeping its enabled state; one installed from elsewhere stays.
const RETIRED_PLUGIN = "beautiful-chat";
const RETIRED_REPLACEMENT = "paseo-chat-polish";

// Bootstrap each ordinary directory install once; the native plugin manager owns it afterwards.
export function prepareCommunityPlugins({
  home,
  sourceRoot,
  readPersistedConfig,
  savePersistedConfig,
}) {
  if (!existsSync(sourceRoot)) return;
  const marker = path.join(home, ".vibing-community-plugins.json");
  const seen = readOfferedPlugins(marker, path.join(home, ".vibing-community-plugins-v1"));
  const pending = communityPluginIds.filter(
    (id) => !seen.has(id) && existsSync(path.join(sourceRoot, id)),
  );
  const retiredDirectory = path.join(home, "installed-plugins", RETIRED_PLUGIN);
  if (!pending.length && !existsSync(retiredDirectory)) return;
  const config = readPersistedConfig(home, { defaultsIfMissing: true });
  const plugins = { ...config.plugins };
  const retired = existsSync(path.join(sourceRoot, RETIRED_REPLACEMENT))
    ? retireBundledPlugin(plugins, retiredDirectory)
    : undefined;
  if (retired && !pending.includes(RETIRED_REPLACEMENT)) pending.unshift(RETIRED_REPLACEMENT);
  if (!pending.length) return;
  for (const id of pending) {
    seen.add(id);
    if (Object.hasOwn(plugins, id)) continue;
    const directory = path.join(home, "installed-plugins", id);
    if (!existsSync(directory)) cpSync(path.join(sourceRoot, id), directory, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(directory, "paseo-plugin.json"), "utf8"));
    if (manifest.id !== id) throw new Error(`Unexpected community plugin: ${id}`);
    const enabled = id === RETIRED_REPLACEMENT && retired ? retired.enabled !== false : true;
    plugins[id] = { source: "directory", path: directory, enabled };
  }
  savePersistedConfig(home, {
    ...config,
    pluginsEnabled: config.pluginsEnabled ?? true,
    plugins,
  });
  // Rename into place so a crash never leaves a truncated marker.
  writeFileSync(`${marker}.tmp`, `${JSON.stringify([...seen])}\n`);
  renameSync(`${marker}.tmp`, marker);
  // The config no longer points at it, so a crash here leaves only an unused folder.
  if (retired) rmSync(retiredDirectory, { recursive: true, force: true });
}

/** Removes the Vibing-installed Beautiful Chat entry and returns it, or undefined when there is none. */
function retireBundledPlugin(plugins, retiredDirectory) {
  const entry = plugins[RETIRED_PLUGIN];
  if (entry?.source !== "directory" || typeof entry.path !== "string") return undefined;
  if (path.resolve(entry.path) !== path.resolve(retiredDirectory)) return undefined;
  delete plugins[RETIRED_PLUGIN];
  return entry;
}

function readOfferedPlugins(marker, legacyMarker) {
  if (!existsSync(marker))
    return new Set(existsSync(legacyMarker) ? ["beautiful-chat", "annotations"] : []);
  try {
    const offered = JSON.parse(readFileSync(marker, "utf8"));
    if (Array.isArray(offered)) return new Set(offered.filter((id) => typeof id === "string"));
  } catch {}
  // An unreadable marker must neither block startup nor reinstall plugins the user removed.
  return new Set(communityPluginIds);
}
