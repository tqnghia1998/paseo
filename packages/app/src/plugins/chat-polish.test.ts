// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
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
  it.each([false, true])(
    "styles slash rows without stretching their text (legacy=%s)",
    (legacy) => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bundle = readFileSync(
        path.resolve(here, "../../../../plugins/paseo-chat-polish/client/paseo-chat-polish.gen.ts"),
        "utf8",
      );
      const style = document.createElement("style");
      // Exercise the shipped slash rules, including future additions, against both RN ScrollView shapes.
      style.textContent = bundle
        .split("\n")
        .filter((line) => line.startsWith('[data-cp-part="slash-list"]'))
        .join("\n");
      document.head.appendChild(style);
      const list = document.createElement("div");
      list.dataset.cpPart = "slash-list";
      const row =
        '<div tabindex="0" aria-label="/skill, Description"><div><svg></svg></div><div dir="auto">/skill</div><div dir="auto">Description</div><div><div dir="auto">Skill</div></div></div>';
      list.innerHTML = legacy ? `<div><div>${row}</div></div>` : `<div>${row}</div>`;
      document.body.appendChild(list);
      try {
        const option = list.querySelector("[aria-label]")!;
        expect(getComputedStyle(option).paddingLeft).toBe("10px");
        expect(getComputedStyle(option).minHeight).toBe("32px");
        for (const child of option.children) {
          expect(getComputedStyle(child).minHeight).not.toBe("32px");
          expect(getComputedStyle(child).paddingLeft).not.toBe("10px");
        }
      } finally {
        list.remove();
        style.remove();
      }
    },
  );

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
