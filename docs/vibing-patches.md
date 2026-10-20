# Vibing fork patches

Start here when changing or rebasing the Space App Vibing fork. Custom behavior
lives in ordinary source modules under `packages/app/src/patches/vibing/` and
`packages/server/src/patches/vibing/`. Upstream files call those modules explicitly.
Tests sit beside the patch they cover; integration tests stay with the upstream
surface they exercise.

Keep each patch tied to one product requirement. Prefer an upstream setting or
extension point when it preserves the same behavior. Keep rendering and provider
event plumbing in upstream files when extracting them would copy upstream code.

## Patch map

Paths in the module column are relative to the corresponding `src/patches/vibing/`
directory. The upstream hooks column names the integration points to check after a
rebase, rather than requiring reviewers to reconstruct them from commit history.

| Patch                                   | Owned modules                                                                                   | Upstream hooks                                                                                                  | Verification                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Worktree entry and embedded navigation  | App: `focus-mode.ts`, `folder-workspace.ts`, `workspace-boundary.ts`, `navigation-boundary.tsx` | Folder entry, Bots surface, route boundary and settings return                                                  | Folder, boundary, bot draft and bridge tests; embedded browser smoke                                |
| Host prompt insertion                   | App: `host-prompts.ts`, `host-messages.ts`, `composer-bridge.ts`                                | Workspace activation and composer                                                                               | Colocated host-prompt and composer-bridge tests                                                     |
| Live Design requests                    | App: `live-design.ts`, `host-messages.ts`, `composer-bridge.ts`                                 | Composer submission/queue callbacks, message context viewer and rewind                                          | Colocated Live Design and bridge tests; attachment/rewind tests; client/server wait regressions     |
| Agent activity                          | App: `agent-activity.tsx`; server: `worktree-activity.ts`, `worktree-runtime.ts`                | App layout and daemon bootstrap                                                                                 | Colocated activity tests; embedded activity case in `bootstrap.smoke.test.ts`                       |
| Embedded theme                          | App: `theme.ts`; `plugins/space-app-vibing-theme/`                                              | App shell and native built-in plugin registry                                                                   | Colocated theme tests; built-in publication test; browser palette check                             |
| Queue persistence                       | App: `queued-messages.ts`                                                                       | Session initialization and queue writes                                                                         | Colocated queue tests; session-store and composer submission tests                                  |
| Worktree stop and deletion              | Server: `worktree-runtime.ts`                                                                   | Daemon startup, cleanup API and offline runner                                                                  | Missing-worktree case in `bootstrap.smoke.test.ts`; runner token-isolation tests                    |
| Duplicate workspace recovery            | Server: `workspace-open.ts`                                                                     | Session activity lookup and workspace provisioning                                                              | `workspace-provisioning-service.test.ts`                                                            |
| Codex questions and native instructions | Server: `codex/questions.ts`                                                                    | Codex config load and developer-instruction composition; the session-local feature default stays in the adapter | Codex provider unit tests and local question round trips                                            |
| Interactive Codex shells                | Server: `codex/terminal-interactions.ts`                                                        | Codex event mapping, optional protocol `stdin`, Shell card renderer                                             | Colocated terminal tests; Codex provider tests; tool-call schema/browser tests                      |
| Standalone distribution                 | `scripts/bundle-paseo-web.mjs`, `scripts/paseo-web.js`                                          | Root build command, embedded build flag, packaged version and built-in plugin discovery                         | Runner tests, full standalone build and Vibing bundle guard; see [porting guide](../README-PORT.md) |

## Plugin boundary

The native plugin settings screen registered by `space-app-vibing-theme` provides
its read-only customization catalog. Update
`plugins/space-app-vibing-theme/client/customizations.tsx` when this patch map
changes. Implementation paths stay under its collapsed details row. The catalog
does not inspect runtime health or change enablement. It points to the native
Appearance and General → Default send controls without adding app routes or
cross-screen plugin navigation. Live Design is configured in outer Vibing
Settings → Experiments. Reliability and navigation patches do not get toggles.

Embedded Settings → Plugins separates Vibing customizations, Community plugins,
Paseo built-ins and additional plugins. Only `space-app-vibing-theme` and the
extended `codex-usage-source` appear under Vibing customizations and in its patch
catalog. The vendored `beautiful-chat`, `mermaid`, `paseo-bots` and `annotations`
appear under Community plugins with links to their original authors' repositories.
They are bundled and enabled by default. The other bundled provider and usage
plugins come from the incorporated upstream base and stay under Paseo built-ins.
Additional plugins retain their installation and lifecycle controls. Keep this
display grouping in `plugin-inventory.ts`; it must not change which plugins load
or their runtime status.

