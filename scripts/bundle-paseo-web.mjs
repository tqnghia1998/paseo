import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import esbuild from "esbuild";
import { communityPluginIds } from "./paseo-web-plugins.mjs";

const ROOT_DIR = process.cwd();
const SHERPA_PLATFORM = process.platform === "win32" ? "win" : process.platform;
const DEST_DIR = path.resolve(
  process.env.PASEO_WEB_DEST_DIR ??
    path.join(ROOT_DIR, "..", "space-app-vibing", "scripts", "paseo-web"),
);

// Runner-only fixes do not need to rebuild or replace the daemon and embedded UI.
if (process.argv.includes("--runner-only")) {
  if (!fs.existsSync(path.join(DEST_DIR, "server.mjs"))) {
    throw new Error("--runner-only requires an existing standalone bundle");
  }
  fs.copyFileSync(path.join(ROOT_DIR, "scripts/paseo-web.js"), path.join(DEST_DIR, "paseo-web.js"));
  fs.copyFileSync(
    path.join(ROOT_DIR, "scripts/paseo-web-plugins.mjs"),
    path.join(DEST_DIR, "paseo-web-plugins.mjs"),
  );
  console.log("Updated paseo-web runner in", DEST_DIR);
  process.exit(0);
}

// Packaging-only repairs can reuse the already-compiled server without rebuilding the UI.
const serverOnly = process.argv.includes("--server-only");
if (!serverOnly) {
  console.log("1. Building frontend web UI...");
  execSync("node scripts/build-daemon-web-ui.mjs", {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: { ...process.env, EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS: "true" },
  });

  console.log("2. Building server TypeScript...");
  execSync("npm run build:server", { cwd: ROOT_DIR, stdio: "inherit" });
}

console.log("3. Bundling server backend with esbuild...");
fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(path.join(ROOT_DIR, "scripts/paseo-web.js"), path.join(DEST_DIR, "paseo-web.js"));
fs.copyFileSync(
  path.join(ROOT_DIR, "scripts/paseo-web-plugins.mjs"),
  path.join(DEST_DIR, "paseo-web-plugins.mjs"),
);

const serverPackageJson = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, "packages/server/package.json"), "utf8"),
);
fs.writeFileSync(
  path.join(DEST_DIR, "package.json"),
  JSON.stringify(
    {
      name: serverPackageJson.name,
      version: serverPackageJson.version,
      type: "module",
      private: true,
    },
    null,
    2,
  ) + "\n",
);

// Bundle server entrypoint
await esbuild.build({
  entryPoints: ["packages/server/dist/server/server/exports.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: path.join(DEST_DIR, "server.mjs"),
  plugins: [
    {
      name: "standalone-terminal-worker-location",
      setup(build) {
        build.onLoad({ filter: /[/\\]terminal-worker-runtime\.js$/ }, ({ path: modulePath }) => {
          const source = fs.readFileSync(modulePath, "utf8");
          const original = 'new URL("../terminal-worker/", import.meta.url)';
          if (!source.includes(original)) {
            throw new Error("Terminal worker location changed; update standalone packaging");
          }
          return {
            contents: source.replace(original, 'new URL("./terminal-worker/", import.meta.url)'),
            loader: "js",
          };
        });
      },
    },
  ],
  banner: {
    js: `
import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirnameFn } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameFn(__filename);
`,
  },
  external: [
    "node-pty",
    "fsevents",
    "classic-level",
    "bufferutil",
    "utf-8-validate",
    "sherpa-onnx-node",
  ],
});

// The upstream worker is self-contained and is copied into each home's private runtime.
const terminalWorkerDest = path.join(DEST_DIR, "terminal-worker");
fs.rmSync(terminalWorkerDest, { recursive: true, force: true });
fs.cpSync(path.join(ROOT_DIR, "packages/server/dist/server/terminal-worker"), terminalWorkerDest, {
  recursive: true,
});
fs.rmSync(path.join(DEST_DIR, "terminal-worker-process.js"), { force: true });
if (serverOnly) {
  console.log("Updated standalone server and terminal worker in", DEST_DIR);
  process.exit(0);
}

// Also bundle the isolated plugin worker that resolves relative to server.mjs.
for (const [entry, output] of [
  ["packages/server/dist/server/server/plugins/plugin-process.js", "plugin-process.js"],
]) {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: path.join(DEST_DIR, output),
    banner: {
      js: `
import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirnameFn } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameFn(__filename);
`,
    },
    external: [
      "node-pty",
      "fsevents",
      "classic-level",
      "bufferutil",
      "utf-8-validate",
      "sherpa-onnx-node",
    ],
  });
}

