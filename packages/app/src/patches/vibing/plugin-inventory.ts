import type { PluginListItem } from "@getpaseo/protocol/messages";

interface PluginGroups {
  vibing: PluginListItem[];
  community: PluginListItem[];
  paseo: PluginListItem[];
  additional: PluginListItem[];
}

interface PluginInventoryInput {
  plugins: PluginListItem[];
  embedded: boolean;
}

const communityPluginSources = new Map([
  ["beautiful-chat", "ABorakati/beautiful-chat"],
  ["annotations", "neunzig-zehn/paseo-annotations"],
  ["mermaid", "dutchakdev/paseo-plugin-mermaid"],
  ["paseo-bots", "oliexe/paseo-bots"],
]);

// The other bundled integrations come from upstream; see docs/vibing-patches.md.
const vibingPluginIds = new Set(["space-app-vibing-theme", "codex-usage-source"]);

export function getCommunityPluginSource(plugin: PluginListItem, embedded: boolean) {
  return embedded && plugin.builtin ? communityPluginSources.get(plugin.id) : undefined;
}

export function groupPluginInventory({ plugins, embedded }: PluginInventoryInput): PluginGroups {
  const groups: PluginGroups = { vibing: [], community: [], paseo: [], additional: [] };
  for (const plugin of plugins) {
    const isVibing = embedded && vibingPluginIds.has(plugin.id);
    if (!plugin.builtin) groups.additional.push(plugin);
    else if (getCommunityPluginSource(plugin, embedded)) groups.community.push(plugin);
    else if (isVibing) groups.vibing.push(plugin);
    else groups.paseo.push(plugin);
  }
  return groups;
}
