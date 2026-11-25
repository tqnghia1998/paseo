# Reply follow-ups

Install this directory as a local Paseo plugin, then start a new chat to try it.
An already-open provider session may not pick up the new instructions until it
reopens.

Suggestions are optional and come from the chat's existing model reply. There
is no separate provider request. In Vibing's Paseo build, the trailing Markdown
section is hidden from rendered replies while this plugin is enabled, so
suggestions appear only as clickable chips below each reply. Clicking a chip
sends that prompt directly without disabling the remaining chips.

Codex needs CLI 0.121.0 or newer to receive the suggestion instructions. On
older or unverified Codex installations, chats still open without those
instructions.

Vibing bundles this plugin as an ordinary addon. Disable it in Settings > Plugins.
