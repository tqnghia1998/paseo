// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePlugin } from "../../../server/src/server/plugins/compiler";
import { runPluginClientBundle, type PluginClientRuntime } from "./evaluate";

// Chat Polish restyles the DOM, reads saved settings over RPC and lists providers for its model rail.
const runtime = {
  paseo: {
    agents: {
      async list() {
        return { subscription: { subscribe() {} } };
      },
    },
    providers: {
      async snapshot() {
        return { entries: [] };
      },
      subscribe() {
        return () => {};
      },
    },
  },
  async rpc() {
    return {};
  },
  openSettings() {},
  openScreen() {},
  openSurface() {},
  openPanel() {},
} as unknown as PluginClientRuntime;

describe("bundled Chat Polish", () => {
  it("leaves prompts native and releases its contributions", async () => {
    // jsdom replaces the global URL, so resolve the plugin from this file's path.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const { clientBundle } = await compilePlugin({
      client: path.resolve(here, "../../../../plugins/paseo-chat-polish/index.client.ts"),
      server: null,
    });
    const plugin = runPluginClientBundle("paseo-chat-polish", clientBundle!, runtime);
    try {
      expect(plugin.timelineTransformers.length).toBeGreaterThan(0);
      expect(plugin.timelineTransformers.map(({ query }) => query.itemType)).not.toContain(
        "user_message",
      );
      expect(plugin.surfaces.map(({ id }) => id)).toContain("dashboard");
    } finally {
      await plugin.cleanup();
    }
    expect(plugin.timelineTransformers).toEqual([]);
    expect(plugin.surfaces).toEqual([]);
  });
});
