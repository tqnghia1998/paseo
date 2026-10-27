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

| Patch                                   | Owned modules                                                                                                        | Upstream hooks                                                                                                                                                                                                                                                              | Verification                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree entry and embedded navigation  | App: `focus-mode.ts`, `folder-workspace.ts`, `workspace-boundary.ts`, `navigation-boundary.tsx`                      | Folder entry, Bots surface, route boundary and settings return                                                                                                                                                                                                              | Folder, boundary, bot draft and bridge tests; embedded browser smoke                                                                                                                                  |
| Host prompt insertion                   | App: `host-prompts.ts`, `host-messages.ts`, `composer-bridge.ts`                                                     | Workspace activation and composer                                                                                                                                                                                                                                           | Colocated host-prompt and composer-bridge tests                                                                                                                                                       |
| Live Design requests                    | App: `live-design.ts`, `host-messages.ts`, `composer-bridge.ts`                                                      | Composer submission/queue callbacks, message context viewer and rewind                                                                                                                                                                                                      | Colocated Live Design and bridge tests; attachment/rewind tests; client/server wait regressions                                                                                                       |
| Agent activity                          | App: `agent-activity.tsx`; server: `worktree-activity.ts`, `worktree-runtime.ts`                                     | App layout and daemon bootstrap                                                                                                                                                                                                                                             | Colocated activity tests; embedded activity case in `bootstrap.smoke.test.ts`                                                                                                                         |
| Bots appearance                         | App: `theme.ts`, `chat-appearance.ts`; `plugins/space-app-vibing-theme/`                                             | App shell and native built-in plugin registry                                                                                                                                                                                                                               | Colocated theme tests; built-in publication test; browser palette check                                                                                                                               |
| Bots sidebar usage                      | App: `bot-usage.ts`, `bot-usage-card.tsx`; Bots patch `sidebarFooter` slot                                           | `embeddedBotChatProps` and the Bots sidebar footer                                                                                                                                                                                                                          | Colocated usage tests; Vibing bundle guard                                                                                                                                                            |
| Bots workspace views                    | App: `embedded-targets.ts`, `bot-chat-panels.tsx`, `bot-chat.tsx`, `host-file-open.ts`, `embedded-command-center.ts` | Layout store `openTab` (non-background), embedded `navigateToWorkspace`, `navigateToAgent`; command center rows, root actions, file search and plugin registration; review feedback recipients; Add to chat (`use-add-file-to-chat.ts`); `focus-mode.ts` shortcut allowlist | `embedded-targets.test.ts`, `bot-chat-links.test.tsx`, `host-file-open.test.ts`, `embedded-command-center.test.ts`, `embedded-add-to-chat.test.tsx`; Vibing `PaseoWeb`/`TabContent`/Live Design tests |
| Bot delegation context                  | Server: `bot-chat-context.ts`                                                                                        | MCP agent creation supplies inherited surface context through native child-label defaults                                                                                                                                                                                   | Stored child/grandchild and explicit-label cases in `agent/create-agent/create.test.ts`                                                                                                               |
| Queue persistence                       | App: `queued-messages.ts`                                                                                            | Session initialization and queue writes                                                                                                                                                                                                                                     | Colocated queue tests; session-store and composer submission tests                                                                                                                                    |
| Worktree stop and deletion              | Server: `worktree-runtime.ts`                                                                                        | Daemon startup, cleanup API and offline runner                                                                                                                                                                                                                              | Missing-worktree case in `bootstrap.smoke.test.ts`; runner token-isolation tests                                                                                                                      |
| Duplicate workspace recovery            | Server: `workspace-open.ts`                                                                                          | Session activity lookup and workspace provisioning                                                                                                                                                                                                                          | `workspace-provisioning-service.test.ts`                                                                                                                                                              |
| Codex questions and native instructions | Server: `codex/questions.ts`                                                                                         | Codex config load and developer-instruction composition; the session-local feature default stays in the adapter                                                                                                                                                             | Codex provider unit tests and local question round trips                                                                                                                                              |
| Interactive Codex shells                | Server: `codex/terminal-interactions.ts`                                                                             | Codex event mapping, optional protocol `stdin`, Shell card renderer                                                                                                                                                                                                         | Colocated terminal tests; Codex provider tests; tool-call schema/browser tests                                                                                                                        |
| Claude background shells                | Server: `claude/background-shells.ts`                                                                                | `ClaudeTaskProtocolSource` (`claude/subagents/live-source.ts`): `local_bash` tasks become Shell subagent rows once backgrounded; `isDeclaredTask` stays false for them so the parent keeps its notification row                                                             | Colocated output-tail test; `live-source.test.ts`; `agent.background-subagent.test.ts`                                                                                                                |
| Codex background terminals              | Server: `codex/background-terminals.ts`                                                                              | `CodexAppServerAgentSession`: `emitEvent` follows root shell cards, root `turn/completed` declares still-running ones as Shell rows, `handleUnexpectedTermination` fails them                                                                                               | Colocated unit test; `codex-app-server-agent.test.ts` (Codex background terminals)                                                                                                                    |
| Standalone distribution                 | `scripts/bundle-paseo-web.mjs`, `scripts/paseo-web.js`                                                               | Root build command, embedded build flag, packaged version and built-in plugin discovery                                                                                                                                                                                     | Runner tests, full standalone build and Vibing bundle guard; see [porting guide](../README-PORT.md)                                                                                                   |

