# Paseo Web Porting Guide & Standalone Bundle

This document explains the porting setup for Paseo Web, how the standalone bundle is generated, and how it is integrated into external applications (e.g. `space-app-vibing`).

---

## 1. Overview & Architecture

Paseo Web is packaged as a lightweight, self-contained standalone server that embeds:

1. **Paseo Daemon (`server.mjs`)**: Node.js backend daemon with WebSocket RPCs, agent lifecycle management, and session state.
2. **Web UI (`web-ui/`)**: Pre-built Expo/React web client.
3. **PTY Terminal Worker (`terminal-worker-process.js`)**: Isolated worker for terminal sessions.
4. **Chat-only embedding (`?folder=<path>`)**: Automatically opens the specified folder workspace directly in its active agent conversation/composer. The standalone build omits project and Changes sidebars, their header controls, workspace navigation, New Tab, Import Session, Fork, command-center, and file-opening escape routes; regular Paseo builds are unchanged.

---

## 2. Bundling Commands (in `paseo` repo)

To build the web UI and generate the standalone package:

```bash
# Build server & client declarations
npm run build:server
npm run build:client

# Bundle Paseo Web into scripts/paseo-web and destination repos
node scripts/bundle-paseo-web.mjs
```

### Bundle Output Structure (`scripts/paseo-web/`)

- `paseo-web.js` — Executable CLI runner
- `server.mjs` — Standalone bundled daemon
- `terminal-worker-process.js` — PTY process worker
- `web-ui/` — Static web client bundle
- `runtime-node-modules.tgz` — Native module bindings archive
- `bridge-plugin.bundle.mjs` — OpenCode bridge runtime artifact

---

## 3. Running Paseo Web Standalone

```bash
node scripts/paseo-web/paseo-web.js --port=6890 --home=~/.paseo-space
```

### CLI Options:

- `--port=<number>` (or `-p <number>`): Port to listen on (default: `6768`).
- `--host=<address>`: Host to bind to (default: `127.0.0.1`).
- `--home=<path>`: Custom Paseo home directory for logs and state.

---

## 4. Integration URL Format

To open directly into a workspace folder:

```
http://127.0.0.1:<port>/?folder=<absolute_folder_path>
```

When loaded in an `iframe` or Electron `<webview>`, Paseo Web:

1. Detects `?folder=` query parameter.
2. Finds or creates the workspace corresponding to that directory.
3. Enters locked chat-only focus mode directly.

---

## 5. Integration Prompt for Target Repo (`space-app-vibing`)

Use the following prompt when implementing the integration in the consumer application:

````markdown
Replace the embedded Codex Web tab/integration with Paseo Web.

### Background & Context

We are replacing the Codex Web preview engine with Paseo Web.
The standalone bundled Paseo Web artifacts have already been prepared in `scripts/paseo-web/`:

- `scripts/paseo-web/paseo-web.js`: Standalone runner script (accepts `--port=<port>`, `--host=<host>`, `--home=<data-dir>`).
- `scripts/paseo-web/server.mjs`: Bundled backend & WebSocket server.
- `scripts/paseo-web/web-ui/`: Bundled web frontend.
- `scripts/paseo-web/terminal-worker-process.js`: Terminal worker.

### Tasks to Complete

1. **Backend Server & Process Management:**
   - Update the backend process manager (where `scripts/codex-web/codex-web.js` was spawned) to launch Paseo Web:
     ```bash
     node scripts/paseo-web/paseo-web.js --port=<port> --home=<paseo_home_dir>
     ```
   - Update backend status endpoints and health check probes (replacing `src/api/codex.ts` with `src/api/paseo.ts` or updating accordingly).

2. **Frontend UI Components & State:**
   - Replace `src/components/CodexWeb.tsx` with `src/components/PaseoWeb.tsx`:
     - Embed URL: `http://127.0.0.1:<port>/?folder=<worktree_folder_path>`
       _(Paseo automatically parses `?folder=` to open the workspace in Simple Mode directly)._
     - Use the existing desktop webview / iframe preview patterns.
   - In `src/components/TabContent.tsx`, `src/App.tsx`, and `src/utils/desktopPreviewId.ts`:
     - Update tab types / preview resources (e.g. rename `'codex'` resource/type to `'paseo'` or map it to Paseo Web).
     - Update tab headers, icons, labels, and tool selectors from "Codex Web" to "Paseo Web".

3. **Cleanup & Verification:**
   - Remove obsolete `scripts/codex-web/` directory (saves ~123 MB).
   - Update tests (`TabContent.test.tsx`, `desktopPreviewLifecycle.test.ts`, etc.) to assert Paseo Web components and test IDs.
   - Run typecheck and tests to ensure everything builds and passes.
````
