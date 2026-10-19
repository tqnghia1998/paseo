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

| Patch                                   | Owned modules                                                                                                                                                  | Upstream hooks                                                                                                  | Verification                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Worktree entry and embedded navigation  | App: `focus-mode.ts`, `folder-workspace.ts`, `workspace-conversation.ts`, `workspace-boundary.ts`, `navigation-boundary.tsx`, `sidebar.ts`, `sidebar-hooks.ts` | Root/workspace routes, panel/workspace-layout stores, New Agent/model/import controls, fork menu                | Colocated focus, folder, and conversation tests; workspace-layout regressions; embedded browser smoke |
| Host prompt insertion                   | App: `host-prompts.ts`, `host-messages.ts`, `composer-bridge.ts`                                                                                               | Workspace activation and composer                                                                               | Colocated host-prompt and composer-bridge tests                                                       |
| Live Design requests                    | App: `live-design.ts`, `host-messages.ts`, `composer-bridge.ts`                                                                                                | Composer submission/queue callbacks, message context viewer and rewind                                          | Colocated Live Design and bridge tests; attachment/rewind tests; client/server wait regressions       |
| Agent activity                          | App: `agent-activity.tsx`; server: `worktree-activity.ts`, `worktree-runtime.ts`                                                                               | App layout and daemon bootstrap                                                                                 | Colocated activity tests; embedded activity case in `bootstrap.smoke.test.ts`                         |
| Embedded theme                          | App: `theme.ts`; `plugins/space-app-vibing-theme/`                                                                                                             | App shell and native built-in plugin registry                                                                   | Colocated theme tests; built-in publication test; browser palette check                               |
| Queue persistence                       | App: `queued-messages.ts`                                                                                                                                      | Session initialization and queue writes                                                                         | Colocated queue tests; session-store and composer submission tests                                    |
| Worktree stop and deletion              | Server: `worktree-runtime.ts`                                                                                                                                  | Daemon startup, cleanup API and offline runner                                                                  | Missing-worktree case in `bootstrap.smoke.test.ts`; runner token-isolation tests                      |
| Editor remount recovery                 | App: `file-recovery.ts`                                                                                                                                        | File editor model/view and panel close attributes                                                               | Recovery/model tests; iframe remount smoke                                                            |
| Duplicate workspace recovery            | Server: `workspace-open.ts`                                                                                                                                    | Session activity lookup and workspace provisioning                                                              | `workspace-provisioning-service.test.ts`                                                              |
| Codex questions and native instructions | Server: `codex/questions.ts`                                                                                                                                   | Codex config load and developer-instruction composition; the session-local feature default stays in the adapter | Codex provider unit tests and local question round trips                                              |
| Interactive Codex shells                | Server: `codex/terminal-interactions.ts`                                                                                                                       | Codex event mapping, optional protocol `stdin`, Shell card renderer                                             | Colocated terminal tests; Codex provider tests; tool-call schema/browser tests                        |
| Standalone distribution                 | `scripts/bundle-paseo-web.mjs`, `scripts/paseo-web.js`                                                                                                         | Root build command, embedded build flag, packaged version and built-in plugin discovery                         | Runner tests, full standalone build and Vibing bundle guard; see [porting guide](../README-PORT.md)   |

## Plugin boundary

Embedded Settings → Vibing customizations provides a read-only catalog of shipped
plugin changes, workspace integration patches, and provider/runtime fixes. It uses
`packages/app/src/patches/vibing/customizations.tsx`; update it when this patch map
changes. Implementation paths stay under its collapsed details row. The catalog
does not inspect runtime health or change enablement.

Settings → Plugins lists registered plugins, not every fork change. Of the bundled
plugins, `space-app-vibing-theme` is added by this fork, and `codex-usage-source`
contains the Enterprise allowance change. The other bundled provider and usage
plugins come from the incorporated upstream base.

The patch map above records the remaining customizations. Native navigation guards,
composer draft/queue integration, editor recovery, process cleanup, and provider
protocol fixes still require their existing core hooks. The plugin API can add
screens, panels, buttons, attachments, lifecycle observers, providers, and themes;
it does not provide native routing policy or composer/editor persistence hooks.
Do not label these patches as installed plugins merely to make them discoverable.

The built-in inventory display itself extends core plugin management with an
optional `builtinPluginListing` capability and opt-in list request; see the
[built-in contract](plugins.md#built-in-plugins). It leaves the default configured
plugin list unchanged.

## Contracts to preserve

- Every standalone host uses the same embedded workspace policy. `?folder=` resolves
  through idempotent `openProject` and preserves workspace/thread identity. Native
  headers, Explorer, New Tab launcher, splits, terminals, Git actions and configured
  panels stay available. Global host/project navigation and workspace archive stay host-owned. Shared
  settings use the native screens; the workspace header and shortcut provide entry.
  A worktree-qualified iframe name keys a sessionStorage navigation binding so
  Settings reload/return cannot select a sibling iframe's last workspace. The route
  boundary gates screen mounting, and navigation/search filter workspace targets.
  The native sidebar, History, Schedules and plugin screens stay available. Scope
  rows, imports and schedule targets to the bound worktree. Different Paseo
  workspace records may share that directory (local scheduled runs); only daemon
  descriptors proving an exact directory match allow those records through. Other
  hosts, sibling paths and unresolved identities remain blocked. Scheduled runs
  created here explicitly use local isolation. Activity includes same-directory
  records even while an auxiliary screen is open.
  The bound project's settings expose scripts and lifecycle hooks; the project
  index and other project settings remain unavailable.
  Shared settings may affect other workspaces; this is not a plugin/terminal sandbox. The historical `EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS` flag identifies
  embedding; Focus Mode itself is optional. Panel-store version 17 clears legacy
  forced focus once. Empty panes no longer create drafts automatically.
- Embedded editors journal unsaved text in sessionStorage before accepting it.
  Recovery is scoped by server/workspace/tab/path and lasts across iframe remounts
  in the same top-level window. It is not cross-window or restart persistence.
  Storage failures reject new edits; external changes retain conflict protection.
  Explicit discard clears recovery, including late save callbacks. Ordinary unmount
  keeps it. Standard builds use the upstream editor without the journal.
- Live Design adds messaging to that same UI. Compact Live Design keeps desktop
  tabs and its compact file/subagent sheet host. Host requests select the nearest
  conversation, recover a pending agent, or explicitly create a fresh draft.
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
  migration. Alternate-send keyboard behavior stays upstream behavior.
- Chat widths, gutters, tab geometry and metadata tooltips follow upstream. Use
  Paseo's Appearance content-width setting for both transcript and composer.
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
New Agent and compact Live Design in an isolated runtime before shipping. Module
organization does not replace runtime or target-platform native checks.
