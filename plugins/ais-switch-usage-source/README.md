# AIS Switch usage

Show the shared AIS monthly AQP allowance in Paseo Usage and the Bots sidebar alongside Codex.
Uses the existing AIS Switch login; no separate sign-in or credential copying is required.

The macOS adapter reads `~/.ais-switch/google_oauth_auth.<sha256(origin)>.enc` without
writing to AIS Switch's files. AIS Switch 0.2.10 uses a versioned AES-GCM envelope,
origin-bound additional data and a key embedded in its executable. Read that key
from the installed app in memory rather than copying it into this repository.
Missing/changed formats fail closed; sign-in and refresh remain owned by AIS Switch.
Discovery is global because this is an account-wide allowance shared by Claude and Codex.

The verified request is `POST https://compass.llm.shopee.io/compass-api/v1/cqp/ccswitch/monthly_usage`,
with the saved `CQP_SESSION` cookie, `X-CQP-Auth: 1`, and a JSON body containing
`project_id`, `selected_year`, and `selected_month`. The response's `total_amount`,
`usage`, and `balance` are USD. Preserve those reported amounts; do not estimate
cost from local requests. The service does not supply a reset timestamp.

Implementation uses native usage-source registration and existing sidebar card styles,
Node filesystem/crypto/HTTPS APIs, strict Zod input/response schemas, and no new dependencies.
Credentials and keys remain on the daemon, never in usage account inputs, reports or logs.
Requests stay on the fixed gateway origin and do not follow redirects. Use system CA
certificates for the corporate gateway without disabling TLS verification.

Files: `server/credentials.ts` owns the disk format; `server/usage.ts` owns discovery
and requests; colocated tests use temporary encrypted fixtures and fake HTTP responses.
Missing/expired/replaced logins, corrupt files, HTTP failures, malformed/zero quota,
credential rotation and sidebar coexistence must be covered.

Verify from the repository root:

```sh
npm run test --workspace=@getpaseo/builtin-plugins -- ais-switch-usage-source/server/usage.test.ts
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run test --workspace=@getpaseo/app -- src/patches/vibing/bot-usage.test.ts src/patches/vibing/bot-usage-card.test.tsx
```

Always reread the login before fetching; never write, refresh, or expose it. Validate
the live response and both cards in an isolated bundle before updating the consumer.
