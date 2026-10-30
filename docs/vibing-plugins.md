# Vibing plugins

Every plugin the Vibing build ships, where it comes from, and what the fork changes in it.
`docs/vibing-patches.md` covers the app and daemon patches that host these plugins; this page
is the per-plugin reference and the upgrade procedure.

## What ships

| Plugin                                            | Source and pin                                                                                              | Version       | Ships as                   | Modified                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- | -------------------------- | ----------------------------------------------- |
| Bots (`paseo-bots`)                               | [oliexe/paseo-bots](https://github.com/oliexe/paseo-bots) `39a7000`                                         | 0.2.0         | Built in, isolated process | Heavily: `scripts/paseo-bots-vibing.patch`      |
| Claude usage (`claude-usage-source`)              | Upstream Paseo                                                                                              | follows Paseo | Built in                   | No                                              |
| Codex usage (`codex-usage-source`)                | Upstream Paseo                                                                                              | follows Paseo | Built in                   | Yes, in place (`052e4718d`)                     |
| AIS Switch usage (`ais-switch-usage-source`)      | Fork-owned                                                                                                  | —             | Built in                   | Fork-owned                                      |
| Space App Vibing theme (`space-app-vibing-theme`) | Fork-owned                                                                                                  | —             | Built in                   | Fork-owned                                      |
| Chat Polish (`paseo-chat-polish`)                 | [lthieu96/paseo-chat-polish](https://github.com/lthieu96/paseo-chat-polish) `f7e6677`                       | 0.8.0         | Community install          | Yes: `scripts/paseo-chat-polish-vibing.patch`   |
| Annotations (`annotations`)                       | [neunzig-zehn/paseo-annotations](https://github.com/neunzig-zehn/paseo-annotations) `b921586`               | 0.1.0         | Community install          | One line: `scripts/annotations-vibing.patch`    |
| Generative UI (`genui`)                           | [anh-chu/paseo-plugin-genui](https://github.com/anh-chu/paseo-plugin-genui) `f2ebfcf`                       | 0.2.1         | Community install          | Yes: `scripts/genui-vibing.patch`               |
| Quick Prompts (`paseo-quick-prompts`)             | [kingsleydon/paseo-plugins](https://github.com/kingsleydon/paseo-plugins) `plugins/quick-prompts` `ceb91be` | 0.2.0         | Community install          | Yes: `scripts/paseo-quick-prompts-vibing.patch` |
| Recap (`paseo-recap`)                             | [kingsleydon/paseo-plugins](https://github.com/kingsleydon/paseo-plugins) `plugins/recap` `ceb91be`         | 0.2.5         | Community install          | Small: `scripts/paseo-recap-vibing.patch`       |
| PDF and Office viewer (`paseo-doc-viewer`)        | [nkwib/paseo-doc-viewer](https://github.com/nkwib/paseo-doc-viewer) `0f39c81`                               | 0.7.0         | Community install          | No (npm dependencies inlined)                   |
| Shell Yeah (`shell-yeah`)                         | [stevecastaneda/paseo-plugins](https://github.com/stevecastaneda/paseo-plugins) `shell-yeah` `2f79b61`      | 1.3.0         | Community install          | No                                              |

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
  merges the steps between replies) and Mermaid are retired; do not restore them.

The pins live in `scripts/vendor-community-plugins.mjs`, which fetches each source, applies its
patch, inlines reviewed npm dependencies from the public registry, and writes the generated
bundles, manifest, licenses and an attribution README into `plugins/<id>/`. Never edit those
generated files by hand.

## Modifications

### Bots (`scripts/paseo-bots-vibing.patch`)

Bots is the agent interface of every embedded Vibing workspace, so most of the patch adapts it
to one worktree per frame and to the host's native chat.

- **Native chat slot.** `client/NativeChat.ts` and `ChatPane.tsx` accept an optional host-owned
  chat UI (`nativeChat`, `botWorkspace`, `workspaceBridge`, `sidebarFooter` props). Hosts without
  it keep the plugin's own chat UI.
- **Worktree-scoped chats.** In an embedded workspace, chat lists, overview counts and routine
  runs show only that workspace's chats (`client/data.ts`, panel sections), and new chats start
  there instead of the bot's folder. Chats carry a `paseo-bots.context` label so Live Design
  conversations stay separate from workspace ones while sharing bot configuration
  (`shared/chat.ts`). General also lists the workspace's pre-Bots conversations.
- **Delete and rename chats.** Rows get a Delete icon before the kebab (confirm, then
  permanent delete through the host handle's `delete()`); the chat menu leads with Rename
  (`rename()`, capped at Paseo's 200-character title limit). Removing the open chat selects the
  next chat in sidebar order, else the previous one (`shared/sidebar.ts`); only an emptied bot
  opens a new chat. Hosts without the handle methods report an error.
- **Import session.** A bot's new-chat draft offers Import session; imported or restored agents
  get the bot's labels and open once the bot lists them.
- **Team tabs.** With teams, the first tab is All bots (every bot, teams' included; it replaced
  Other bots), then one per team. Tabs remember their last opened chat per workspace and chat
  context (`client/teams/tabChats.ts`), fall back to the tab's most recently active chat, and
  carry the most urgent status of their chats as a badge (`tabStatus.ts`, `shared/groups.ts`).
- **Per-conversation runtime choice.** A chat's provider, model, mode and thinking choice is
  frozen for that conversation and passed to the chats it delegates to, without rewriting the
  bot's saved defaults (`botForChat`, `delegatedAgentSettings`, `server/chats.ts`).
- **`ask_bot` placement.** A chat working in another workspace (an embedded worktree) asks there
  too, in the same chat context, so the other bot's chat is listed beside it and its permission
  prompts can be answered (`server/tools/bots.ts`). Bots' own folders and routines keep the target
  bot's placement.
- **Sharing.** Export downloads the same portable JSON the import dialog accepts
  (`client/web.ts`), and the 50-bot/50-team caps on team export and import are removed.
- **Sidebar footer slot.** Host content (Vibing's Codex and AIS Switch usage cards) renders
  above the sidebar footer.

Tests: `tests/bots.test.ts`, `groups.test.ts`, `scheduler.test.ts`, `sidebar.test.ts`,
`presets.test.ts`, `sharing-*.test.ts(x)`, `chat-menu.test.ts` in the patched checkout.
`sharing-dialogs.test.tsx` needs jsdom, which the checkout does not install, so `vitest run`
reports two unhandled errors that are not failures.

### Codex usage (in place, `plugins/codex-usage-source/`)

Reports Codex Enterprise spending allowances in Usage, in the unit the API gives (dollars or
credits, never converted), with their reset time. The Bots sidebar card shows that allowance.
It is edited in place because upstream ships it in this repository; keep it on every rebase.

### AIS Switch usage and the theme (fork-owned)

`ais-switch-usage-source` reports the company gateway's shared monthly Claude/Codex allowance by
reading the installed macOS AIS Switch app's login, read-only (see its README).
`space-app-vibing-theme` supplies the Vibing palette that embedded Bots routes select.

### Chat Polish (`scripts/paseo-chat-polish-vibing.patch`)

`client/web/restyle-css.ts` adds `:root` fallbacks from Paseo's own colour variables, so embedded
frames without the sidebar that normally calls `setNativeColors` still get its colours, and keeps
its queued-message action icons and chat-outline preview styled after Paseo 0.14's markup.
Covered by `test/web.test.mjs`. Native `sharp` is not bundled, so thumbnails fall back to the
original image; the optional headless browser downloads only when a user enables page checks.

### Annotations (`scripts/annotations-vibing.patch`)

Always sends through Queue (`client/web.ts`) instead of reading the web send preference or
steering, matching Vibing's queue-first active-turn policy.

### Generative UI (`scripts/genui-vibing.patch`)

File cards use one press target and always open through the host's `openFile`, on web too, so
embedded workspace and Live Design chats open worktree files in Vibing's VS Code with their line
numbers, instead of an anchor that opens a Paseo file tab. Regressions:
`node --test scripts/genui-file-links.test.mjs`.

### Quick Prompts (`scripts/paseo-quick-prompts-vibing.patch`)

One menu by default that opens on desktop hover; pressing a row sends the prompt and Insert is
its only trailing action (this relies on the fork's plugin menu row `onPress`). Covered by
`client/pills.test.ts`.

### Recap (`scripts/paseo-recap-vibing.patch`)

The automatic Claude model is the CLI's `haiku` alias (`server/models.ts`), which honours
`ANTHROPIC_DEFAULT_HAIKU_MODEL`. The company gateway maps Haiku to an older model and rejects the
newest Haiku's reasoning-effort setting, so the full model ID would fail.

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
