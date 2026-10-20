import type { PluginListItem } from "@getpaseo/protocol/messages";

interface PluginGroups {
  vibing: PluginListItem[];
  paseo: PluginListItem[];
  additional: PluginListItem[];
}

interface PluginInventoryInput {
  plugins: PluginListItem[];
  embedded: boolean;
}

// The other bundled integrations come from upstream; see docs/vibing-patches.md.
const vibingPluginIds = new Set(["space-app-vibing-theme", "codex-usage-source", "beautiful-chat"]);

export function groupPluginInventory({ plugins, embedded }: PluginInventoryInput): PluginGroups {
  const groups: PluginGroups = { vibing: [], paseo: [], additional: [] };
  for (const plugin of plugins) {
    const isVibing = embedded && vibingPluginIds.has(plugin.id);
    if (!plugin.builtin) groups.additional.push(plugin);
    else if (isVibing) groups.vibing.push(plugin);
    else groups.paseo.push(plugin);
  }
  return groups;
}
