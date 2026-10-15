# bot-compat: run real Discord libraries against a local SerikaCord

A throwaway stack for checking Discord API parity with unmodified libraries
(discord.js, discord.py) without touching production data. See section 6.1 of
`docs/architecture/discord-parity.md`.

- `stack.sh up|down`: Postgres 17 (`127.0.0.1:55432`, tmpfs) and Redis 7
  (`127.0.0.1:56379`) in docker. `down` removes only these two containers.
- `schema.ts`: builds the schema offline from `src/lib/db/schema.ts`
  (drizzle-kit/api, no `drizzle-kit push`) and applies `drizzle/manual_*.sql`.
- `serve.ts`: the harness. Elysia API (`/api/*`) and the bot gateway
  (`/api/v10/gateway`) in one Bun process, no Next.js (~300 MB RSS).
- `seed.ts`: two users (alice, bob), a server, a forum, a role and a
  snowflake-format application whose bot is installed through the real OAuth2
  route. Writes ids and tokens to `.seed.json` (git-ignored).
- `guard.ts`: every script aborts unless Postgres/Redis are the local
  containers and every external-service secret is unset. URLs of real
  services (accounts, serika.moe, ...) are forced to a dead local port.

## Run

```bash
cp scripts/bot-compat/env.test.example scripts/bot-compat/.env.test   # once
scripts/bot-compat/stack.sh up
ENV="--no-env-file --env-file=scripts/bot-compat/.env.test"
bun $ENV scripts/bot-compat/schema.ts
bun $ENV scripts/bot-compat/serve.ts &          # GATEWAY_DEBUG=1 for gateway logs
bun $ENV scripts/bot-compat/seed.ts             # run once per fresh database
```

`--no-env-file` keeps Bun from loading the repo `.env` (production). The guard
refuses to start if it were loaded anyway.

## Smoke clients

Keep them outside the repo:

```bash
mkdir -p /tmp/bot-smoke && cd /tmp/bot-smoke
npm init -y && npm i discord.js@14
python3 -m venv venv && ./venv/bin/pip install "discord.py>=2.4,<3"
```

Point them at the harness with the values in `.seed.json`:

- discord.js: `new Client({ intents, rest: { api: seed.api } })`. The gateway
  URL comes from `GET /gateway/bot`.
- discord.py: set `discord.http.Route.BASE = seed.api + '/v10'` **and**
  `discord.gateway.DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL(seed.gateway)`.
  Unsharded discord.py never calls `/gateway/bot`; without the second line it
  connects to Discord's real gateway with your token.

To make the bot receive a message, post one as the seeded human:

```bash
curl -X POST "$API/channels/$CHANNEL/messages" -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'content-type: application/json' -d '{"content":"ping"}'
```

## Stop

```bash
kill %1                      # the harness (sends op 7 RECONNECT to bots first)
scripts/bot-compat/stack.sh down
```
