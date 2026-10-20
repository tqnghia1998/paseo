import { describe, expect, it } from "vitest";
import type { PluginListItem } from "@getpaseo/protocol/messages";
import { groupPluginInventory } from "./plugin-inventory";

function plugin(id: string): PluginListItem {
  return { id, builtin: true, path: `/plugins/${id}`, enabled: true, status: "running" };
}

describe("groupPluginInventory", () => {
  it("separates Vibing plugin changes from Paseo integrations and installed plugins", () => {
    const zai = plugin("zai-usage-source");
    const codex = plugin("codex-usage-source");
    const beautifulChat = plugin("beautiful-chat");
    const theme = plugin("space-app-vibing-theme");
    const muse = plugin("muse-provider");
    const additional = { ...plugin("example"), builtin: false };

    expect(
      groupPluginInventory({
        plugins: [zai, codex, beautifulChat, theme, muse, additional],
        embedded: true,
      }),
    ).toEqual({
      vibing: [codex, theme],
      community: [beautifulChat],
      paseo: [zai, muse],
      additional: [additional],
    });
  });

  it("attributes all bundled community plugins without changing their runtime status", () => {
    const community = ["beautiful-chat", "mermaid", "paseo-bots", "annotations"].map(plugin);
    community[2]!.status = "failed";
    community[2]!.error = "Worker unavailable";
    expect(groupPluginInventory({ plugins: community, embedded: true })).toEqual({
      vibing: [],
      community,
      paseo: [],
      additional: [],
    });
    expect(groupPluginInventory({ plugins: community, embedded: false })).toEqual({
      vibing: [],
      community: [],
      paseo: community,
      additional: [],
    });
    const installed = community.map((entry) => Object.assign(plugin(entry.id), { builtin: false }));
    expect(groupPluginInventory({ plugins: installed, embedded: true }).additional).toEqual(
      installed,
    );
  });

  it("keeps configured plugins in Additional even when their IDs match a Vibing plugin", () => {
    const installed = { ...plugin("codex-usage-source"), builtin: false };
    const legacy = { ...plugin("space-app-vibing-theme"), builtin: undefined };
    expect(groupPluginInventory({ plugins: [installed, legacy], embedded: true })).toEqual({
      vibing: [],
      community: [],
      paseo: [],
      additional: [installed, legacy],
    });
  });

  it("preserves upstream grouping outside embedded builds", () => {
    const codex = plugin("codex-usage-source");
    const theme = plugin("space-app-vibing-theme");
    expect(groupPluginInventory({ plugins: [codex, theme], embedded: false })).toEqual({
      vibing: [],
      community: [],
      paseo: [codex, theme],
      additional: [],
    });
  });

  it("retains failed status and unknown built-ins without inventing absent plugins", () => {
    const failed: PluginListItem = {
      ...plugin("codex-usage-source"),
      status: "failed",
      error: "Unable to start",
    };
    const unknown = plugin("future-provider");
    expect(groupPluginInventory({ plugins: [failed, unknown], embedded: true })).toEqual({
      vibing: [failed],
      community: [],
      paseo: [unknown],
      additional: [],
    });
    expect(groupPluginInventory({ plugins: [], embedded: true })).toEqual({
      vibing: [],
      community: [],
      paseo: [],
      additional: [],
    });
  });
});
