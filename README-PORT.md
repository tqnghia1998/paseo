# Paseo Web Porting Guide & Standalone Bundle

This document explains the porting setup for Paseo Web, how the standalone bundle is generated, and how it is integrated into external applications (e.g. `space-app-vibing`).

---

## 1. Overview & Architecture

Paseo Web is packaged as a standalone server that embeds:

1. **Paseo Daemon (`server.mjs`)**: Node.js backend daemon with WebSocket RPCs, agent lifecycle management, and session state.
2. **Web UI (`web-ui/`)**: Pre-built Expo/React web client.
3. **PTY Terminal Worker (`terminal-worker-process.js`)**: Isolated worker for terminal sessions, with `shell-integration/` beside the bundled modules.
4. **Local Speech Worker (`worker-process.js`)**: Isolated worker for embedded dictation and voice mode.
5. **Built-in plugins (`builtin-plugins/`)**: The daemon's provider/usage sources, native Space App Vibing theme and [Beautiful Chat](plugins/beautiful-chat/README.md), with runtime compilers included in the dependency archive.
6. **Embedded workspace**: The Bots surface bound to the selected worktree, with host-owned global navigation. See the [patch contracts](docs/vibing-patches.md#contracts-to-preserve) for navigation and Live Design.

### Canonical embedded mode

Both consumer surfaces use one **embedded workspace policy** backed by the same standalone build. The Bots left tab inside Space App Vibing and the Live Design drawer's **Agent** tab both open Bots for the selected worktree; Live Design runs in its own runtime and home.

The [Vibing patch catalog](docs/vibing-patches.md) owns the module map, remaining
upstream hooks, behavior contracts and focused checks. Read it before changing
embedded navigation, host messages, queues, layout or provider policy.

---

## 2. Bundling Commands (in `paseo` repo)

Run from the Paseo checkout with its npm dependencies installed. Use an absolute destination when the consumer is a worktree; the default is `../space-app-vibing/scripts/paseo-web` relative to the Paseo checkout, not the caller's Vibing worktree.

```bash
# Builds the embedded web UI and server stack, then writes the consumer bundle
PASEO_WEB_DEST_DIR=/absolute/consumer/worktree/scripts/paseo-web npm run build:web
```

The fork bundler supplies `EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS=true` to its web
export; shared Paseo build commands keep their native behavior.

For changes limited to `scripts/paseo-web.js`, refresh an existing bundle without
rebuilding or replacing its backend, native archive, or UI:

```bash
PASEO_WEB_DEST_DIR=/absolute/consumer/worktree/scripts/paseo-web npm run build:web -- --runner-only
```

The runner consumes `PASEO_WORKTREE_CLEANUP_TOKEN` before importing the daemon or
launching extraction tools. It retains the capability only in daemon configuration,
not in the environment inherited by providers, external commands, or terminals.

### Bundle Output Structure (`scripts/paseo-web/`)

- `paseo-web.js` — Executable CLI runner
- `plugin-process.js` — Bundled worker for isolated built-ins and installed plugins
- `package.json` — Packaged daemon name/version and ESM metadata
- `server.mjs` — Standalone bundled daemon
- `terminal-worker-process.js` — PTY process worker
- `worker-process.js` — Local speech worker
- `web-ui/` — Static web client bundle
- `runtime-node-modules.tgz` — PTY and speech dependencies, TypeScript, esbuild, and the build host's esbuild binary
- `bridge-plugin.bundle.mjs` — OpenCode bridge runtime artifact
- `builtin-plugins/` — Provider, usage-source and embedded theme plugins loaded beside `server.mjs`; checkout-only `tsconfig.json` files are omitted because their parent configuration is not shipped

The runner extracts the archive when a required runtime package is missing. Plugin loading must work without the Paseo checkout's `node_modules`. The built-in registry is `packages/server/src/server/plugins/builtin/index.ts`; see [built-in plugin behavior](docs/plugins.md#built-in-plugins).

The archive is platform-specific. Vibing's Electron packaging replaces the target Sherpa speech package when needed, but does not replace `@esbuild/<platform>-<arch>`. A bundle built on one platform must not be assumed usable on another; verify the target compiler binary and PTY/speech runtime before shipping.

---

## 3. Running Paseo Web Standalone

```bash
node /absolute/consumer/worktree/scripts/paseo-web/paseo-web.js --port=6890 --home="$HOME/.paseo-space"
```

### CLI Options:

- `--port=<number>` (or `-p <number>`): Port to listen on (default: `6768`).
- `--host=<address>`: Host to bind to (default: `127.0.0.1`).
- `--home=<path>`: Custom Paseo home directory for logs and state (default: `~/.paseo-web`). Pass an expanded absolute path.

The runner disables authentication and relay access and binds to loopback by default. Do not expose it as an authenticated remote Paseo service.

---

## 4. Integration URL Format

To open directly into a workspace folder:

```
http://127.0.0.1:<port>/?folder=<absolute_folder_path>
```

Vibing uses a renderer-owned `iframe` in both browser and Electron builds. Paseo Web:

1. Detects the `?folder=` query parameter.
2. Resolves it through the daemon's idempotent `openProject` path on every entry, preserving its workspace and agent thread on remount without a second frontend workspace cache.
3. Binds that worktree and opens its Bots surface directly; normal workspace routes redirect to the binding.
4. In Live Design, readiness activates the selected local bot or General, and Send new agent creates a fresh bot draft.
5. Dictation and voice mode are enabled by the standalone runner (`PASEO_DICTATION_ENABLED`/`PASEO_VOICE_MODE_ENABLED` in `scripts/paseo-web.js`); the host iframe must keep `microphone` in its `allow` list.

### Upstream rebase guard

After syncing from `getpaseo/paseo`, verify all of the following before regenerating the consumer bundle:

Review the [patch catalog](docs/vibing-patches.md) against the upstream diff.
Keep explicit hooks small and use the regression tests listed for each patch.
After source checks, rebuild the consumer bundle and run its guard. The full build
copies the runner automatically; do not hand-edit generated artifacts.

```bash
# In the Paseo checkout
npm run test --workspace=@getpaseo/app -- --project unit src/patches/vibing --bail=1 --maxWorkers=1
npm run test:unit --workspace=@getpaseo/server -- src/server/plugins/builtin/index.test.ts -t "standalone bundles resolve|listed built-ins resolve" --bail=1 --maxWorkers=1
node --test scripts/paseo-web.test.mjs
npm run typecheck
npm run lint

# In the destination Vibing worktree, after rebuilding
pnpm exec vitest run scripts/paseo-web/paseoWebBundle.test.ts
```

## 5. Current Vibing Integration

`host-prompts.ts` handles host prompt insertion in embedded workspaces. Parent-origin/source-checked readiness requests activate the nearest conversation or create a draft; insertion appends to the active unlocked composer and focuses it without submitting or changing attachments. Readiness echoes a host request ID and composer ID; insertion targets that composer and acknowledges the request. The host retries unacknowledged requests, while the iframe deduplicates the latest 1024 delivered IDs across composer switches. Only editable workspace chat composers participate; terminal, read-only, and workspace-setup inputs are excluded. Keep its source tests and the consumer bundle guard when refreshing the fork.

`server/routes/paseo.ts` owns two independent runtimes: the shared Paseo tab instance and the Live Design instance, each with its own port and persistent home. They use the same bundle, but their conversations do not share state. `src/components/PaseoWeb.tsx` owns the workspace iframe and activity bridge.

The host also polls `/api/worktrees/activity` with its existing isolated worktree capability token. Keep this endpoint loopback-only and token-gated: it restores feature indicators after host refresh without mounting inactive iframes or starting agents. Internal agents and archived workspaces do not contribute. Running state comes from live turns rather than persisted lifecycle records. Both iframe messages and snapshots consider every live conversation in the workspace, so a newer idle conversation cannot hide a running one.

Offload calls `/api/worktrees/stop` in both running runtime homes and retains workspace/conversation records. Deletion requires successful cleanup before removing worktrees. Worktree deletion cleans matching agent persistence from both runtime homes; startup also prunes agents whose working directories no longer exist. Preserve cleanup-token isolation when changing the runner. Refreshing the bundle does not restart running daemons. Reload an already-mounted
Live Design iframe after the prepared-text transport update; its readiness
capability prevents sending the new payload to an older client.

Vibing's `AGENTS.md` contains the host-side fork overlay checklist; `PROJECT_DOCUMENTATION.md` owns host lifecycle and packaging details.
