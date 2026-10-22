import { cpSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Prebundled under plugins/ and copied beside the runner as community-plugins/.
export const communityPluginIds = [
  "beautiful-chat",
  "annotations",
  "paseo-doc-viewer",
  "shell-yeah",
  "paseo-recap",
  "paseo-quick-prompts",
  "genui",
];

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
  if (!pending.length) return;
  const config = readPersistedConfig(home, { defaultsIfMissing: true });
  const plugins = { ...config.plugins };
  for (const id of pending) {
    seen.add(id);
    if (Object.hasOwn(plugins, id)) continue;
    const directory = path.join(home, "installed-plugins", id);
    if (!existsSync(directory)) cpSync(path.join(sourceRoot, id), directory, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(directory, "paseo-plugin.json"), "utf8"));
    if (manifest.id !== id) throw new Error(`Unexpected community plugin: ${id}`);
    plugins[id] = { source: "directory", path: directory, enabled: true };
  }
  savePersistedConfig(home, {
    ...config,
    pluginsEnabled: config.pluginsEnabled ?? true,
    plugins,
  });
  // Rename into place so a crash never leaves a truncated marker.
  writeFileSync(`${marker}.tmp`, `${JSON.stringify([...seen])}\n`);
  renameSync(`${marker}.tmp`, marker);
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
