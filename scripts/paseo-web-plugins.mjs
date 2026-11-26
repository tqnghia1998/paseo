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
export const communityPluginIds = ["better-paseo", "shell-yeah", "genui", "reply-followups"];

// Addons Vibing no longer ships. The copy Vibing installed is dropped once on the next start; a copy
// installed from elsewhere stays. (Chat Polish and Beautiful Chat are retired separately below: they have a replacement.)
const REMOVED_PLUGINS = [
  "paseo-quick-prompts",
  "paseo-sidechat",
  "paseo-doc-viewer",
  "paseo-recap",
  "annotations",
];

// Better Paseo replaced Chat Polish (and earlier Beautiful Chat) as the bundled chat and Tasks board addon.
// A copy Vibing installed is swapped for Better Paseo once, keeping its enabled state; one installed from elsewhere stays.
const RETIRED_PLUGINS = ["paseo-chat-polish", "beautiful-chat"];
const RETIRED_REPLACEMENT = "better-paseo";

// Each Vibing-installed copy records the fingerprint of the bundle it came from, so later starts
// can tell an untouched copy (safe to update) from one someone edited.
const FINGERPRINT_FILE = ".vibing-bundle.json";
const SOURCE_FINGERPRINTS_CACHE_FILE = ".vibing-source-fingerprints.json";
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
  removeRetiredPlugins({ home, readPersistedConfig, savePersistedConfig });
  if (!existsSync(sourceRoot)) return;
  updateInstalledPlugins({ home, sourceRoot, readPersistedConfig });
  const marker = path.join(home, ".vibing-community-plugins.json");
  const seen = readOfferedPlugins(marker, path.join(home, ".vibing-community-plugins-v1"));
  const pending = communityPluginIds.filter(
    (id) => !seen.has(id) && existsSync(path.join(sourceRoot, id)),
  );
  if (!pending.length && !hasRetiredPluginDirectories(home)) return;
  const config = readPersistedConfig(home, { defaultsIfMissing: true });
  const plugins = { ...config.plugins };
  const retired = existsSync(path.join(sourceRoot, RETIRED_REPLACEMENT))
    ? retireBundledPlugins(plugins, home)
    : undefined;
  if (retired?.entry && !pending.includes(RETIRED_REPLACEMENT))
    pending.unshift(RETIRED_REPLACEMENT);
  if (!pending.length && !retired?.directories.length) return;
  if (pending.length || retired?.entry) {
    installPendingPlugins({
      pending,
      seen,
      plugins,
      home,
      sourceRoot,
      retiredEntry: retired?.entry,
    });
    savePersistedConfig(home, {
      ...config,
      pluginsEnabled: config.pluginsEnabled ?? true,
      plugins,
    });
    // Rename into place so a crash never leaves a truncated marker.
    writeFileSync(`${marker}.tmp`, `${JSON.stringify([...seen])}\n`);
    renameSync(`${marker}.tmp`, marker);
  }
  // The config no longer points at them, so a crash here leaves only unused folders.
  for (const directory of retired?.directories ?? []) {
    rmSync(directory, { recursive: true, force: true });
  }
}

function installPendingPlugins({ pending, seen, plugins, home, sourceRoot, retiredEntry }) {
  for (const id of pending) {
    seen.add(id);
    if (Object.hasOwn(plugins, id)) continue;
    const directory = path.join(home, "installed-plugins", id);
    if (!existsSync(directory)) installCopy(path.join(sourceRoot, id), directory);
    const manifest = JSON.parse(readFileSync(path.join(directory, "paseo-plugin.json"), "utf8"));
    if (manifest.id !== id) throw new Error(`Unexpected community plugin: ${id}`);
    const enabled =
      id === RETIRED_REPLACEMENT && retiredEntry ? retiredEntry.enabled !== false : true;
    plugins[id] = { source: "directory", path: directory, enabled };
  }
}

/**
 * Replaces Vibing-installed copies that are still untouched when the bundle changed. The config
 * entry is left as is, so a plugin keeps its enabled state; removed plugins, copies installed
 * elsewhere and edited copies are never touched. One plugin's failure does not block startup.
 */
function updateInstalledPlugins({ home, sourceRoot, readPersistedConfig }) {
  const installedRoot = path.join(home, "installed-plugins");
  if (!existsSync(installedRoot)) return;
  const sourceCache = readSourceFingerprintCache(home);
  const outdated = [];
  for (const id of communityPluginIds) {
    const source = path.join(sourceRoot, id);
    const directory = path.join(installedRoot, id);
    try {
      recoverInterruptedUpdate(directory);
      if (!existsSync(source) || !existsSync(directory)) continue;
      const bundle = resolveSourceFingerprint(id, source, sourceCache);
      const recorded = readFingerprint(directory);
      if (recorded === bundle) continue;
      const untouched = recorded ? fingerprint(directory) === recorded : isVendoredCopy(directory);
      if (untouched) outdated.push({ id, source, directory, bundle });
    } catch (error) {
      console.warn(`[Paseo] Couldn't check the community plugin ${id}:`, error);
    }
  }
  writeSourceFingerprintCache(home, sourceCache);
  if (!outdated.length) return;
  const { plugins = {} } = readPersistedConfig(home, {
    defaultsIfMissing: true,
  });
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

function readSourceFingerprintCache(home) {
  const file = path.join(home, SOURCE_FINGERPRINTS_CACHE_FILE);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { entries: { ...parsed }, dirty: false };
    }
  } catch {}
  return { entries: {}, dirty: false };
}

