# Beautiful Chat

Bundled from [ABorakati/beautiful-chat](https://github.com/ABorakati/beautiful-chat)
at `42b61d8301b5400a67821bbbfcf99fa8b681dc37` (version 0.1.0, MIT).

Regenerate from the Paseo repository root:

```sh
node scripts/vendor-beautiful-chat.mjs
```

The generated client and server include upstream code and its locked production
dependencies. Paseo's SDK, React, React Native and Zod stay host-provided. Startup
requires no npm install or network access. Keep the upstream license and generated
dependency notices with the bundle.

`INTER-OFL.txt` and `IOSEVKA-OFL.txt` retain the licenses for upstream's embedded
font subsets, from the Inter and Iosevka projects respectively. Keep them when
regenerating; the vendoring script only replaces generated code and npm notices.

`scripts/beautiful-chat-vibing.patch` keeps native user and assistant rendering as
the default to preserve context attachments, citation handling and native Find.
Saved Chat presentation preferences still win. Interactive Shell cards carrying
stdin stay native. The host timeline projection separately preserves messages
with attachments or images even if enhanced user bubbles are enabled.

Beautiful Chat yields Mermaid fences and Bots/Composio tools to their specialized
renderers, including when enhanced user or assistant messages are enabled.
