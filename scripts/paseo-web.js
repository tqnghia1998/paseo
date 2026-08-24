#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable unneeded features for embedded mode
process.env.PASEO_DICTATION_ENABLED = "false";
process.env.PASEO_VOICE_MODE_ENABLED = "false";
process.env.PASEO_AUTH_REQUIRED = "false";
process.env.PASEO_RELAY_ENABLED = "false";

// Auto-extract runtime native modules (node-pty) if bundled as runtime-node-modules.tgz
const bundledNodeModulesRoot = path.join(__dirname, "node_modules");
const bundledArchive = path.join(__dirname, "runtime-node-modules.tgz");

if (
  fs.existsSync(bundledArchive) &&
  !fs.existsSync(path.join(bundledNodeModulesRoot, "node-pty"))
) {
  fs.mkdirSync(bundledNodeModulesRoot, { recursive: true });
  execFileSync("tar", ["-xzf", bundledArchive, "-C", bundledNodeModulesRoot], {
    stdio: "ignore",
  });
}

// Point web UI directory to bundled web-ui
const webUiDist = path.join(__dirname, "web-ui");
if (fs.existsSync(webUiDist)) {
  process.env.PASEO_WEB_UI_DIST_DIR = webUiDist;
}

// Import server entrypoint
const serverModulePath = path.join(__dirname, "server.mjs");
const { createPaseoDaemon, loadConfig, createRootLogger } = await import(
  `file://${serverModulePath}`
);

function parseArgs(args) {
  let port = 6768;
  let host = "127.0.0.1";
  let home = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
    } else if (arg.startsWith("--port=")) {
      port = parseInt(arg.slice("--port=".length), 10);
    } else if (arg === "--host" || arg === "-h") {
      host = args[++i];
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg === "--home" || arg === "--data-dir") {
      home = args[++i];
    } else if (arg.startsWith("--home=")) {
      home = arg.slice("--home=".length);
    }
  }

  return { port, host, home };
}

const { port, host, home: customHome } = parseArgs(process.argv.slice(2));
const home = customHome || path.join(os.homedir(), ".paseo-web");

const config = loadConfig(home, {
  cli: {
    listen: `${host}:${port}`,
    webUiEnabled: true,
  },
  env: {
    PASEO_AUTH_REQUIRED: "false",
    PASEO_DICTATION_ENABLED: "false",
    PASEO_RELAY_ENABLED: "false",
    PASEO_VOICE_MODE_ENABLED: "false",
    ...(fs.existsSync(webUiDist) ? { PASEO_WEB_UI_DIST_DIR: webUiDist } : {}),
  },
});

const logger = createRootLogger({ level: "info", format: "pretty" });
const daemon = await createPaseoDaemon(config, logger);
await daemon.start();

const listenTarget = daemon.getListenTarget() || { host, port };
console.log(`[Paseo] Paseo Web UI is running at http://${listenTarget.host}:${listenTarget.port}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("[Paseo] Shutting down Paseo Web UI server...");
  try {
    await daemon.stop();
  } catch (err) {
    console.error("[Paseo] Error during shutdown:", err);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
