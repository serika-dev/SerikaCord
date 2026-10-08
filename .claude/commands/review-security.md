---
description: Security review of the current diff against SerikaCord's rules
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)
---

Review the diff for security problems. Target: $ARGUMENTS (a commit range,
branch or path); if empty, review `git diff HEAD` plus untracked files from
`git status`.

Read `docs/architecture/security.md` and `docs/architecture/api.md` first.
For each changed route, handler, model or component, check:

1. **Authentication**: every new or changed `/api` route calls `getAuth` /
   `authenticateBot` / `getAdminAuth` (or checks the service key) and returns
   401 before doing work.
2. **Authorization**: every id from params or body is checked for the caller:
   `checkChannelAccess` for channels and messages, the `can*` helpers or role
   bits for server actions, recipient checks for DMs, ownership for user and
   app resources. Message ids must belong to the channel in the path. Bot
   routes keep `:guildId` / `:channelId` / `:messageId` in the path so the bot
   guard applies.
3. **Model whitelist**: open the model for every `find` / `findOne` call in the
   diff and confirm each filter key is a `case` in its switch. An unknown key
   is silently ignored and can turn a token or ownership check into "any
   row".
4. **Validation**: `t.Object` schemas, length and count caps, UUID params
   validated, `sanitizeInput` for stored text.
5. **Rate limits** on writes and expensive reads (`checkRateLimit`).
6. **XSS**: no user content in `dangerouslySetInnerHTML`, inline scripts, or
   `href`/`src` without a scheme allowlist; markdown changes keep the safe
   scheme check.
7. **SSRF**: server-side fetches of user URLs block private/loopback/link-local
   addresses, re-check redirects, use timeouts and byte caps.
8. **Data exposure**: responses and logs don't include tokens, password
   hashes, private keys, emails of other users, or decrypted content the
   caller can't see. Realtime fan-out (`publishToChannel`, `fanoutToUsers`,
   `notifyChannelActivity`) reaches only users who can see the channel.
9. **Secrets** are not committed (`.env`, keys in code or docs).
10. **Schema** changes are additive and idempotent.

Output findings ordered by severity (critical, high, medium, low), each with
file:line, the concrete failure scenario (who can do what), and a suggested
fix. Say explicitly if nothing was found. Don't edit files unless asked.
