import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  cpSync,
  readdirSync,
  renameSync,
  lstatSync,
  statSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readPersistedConfig,
  savePersistedConfig,
} from "../packages/server/dist/server/server/persisted-config.js";

test("runner keeps cleanup capability out of external commands and Bash sessions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-runner-token-"));
  const token = "cleanup-regression-canary";
  const require = createRequire(import.meta.url);
  try {
    copyFileSync(
      path.join(import.meta.dirname, "paseo-web.js"),
      path.join(directory, "paseo-web.mjs"),
    );
    copyFileSync(
      path.join(import.meta.dirname, "paseo-web-plugins.mjs"),
      path.join(directory, "paseo-web-plugins.mjs"),
    );
    // This adapter probes import-time inheritance, before daemon construction.
    writeFileSync(
      path.join(directory, "server.mjs"),
      `
import { execFileSync } from "node:child_process";
import pty from ${JSON.stringify(require.resolve("node-pty"))};
const external = execFileSync(process.execPath, ["-e",
  "process.stdout.write(process.env.PASEO_WORKTREE_CLEANUP_TOKEN ?? 'absent')"
], { encoding: "utf8" });
const bash = execFileSync("bash", ["--noprofile", "--norc", "-c",
  'printf "%s" "\${PASEO_WORKTREE_CLEANUP_TOKEN-absent}"'
], { encoding: "utf8" });
const bashSession = await new Promise((resolve, reject) => {
  const terminal = pty.spawn("bash", ["--noprofile", "--norc", "-i"], {
    cwd: ${JSON.stringify(directory)}, env: { ...process.env, PS1: "" },
    cols: 200, rows: 24,
  });
  let output = "";
  const timer = setTimeout(() => {
    terminal.kill();
    reject(new Error("Bash PTY timed out"));
  }, 5000);
  terminal.onData(data => { output += data; });
  terminal.onExit(() => {
    clearTimeout(timer);
    resolve(output);
  });
  terminal.write('printf "TOKEN_RESULT=%s\\\\n" "\${PASEO_WORKTREE_CLEANUP_TOKEN-absent}"; exit\\r');
});
export const loadConfig = () => ({});
export const createRootLogger = () => ({});
export async function createPaseoDaemon(config) {
  console.log(JSON.stringify({
    external, bash, bashSession, token: config.worktreeCleanupToken,
    inherited: process.env.PASEO_WORKTREE_CLEANUP_TOKEN ?? "absent",
  }));
  return {
    start: async () => {},
    getListenTarget: () => ({ host: "127.0.0.1", port: 0 }),
  };
}
`,
    );
    const output = execFileSync(process.execPath, [path.join(directory, "paseo-web.mjs")], {
      env: { ...process.env, PASEO_WORKTREE_CLEANUP_TOKEN: token },
      encoding: "utf8",
      timeout: 10_000,
    });
    const { bashSession, ...result } = JSON.parse(output.split("\n")[0]);
    assert.match(bashSession, /TOKEN_RESULT=absent\r?\n/);
    assert.ok(!bashSession.includes(token));
    assert.deepEqual(result, {
      external: "absent",
      bash: "absent",
      token,
      inherited: "absent",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runner-only bundling preserves existing backend and UI artifacts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-runner-build-"));
  try {
    writeFileSync(path.join(directory, "server.mjs"), "existing backend");
    writeFileSync(path.join(directory, "ui-canary"), "existing UI");
    execFileSync(process.execPath, ["scripts/bundle-paseo-web.mjs", "--runner-only"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, PASEO_WEB_DEST_DIR: directory },
      timeout: 10_000,
    });
    assert.equal(readFileSync(path.join(directory, "server.mjs"), "utf8"), "existing backend");
    assert.equal(readFileSync(path.join(directory, "ui-canary"), "utf8"), "existing UI");
    assert.equal(
      readFileSync(path.join(directory, "paseo-web.js"), "utf8"),
      readFileSync(path.join(import.meta.dirname, "paseo-web.js"), "utf8"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("server-only packaging relocates the upstream terminal worker without replacing the UI", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-server-package-"));
  try {
    writeFileSync(path.join(directory, "server.mjs"), "old backend");
    writeFileSync(path.join(directory, "terminal-worker-process.js"), "obsolete worker");
    writeFileSync(path.join(directory, "ui-canary"), "existing UI");
    execFileSync(process.execPath, ["scripts/bundle-paseo-web.mjs", "--server-only"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, PASEO_WEB_DEST_DIR: directory },
      timeout: 30_000,
    });
    assert.match(
      readFileSync(path.join(directory, "server.mjs"), "utf8"),
      /new URL\("\.\/terminal-worker\/", import\.meta\.url\)/,
    );
    assert.ok(existsSync(path.join(directory, "terminal-worker", "terminal-worker.mjs")));
    assert.ok(existsSync(path.join(directory, "plugin-process.js")));
    assert.ok(existsSync(path.join(directory, "compiler-worker.js")));
    assert.ok(
      existsSync(path.join(directory, "terminal-worker", "shell-integration", "zsh", ".zshenv")),
    );
    assert.ok(!existsSync(path.join(directory, "terminal-worker-process.js")));
    assert.equal(readFileSync(path.join(directory, "ui-canary"), "utf8"), "existing UI");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("community plugins install once as ordinary directory sources and respect removal and disablement", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const home = path.join(root, "home");
    const sourceRoot = path.join(root, "sources");
    mkdirSync(home);
    for (const id of ["paseo-chat-polish", "annotations"]) {
      mkdirSync(path.join(sourceRoot, id), { recursive: true });
      writeFileSync(path.join(sourceRoot, id, "paseo-plugin.json"), JSON.stringify({ id }));
    }
    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ version: 1, pluginsEnabled: false, log: { level: "warn" } }),
    );
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    const configPath = path.join(home, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.pluginsEnabled, false);
    assert.equal(config.log.level, "warn");
    for (const id of ["paseo-chat-polish", "annotations"]) {
      assert.equal(config.plugins[id].source, "directory");
      assert.equal(config.plugins[id].enabled, true);
      assert.ok(existsSync(path.join(config.plugins[id].path, "paseo-plugin.json")));
    }
    delete config.plugins["paseo-chat-polish"];
    config.plugins.annotations.enabled = false;
    writeFileSync(configPath, JSON.stringify(config));
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), config);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("homes bootstrapped by the legacy marker receive only newly bundled community plugins", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const home = path.join(root, "home");
    const sourceRoot = path.join(root, "sources");
    mkdirSync(home);
    for (const id of ["paseo-chat-polish", "annotations", "genui", "paseo-recap"]) {
      mkdirSync(path.join(sourceRoot, id), { recursive: true });
      writeFileSync(path.join(sourceRoot, id, "paseo-plugin.json"), JSON.stringify({ id }));
    }
    const configPath = path.join(home, "config.json");
    // Beautiful Chat was removed and Recap was installed separately before the upgrade.
    const recap = { source: "directory", path: "/elsewhere/paseo-recap", enabled: false };
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        plugins: {
          annotations: { source: "directory", path: "/a", enabled: false },
          "paseo-recap": recap,
        },
      }),
    );
    writeFileSync(path.join(home, ".vibing-community-plugins-v1"), "1\n");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.plugins["beautiful-chat"], undefined);
    assert.equal(config.plugins.annotations.enabled, false);
    assert.deepEqual(config.plugins["paseo-recap"], recap);
    assert.equal(config.plugins.genui.source, "directory");
    assert.equal(config.plugins.genui.enabled, true);
    // Without Beautiful Chat, its replacement is offered.
    assert.equal(config.plugins["paseo-chat-polish"].enabled, true);

    delete config.plugins.genui;
    writeFileSync(configPath, JSON.stringify(config));
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), config);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function communityHome(root, ids) {
  const home = path.join(root, "home");
  const sourceRoot = path.join(root, "sources");
  mkdirSync(home);
  for (const id of ids) {
    mkdirSync(path.join(sourceRoot, id), { recursive: true });
    writeFileSync(path.join(sourceRoot, id, "paseo-plugin.json"), JSON.stringify({ id }));
  }
  return { home, sourceRoot, configPath: path.join(home, "config.json") };
}

