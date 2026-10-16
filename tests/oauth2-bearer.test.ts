import { describe, expect, test } from 'bun:test';
import {
  clientCredentialsOf, clientCredentialsScopes, commandsScopeOk, oauthError, parseBasicAuth, parseBearer, parseScopeParam,
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
  test('client_credentials cannot install bots, join guilds or create webhooks', () => {
    expect(clientCredentialsScopes(['identify', 'applications.commands.update'], VALID)).toEqual({ ok: true, scopes: ['identify', 'applications.commands.update'] });
    expect(clientCredentialsScopes(['bot'], VALID)).toEqual({ ok: false, scope: 'bot' });
    expect(clientCredentialsScopes(['guilds.join'], VALID)).toEqual({ ok: false, scope: 'guilds.join' });
    expect(clientCredentialsScopes(['webhook.incoming'], VALID)).toEqual({ ok: false, scope: 'webhook.incoming' });
    expect(clientCredentialsScopes(['made.up'], VALID)).toEqual({ ok: false, scope: 'made.up' });
  });
  test('command routes need applications.commands.update (permissions: .permissions.update)', () => {
    expect(commandsScopeOk(['applications.commands.update'], 'write')).toBe(true);
    expect(commandsScopeOk(['applications.commands'], 'write')).toBe(false);
    expect(commandsScopeOk(['applications.commands.update'], 'permissions')).toBe(false);
    expect(commandsScopeOk(['applications.commands.permissions.update'], 'permissions')).toBe(true);
  });
  test('oauthError shape', () => {
    expect(oauthError('invalid_grant', 'x')).toEqual({ error: 'invalid_grant', error_description: 'x' });
    expect(oauthError('invalid_client')).toEqual({ error: 'invalid_client' });
  });
});
