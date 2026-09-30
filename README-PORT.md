# Paseo Web Porting Guide & Standalone Bundle

This document explains the porting setup for Paseo Web, how the standalone bundle is generated, and how it is integrated into external applications (e.g. `space-app-vibing`).

---

## 1. Overview & Architecture

Paseo Web is packaged as a standalone server that embeds:

1. **Paseo Daemon (`server.mjs`)**: Node.js backend daemon with WebSocket RPCs, agent lifecycle management, and session state.
2. **Web UI (`web-ui/`)**: Pre-built Expo/React web client.
3. **PTY Terminal Worker (`terminal-worker-process.js`)**: Isolated worker for terminal sessions.
4. **Local Speech Worker (`worker-process.js`)**: Isolated worker for embedded dictation and voice mode.
5. **Built-in usage plugins (`builtin-plugins/`)**: The daemon's usage sources, with runtime compilers included in the dependency archive.
6. **Embedded Focus Mode**: The standalone build locks every host to the selected worktree by omitting project/Changes sidebars, their header controls, workspace switching, command-center navigation, and agent-profile/provider management. Fork in a new tab and Import Session remain available within the selected worktree; the embedded importer cannot widen its list to other directories.

### Canonical embedded mode

Both consumer surfaces use one **Embedded Focus Mode** backed by the same standalone build. The Paseo left tab inside Space App Vibing and the Live Design drawer's **Agent** tab render the same workspace tabs, content, and interactions for the selected worktree.

Embedded conversations fill their parent pane through `resolveChatMaxContentWidth`. At pane widths of 960px and above (`CHAT_WIDE_MIN_WIDTH`), 96px outer gutters leave room for the left-side conversation jumper; narrower panes use 16px edge insets and hide the jumper. The existing 8px inner message inset remains. `getChatHorizontalSpacing` and `useChatGutter` share this responsive policy across the web transcript, composers, draft controls, trackers, and callouts. Message inputs stay centered and capped at 960px through `resolveComposerMaxContentWidth`. Standard Paseo keeps its configured content width and padding.

The raw DOM transcript in `agent-stream/strategy-web.tsx` measures its own viewport and applies the responsive gutter independently of the native list styles in `view.tsx`; preserve this path, including virtualized rows and turn footers.

Tooltips must dismiss their global portal and cancel pending hover timers when their retained panel becomes inactive, before `RetainedChatContent` freezes the source chat. The first-fork empty pill was the fork tooltip's portal, not the conversation jumper or workspace diff pill. Preserve the real-browser regression in `components/ui/tooltip.browser.test.tsx`.

The `?embedded-live-design=1` query enables Live Design messaging, not a second build or focus policy. It also retains the desktop tab row at compact widths. When the host asks whether Paseo is ready to receive notes, the workspace focuses the nearest agent/draft tab by tab order (earlier tab on a tie) or creates a draft if none exists. Send new agent always creates a fresh draft. The build-wide invariant is `EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS=true`; preserve it and the guards in `packages/app/src/embedded-focus-mode.ts` when resolving upstream changes.

Embedded empty panes open a focused New Agent draft instead of the generic New Tab launcher, including after closing the last conversation tab or remounting. After persisted form preferences load, an empty model selection defaults to the first available model in Codex, Claude, OpenCode, then Pi order; an explicit selection is preserved.

Queue is the fork's default send behavior. During an active turn, the composer has one Send/Queue action, without a separate Steer button or send-menu action; alternate-send keyboard behavior remains available. Queued messages are checkpointed per server for remounts. The one-time `queue-default` settings migration converts older persisted interrupt/steer defaults to queue; later explicit choices stick.

Live Design handoff is text-only: a short message accompanies a `Live Design context` text attachment containing editing instructions, an untrusted-evidence warning, and fenced JSON. Drafts and queues preserve the attachment. Obsolete host messages containing `images` or `imageGrant` are rejected, without submitting their text. Ordinary Paseo image attachments remain available through the composer.

Sent Live Design context attachments open the shared adaptive modal sheet with read-only, scrollable text, the shared Copy action, and a close control. Conversation Find temporarily reveals the selected message's context inline so matches remain searchable and keyboard navigation stays in the conversation. The context collapses when Find closes or moves to another message. Viewing or searching does not alter the message; rewinding restores the context as editable composer text while preserving an existing draft.

---

## 2. Bundling Commands (in `paseo` repo)

Run from the Paseo checkout with its npm dependencies installed. Use an absolute destination when the consumer is a worktree; the default is `../space-app-vibing/scripts/paseo-web` relative to the Paseo checkout, not the caller's Vibing worktree.

