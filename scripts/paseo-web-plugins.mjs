import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// Each Vibing-installed copy records the fingerprint of the bundle it came from, so later starts
// can tell an untouched copy (safe to update) from one someone edited.
const FINGERPRINT_FILE = ".vibing-bundle.json";
// Copies installed before fingerprints carry the README the vendoring script writes.
const VENDORED_README = "node scripts/vendor-community-plugins.mjs";
const UPDATE_SUFFIX = ".vibing-update";
const PREVIOUS_SUFFIX = ".vibing-previous";

// Bootstrap each ordinary directory install once; the native plugin manager owns enablement and
// removal afterwards, while untouched copies follow the bundle.
export function prepareCommunityPlugins({
  home,
  sourceRoot,
  readPersistedConfig,
  savePersistedConfig,
}) {
  if (!existsSync(sourceRoot)) return;
  updateInstalledPlugins({ home, sourceRoot, readPersistedConfig });
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
    if (!existsSync(directory)) installCopy(path.join(sourceRoot, id), directory);
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

/**
 * Replaces Vibing-installed copies that are still untouched when the bundle changed. The config
 * entry is left as is, so a plugin keeps its enabled state; removed plugins, copies installed
 * elsewhere and edited copies are never touched. One plugin's failure does not block startup.
 */
function updateInstalledPlugins({ home, sourceRoot, readPersistedConfig }) {
  const installedRoot = path.join(home, "installed-plugins");
  if (!existsSync(installedRoot)) return;
  const outdated = [];
  for (const id of communityPluginIds) {
    const source = path.join(sourceRoot, id);
    const directory = path.join(installedRoot, id);
    try {
      recoverInterruptedUpdate(directory);
      if (!existsSync(source) || !existsSync(directory)) continue;
      const bundle = fingerprint(source);
      const recorded = readFingerprint(directory);
      if (recorded === bundle) continue;
      const untouched = recorded ? fingerprint(directory) === recorded : isVendoredCopy(directory);
      if (untouched) outdated.push({ id, source, directory, bundle });
    } catch (error) {
      console.warn(`[Paseo] Couldn't check the community plugin ${id}:`, error);
    }
  }
  if (!outdated.length) return;
  const { plugins = {} } = readPersistedConfig(home, { defaultsIfMissing: true });
  for (const { id, source, directory, bundle } of outdated) {
    const entry = plugins[id];
    const owned =
      entry?.source === "directory" &&
      typeof entry.path === "string" &&
      path.resolve(entry.path) === path.resolve(directory);
    if (!owned) continue;
    try {
      replaceCopy(source, directory, bundle);
    } catch (error) {
      console.warn(`[Paseo] Couldn't update the community plugin ${id}:`, error);
    }
  }
}

function installCopy(source, directory) {
  cpSync(source, directory, { recursive: true });
  writeFingerprint(directory, fingerprint(source));
}

/** Stages the new copy beside the old one, then swaps them, so a crash leaves one to recover. */
function replaceCopy(source, directory, bundle) {
  const staging = directory + UPDATE_SUFFIX;
  const previous = directory + PREVIOUS_SUFFIX;
  rmSync(staging, { recursive: true, force: true });
  cpSync(source, staging, { recursive: true });
  writeFingerprint(staging, bundle);
  rmSync(previous, { recursive: true, force: true });
  renameSync(directory, previous);
  try {
    renameSync(staging, directory);
  } catch (error) {
    // Put the old copy back now rather than run without the plugin until the next start.
    renameSync(previous, directory);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
}

function recoverInterruptedUpdate(directory) {
  const previous = directory + PREVIOUS_SUFFIX;
  if (!existsSync(directory) && existsSync(previous)) renameSync(previous, directory);
  rmSync(directory + UPDATE_SUFFIX, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
}

function isVendoredCopy(directory) {
  if (existsSync(path.join(directory, ".git")) || existsSync(path.join(directory, "node_modules")))
    return false;
  const readme = path.join(directory, "README.md");
  return existsSync(readme) && readFileSync(readme, "utf8").includes(VENDORED_README);
}

function readFingerprint(directory) {
  try {
    const { fingerprint: recorded } = JSON.parse(
      readFileSync(path.join(directory, FINGERPRINT_FILE), "utf8"),
    );
    return typeof recorded === "string" ? recorded : undefined;
  } catch {
    return undefined;
  }
}

function writeFingerprint(directory, value) {
  writeFileSync(
    path.join(directory, FINGERPRINT_FILE),
    `${JSON.stringify({ fingerprint: value })}\n`,
  );
}

/** SHA-256 over every file's relative path and bytes, in a stable order. */
function fingerprint(root) {
  const hash = createHash("sha256");
  const visit = (relative) => {
    const names = readdirSync(path.join(root, relative)).sort();
    for (const name of names) {
      const child = path.join(relative, name);
      if (child === FINGERPRINT_FILE) continue;
      const stats = lstatSync(path.join(root, child));
      if (stats.isDirectory()) visit(child);
      else {
        hash.update(`${child.split(path.sep).join("/")}\0`);
        const target = path.join(root, child);
        hash.update(
          stats.isSymbolicLink() ? `symlink:${readlinkSync(target)}` : readFileSync(target),
        );
        hash.update("\0");
      }
    }
  };
  visit("");
  return hash.digest("hex");
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
