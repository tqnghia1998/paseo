import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vibing ships only the usage sources for its supported agents; the other upstream
// provider and usage-source plugins stay in plugins/ for their own tests.
export const builtinPlugins = [
  "claude-usage-source",
  "codex-usage-source",
  "ais-switch-usage-source",
  "paseo-bots",
  "space-app-vibing-theme",
] as const;

export function resolveBuiltinPluginsRoot(moduleUrl: string | URL = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const archiveSegment = `${path.sep}app.asar${path.sep}`;
  const archiveIndex = moduleDir.indexOf(archiveSegment);
  if (archiveIndex !== -1) {
    // esbuild runs outside Electron's filesystem shim and cannot read archive entries.
    return path.join(moduleDir.slice(0, archiveIndex), "builtin-plugins");
  }
  const candidates = [
    path.join(moduleDir, "builtin-plugins"),
    path.resolve(moduleDir, "..", "..", "..", "builtin-plugins"),
    path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "plugins"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export interface BuiltinPlugin {
  id: string;
  directory: string;
  isolated?: boolean;
}

// Stateful community plugins read PASEO_HOME and own timers or local servers.
const isolatedBuiltins = new Set(["paseo-bots"]);

export class BuiltinPluginLoader {
  readonly ids: ReadonlySet<string>;

  constructor(
    private readonly root = resolveBuiltinPluginsRoot(),
    private readonly list: readonly string[] = builtinPlugins,
  ) {
    this.ids = new Set(list);
  }

  async load(start: (plugin: BuiltinPlugin) => Promise<void>): Promise<void> {
    for (const id of this.list) {
      await start({
        id,
        directory: path.join(this.root, id),
        ...(isolatedBuiltins.has(id) ? { isolated: true } : {}),
      });
    }
  }
}