function installRetiredBeautifulChat(home) {
  const directory = path.join(home, "installed-plugins", "beautiful-chat");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "beautiful-chat" }),
  );
  return directory;
}

for (const offered of [["beautiful-chat"], ["beautiful-chat", "paseo-chat-polish"]]) {
  test(`the bundled Beautiful Chat is replaced by Chat Polish, keeping its state: ${offered}`, async () => {
    const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
    try {
      const { home, sourceRoot, configPath } = communityHome(root, ["paseo-chat-polish", "genui"]);
      const retired = installRetiredBeautifulChat(home);
      writeFileSync(
        configPath,
        JSON.stringify({
          version: 1,
          pluginsEnabled: false,
          plugins: { "beautiful-chat": { source: "directory", path: retired, enabled: false } },
        }),
      );
      writeFileSync(path.join(home, ".vibing-community-plugins.json"), JSON.stringify(offered));
      prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      assert.equal(config.pluginsEnabled, false);
      assert.equal(config.plugins["beautiful-chat"], undefined);
      assert.ok(!existsSync(retired));
      assert.equal(config.plugins["paseo-chat-polish"].source, "directory");
      assert.equal(config.plugins["paseo-chat-polish"].enabled, false);
      assert.ok(
        existsSync(path.join(config.plugins["paseo-chat-polish"].path, "paseo-plugin.json")),
      );
      assert.equal(config.plugins.genui.enabled, true);

      prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
      assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), config);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a Beautiful Chat installed from elsewhere is left alone", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const { home, sourceRoot, configPath } = communityHome(root, ["paseo-chat-polish"]);
    const own = { source: "directory", path: "/elsewhere/beautiful-chat", enabled: true };
    writeFileSync(configPath, JSON.stringify({ version: 1, plugins: { "beautiful-chat": own } }));
    writeFileSync(path.join(home, ".vibing-community-plugins.json"), '["paseo-chat-polish"]\n');
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).plugins, {
      "beautiful-chat": own,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const marker of ['["beautiful-chat","annot', '{"offered":true}']) {
  test(`an unreadable community plugin marker neither blocks startup nor reinstalls: ${marker}`, async () => {
    const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
    try {
      const home = path.join(root, "home");
      const sourceRoot = path.join(root, "sources");
      mkdirSync(home);
      for (const id of ["paseo-chat-polish", "genui"]) {
        mkdirSync(path.join(sourceRoot, id), { recursive: true });
        writeFileSync(path.join(sourceRoot, id, "paseo-plugin.json"), JSON.stringify({ id }));
      }
      // A crash mid-write leaves a truncated marker; the user had removed Beautiful Chat.
      writeFileSync(path.join(home, ".vibing-community-plugins.json"), marker);
      const configPath = path.join(home, "config.json");
      writeFileSync(configPath, JSON.stringify({ version: 1, plugins: {} }));
      prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
      assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).plugins, {});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const kind of ["bom", "permissions", "symlink"]) {
  test(
    `community installation preserves native config handling: ${kind}`,
    { skip: process.platform === "win32" && kind !== "bom" },
    async () => {
      const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
      const root = mkdtempSync(path.join(os.tmpdir(), "paseo-config-bootstrap-"));
      try {
        const home = path.join(root, "home");
        const sourceRoot = path.join(root, "sources");
        mkdirSync(home, { mode: 0o755 });
        for (const id of ["paseo-chat-polish", "annotations"]) {
          mkdirSync(path.join(sourceRoot, id), { recursive: true });
          writeFileSync(path.join(sourceRoot, id, "paseo-plugin.json"), JSON.stringify({ id }));
        }
        const configPath = path.join(home, "config.json");
        const target = path.join(root, "linked-config.json");
        const content = JSON.stringify({
          version: 1,
          features: { dictation: { stt: { provider: "openai", apiKey: "test-only-key" } } },
        });
        if (kind === "symlink") {
          writeFileSync(target, content, { mode: 0o600 });
          symlinkSync(target, configPath);
        } else {
          writeFileSync(configPath, (kind === "bom" ? "\uFEFF" : "") + content, { mode: 0o600 });
        }
        prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        assert.equal(config.features.dictation.stt.apiKey, "test-only-key");
        assert.equal(config.plugins.annotations.source, "directory");
        if (kind === "permissions") {
          assert.equal(statSync(configPath).mode & 0o777, 0o600);
          assert.equal(statSync(home).mode & 0o777, 0o700);
        }
        if (kind === "symlink") {
          assert.ok(lstatSync(configPath).isSymbolicLink());
          assert.equal(
            JSON.parse(readFileSync(target, "utf8")).plugins.annotations.source,
            "directory",
          );
          assert.equal(statSync(target).mode & 0o777, 0o600);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

function writeBundle(sourceRoot, id, code) {
  const directory = path.join(sourceRoot, id);
  mkdirSync(path.join(directory, "client"), { recursive: true });
  writeFileSync(path.join(directory, "paseo-plugin.json"), JSON.stringify({ id }));
  writeFileSync(
    path.join(directory, "README.md"),
    `# ${id}\n\nRegenerate with \`node scripts/vendor-community-plugins.mjs ${id}\` in the Paseo fork.\n`,
  );
  writeFileSync(path.join(directory, "client", `${id}.gen.ts`), code);
}

function installedCode(home, id) {
  return readFileSync(path.join(home, "installed-plugins", id, "client", `${id}.gen.ts`), "utf8");
}

test("Vibing-installed community plugins follow the bundle, keeping their state", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const { home, sourceRoot, configPath } = communityHome(root, []);
    writeBundle(sourceRoot, "genui", "v1");
    writeBundle(sourceRoot, "annotations", "v1");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plugins.genui.enabled = false;
    writeFileSync(configPath, JSON.stringify(config));

    writeBundle(sourceRoot, "genui", "v2");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.equal(installedCode(home, "genui"), "v2");
    assert.equal(installedCode(home, "annotations"), "v1");
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), config);
    assert.deepEqual(readdirSync(path.join(home, "installed-plugins")).sort(), [
      "annotations",
      "genui",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("community plugins that were edited, removed or installed elsewhere are not updated", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const { home, sourceRoot, configPath } = communityHome(root, []);
    for (const id of ["genui", "annotations", "shell-yeah"]) writeBundle(sourceRoot, id, "v1");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    const genui = path.join(home, "installed-plugins", "genui", "client", "genui.gen.ts");
    writeFileSync(genui, "edited");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    delete config.plugins.annotations;
    config.plugins["shell-yeah"].path = path.join(root, "elsewhere");
    writeFileSync(configPath, JSON.stringify(config));

    for (const id of ["genui", "annotations", "shell-yeah"]) writeBundle(sourceRoot, id, "v2");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.equal(readFileSync(genui, "utf8"), "edited");
    assert.equal(installedCode(home, "annotations"), "v1");
    assert.equal(installedCode(home, "shell-yeah"), "v1");
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), config);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("copies installed before fingerprints update once; clones are left alone", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const { home, sourceRoot, configPath } = communityHome(root, []);
    writeBundle(sourceRoot, "genui", "old");
    writeBundle(sourceRoot, "paseo-chat-polish", "old");
    const installed = path.join(home, "installed-plugins");
    mkdirSync(installed);
    for (const id of ["genui", "paseo-chat-polish"]) {
      cpSync(path.join(sourceRoot, id), path.join(installed, id), { recursive: true });
    }
    mkdirSync(path.join(installed, "paseo-chat-polish", ".git"));
    const plugins = Object.fromEntries(
      ["genui", "paseo-chat-polish"].map((id) => [
        id,
        { source: "directory", path: path.join(installed, id), enabled: true },
      ]),
    );
    writeFileSync(configPath, JSON.stringify({ version: 1, plugins }));
    writeFileSync(
      path.join(home, ".vibing-community-plugins.json"),
      JSON.stringify(["genui", "paseo-chat-polish"]),
    );

    writeBundle(sourceRoot, "genui", "new");
    writeBundle(sourceRoot, "paseo-chat-polish", "new");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.equal(installedCode(home, "genui"), "new");
    assert.equal(installedCode(home, "paseo-chat-polish"), "old");

    // Now fingerprinted, a later edit protects it like any other copy.
    writeFileSync(path.join(installed, "genui", "client", "genui.gen.ts"), "edited");
    writeBundle(sourceRoot, "genui", "newer");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.equal(installedCode(home, "genui"), "edited");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an update interrupted mid-swap restores the previous copy", async () => {
  const { prepareCommunityPlugins } = await import("./paseo-web-plugins.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-installed-plugins-"));
  try {
    const { home, sourceRoot } = communityHome(root, []);
    writeBundle(sourceRoot, "genui", "v1");
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    const directory = path.join(home, "installed-plugins", "genui");
    // A crash between moving the old copy aside and moving the new one in.
    renameSync(directory, `${directory}.vibing-previous`);
    mkdirSync(`${directory}.vibing-update`);
    prepareCommunityPlugins({ home, sourceRoot, readPersistedConfig, savePersistedConfig });
    assert.equal(installedCode(home, "genui"), "v1");
    assert.deepEqual(readdirSync(path.join(home, "installed-plugins")), ["genui"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
