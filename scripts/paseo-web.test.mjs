import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("runner keeps cleanup capability out of external commands and Bash sessions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-runner-token-"));
  const token = "cleanup-regression-canary";
  const require = createRequire(import.meta.url);
  try {
    copyFileSync(
      path.join(import.meta.dirname, "paseo-web.js"),
      path.join(directory, "paseo-web.mjs"),
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