function writeSourceFingerprintCache(home, cache) {
  if (!cache.dirty) return;
  const file = path.join(home, SOURCE_FINGERPRINTS_CACHE_FILE);
  try {
    writeFileSync(`${file}.tmp`, `${JSON.stringify(cache.entries)}\n`);
    renameSync(`${file}.tmp`, file);
  } catch {}
}

function resolveSourceFingerprint(id, source, cache) {
  const meta = metadataFingerprint(source);
  const hit = cache.entries[id];
  if (hit && hit.meta === meta && typeof hit.fingerprint === "string") {
    return hit.fingerprint;
  }
  const value = fingerprint(source);
  cache.entries[id] = { meta, fingerprint: value };
  cache.dirty = true;
  return value;
}

function metadataFingerprint(root) {
  const hash = createHash("sha256");
  const visit = (relative) => {
    const names = readdirSync(path.join(root, relative)).sort();
    for (const name of names) {
      const child = path.join(relative, name);
      if (child === FINGERPRINT_FILE) continue;
      const target = path.join(root, child);
      const stats = lstatSync(target, { bigint: true });
      if (stats.isDirectory()) visit(child);
      else if (stats.isSymbolicLink()) {
        hash.update(`L:${child.split(path.sep).join("/")}:${readlinkSync(target)}\0`);
      } else {
        hash.update(
          `F:${child.split(path.sep).join("/")}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}\0`,
        );
      }
    }
  };
  visit("");
  return hash.digest("hex");
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

/** Drops config entries (and folders) for addons Vibing stopped shipping, when Vibing installed them. */
function removeRetiredPlugins({ home, readPersistedConfig, savePersistedConfig }) {
  const installedRoot = path.join(home, "installed-plugins");
  const owned = REMOVED_PLUGINS.filter((id) => existsSync(path.join(installedRoot, id)));
  if (!owned.length) return;
  try {
    const config = readPersistedConfig(home, { defaultsIfMissing: true });
    const plugins = { ...config.plugins };
    const dropped = [];
    for (const id of owned) {
      const directory = path.join(installedRoot, id);
      const entry = plugins[id];
      // Only the copy Vibing installed: its entry points at that exact folder, or there is no entry.
      const ours =
        !entry ||
        (entry.source === "directory" &&
          typeof entry.path === "string" &&
          path.resolve(entry.path) === path.resolve(directory));
      if (!ours) continue;
      delete plugins[id];
      dropped.push(directory);
    }
    if (!dropped.length) return;
    savePersistedConfig(home, { ...config, plugins });
    // The config no longer points at them, so a crash here leaves only unused folders.
    for (const directory of dropped) rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.warn("[Paseo] Couldn't remove a retired community plugin:", error);
  }
}

function isRemovableOrphanedDir(directory) {
  return existsSync(directory) && !existsSync(path.join(directory, ".git"));
}

function hasRetiredPluginDirectories(home) {
  return RETIRED_PLUGINS.some(
    (id) =>
      isRemovableOrphanedDir(path.join(home, "installed-plugins", id)) ||
      existsSync(path.join(home, "plugin-upgrades", id)),
  );
}

function isOwnedRetiredPath(targetPath, installedDir, upgradesDir) {
  const resolved = path.resolve(targetPath);
  const resolvedInstalled = path.resolve(installedDir);
  if (resolved === resolvedInstalled) return true;
  const resolvedUpgrades = path.resolve(upgradesDir);
  const rel = path.relative(resolvedUpgrades, resolved);
  return Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Removes Vibing-installed Chat Polish / Beautiful Chat entries and returns the newest entry + folders to drop. */
function retireBundledPlugins(plugins, home) {
  let retiredEntry;
  const directories = [];
  for (const id of RETIRED_PLUGINS) {
    const installedDir = path.join(home, "installed-plugins", id);
    const upgradesDir = path.join(home, "plugin-upgrades", id);
    const entry = plugins[id];
    if (!entry) {
      if (isRemovableOrphanedDir(installedDir)) directories.push(installedDir);
      if (existsSync(upgradesDir)) directories.push(upgradesDir);
      continue;
    }
    if (entry.source !== "directory" || typeof entry.path !== "string") continue;
    if (!isOwnedRetiredPath(entry.path, installedDir, upgradesDir)) continue;
    delete plugins[id];
    retiredEntry ??= entry;
    if (existsSync(installedDir)) directories.push(installedDir);
    if (existsSync(upgradesDir)) directories.push(upgradesDir);
  }
  return retiredEntry || directories.length ? { entry: retiredEntry, directories } : undefined;
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
