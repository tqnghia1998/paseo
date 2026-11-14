# Vibing plugins

Every plugin the Vibing build ships, where it comes from, and what the fork changes in it.
`docs/vibing-patches.md` covers the app and daemon patches that host these plugins; this page
is the per-plugin reference and the upgrade procedure.

## What ships

| Plugin                                            | Source and pin                                                                                         | Version       | Ships as                   | Modified                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- | -------------------------- | --------------------------------------------- |
| Bots (`paseo-bots`)                               | [oliexe/paseo-bots](https://github.com/oliexe/paseo-bots) `069f8eb`                                    | 0.2.0         | Built in, isolated process | Heavily: `scripts/paseo-bots-vibing.patch`    |
| Claude usage (`claude-usage-source`)              | Upstream Paseo                                                                                         | follows Paseo | Built in                   | No                                            |
| Codex usage (`codex-usage-source`)                | Upstream Paseo                                                                                         | follows Paseo | Built in                   | Yes, in place (`052e4718d`)                   |
| AIS Switch usage (`ais-switch-usage-source`)      | Fork-owned                                                                                             | —             | Built in                   | Fork-owned                                    |
| Space App Vibing theme (`space-app-vibing-theme`) | Fork-owned                                                                                             | —             | Built in                   | Fork-owned                                    |
| Chat Polish (`paseo-chat-polish`)                 | [lthieu96/paseo-chat-polish](https://github.com/lthieu96/paseo-chat-polish) `6b52cc2`                  | 0.14.0        | Community install          | Yes: `scripts/paseo-chat-polish-vibing.patch` |
| Generative UI (`genui`)                           | [anh-chu/paseo-plugin-genui](https://github.com/anh-chu/paseo-plugin-genui) `cd50b2a`                  | 0.3.3         | Community install          | Yes: `scripts/genui-vibing.patch`             |
| Shell Yeah (`shell-yeah`)                         | [stevecastaneda/paseo-plugins](https://github.com/stevecastaneda/paseo-plugins) `shell-yeah` `7f08467` | 1.4.1         | Community install          | Cleanup: `scripts/shell-yeah-vibing.patch`    |

- **Built in:** listed in `builtinPlugins` (`packages/server/src/server/plugins/builtin/index.ts`);
  the bundler copies them beside `server.mjs` and the daemon always loads them.
- **Community install:** listed in `communityPluginIds` (`scripts/paseo-web-plugins.mjs`) and
  copied into `<home>/installed-plugins/<id>` as an ordinary directory plugin the first time a
  home sees the id. After that the native plugin manager owns it: users can disable or remove it,
  and Vibing never reinstalls or re-enables it.
- **Updates:** each copy Vibing installs records the bundle's fingerprint (SHA-256 of every file)
  in `.vibing-bundle.json`. On each start, when the bundle's fingerprint differs, Vibing replaces
  the copy only if it still matches its recorded fingerprint and its config entry still points at
  `<home>/installed-plugins/<id>`. The entry is untouched, so the plugin keeps its enabled state.
  Edited copies, removed plugins and copies installed from elsewhere are never replaced. Copies
  from before fingerprints are recognised once by the vendoring README and the absence of `.git`
  and `node_modules`. The swap stages `<id>.vibing-update` and moves the old copy to
  `<id>.vibing-previous` first, so an interrupted update restores the previous copy on the next
  start; a failure logs a warning and never blocks startup.
- **Not shipped:** the other upstream provider and usage-source plugins stay in `plugins/` for
  their own tests. Beautiful Chat (replaced by Chat Polish), Fold Turns (Chat Polish already
  merges the steps between replies), Mermaid, Doc Viewer, Annotations, Recap and Side Chat are retired; do not restore them.

The pins live in `scripts/vendor-community-plugins.mjs`, which fetches each source, applies its
patch, inlines reviewed npm dependencies from the public registry, and writes the generated
bundles, manifest, licenses and an attribution README into `plugins/<id>/`. Never edit those
generated files by hand.

A patch change does nothing until its plugin is regenerated (`node scripts/vendor-community-plugins.mjs
<id>`) and the host bundle is rebuilt. This matters most for the Bots patch: the daemon's Chief broker
sends `bots.chief.prepare` the agent id and folder, and the plugin's strict schema rejects a bundle that
lacks them, which leaves Chief unable to connect.

## Modifications

### Bots (`scripts/paseo-bots-vibing.patch`)

Bots is the agent interface of every embedded Vibing workspace, so most of the patch adapts it
to one worktree per frame and to the host's native chat.

- **Native chat slot.** `client/NativeChat.ts` and `ChatPane.tsx` accept an optional host-owned
  chat UI (`nativeChat`, `botWorkspace`, `workspaceBridge` props). Hosts without
  it keep the plugin's own chat UI.
- **Worktree-scoped chats.** In an embedded workspace, chat lists, overview counts and routine
  runs show only that workspace's chats (`client/data.ts`, panel sections), and new chats start
  there instead of the bot's folder. Chats carry a `paseo-bots.context` label so Live Design
  conversations stay separate from workspace ones while sharing bot configuration
  (`shared/chat.ts`). The default Codex bot also lists the workspace's pre-Bots conversations.
- **Default bots and list width.** Codex (the default, `vibing-general`) and Claude are
  seeded once per home (`shared/vibing-defaults.ts`), so deleting either sticks; an untouched
  General bot from older homes becomes Codex once. Version 3 renames an untouched default bot to
  "Codex (default)" or "Claude (default)" once when another bot already has its name. A
  workspace opens on Codex, or on Claude when the Codex bot's provider can't run there (not
  installed or failing) and Claude's can, or when Codex was deleted (`preferredDefaultBotId`,
  then `fallbackDefaultBotId`: Claude, else the first local bot); restore waits for
  provider probes for up to 15 seconds. The bot list opens at its 200px minimum; a list still at the old 320px default is
  narrowed once, and a dragged width is kept. The sidebar footer's New bot is an icon button
  with a tooltip, like the buttons beside it, so the footer fits that width. Bot, chat and team-tab labels use 13px interface text to keep the sidebar compact.
- **Delete and rename chats.** Rows get a Delete icon before the kebab (confirm, then
  permanent delete through the host handle's `delete()`); the chat menu leads with Rename
  (`rename()`, capped at Paseo's 200-character title limit). Removing the open chat selects the
  next chat in sidebar order, else the previous one (`shared/sidebar.ts`); only an emptied bot
  opens a new chat. Hosts without the handle methods report an error.
- **Delete all chats.** The bot menu (kebab and right-click) has a destructive Delete all chats,
  between Archive bot and Delete bot (`shared/delete-chats.ts`). It lists the bot's chats fresh
  through the same query and `select` the sidebar uses (`scopeBotChats` in `shared/chat.ts`, so
  inside an embedded workspace that is this workspace and chat context only), confirms with the
  count and how many are still running (deleting closes the agent first, so they are stopped),
  then deletes four at a time and keeps going past failures, reporting how many failed. Deleted
  chats leave the selection (a new chat opens) and the pins; it never touches the bot itself.
- **Import session.** A bot's new-chat draft offers Import session; imported or restored agents
  get the bot's labels and open once the bot lists them.
- **Team tabs.** With teams, the first tab is All bots (every bot, teams' included; it replaced
  Other bots), then one per team. Tabs remember their last opened chat per workspace and chat
  context (`client/teams/tabChats.ts`), fall back to the tab's most recently active chat, and
  carry the most urgent status of their chats as a badge (`tabStatus.ts`, `shared/groups.ts`).
- **Header height.** On desktop the team tab bar (`client/teams/TeamTabs.tsx`), the chat header
  (`ChatPane.tsx`), the bot settings panel header (`panel/BotPanel.tsx`) and the team map header
  (`teams/TeamMap.tsx`) are 40px instead of 36px, matching Vibing's vertical feature panel
  header; the compact (phone) headers stay 56px.
- **Per-conversation runtime choice.** A chat's provider, model, mode and thinking choice is
  frozen for that conversation and passed to the chats it delegates to, without rewriting the
  bot's saved defaults (`botForChat`, `delegatedAgentSettings`, `server/chats.ts`).
- **`ask_bot` placement.** A chat working in another workspace (an embedded worktree) asks there
  too, in the same chat context, so the other bot's chat is listed beside it and its permission
  prompts can be answered (`server/tools/bots.ts`). Bots' own folders and routines keep the target
  bot's placement.
- **Source-owned Chief UI.** The reserved Chief is excluded from the Bots sidebar,
  settings, setup details/proposals, team membership views and exports. Saved identity,
  instructions, skill/playbook assignments and runtime settings do not override the
  source-defined `managedChiefBot`; its internal memory remains available through the
  host broker. Ordinary Bots remain user-configurable. This lives in the maintained
  Bots vendor patch and requires a permitted plugin refresh to activate.
- **Managed Chief.** `vibing-chief` is a reserved, host-managed persona: ordinary launches,
  routines and relay tools reject it (`assertOrdinaryBot`). The daemon-only broker
  (`server/chief.ts`, `bots.chief.prepare|call|handoff`, bridge-token gated) serves Chief's
  memory, reviewed skills and read-only Bot tools (no `check_chat`), and starts Chief's
  feature handoffs as ordinary chats in the feature workspace (`handoff`). A handoff chat
  may still use `ask_bot` (`mayAsk` exempts `asked-by: vibing-chief`). See
  [Vibing Chief](./vibing-patches.md#vibing-chief).
- **Sharing.** Export downloads the same portable JSON the import dialog accepts
  (`client/web.ts`), and the 50-bot/50-team caps on team export and import are removed.

Tests: `tests/bots.test.ts`, `chief.test.ts`, `groups.test.ts`, `scheduler.test.ts`,
`sidebar.test.ts`, `presets.test.ts`, `sharing-*.test.ts(x)`, `chat-menu.test.ts` in the
patched checkout.
`sharing-dialogs.test.tsx` needs jsdom, which the checkout does not install, so `vitest run`
reports two unhandled errors that are not failures.

### Codex usage (in place, `plugins/codex-usage-source/`)

Reports Codex Enterprise spending allowances in Usage, in the unit the API gives (dollars or
credits, never converted), with their reset time. Vibing's tool rail shows that allowance
through `GET /api/usage/summary`.
It is edited in place because upstream ships it in this repository; keep it on every rebase.

### AIS Switch usage and the theme (fork-owned)

`ais-switch-usage-source` reports the company gateway's shared monthly Claude/Codex allowance by
reading the installed macOS AIS Switch app's login, read-only (see its README).
`space-app-vibing-theme` registers two themes, `dark` and `light`, with the Space App Vibing
(Desktop Plus) palette of each mode; keep them equal to `--palette-*` in Vibing's `src/index.css`.
Its `border` is the palette's own border value (`--palette-border`: `#2b3137` dark, `#e1e4e8`
light), not the hover tone that `raised` uses; `default-dark-tint.ts` and Chief's `CHIEF_PALETTES` match it.
It also sets the optional `raisedStrong` (`surface3`) to the hover tone (`#2f363d` / `#f6f8fa`):
without it the theme builder would derive `surface3`, and with it secondary buttons, selected
segments, switch tracks and the light sidebar hover, from the border. `raisedStrong` is a fork
addition to the theme contract (`PluginThemeColors`, the theme schema and builders in
`plugins/themes/index.ts`); themes that omit it keep `surface3 = border`.
Embedded frames show the theme of the host's light/dark mode, chosen in memory from the
`themeMode` query and `space:theme-mode` messages (`patches/vibing/host-theme-mode.ts` and
`theme.ts`); the choice is never saved to the shared settings.

### Chat Polish (`scripts/paseo-chat-polish-vibing.patch`)

`client/web/restyle-css.ts` adds `:root` fallbacks from Paseo's own colour variables, so embedded
frames without the sidebar that normally calls `setNativeColors` still get its colours, and keeps
its queued-message action icons and chat-outline preview styled after Paseo 0.14's markup.
`client/web/selectors.ts` limits its composer chip styling to the toolbar: the model sheet
reuses `mode-control` as a labelled row, and the chip rule that hides a third child would
otherwise hide its current mode (Plan mode, Auto mode).
Covered by `test/web.test.mjs`. Native `sharp` is not bundled, so thumbnails fall back to the
original image; the optional headless browser downloads only when a user enables page checks.

### Generative UI (`scripts/genui-vibing.patch`)

File cards use one press target and always open through the host's `openFile`, on web too, so
embedded workspace and Live Design chats open worktree files in Vibing's VS Code with their line
numbers, instead of an anchor that opens a Paseo file tab. Regressions:
`node --test scripts/genui-file-links.test.mjs`.

## Upgrading

1. Find each source's latest revision, for example
   `git ls-remote https://github.com/<repository> HEAD`. For monorepo sources, check whether the
   plugin's own directory changed (`git log <pin>..HEAD -- <directory>`).
2. Read the upstream changes, and check the manifest's `requirements.paseo` against the fork's
   Paseo version.
3. Bump `revision` in `scripts/vendor-community-plugins.mjs` and run
   `node scripts/vendor-community-plugins.mjs <id>` (Node 24). It applies the plugin's patch and
   fails if the patch no longer applies.
4. When a patch fails, clone the source at the new revision, `git apply --3way` the old patch,
   resolve, run the plugin's tests, and regenerate it with `git add -A -N . && git diff <revision>`
   (exclude `node_modules`). Bots' patch is developed this way too.
5. Run `npx oxfmt` on each regenerated `paseo-plugin.json`, one file per call.
6. Rebuild into Vibing (`PASEO_WEB_DEST_DIR=<vibing>/scripts/paseo-web npm run build:web`) and run
   `pnpm exec vitest run scripts/paseo-web/paseoWebBundle.test.ts` there; it starts a daemon and
   checks every built-in plugin loads.
7. Update the table above. Existing homes pick up the new bundle on their next start, unless
   their copy was edited (see Updates above).
