# Paseo Web Porting Guide & Standalone Bundle

This document explains the porting setup for Paseo Web, how the standalone bundle is generated, and how it is integrated into external applications (e.g. `space-app-vibing`).

---

## 1. Overview & Architecture

Paseo Web is packaged as a standalone server that embeds:

1. **Paseo Daemon (`server.mjs`)**: Node.js backend daemon with WebSocket RPCs, agent lifecycle management, and session state.
2. **Web UI (`web-ui/`)**: Pre-built Expo/React web client.
3. **PTY Terminal Worker (`terminal-worker/terminal-worker.mjs`)**: Upstream's self-contained worker and shell integration, copied into the runtime home before launch. The standalone server resolves this directory beside `server.mjs`, not one directory above it.
4. **Local Speech Worker (`worker-process.js`)**: Isolated worker for embedded dictation and voice mode.
5. **Built-in plugins (`builtin-plugins/`)**: The Claude, Codex and AIS Switch usage sources, native Space App Vibing theme and Bots, with runtime compilers included in the dependency archive.
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

For changes limited to `scripts/paseo-web.js` or `scripts/paseo-web-plugins.mjs`, refresh an existing bundle without
rebuilding or replacing its backend, native archive, or UI:

```bash
PASEO_WEB_DEST_DIR=/absolute/consumer/worktree/scripts/paseo-web npm run build:web -- --runner-only
```

For a server packaging repair with current `packages/server/dist` artifacts and an existing consumer bundle, use `node scripts/bundle-paseo-web.mjs --server-only` with the same destination. This regenerates `server.mjs`, the plugin runtime/compiler workers, and the upstream terminal-worker directory without rebuilding or replacing the UI; it does not compile changed TypeScript sources.

The runner consumes `PASEO_WORKTREE_CLEANUP_TOKEN` before importing the daemon or
launching extraction tools. It retains the capability only in daemon configuration,
not in the environment inherited by providers, external commands, or terminals.

### Bundle Output Structure (`scripts/paseo-web/`)

- `paseo-web.js` — Executable CLI runner
- `paseo-web-plugins.mjs` — One-time ordinary directory installation of each community addon in `communityPluginIds`
- `community-plugins/` — Prebundled offline addon sources (Beautiful Chat, Annotations, PDF and Office viewer, Shell Yeah, Recap, Quick prompts, Generative UI), each copied into a runtime home the first time a bundle containing it starts there
- `plugin-process.js` — Bundled worker for isolated built-ins and installed plugins
- `compiler-worker.js` — Plugin compilation isolate used by daemon and plugin workers
- `package.json` — Packaged daemon name/version and ESM metadata
- `server.mjs` — Standalone bundled daemon
- `terminal-worker/` — Upstream's self-contained `terminal-worker.mjs` and `shell-integration/`
- `worker-process.js` — Local speech worker
- `web-ui/` — Static web client bundle
- `runtime-node-modules.tgz` — PTY and speech dependencies, TypeScript, esbuild, and the build host's esbuild binary
- `bridge-plugin.bundle.mjs` — OpenCode bridge runtime artifact
- `builtin-plugins/` — Only the plugins in the daemon's built-in list (Claude, Codex and AIS Switch usage sources, Bots and embedded theme), loaded beside `server.mjs`; checkout-only `tsconfig.json` files are omitted because their parent configuration is not shipped

Community addons use native plugin management after one-time installation. Later launches preserve removal and disablement, including a global plugin opt-out. See the [plugin boundary](docs/vibing-patches.md#plugin-boundary).

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

`server/routes/paseo.ts` owns one shared runtime/home for workspace Bots and Live Design, with single-flight startup. Bot configuration and memory are shared; `paseo-bots.context=live-design` and surface-scoped drafts, selections and command-center results keep conversations separate. `src/components/PaseoWeb.tsx` owns the workspace iframe and activity bridge.

The host also polls `/api/worktrees/activity` with its existing isolated worktree capability token. Keep this endpoint loopback-only and token-gated: it restores feature indicators after host refresh without mounting inactive iframes or starting agents. Internal agents and archived workspaces do not contribute. Running state comes from live turns rather than persisted lifecycle records. Both iframe messages and snapshots consider every live conversation in the workspace, so a newer idle conversation cannot hide a running one.

Offload calls `/api/worktrees/stop` in the shared runtime and retains workspace/conversation records. Deletion requires successful cleanup before removing worktrees. Worktree deletion cleans matching agent persistence from the shared runtime; startup also prunes agents whose working directories no longer exist. Preserve cleanup-token isolation when changing the runner. Refreshing the bundle does not restart running daemons. Reload an already-mounted
Live Design iframe after the prepared-text transport update; its readiness
capability prevents sending the new payload to an older client.

Vibing's `AGENTS.md` contains the host-side fork overlay checklist; `PROJECT_DOCUMENTATION.md` owns host lifecycle and packaging details.