```bash
# Builds the embedded web UI and server stack, then writes the consumer bundle
PASEO_WEB_DEST_DIR=/absolute/consumer/worktree/scripts/paseo-web npm run build:web
```

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
- `package.json` — Packaged daemon name/version and ESM metadata
- `server.mjs` — Standalone bundled daemon
- `terminal-worker-process.js` — PTY process worker
- `worker-process.js` — Local speech worker
- `web-ui/` — Static web client bundle
- `runtime-node-modules.tgz` — PTY and speech dependencies, TypeScript, esbuild, and the build host's esbuild binary
- `bridge-plugin.bundle.mjs` — OpenCode bridge runtime artifact
- `builtin-plugins/` — Usage-source plugins loaded beside `server.mjs`; checkout-only `tsconfig.json` files are omitted because their parent configuration is not shipped

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
2. Finds or creates the workspace corresponding to that directory through the idempotent `openProject` path, preserving its workspace and agent thread on remount.
3. Enters **Embedded Focus Mode** directly.
4. Keeps the selected worktree's tabs/content in both hosts; Live Design messaging selects the nearest conversation or explicitly creates a fresh one.
5. Dictation and voice mode are enabled by the standalone runner (`PASEO_DICTATION_ENABLED`/`PASEO_VOICE_MODE_ENABLED` in `scripts/paseo-web.js`); the host iframe must keep `microphone` in its `allow` list.

### Upstream rebase guard

After syncing from `getpaseo/paseo`, verify all of the following before regenerating the consumer bundle:

- `EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS=true` is still injected by `scripts/build-daemon-web-ui.mjs`.
- Embedded guards still gate project/workspace navigation, sidebars, workspace headers, command center, route-changing shortcuts, and model-management escape paths; Fork in a new tab and Import Session remain scoped to the selected worktree.
- Tooltips dismiss their global portal and cancel pending hover timers when their retained panel becomes inactive; run `components/ui/tooltip.browser.test.tsx` to verify hidden-chat suspension and return.
- Preserve the empty-pane New Agent fallback, persisted model choices, queue checkpoints, text attachments, and request-correlated Live Design outcomes across remounts.
- The `?folder=` bootstrap still uses `openProject` rather than direct workspace creation.
- Focus Mode remains locked and its exit controls remain unavailable.
- Codex terminal interactions stay on their parent Shell card with separate input and output. Preserve `codex/terminal-interactions.ts`, the optional shell `stdin` protocol field, and its renderer when syncing provider changes; mirrored events must not erase repeated input.
- Preserve Default-mode Codex questions through the session-local `default_mode_request_user_input` feature and its explicit provider-option opt-out; see [provider options](docs/providers.md#provider-native-session-options). Run the local `codex-app-server-agent.local.e2e.test.ts` question cases after changing this path, including Full Access. Do not replace questions with auto-approvals or infer them from assistant prose.
- The built-in registry resolves beside `server.mjs`, all listed plugin sources ship, and the archive contains TypeScript, esbuild, and its target binary. Do not restore checkout-only plugin tsconfigs.
- Run focused source checks, then rebuild and run the consumer guard. The full build copies the runner automatically; do not hand-edit generated artifacts.

```bash
# In the Paseo checkout
npm run test --workspace=@getpaseo/app -- --project unit src/embedded-focus-mode.test.tsx src/embedded-live-design.test.tsx src/app/folder-workspace.test.ts src/stores/queued-message-store.test.ts src/constants/layout.test.ts --bail=1 --maxWorkers=1
npm run test:unit --workspace=@getpaseo/server -- src/server/plugins/builtin/index.test.ts -t "standalone bundles resolve|listed built-ins resolve" --bail=1 --maxWorkers=1
node --test scripts/paseo-web.test.mjs
npm run typecheck
npm run lint

# In the destination Vibing worktree, after rebuilding
pnpm exec vitest run scripts/paseo-web/paseoWebBundle.test.ts
```

## 5. Current Vibing Integration

`server/routes/paseo.ts` owns two independent runtimes: the shared Paseo tab instance and the Live Design instance, each with its own port and persistent home. They use the same bundle, but their conversations do not share state. `src/components/PaseoWeb.tsx` owns the workspace iframe and activity bridge.

Worktree deletion cleans matching agent persistence from both runtime homes; startup also prunes agents whose working directories no longer exist. Preserve cleanup-token isolation when changing the runner. Refreshing the bundle does not restart running daemons.

Vibing's `AGENTS.md` contains the host-side fork overlay checklist; `PROJECT_DOCUMENTATION.md` owns host lifecycle and packaging details.