[Beautiful Chat](../plugins/beautiful-chat/README.md) ships a pinned, prebundled
upstream revision so embedded startup stays offline. Its tool, reasoning and task
cards are enabled; native user and assistant rendering remains the default to
retain Find and citation handling. Saved Chat presentation preferences win.
Attachment rows and interactive Shell input remain native even when users enable
enhanced messages. Preserve these boundaries when updating the vendored plugin.

Vibing exposes Bots as its only agent tool. Embedded folder launches, including
legacy entries and Live Design, bind the worktree and open the Bots plugin.
Standalone Paseo retains its upstream workspace screens. The old embedded Agent
launcher, tab/header projection, sidebar/history/schedule changes and editor
journal are removed; they no longer serve an exposed tool.

Embedded local bot chats use the native transcript and composer through the private
`bot-chat*` slot. Keep the app query client around native controls: plugin surfaces
own a separate cache. Bots owns creation, preserving instructions, memory, skills,
MCP/tools and labels, while the host supplies the bound workspace placement.
Definitions remain runtime-global and local conversation lists stay worktree-scoped.
Native fork actions open a fresh draft in the same bot, preserving the draft ID
that owns the bounded Chat history attachment. The Bots composer reads that
draft's attachment scope so the copied conversation reaches its first message.
Bot chat rows show a Delete icon before their kebab; it confirms, then permanently
deletes the agent through the client handle's `delete()` (hosts without it report an
error). Deleting or archiving the open chat selects the bot's next chat in sidebar
order (pins first), else the previous one; only a bot with no chats left opens a new
chat. The new-chat draft shows the native Import session pill: the sheet is locked
to the bound worktree (no "Show all") and labels the imported or restored agent with
the bot, so it lists and opens under that bot.
Opening a new chat focuses its composer while the pane is active, matching the native
workspace draft; focus pauses while the first message is being created.
The fork menu omits its new-workspace destination inside Bots chats.
General is created automatically and includes legacy unlabeled chats from the same
directory without mutating their records. Embedded conversation lists, pins, usage and routine chat links are strictly
scoped to the bound worktree. There is no all-folder override. Selected chat IDs
are checked against that scope before loading a transcript, and unresolved binding
waits instead of falling back to the global list. Remote-host bots cannot open
chats in a local worktree; their settings remain editable. Routine definitions
and configured background placement remain shared.

`bot-workspace.tsx` activates conversations for review/recovery prompts and Live
Design, including pending completion recovery and unique fresh-draft handshakes.
It also saves the open chat (or new chat) per worktree in iframe `localStorage`
and reopens it when the surface remounts, once agents hydrate and only if that
agent still belongs to the worktree; prompts and Live Design win over a pending
restore. Native draft keys include the workspace. Shared chat plugins, attachments, queues,
rewind and provider fixes remain. The reproducible community source patch lives in
`scripts/paseo-bots-vibing.patch`; regenerate its bundles instead of hand editing
generated files. The workspace bridge renders no header or Chat settings button.

The additional community plugins are pinned and regenerated with
`scripts/vendor-community-plugins.mjs`; each plugin's README records attribution,
revision and license. They have no extra runtime dependencies. Beautiful Chat
yields Mermaid messages and Bots tools so diagram renderers and actionable
proposal/sign-in cards can run. Mermaid leaves messages containing provider
citation markers to the native renderer. Its parser supports flowcharts and
sequence diagrams; see upstream for its syntax limits.

Bots and Annotations run in plugin workers with the owning daemon's `PASEO_HOME`,
including isolated test and Live Design homes. Do not run these stateful built-ins
inside the parent process or substitute the shell's home. Bots owns its own
screen, data and routines; native worktree navigation remains scoped. Connected
apps and bots are configured by the user. Annotations follows explicit saved send
behavior and defaults to Queue. Its direct Send now queue lasts only for the
current client lifetime; sending through the normal composer uses native queued
message recovery. Live Design text attachments remain native and independent.

The patch map above records the remaining customizations. Native navigation guards,
composer draft/queue integration, process cleanup, and provider
protocol fixes still require their existing core hooks. The plugin API can add
screens, panels, buttons, attachments, lifecycle observers, providers, and themes;
it does not provide native routing policy or composer persistence hooks.
Do not label these patches as installed plugins merely to make them discoverable.

