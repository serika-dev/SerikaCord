---
description: Checklist for adding a new Elysia API route
---

Add the API route described in $ARGUMENTS, following
`docs/architecture/api.md`. Work through this checklist and confirm each item
in your final report:

1. **Placement**: the module that owns the resource (`src/lib/api/*.ts`);
   new route groups get `.onBeforeHandle(rejectInvalidObjectIdParams)` or
   validate UUID params with `isValidObjectId`.
2. **Auth**: `getAuth(headers, cookie)` (users), `authenticateBot` (bot API,
   `/api/v10`), `getAdminAuth` (staff). Return 401 `{ error }` early.
3. **Access check**: `checkChannelAccess(user.id, channelId)` for anything in
   a channel or DM; `canManageServer` / `canManageRoles` /
   `canModerateMembers` / `canManageMessagesInServer` ... for server actions;
   ownership for user/app resources. 403 `{ error }` on failure. Never trust
   ids or flags from the body.
4. **Validation**: `body: t.Object({...})` / `query: t.Object({...})`, length
   and count caps, `sanitizeInput` for stored text, `validateMessageContent`
   for messages.
5. **Rate limit**: `checkRateLimit('<limiter>', key)` for writes; add a new
   entry to `rateLimiters_config` if none fits. Return 429 with `retryAfter`.
6. **Models**: every `find` / `findOne` key must be a `case` in that model's
   switch (unknown keys are silently ignored). Add cases as needed.
7. **Schema**: if you need a column or table, update `schema.ts` and add an
   idempotent `drizzle/manual_*.sql`; tell the owner to apply it.
8. **Realtime**: publish live changes with `publishToChannel` /
   `publishToDm` / `emitDmListUpdate` / `fanoutToUsers`; handle the new event
   `type` in `useChatSession` (or the relevant client). Any new registry uses
   `processShared`.
9. **Message signals**: if the route creates a message outside the normal
   user send routes (bot, webhook, interaction, system), call
   `signalChannelMessage` / `signalDmMessage` from
   `src/lib/services/messageSignals.ts`, and `emitMessageCreate` for bots.
10. **Response**: no secrets or private fields; errors as `{ error }` (bot API:
    Discord `{ code, message }`). Redirects return a raw `Response` with
    `Location`.
11. **Client**: call it from the right context/hook; startup fetches go in
    `BootPrefetch` + `sharedGet`; strings via `gt()`.
12. **Docs**: public bot/developer endpoints documented in
    `src/app/developers/docs`.
13. **Verify**: `npx tsc --noEmit -p tsconfig.json`, `npx eslint <files>`,
    `bun run test` (add tests for pure helpers), then a `## Unreleased`
    changelog bullet if users will notice.
