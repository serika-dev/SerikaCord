/**
 * Seed the bot-compat stack through the running harness (serve.ts): two human
 * users, a server (real POST /api/servers: @everyone, categories, #general,
 * voice), a forum channel, a role, an application with a bot (snowflake ids,
 * MESSAGE_CONTENT + GUILD_MEMBERS enabled) installed with the real OAuth2
 * authorize route. Writes tokens and ids to scripts/bot-compat/.seed.json
 * (git-ignored). Local stack only (see guard.ts).
 *
 *   bun --no-env-file --env-file=scripts/bot-compat/.env.test scripts/bot-compat/seed.ts
 */
import { assertLocalStack } from './guard';

assertLocalStack();

const { writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const jose = await import('jose');
const { User } = await import('../../src/lib/models');
const { connectDB } = await import('../../src/lib/db');

const BASE = `http://127.0.0.1:${process.env.PORT || 58080}`;
await connectDB();

async function human(username: string) {
  const existing = await User.findOne({ username });
  if (existing) return existing;
  return User.create({ username, displayName: username[0].toUpperCase() + username.slice(1), email: `${username}@bot-compat.test`, isVerified: true });
}

async function tokenFor(userId: string) {
  return new jose.SignJWT({ sub: userId, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

async function call<T = Record<string, unknown>>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const alice = await human('alice');
const bob = await human('bob');
const aliceToken = await tokenFor(alice.id);
const bobToken = await tokenFor(bob.id);

type Ch = { id: string; name: string; type: string };
const created = await call<{ server: { id: string; channels: Ch[]; roles: Array<{ id: string }> } }>(aliceToken, 'POST', '/api/servers', { name: 'Bot Compat' });
const server = created.server;
const general = server.channels.find((c) => c.type === 'text')!;

// A forum and a role, so GUILD_CREATE carries more than the defaults.
let forumId: string | null = null;
try {
  const forum = await call<{ channel?: { id: string }; id?: string }>(aliceToken, 'POST', `/api/servers/${server.id}/channels`, { name: 'forum', type: 'forum' });
  forumId = forum.channel?.id ?? forum.id ?? null;
} catch (err) { console.warn('seed: forum channel:', (err as Error).message); }
try {
  await call(aliceToken, 'POST', `/api/servers/${server.id}/roles`, { name: 'Testers', color: '#3498db', permissions: '0' });
} catch (err) { console.warn('seed: role:', (err as Error).message); }

// Bob joins through an invite.
try {
  const inv = await call<{ invite?: { code: string }; code?: string }>(aliceToken, 'POST', `/api/servers/${server.id}/invites`, { channelId: general.id });
  const code = inv.invite?.code ?? inv.code;
  if (code) await call(bobToken, 'POST', `/api/invites/${code}`, {});
} catch (err) { console.warn('seed: bob join:', (err as Error).message); }

// Application + bot (new apps default to snowflake ids).
const appRes = await call<{ application: { id: string; clientId: string; apiIdFormat: string } }>(aliceToken, 'POST', '/api/developers/applications', { name: 'CompatBot' });
const app = appRes.application;
const botRes = await call<{ application: { botToken: string; botId: string } }>(aliceToken, 'POST', `/api/developers/applications/${app.id}/bot`);
await call(aliceToken, 'PATCH', `/api/developers/applications/${app.id}`, { gatewayIntents: (1 << 1) | (1 << 15) });
await call(aliceToken, 'POST', '/api/oauth2/authorize', { client_id: app.clientId, serverId: server.id, scopes: ['bot', 'applications.commands'], permissions: '8' });

const out = {
  base: BASE,
  api: `${BASE}/api`,
  gateway: process.env.GATEWAY_URL,
  app: { id: app.id, clientId: app.clientId, apiIdFormat: app.apiIdFormat },
  botToken: botRes.application.botToken,
  botUserId: botRes.application.botId,
  serverId: server.id,
  generalChannelId: general.id,
  forumChannelId: forumId,
  users: { alice: { id: alice.id, token: aliceToken }, bob: { id: bob.id, token: bobToken } },
};
writeFileSync(join(import.meta.dir, '.seed.json'), JSON.stringify(out, null, 2));
console.log(`seed: ok (server ${server.id}, #general ${general.id}, app ${app.id} format=${app.apiIdFormat})`);
console.log(`seed: wrote ${join(import.meta.dir, '.seed.json')}`);
process.exit(0);