The built-in inventory display itself extends core plugin management with an
optional `builtinPluginListing` capability and opt-in list request; see the
[built-in contract](plugins.md#built-in-plugins). It leaves the default configured
plugin list unchanged.

## Contracts to preserve

- Embedded folder entry uses idempotent `openProject`, binds its worktree and
  opens Bots. Normal workspace/Agent routes cannot mount. Settings return to that
  same frame's binding, independently of sibling workspaces. This is a navigation
  policy, not a sandbox for agents or plugins. Standalone builds keep upstream
  navigation, sidebar preferences and multi-tool workspace layouts.
- Live Design uses Bots in its separate runtime. Readiness activates the selected
  local bot or General; fresh requests create unique bot drafts. Pending completion
  observation returns to the owning conversation in the bound directory.
- Host prompts append to the active editable composer without submitting. Parent
  source/origin checks, composer/request IDs, acknowledgements and delivery
  deduplication belong to `host-prompts.ts`. Its parent origin/source boundary is
  shared with Live Design in `host-messages.ts`.
- Vibing owns note formatting in `src/live-design/paseoMessage.ts`. Its iframe
  message carries prepared `text` and `contextText`; Paseo wraps the latter as a
  native `Live Design context` text attachment. Readiness advertises
  `preparedText: true`; an older mounted iframe requires a reload before sending.
  Keep attachments through drafts/queues, read-only viewing/search, rewind, and
  request-correlated completion across remounts. Observation errors keep waiting;
  only confirmed terminal snapshots settle a request. Legacy image grants and
  image handoff remain rejected.
- Queue stays the default active-turn Send behavior. Preserve synchronous draft
  clearing, queue checkpoint merging/deduplication, and the one-time settings
  migration. Sending controls and alternate-send keyboard behavior follow upstream.
  Native saved provider/model preferences own selection; no provider-priority
  fallback overrides them.
- Paseo's native Appearance content-width setting controls both transcript and
  composer, defaulting to 1200px in embedded builds and 820px in standalone builds.
  Explicit saved widths persist. The embedded web transcript pads 48px on each side
  (`agent-stream/strategy-web.tsx`) so messages clear the chat outline rail, whose
  upstream gutter assumes the narrower standalone width. Gutters, tab geometry and metadata tooltips follow upstream.
  The bundled theme uses the native `addTheme` palette, whose derived colors
  intentionally replace the former full-token override. Only embedded builds
  select it automatically once; subsequent explicit appearance choices persist. Native built-ins need an explicit Paseo version range
  and a server entry even for a client-only palette; no user-plugin enablement
  or configuration migration is required.
- Worktree APIs stay loopback-only and host-token-gated. Startup pruning,
  archive/close/flush/delete ordering, directory-boundary matching and capability
  removal before child processes are part of the cleanup contract. `/stop` releases
  matching setup/agent/terminal resources without removing records; `/cleanup`
  first stops, then archives/deletes. Failure blocks Vibing filesystem deletion.
  Explicit terminal teardown force-signals the discovered process tree before its
  root exits, including hangup-resistant jobs. Deliberately detached processes and
  concurrent external process creation are not a complete ownership boundary.
- Codex questions stay session-local, respect explicit feature opt-out, exclude
  internal agents and preserve native developer instructions. A native config
  read failure must not replace unknown instructions. Keep Default/Full Access,
  Default/normal-permissions and Plan question round trips.

## Small edits that stay upstream

The Codex usage plugin reads `spend_control.individual_limit` for Enterprise
allowances, preserving the reported currency/credit unit, amounts, percentages,
reset time and reached-limit status. Null credit balances stay unreported.
Keep this in `plugins/codex-usage-source/server/usage.ts` with its regression tests;
native usage windows/balances own rendering and sidebar pins.

Some fixes need the upstream execution path: active/archived Codex import
pagination, terminal output event mapping, optional wait/protocol fields, Pi turn
settlement, assistant-only citation normalization, retained-panel tooltip cleanup,
text-attachment support, and tab/header/sheet rendering. Keep these edits local
to their existing owner and preserve their regression tests. Moving an entire
upstream component into the patch directory would create a second copy to rebase.

## Rebase and verification

Compare the fork with its incorporated upstream base, rather than treating newer
upstream commits as custom changes:

```bash
git diff "$(git merge-base upstream/main HEAD)" -- packages/app/src packages/server/src
```

For each conflict, check the relevant row above, retain the smallest explicit
hook, and run the tests for that row. Run these focused checks after reorganizing
the modules:

```bash
npm run test --workspace=@getpaseo/app -- --project unit src/patches/vibing --bail=1 --maxWorkers=1
npm run test:unit --workspace=@getpaseo/server -- src/patches/vibing src/server/agent/providers/codex-app-server-agent.test.ts src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts --bail=1 --maxWorkers=1
node --test scripts/paseo-web.test.mjs
npm run typecheck
npm run lint
```

Use the [porting guide](../README-PORT.md#2-bundling-commands-in-paseo-repo) to build
the consumer bundle and run its guard. Verify workspace entry, prompt insertion,
New Agent and compact Bots/Live Design in an isolated runtime before shipping. Module
organization does not replace runtime or target-platform native checks.
