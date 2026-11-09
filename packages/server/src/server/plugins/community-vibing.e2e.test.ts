import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

async function withPlugin(
  id: string,
  check: (client: DaemonClient, directory: string) => Promise<void>,
) {
  const daemon = await createTestPaseoDaemon({ daemonVersion: "0.15.3" });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.15.3",
  });
  try {
    const source = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../..",
      "plugins",
      id,
    );
    const directory = path.join(daemon.paseoHome, "installed plugins", id);
    await cp(source, directory, { recursive: true });
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await expect(client.installDirectoryPlugin(directory)).resolves.toMatchObject({
      id,
      enabled: true,
      status: "running",
    });
    await check(client, directory);
  } finally {
    await client.close();
    await daemon.close();
  }
}

test("vendored GenUI serves gallery examples, their data and the sketch font from a relocated install", async () => {
  await withPlugin("genui", async (client, directory) => {
    await expect(client.invokePluginRpc("genui", "genui.gallery_list", {})).resolves.toMatchObject({
      names: expect.arrayContaining(["Card.ui", "Tests-vitest.ui"]),
    });
    const spec = await client.invokePluginRpc("genui", "genui.gallery_get", { name: "Card" });
    expect(spec).toEqual({
      source: await readFile(path.join(directory, "gallery/Card.ui"), "utf8"),
    });
    await expect(
      client.invokePluginRpc("genui", "genui.gallery_data", { path: "data/vitest-report.json" }),
    ).resolves.toMatchObject({ ok: true });
    const font = await readFile(
      path.join(directory, "assets/fonts/Excalifont-Regular-latin.woff2"),
    );
    expect(
      await readFile(path.join(directory, "assets/fonts/Excalifont-OFL.txt"), "utf8"),
    ).toContain("SIL OPEN FONT LICENSE");
    await expect(client.invokePluginRpc("genui", "genui.sketch_font", {})).resolves.toEqual({
      dataUrl: `data:font/woff2;base64,${font.toString("base64")}`,
    });
    const examples = await client.invokePluginRpc("genui", "genui.ui_examples", {
      components: ["Card"],
    });
    expect(examples).toMatchObject({ ok: true, text: expect.stringContaining("```ui") });
  });
}, 60_000);

test("vendored Chat Polish reports local updates without depending on an external Paseo CLI", async () => {
  await withPlugin("paseo-chat-polish", async (client, directory) => {
    await expect(client.invokePluginRpc("paseo-chat-polish", "update.check", {})).resolves.toEqual({
      state: "local",
      links: [],
    });
    await expect(
      client.invokePluginRpc("paseo-chat-polish", "update.apply", {}),
    ).resolves.toMatchObject({ error: expect.stringContaining("Space App Vibing") });
    // Native source-path upgrades keep settings and avoid older bundle bootstrap copies.
    const prefs = await client.invokePluginRpc("paseo-chat-polish", "prefs.get", {});
    const config = (await client.getDaemonConfig()).config;
    const upgraded = `${directory}-upgraded`;
    await cp(directory, upgraded, { recursive: true });
    await client.patchDaemonConfig({
      plugins: {
        ...config.plugins,
        "paseo-chat-polish": { ...config.plugins!["paseo-chat-polish"]!, path: upgraded },
      },
    });
    await expect(client.reloadPlugin("paseo-chat-polish")).resolves.toMatchObject({
      enabled: true,
      status: "running",
      path: upgraded,
    });
    await expect(client.invokePluginRpc("paseo-chat-polish", "prefs.get", {})).resolves.toEqual(
      prefs,
    );
  });
}, 60_000);
