---
description: Read-only check of the latest Coolify deployment of the canary app
allowed-tools: Bash(curl:*)
---

Report the state of the latest SerikaCord canary deployment on Coolify.
Read-only: only `GET` requests. Never call deploy, restart, stop or any
endpoint that changes state, and never print the token.

Requires environment variables:
- `COOLIFY_URL`: Coolify base URL, for example `https://coolify.example.com`
- `COOLIFY_TOKEN`: API token (Bearer)
- `COOLIFY_APP_UUID` (optional): the canary application's UUID

If `COOLIFY_URL` or `COOLIFY_TOKEN` is missing, say so and stop.

Steps (Coolify v4 API):

1. If `COOLIFY_APP_UUID` is unset, list applications and pick the canary app
   (name or git branch `canary`):
   `curl -fsS -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/applications"`
   Show only `uuid`, `name`, `git_branch`, `status` for each.
2. Application status:
   `curl -fsS -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/applications/$COOLIFY_APP_UUID"`
3. Recent deployments for that application:
   `curl -fsS -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/deployments/applications/$COOLIFY_APP_UUID?skip=0&take=5"`
4. For the newest deployment, fetch its details (status and log tail):
   `curl -fsS -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/deployments/<deployment_uuid>"`

Report: app status, newest deployment status, commit SHA and message,
start/finish time, and, if it failed, the last ~30 relevant log lines (build
errors from `next build`, `tsc`, missing env). Compare the deployed commit
with `git rev-parse canary` if useful. $ARGUMENTS may name a different
application UUID.
