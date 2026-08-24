import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import esbuild from "esbuild";

const ROOT_DIR = process.cwd();
const DEST_DIR = "/Users/quangnghia.trinh/Documents/Git/space-app-vibing/scripts/paseo-web";

console.log("1. Building frontend web UI...");
execSync("node scripts/build-daemon-web-ui.mjs", { cwd: ROOT_DIR, stdio: "inherit" });

console.log("2. Building server TypeScript...");
execSync("npm run build:server", { cwd: ROOT_DIR, stdio: "inherit" });

console.log("3. Bundling server backend with esbuild...");
fs.mkdirSync(DEST_DIR, { recursive: true });

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

// Also bundle terminal worker
await esbuild.build({
  entryPoints: ["packages/server/dist/server/terminal/terminal-worker-process.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: path.join(DEST_DIR, "terminal-worker-process.js"),
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

console.log("4. Copying static web-ui assets...");
const webUiSrc = path.join(ROOT_DIR, "packages/server/dist/server/web-ui");
const webUiDest = path.join(DEST_DIR, "web-ui");
fs.cpSync(webUiSrc, webUiDest, { recursive: true });

console.log("5. Packaging runtime node_modules (node-pty native bindings)...");
// Tar node-pty and other native modules
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

execSync(`tar -czf "${path.join(DEST_DIR, "runtime-node-modules.tgz")}" -C "${runtimeNmTmp}" .`);
fs.rmSync(runtimeNmTmp, { recursive: true, force: true });

console.log("Done bundling paseo-web into", DEST_DIR);