## Interrupted Bots conversations

Recovery belongs to the daemon so leaving a feature tab does not disable it. Only live
failed/interrupted turns in top-level Bots workspace chats qualify; silence and a normal
completion do not establish unfinished work. `bot-auto-resume.ts` owns the bounded retry
window. AgentManager retains admission and lifecycle ownership, including queued-message
protection. Closing/offloading, permissions, and a new prompt cancel pending recovery.

Client Stop requests carry optional `preventAutoResume`; anonymous cancellation requests
remain recoverable. Update the client and daemon together to preserve explicit Stop intent.
The window is process-local and does not survive a daemon restart. Live Design and child
agents keep their existing completion and parent-owned recovery contracts.

## Plugin boundary

Keep `useRevealedText` in the plugin UI exports: vendored Bots, Beautiful Chat and
Generative UI use the hook for custom Markdown and reasoning renderers. A runtime
refresh must preserve it for already-installed plugin bundles too.

Settings → Plugins uses upstream plugin management. The standalone runner copies
each community addon in `communityPluginIds` (`scripts/paseo-web-plugins.mjs`) into
the owning home's `installed-plugins/` and adds an ordinary directory entry to
`config.json` once through native config read/save APIs, preserving BOM support, symlinks and private file permissions. The
home's `.vibing-community-plugins.json` marker records each addon already offered, so
later launches never reinstall removed plugins or reset disabled ones, while newly
bundled addons still reach existing homes. Homes with the legacy
`.vibing-community-plugins-v1` marker count Beautiful Chat and Annotations as offered.
Existing entries, including the same ID installed from another source, and an explicit
global plugin opt-out are preserved. The addons follow native enable, disable, reload
and remove controls. They are not reserved built-in IDs. Offline source copies live
beside the bundle in `community-plugins/`.

Besides Beautiful Chat and Annotations, the addons are PDF and Office viewer
(`paseo-doc-viewer`), Shell Yeah (`shell-yeah`), Recap (`paseo-recap`), Quick prompts
(`paseo-quick-prompts`) and Generative UI (`genui`). Fold Turns (`completed-turns`) is
deliberately not shipped: the host applies timeline transformers in plugin-ID order,
so Beautiful Chat claims tool and reasoning rows first and Fold Turns cannot fold them.
Bots chats use the native agent panel, so their slash commands, composer pills,
attachment sources and timeline renderers apply there. Addon workspace panels open
inside the chat through the Bots workspace views below (Cmd+K or plugin actions); header
buttons and sidebar items do not appear, because the embedded build mounts no workspace
screen or sidebar. Recap generates summaries through
the `claude`, `codex` or `opencode` CLIs on the daemon's `PATH`;
`scripts/paseo-recap-vibing.patch` makes its automatic Claude choice the CLI's `haiku`
alias, which honors `ANTHROPIC_DEFAULT_HAIKU_MODEL`, because the company gateway maps
the newest Haiku to an older model that rejects its reasoning-effort setting.

