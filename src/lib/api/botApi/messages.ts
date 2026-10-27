// Discord v10 bot routes: channels, messages, threads, pins and webhooks.
// Mounted at the end of botApiRoutes (src/lib/api/botApi.ts), so the id
// boundary, per-bot rate limits and the guild/channel access guard registered
// there run for every route here too. Same conventions as botApi.ts.
import { Elysia } from 'elysia';

export const messagesBotRoutes = new Elysia();