await esbuild.build({
  entryPoints: ["packages/server/dist/server/server/speech/providers/local/worker-process.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: path.join(DEST_DIR, "worker-process.js"),
  banner: {
    js: `
import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirnameFn } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameFn(__filename);
`,
  },
  external: ["sherpa-onnx-node"],
});
fs.writeFileSync(
  path.join(DEST_DIR, "worker-process.js"),
  fs.readFileSync(path.join(DEST_DIR, "worker-process.js"), "utf8").replace(/[\t ]+$/gm, ""),
);

console.log("4. Copying bundled OpenCode bridge plugin...");
fs.copyFileSync(
  path.join(
    ROOT_DIR,
    "packages/server/dist/server/server/agent/providers/opencode/bridge-plugin.bundle.mjs",
  ),
  path.join(DEST_DIR, "bridge-plugin.bundle.mjs"),
);

console.log("5. Copying static web-ui assets...");
// Bundled terminal modules resolve these files beside server.mjs and the terminal worker.
const shellIntegrationDest = path.join(DEST_DIR, "shell-integration");
fs.rmSync(shellIntegrationDest, { recursive: true, force: true });
fs.cpSync(
  path.join(ROOT_DIR, "packages/server/dist/server/terminal/shell-integration"),
  shellIntegrationDest,
  { recursive: true },
);
const builtinPluginsDest = path.join(DEST_DIR, "builtin-plugins");
const builtinPluginsSrc = path.join(ROOT_DIR, "packages/server/dist/server/builtin-plugins");
// Ship only the daemon's built-in list; other plugins/ entries stay checkout-only.
const { builtinPlugins } = await import(
  pathToFileURL(path.join(ROOT_DIR, "packages/server/dist/server/server/plugins/builtin/index.js"))
    .href
);
const shippedBuiltinEntries = new Set(["", "package.json", ...builtinPlugins]);
fs.rmSync(builtinPluginsDest, { recursive: true, force: true });
fs.cpSync(builtinPluginsSrc, builtinPluginsDest, {
  recursive: true,
  filter: (source) =>
    path.basename(source) !== "tsconfig.json" &&
    shippedBuiltinEntries.has(path.relative(builtinPluginsSrc, source).split(path.sep)[0]),
});
const communityPluginsDest = path.join(DEST_DIR, "community-plugins");
fs.rmSync(communityPluginsDest, { recursive: true, force: true });
for (const id of communityPluginIds) {
  fs.cpSync(path.join(ROOT_DIR, "plugins", id), path.join(communityPluginsDest, id), {
    recursive: true,
    filter: (source) => path.basename(source) !== "tsconfig.json",
  });
}
const webUiSrc = path.join(ROOT_DIR, "packages/server/dist/server/web-ui");
const webUiDest = path.join(DEST_DIR, "web-ui");
fs.rmSync(webUiDest, { recursive: true, force: true });
fs.cpSync(webUiSrc, webUiDest, { recursive: true });

console.log("6. Packaging runtime native modules...");
const runtimeNmTmp = path.join(DEST_DIR, "runtime-nm-temp");
fs.mkdirSync(runtimeNmTmp, { recursive: true });

const nodePtySrc = [
  path.join(ROOT_DIR, "node_modules/node-pty"),
  path.join(ROOT_DIR, "packages/server/node_modules/node-pty"),
].find((candidate) => fs.existsSync(candidate));
if (!nodePtySrc) {
  throw new Error("Could not find the node-pty runtime package");
}
fs.cpSync(nodePtySrc, path.join(runtimeNmTmp, "node-pty"), { recursive: true });

const sherpaPackage = "sherpa-onnx-node";
const sherpaPlatformPackage = `sherpa-onnx-${SHERPA_PLATFORM}-${process.arch}`;
for (const packageName of [
  sherpaPackage,
  sherpaPlatformPackage,
  "typescript",
  "esbuild",
  `@esbuild/${process.platform}-${process.arch}`,
]) {
  const source = path.join(ROOT_DIR, "node_modules", packageName);
  if (!fs.existsSync(source)) {
    throw new Error(`Could not find the ${packageName} runtime package`);
  }
  fs.cpSync(source, path.join(runtimeNmTmp, packageName), { recursive: true });
}

// Zero mtimes so repeated builds produce a byte-identical archive (cpSync stamps copies with
// "now", which tar bakes in and made every rebuild churn the committed tgz). lutimes so symlink
// entries are stamped without following them.
const ZERO_TIME = new Date(0);
const zeroMtimes = (dir) => {
  fs.utimesSync(dir, ZERO_TIME, ZERO_TIME);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) zeroMtimes(entryPath);
    else fs.lutimesSync(entryPath, ZERO_TIME, ZERO_TIME);
  }
};
zeroMtimes(runtimeNmTmp);
// gzip:!timestamp drops the current time from the gzip header, which bsdtar stamps in and
// which made even mtime-zeroed rebuilds produce different bytes.
execSync(
  `tar --options='gzip:!timestamp' -czf "${path.join(
    DEST_DIR,
    "runtime-node-modules.tgz",
  )}" -C "${runtimeNmTmp}" .`,
);
fs.rmSync(runtimeNmTmp, { recursive: true, force: true });

console.log("Done bundling paseo-web into", DEST_DIR);