Quick Prompts uses one menu by default, opens on desktop hover, sends from the row,
and inserts from its sole trailing action. `paseo-quick-prompts-vibing.patch` owns these
choices and the draft-agent integration, so regenerating the addon keeps them.

Generative UI file cards use a single press target. In embedded workspace and Live Design chats,
`genui-vibing.patch` sends worktree-relative paths and line numbers through the existing
origin-checked `paseo:open-file` bridge; standalone workspace routing remains available.
The root comes from the timeline agent snapshot. Regressions: `node --test scripts/genui-file-links.test.mjs`.

Bots and the palette remain built-ins because embedded navigation depends on them.
Above the Bots sidebar footer, the app's `sidebarFooter` slot shows the Codex budget
(the spending allowance, else Codex's first limit): percent and whole dollars left.
Claude is deliberately omitted; the card hides without Codex data and opens Usage.
The built-in list also keeps the Claude, Codex and AIS Switch usage sources; the other
upstream provider and usage-source plugins stay in `plugins/` for their tests, and
the bundler copies only listed built-ins.
The separate customization catalog and redundant Mermaid plugin are removed;
Paseo's native Markdown renderer handles Mermaid diagrams.

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
own a separate cache. Use Expo Router's focus hooks; SDK 57 owns navigation contexts
that are separate from `@react-navigation/native`. Bots owns creation, preserving instructions, memory, skills,
MCP/tools and labels, while the host supplies the bound workspace placement.
Definitions remain runtime-global and local conversation lists stay worktree-scoped.
Native fork actions open a fresh draft in the same bot, preserving the draft ID
that owns the bounded Chat history attachment. The Bots composer reads that
draft's attachment scope so the copied conversation reaches its first message.
Fork drafts allocate their bot/workspace/context-scoped ID before saving history
attachments, so unsent forks restore after warm activation and iframe remount.
Bot chat rows show a Delete icon before their kebab; it confirms, then permanently
deletes the agent through the client handle's `delete()` (hosts without it report an
error). Deleting or archiving the open chat selects the bot's next chat in sidebar
order (pins first), else the previous one; only a bot with no chats left opens a new
chat. The new-chat draft shows the native Import session pill: the sheet is locked
to the bound worktree (no "Show all") and labels the imported or restored agent with
the bot, so it lists and opens under that bot.
Opening a new chat focuses its composer while the pane is active, matching the native
workspace draft; focus pauses while the first message is being created. Native
Bots drafts use `useDraftAgentCreateFlow` for submission state, first-message
identity, pending-create protection and optimistic handoff; the Bots adapter owns
image encoding and bot creation. Each new draft has its own keyed lifecycle;
hiding a retained draft keeps its explicit runtime choice and delegation intent.
The native model picker can override provider, model, approval mode and thinking for
that conversation and its delegated chats. Bot settings seed the picker. Automatic
default resolution does not count as a choice: until you select a model, provider,
mode or thinking level, delegated bots use their own saved settings. An explicit
choice freezes the resolved model in the conversation's `paseo-bots.runtime` label,
so `ask_bot` reuses it even after reloads or provider-default changes. Members keep
their own instructions, skills and tools. Saved bot settings remain the defaults
for later chats and routines. The picker already displays the concrete model;
an explicit choice adds a note that it applies to delegated team members.
Prompt composition and agent creation use the same runtime choice. Draft preference
services are local to the mounted conversation so global composer preferences cannot
replace bot/provider defaults or receive these overrides.
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
It remembers the selected started chat or unsent draft per worktree in iframe
`localStorage`, including the draft ID and owning bot. An explicit New Chat takes
precedence on feature return and remount; selecting a started chat clears that
draft selection. Deleted and remote-host bots cannot be restored. Without a valid
draft selection, restoration uses the last eligible started chat, then the newest
eligible chat, then New Chat. Prompts and Live Design win over a pending restore.
Native draft keys include the workspace. Web draft persistence writes only changed
records to separate storage keys, importing legacy shared snapshots without replacing
newer records; stale iframe snapshots must never overwrite another feature's drafts.
Page hide flushes staged text and its storage checkpoint before iframe teardown. Shared chat plugins, attachments, queues,
rewind and provider fixes remain. The reproducible community source patch lives in
`scripts/paseo-bots-vibing.patch`; regenerate its bundles instead of hand editing
generated files. The workspace bridge renders no header or Chat settings button.

