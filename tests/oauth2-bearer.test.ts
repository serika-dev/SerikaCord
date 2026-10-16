import { describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import {
  clientCredentialsOf, clientCredentialsScopes, commandsGrantOk, oauthError, parseBasicAuth, parseBearer, parseScopeParam,
  parsePkceChallenge, pkceVerifierOk, userGrantScopes,
} from '../src/lib/oauth/scopes';

const VALID = new Set(['identify', 'email', 'guilds', 'guilds.join', 'connections', 'bot', 'applications.commands', 'applications.commands.update', 'webhook.incoming']);

describe('parseBearer', () => {
  test('accepts a Bearer token', () => {
    expect(parseBearer('Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe('abcdefghijklmnopqrstuvwxyz0123');
    expect(parseBearer('bearer abcdefghijklmnopqrstuvwxyz0123')).toBe('abcdefghijklmnopqrstuvwxyz0123');
  });
  test('rejects bot tokens, short tokens and junk', () => {
    expect(parseBearer('Bot abcdefghijklmnopqrstuvwxyz0123')).toBeNull();
    expect(parseBearer('Bearer short')).toBeNull();
    expect(parseBearer('Bearer abc def ghi jkl mno pqr stu')).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('abcdefghijklmnopqrstuvwxyz0123')).toBeNull();
  });
});

describe('client authentication', () => {
  test('HTTP Basic is decoded (form-urlencoded parts)', () => {
    const header = `Basic ${Buffer.from('123:s%3Acret').toString('base64')}`;
    expect(parseBasicAuth(header)).toEqual({ clientId: '123', clientSecret: 's:cret' });
  });
  test('Basic wins over the body; body works alone', () => {
    const header = `Basic ${Buffer.from('a:b').toString('base64')}`;
    expect(clientCredentialsOf({ client_id: 'x', client_secret: 'y' }, header)).toEqual({ clientId: 'a', clientSecret: 'b' });
    expect(clientCredentialsOf({ client_id: 'x', client_secret: 'y' }, null)).toEqual({ clientId: 'x', clientSecret: 'y' });
  });
  test('missing or malformed credentials', () => {
    expect(clientCredentialsOf({ client_id: 'x' }, null)).toBeNull();
    expect(clientCredentialsOf({}, 'Basic !!!')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeNull();
  });
});

describe('scopes', () => {
  test('parseScopeParam splits, dedupes and drops junk', () => {
    expect(parseScopeParam('identify guilds  identify')).toEqual(['identify', 'guilds']);
    expect(parseScopeParam('identify+email')).toEqual(['identify', 'email']);
    expect(parseScopeParam('bad<scope> identify')).toEqual(['identify']);
    expect(parseScopeParam(undefined)).toEqual([]);
  });
  test('client_credentials: commands + public profile only', () => {
    expect(clientCredentialsScopes(['identify', 'applications.commands.update'], VALID)).toEqual({ ok: true, scopes: ['identify', 'applications.commands.update'] });
    expect(clientCredentialsScopes(['bot'], VALID)).toEqual({ ok: false, scope: 'bot' });
    expect(clientCredentialsScopes(['guilds.join'], VALID)).toEqual({ ok: false, scope: 'guilds.join' });
    expect(clientCredentialsScopes(['webhook.incoming'], VALID)).toEqual({ ok: false, scope: 'webhook.incoming' });
    expect(clientCredentialsScopes(['made.up'], VALID)).toEqual({ ok: false, scope: 'made.up' });
    // Allowlist: never the owner's private data.
    expect(clientCredentialsScopes(['email'], VALID)).toEqual({ ok: false, scope: 'email' });
    expect(clientCredentialsScopes(['identify', 'guilds'], VALID)).toEqual({ ok: false, scope: 'guilds' });
    expect(clientCredentialsScopes(['connections'], VALID)).toEqual({ ok: false, scope: 'connections' });
  });
  test('command management is client_credentials-only (regression: user consent could edit any app)', () => {
    const cc = { grantType: 'client_credentials', scopes: ['applications.commands.update'] };
    expect(commandsGrantOk(cc, 'write')).toBe(true);
    expect(commandsGrantOk(cc, 'read')).toBe(true);
    for (const grantType of ['authorization_code', 'implicit', 'refresh_token']) {
      expect(commandsGrantOk({ grantType, scopes: ['applications.commands.update'] }, 'write')).toBe(false);
      expect(commandsGrantOk({ grantType, scopes: ['applications.commands.update'] }, 'read')).toBe(false);
    }
    expect(commandsGrantOk({ grantType: 'client_credentials', scopes: ['applications.commands'] }, 'write')).toBe(false);
    // Permissions stay user-granted (the route checks MANAGE_GUILD + MANAGE_ROLES).
    expect(commandsGrantOk({ grantType: 'authorization_code', scopes: ['applications.commands.permissions.update'] }, 'permissions')).toBe(true);
    expect(commandsGrantOk({ grantType: 'authorization_code', scopes: ['applications.commands.update'] }, 'permissions')).toBe(false);
  });
  test('user-consented grants never get client_credentials-only scopes', () => {
    expect(userGrantScopes(['identify', 'applications.commands.update'])).toEqual({ ok: false, scope: 'applications.commands.update' });
    expect(userGrantScopes(['bot', 'identify', 'webhook.incoming', 'applications.commands'])).toEqual({ ok: true, scopes: ['identify', 'applications.commands'] });
    expect(userGrantScopes(['applications.commands', 'applications.commands.permissions.update'])).toEqual({ ok: true, scopes: ['applications.commands', 'applications.commands.permissions.update'] });
  });
  test('PKCE: S256 only, verifier must match', () => {
    const verifier = 'a'.repeat(43) + 'B-._~xyz';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(parsePkceChallenge(undefined, undefined)).toEqual({ ok: true, challenge: null });
    expect(parsePkceChallenge(challenge, 'S256')).toEqual({ ok: true, challenge });
    expect(parsePkceChallenge(challenge, 'plain').ok).toBe(false);
    expect(parsePkceChallenge(challenge, undefined).ok).toBe(false); // default method is plain
    expect(parsePkceChallenge(undefined, 'S256').ok).toBe(false);
    expect(parsePkceChallenge('short', 'S256').ok).toBe(false);
    expect(pkceVerifierOk(verifier, challenge)).toBe(true);
    expect(pkceVerifierOk(verifier + 'x', challenge)).toBe(false);
    expect(pkceVerifierOk(undefined, challenge)).toBe(false);
    expect(pkceVerifierOk('tooshort', challenge)).toBe(false);
  });
  test('oauthError shape', () => {
    expect(oauthError('invalid_grant', 'x')).toEqual({ error: 'invalid_grant', error_description: 'x' });
    expect(oauthError('invalid_client')).toEqual({ error: 'invalid_client' });
  });
});
