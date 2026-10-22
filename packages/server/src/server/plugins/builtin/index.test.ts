import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vitest";
import { compilePlugin } from "../compiler.js";
import { readPluginManifest } from "../manifest.js";
import { DaemonClient } from "../../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../../test-utils/paseo-daemon.js";
import { BuiltinPluginLoader, builtinPlugins, resolveBuiltinPluginsRoot } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(root: string, id: string, client = false): Promise<string> {
  const directory = path.join(root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id, requirements: { paseo: ">=0.9.2" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    "export default function contribute() { return () => {}; }",
  );
  if (client) {
    await writeFile(
      path.join(directory, "index.client.tsx"),
      "export default function contribute() { const marker = 'builtin-client-marker'; void marker; return () => {}; }",
    );
  }
  return directory;
}

test("listed built-ins resolve to matching manifests and compile", async () => {
  const root = resolveBuiltinPluginsRoot();
  for (const id of builtinPlugins) {
    const directory = path.join(root, id);
    expect((await readPluginManifest(directory)).id).toBe(id);
    const findEntry = async (names: string[]) => {
      for (const name of names) {
        const entry = path.join(directory, name);
        if ((await stat(entry).catch(() => null))?.isFile()) return entry;
      }
      return null;
    };
    const bundles = await compilePlugin({
      server: await findEntry(["index.server.ts", "index.server.tsx"]),
      client: await findEntry(["index.client.ts", "index.client.tsx"]),
    });
    expect(bundles.serverBundle).toBeTruthy();
  }
});

test("standalone bundles resolve built-ins beside the server entrypoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-builtin-standalone-"));
  roots.push(root);
  const plugins = path.join(root, "builtin-plugins");
  await mkdir(plugins);
  expect(resolveBuiltinPluginsRoot(pathToFileURL(path.join(root, "server.mjs")))).toBe(plugins);
});

test("Bots stays built-in while ordinary community plugins use native lifecycle controls and their daemon home", async () => {
  const embeddedDefaults = ["space-app-vibing-theme", "paseo-bots"];
  for (const id of embeddedDefaults) expect(builtinPlugins).toContain(id);
  const daemon = await createTestPaseoDaemon({
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(resolveBuiltinPluginsRoot(), embeddedDefaults),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const catalog = await client.getPluginCatalog();
    expect(catalog).toHaveLength(2);
    expect(
      await client.invokePluginRpc("paseo-bots", "bots.ensure-home", { botId: "bundle-test" }),
    ).toMatchObject({
      root: path.join(daemon.paseoHome, "plugin-data/paseo-bots/shared/Bots"),
    });
    expect(await client.listPlugins()).toEqual([]);
    await client.patchDaemonConfig({ pluginsEnabled: true });
    for (const id of ["beautiful-chat", "annotations"]) {
      expect(builtinPlugins).not.toContain(id);
      await client.installDirectoryPlugin(path.join(resolveBuiltinPluginsRoot(), id));
    }
    expect((await client.listPlugins()).map(({ id }) => id).sort()).toEqual([
      "annotations",
      "beautiful-chat",
    ]);
    await client.disablePlugin("beautiful-chat");
    expect(await client.listPlugins()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "beautiful-chat", status: "disabled" }),
      ]),
    );
    await client.enablePlugin("beautiful-chat");
    const installedCatalog = await client.getPluginCatalog();
    const annotation = {
      id: "bundle-test",
      agentId: "agent-test",
      quote: "Selected passage",
      anchorText: "Selected passage",
      code: null,
      anchor: null,
      comment: "Explain this",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await client.invokePluginRpc("annotations", "annotations.save", { annotations: [annotation] });
    expect(await client.invokePluginRpc("annotations", "annotations.list", {})).toEqual({
      annotations: [annotation],
    });
    expect(
      (
        await stat(path.join(daemon.paseoHome, "plugin-data/annotations/annotations.json"))
      ).isFile(),
    ).toBe(true);
    expect(catalog.find(({ id }) => id === "space-app-vibing-theme")?.clientBundle).toContain(
      "Space App Vibing",
    );
    expect(installedCatalog.find(({ id }) => id === "beautiful-chat")?.clientBundle).toContain(
      "Chat presentation",
    );
    expect(
      await client.invokePluginRpc("beautiful-chat", "highlight.tokens", {
        code: "const bundled = true;",
        language: "typescript",
        dark: true,
      }),
    ).toMatchObject({
      language: "typescript",
      lines: [
        expect.arrayContaining([
          expect.objectContaining({ color: expect.stringMatching(/^#[a-f0-9]{6}$/i) }),
        ]),
      ],
    });
    await client.removePlugin("annotations");
    expect(
      (
        await stat(path.join(daemon.paseoHome, "plugin-data/annotations/annotations.json"))
      ).isFile(),
    ).toBe(true);
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);

test("listed client bundle is published while plugins are disabled; unlisted directory is inert", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-builtin-fixture-"));
  roots.push(root);
  await fixture(root, "listed", true);
  await fixture(root, "unlisted", true);
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.9.2",
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(root, ["listed"]),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.9.2" });
  try {
    await client.connect();
    expect(await client.listPlugins()).toEqual([]);
    const catalog = await client.getPluginCatalog();
    expect(catalog.map(({ id }) => id)).toEqual(["listed"]);
    expect(catalog[0]?.clientBundle).toContain("builtin-client-marker");
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);

test("directory, Git, and npm installs reject a built-in ID", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-builtin-install-"));
  roots.push(root);
  const directory = await fixture(root, "reserved");
  const gitDirectory = await fixture(root, "git-source");
  await writeFile(
    path.join(gitDirectory, "paseo-plugin.json"),
    JSON.stringify({ id: "reserved", requirements: { paseo: ">=0.9.2" } }),
  );
  execFileSync("git", ["init", "-q", gitDirectory]);
  execFileSync("git", [
    "-C",
    gitDirectory,
    "-c",
    "user.name=Paseo Tests",
    "-c",
    "user.email=paseo@example.test",
    "add",
    ".",
  ]);
  execFileSync("git", [
    "-C",
    gitDirectory,
    "-c",
    "user.name=Paseo Tests",
    "-c",
    "user.email=paseo@example.test",
    "commit",
    "-qm",
    "fixture",
  ]);
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.9.2",
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(root, ["reserved"]),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.9.2" });
  try {
    await client.connect();
    await expect(client.installDirectoryPlugin(directory)).rejects.toThrow(
      /reserved for a built-in/,
    );
    await expect(
      client.installPluginSource({ source: pathToFileURL(gitDirectory).href }),
    ).rejects.toThrow(/reserved for a built-in/);
    await expect(
      client.installPluginSource({ source: "npm:unused-fixture", id: "reserved" }),
    ).rejects.toThrow(/reserved for a built-in/);
    expect(await client.listPlugins()).toEqual([]);
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);