`ask_bot` from a chat working outside the asking bot's own folder (a bound worktree)
starts the other bot's chat in that same workspace and chat context, so it is listed
under that bot in the same Bots sidebar and its permission prompts can be answered.
Chats in a bot's own folder, and routines, keep the target bot's own placement.

With teams, the first tab is **All bots** (every listed bot, teams' included, replacing
upstream's "Other bots" tab), followed by one tab per team. Tabs remember the chat last
opened on them, per worktree and chat context (`paseo-bots:tab-chats:` in local storage).
Switching tabs on desktop keeps the current chat when the new tab lists its bot, else
reopens the tab's remembered chat while it is still open, else its most recently active
chat, else a new chat with its first bot. However a chat is opened (list, restore, host
prompt), a team tab that doesn't list its bot gives way to the bot's team tab, or to All
bots. Each tab's icon carries the same status badge as a collapsed
bot row, aggregated over its bots' chats: working, needs input, failed, or ready to review
(Paseo's finished-unread dot).

Bots mounts no workspace screen, so tabs, sheets and the Explorer opened by upstream code
would never appear. While a Bots chat is visible it registers in `embedded-targets.ts`; the
layout store's user-initiated `openTab` (not `background`, so automatic PR tabs stay quiet),
the embedded `navigateToWorkspace` branch and `navigateToAgent` hand their target to it.
`bot-chat.tsx` then opens worktree files in Vibing (`paseo:open-file` with the relative path
and line, posted to the embedding origin), turns drafts into Bots drafts, and shows every other
supported target through `BotChatPanelLayer`: the target's own registered panel under a Back
header, stacked, with the parent chat retained underneath. That covers subagents (Paseo child
agents and provider subagents, with an opened child agent's timeline kept live), Changes and
diffs (the composer pill and review chips), the Files explorer for folder links, pull
requests, plugin panels, detached agents, notification and command-center agent results, and
files outside the worktree (shown read-only in Paseo's file panel). Terminals, browsers and setup stay with Vibing.
Panels keep their tab state while open. A diff closed with Back stays mounted but hidden, as a
workspace diff tab would, because the diff publishes review comments to the composer only while
mounted; reopening it or the review chip shows the same panel. Selecting another chat clears
the stack.

Upstream code that looks for an agent tab finds the visible Bots chat instead: review feedback
sends to it, and Add to chat from Files and diffs attaches to its composer and closes the panels
over it.

The command center (Cmd+K and its file scope) is enabled in Bots. The bound worktree stands in
for the route's workspace and the visible chat for the focused agent, so plugin entries and
file search work. Workspace results are dropped, agent results are limited to the bound
worktree, and only Settings and shortcut help remain among the root commands.

Bots and the other community addons except Beautiful Chat are pinned and regenerated
with `scripts/vendor-community-plugins.mjs [id...]`; each README records attribution,
revision and license. Addons with npm dependencies (`bundleDependencies`) install
their lockfile from the public npm registry at vendoring time and inline it, with
`THIRD_PARTY_LICENSES.txt`; the upstream manifest `build` step is dropped, so
installs never run npm (company registry mirrors lack some packages). Beautiful Chat yields Mermaid messages and Bots tools so native
diagrams and actionable proposal/sign-in cards can run.

Bots and ordinary installed plugins run in workers with the owning daemon's
`PASEO_HOME`, including isolated test homes. Workspace Bots and Live Design share one production home. Bots owns its screen,
data and routines; native worktree navigation remains scoped. Connected apps and
bots are configured by the user. Annotations always uses Queue. Its direct-send
queue lasts only for the current client lifetime; sending through the normal
composer uses native queued-message recovery. Live Design text attachments remain
native and independent.

The patch map above records the remaining customizations. Native navigation guards,
composer draft/queue integration, process cleanup, and provider
protocol fixes still require their existing core hooks. The plugin API can add
screens, panels, buttons, attachments, lifecycle observers, providers, and themes;
it does not provide native routing policy or composer persistence hooks.
Do not label these patches as installed plugins merely to make them discoverable.

## Contracts to preserve

- Embedded folder entry uses idempotent `openProject`, binds its worktree and
  opens Bots. Normal workspace/Agent routes cannot mount. Settings return to that
  same frame's binding, independently of sibling workspaces. This is a navigation
  policy, not a sandbox for agents or plugins. Standalone builds keep upstream
  navigation, sidebar preferences and multi-tool workspace layouts.
- Live Design shares the workspace Bots runtime, bot definitions and memory. Its `paseo-bots.context=live-design` label scopes chat lists and imports; native draft/selection keys and command-center results also stay separate by surface and worktree. Readiness activates the selected
  local bot or General; fresh requests create unique bot drafts. Embedded activity
  indicators use the same conversation context, so a running workspace chat cannot
  keep Live Design's dot flashing (or the reverse). Pending completion
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
  only confirmed terminal snapshots settle a request. Its `wait_for_finish` sets the
  fork-only `waitUntilActive`, so the wait outlasts an idle agent until the
  note's turn starts; upstream's `waitForActive` keeps returning at once for an
  idle agent with no turn, which child-completion reports rely on. Legacy image grants and
  image handoff remain rejected.
- Queue is the fixed active-turn Send policy. The default-send setting and
  one-time queue migration are removed; obsolete saved preferences cannot change
  the policy. Preserve synchronous draft clearing and queue checkpoint merging
  and deduplication. Explicit send controls and alternate-send keyboard behavior
  follow upstream. Native saved provider/model preferences own selection.
- The native Appearance content-width setting controls transcript and composer.
  Bots routes default to 1200px and use 48px desktop transcript gutters to clear
  the outline rail; normal chats retain the upstream 820px default and gutters.
  Explicit saved widths persist. The bundled theme uses the native `addTheme`
  palette and is selected once only on embedded Bots routes; later explicit
  appearance choices persist. The theme needs an explicit Paseo version range
  and a server entry to load independently of the user-plugin switch.
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

The AIS Switch usage source reads the installed macOS app's encrypted login and
queries the shared monthly AQP allowance through CQP. It never writes or refreshes
AIS credentials. The Bots sidebar shows separate AIS Switch and Codex cards through
the existing Usage modal and styles. See `plugins/ais-switch-usage-source/README.md`
for the verified disk/API contract and its version boundary.

Plugin menu `actions` rows accept an optional row-level `onPress` declared in
`packages/plugin/src/client/buttons.ts` and documented in
`public-docs/plugins/reference.md`. In `packages/app/src/plugins/buttons/`,
`validation.ts` checks it, `model.ts` runs it for a one-segment row path, and
`view.tsx` renders such a row as a pressable menu item whose trailing icon actions
stop propagation so they never trigger the row. Pending or disabled buttons and
disabled rows or actions run nothing; rows without `onPress` stay upstream labels.
Quick Prompts (`scripts/paseo-quick-prompts-vibing.patch`) depends on it as its only
Send path, keeping Insert as the trailing action. Keep `model.test.ts`, the patch's
`pills.test.ts` and the Vibing bundle guard.

Some fixes need the upstream execution path: active/archived Codex import
pagination, terminal output event mapping, optional wait/protocol fields, Pi turn
settlement, assistant-only citation normalization shared by transcript and clipboard HTML, retained-panel tooltip cleanup,
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
