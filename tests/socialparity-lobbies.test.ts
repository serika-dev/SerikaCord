import { describe, expect, test } from 'bun:test';
import {
  LOBBY_LIMITS, hashLobbySecret, isLobbyExpired, linkedChannelForwardText, parseBulkMembers, parseCreateLobby, parseCreateOrJoin,
  parseLobbyMessage, parseMemberUpsert, parseMessageLimit, parseModerationMetadata, parseModifyLobby, toDiscordLobby,
  toDiscordLobbyMember, toDiscordLobbyMessage,
} from '../src/lib/botapi/lobbies';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

function errorsOf(r: { ok: boolean } & ({ ok: true } | { ok: false; errors: { toBody(): { errors: unknown } } })) {
  return r.ok ? null : (r as { errors: { toBody(): { errors: unknown } } }).errors.toBody().errors as Record<string, unknown>;
}

describe('create lobby', () => {
  test('accepts metadata, members and idle timeout', () => {
    const r = parseCreateLobby({ metadata: { topic: 'redstone' }, members: [{ id: U1, flags: 1, additional_name: ' Twindly ' }], idle_timeout_seconds: 600 });
    expect(r.ok).toBeTrue();
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ topic: 'redstone' });
    expect(r.value.members).toEqual([{ id: U1, flags: 1, additionalName: 'Twindly' }]);
    expect(r.value.idleTimeoutSeconds).toBe(600);
  });
  test('empty body is fine (defaults applied by storage)', () => {
    const r = parseCreateLobby(undefined);
    expect(r.ok).toBeTrue();
    if (r.ok) expect(r.value).toEqual({ metadata: undefined, members: [], idleTimeoutSeconds: undefined, flags: undefined });
  });
  test('idle timeout bounds 5..604800', () => {
    expect(parseCreateLobby({ idle_timeout_seconds: 4 }).ok).toBeFalse();
    expect(parseCreateLobby({ idle_timeout_seconds: 604801 }).ok).toBeFalse();
    expect(parseCreateLobby({ idle_timeout_seconds: 5 }).ok).toBeTrue();
    expect(parseCreateLobby({ idle_timeout_seconds: 604800 }).ok).toBeTrue();
    expect(parseCreateLobby({ idle_timeout_seconds: 1.5 }).ok).toBeFalse();
  });
  test('metadata over 1000 characters (keys + values) is rejected', () => {
    const ok = parseCreateLobby({ metadata: { k: 'x'.repeat(999) } });
    expect(ok.ok).toBeTrue();
    const bad = parseCreateLobby({ metadata: { k: 'x'.repeat(1000) } });
    expect(errorsOf(bad)).toHaveProperty('metadata');
  });
  test('metadata must be a string dictionary', () => {
    expect(errorsOf(parseCreateLobby({ metadata: ['a'] }))).toHaveProperty('metadata');
    expect(errorsOf(parseCreateLobby({ metadata: { a: 1 } }))).toHaveProperty('metadata');
    const nulled = parseCreateLobby({ metadata: null });
    expect(nulled.ok && nulled.value.metadata).toBeNull();
  });
  test('at most 25 members, no duplicates, ids required', () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ id: `${i}` }));
    expect(errorsOf(parseCreateLobby({ members: many }))).toHaveProperty('members');
    expect(errorsOf(parseCreateLobby({ members: [{ id: U1 }, { id: U1.toUpperCase() }] }))).toHaveProperty('members');
    expect(errorsOf(parseCreateLobby({ members: [{}] }))).toHaveProperty('members');
  });
  test('member flags only allow CanLinkLobby; additional_name 1-80', () => {
    expect(parseCreateLobby({ members: [{ id: U1, flags: 2 }] }).ok).toBeFalse();
    expect(parseCreateLobby({ members: [{ id: U1, additional_name: 'x'.repeat(81) }] }).ok).toBeFalse();
    expect(parseCreateLobby({ members: [{ id: U1, additional_name: '   ' }] }).ok).toBeFalse();
  });
  test('unknown (untranslated) ids are kept for an Unknown User answer', () => {
    const r = parseCreateLobby({ members: [{ id: '123456789012345678' }] });
    expect(r.ok && r.value.members[0].id).toBe('123456789012345678');
  });
  test('only flags 0 are accepted on the lobby itself', () => {
    expect(parseCreateLobby({ flags: 0 }).ok).toBeTrue();
    expect(parseCreateLobby({ flags: 1 }).ok).toBeFalse();
  });
});

describe('modify / create-or-join / member upsert / bulk', () => {
  test('modify: members absent = keep, null = clear all', () => {
    const keep = parseModifyLobby({ metadata: { a: 'b' } });
    expect(keep.ok && keep.value.members).toBeUndefined();
    const clear = parseModifyLobby({ members: null });
    expect(clear.ok && clear.value.members).toEqual([]);
  });
  test('create or join needs a secret of at most 250 characters', () => {
    expect(errorsOf(parseCreateOrJoin({}))).toHaveProperty('secret');
    expect(errorsOf(parseCreateOrJoin({ secret: 'x'.repeat(251) }))).toHaveProperty('secret');
    const r = parseCreateOrJoin({ secret: 's3cret', lobby_metadata: { map: 'de_dust' }, member_metadata: { team: 'red' } });
    expect(r.ok).toBeTrue();
    if (r.ok) {
      expect(r.value.lobbyMetadata).toEqual({ map: 'de_dust' });
      expect(r.value.memberMetadata).toEqual({ team: 'red' });
    }
  });
  test('member upsert: omit additional_name keeps it, null clears it', () => {
    const omit = parseMemberUpsert({ metadata: { a: 'b' } });
    expect(omit.ok && 'additionalName' in omit.value).toBeFalse();
    const clear = parseMemberUpsert({ additional_name: null });
    expect(clear.ok && clear.value.additionalName).toBeNull();
  });
  test('bulk: 1-25 entries and remove_member must be boolean', () => {
    expect(parseBulkMembers([]).ok).toBeFalse();
    expect(parseBulkMembers({}).ok).toBeFalse();
    expect(parseBulkMembers([{ id: U1, remove_member: 'yes' }]).ok).toBeFalse();
    const r = parseBulkMembers([{ id: U1, remove_member: true }, { id: U2, metadata: { a: 'b' } }]);
    expect(r.ok && r.value).toEqual([{ id: U1, remove: true }, { id: U2, metadata: { a: 'b' } }]);
  });
});

describe('lobby messages', () => {
  test('content is required, non-blank, at most 2000 characters', () => {
    expect(errorsOf(parseLobbyMessage({}))).toHaveProperty('content');
    expect(errorsOf(parseLobbyMessage({ content: '   ' }))).toHaveProperty('content');
    expect(errorsOf(parseLobbyMessage({ content: 'x'.repeat(2001) }))).toHaveProperty('content');
    expect(parseLobbyMessage({ content: 'gg' }).ok).toBeTrue();
  });
  test('only SDK-creatable flags (SUPPRESS_NOTIFICATIONS)', () => {
    expect(parseLobbyMessage({ content: 'a', flags: 1 << 12 }).ok).toBeTrue();
    expect(parseLobbyMessage({ content: 'a', flags: 1 << 6 }).ok).toBeFalse();
  });
  test('nonce rules and enforce_nonce', () => {
    const r = parseLobbyMessage({ content: 'a', nonce: 'n-1', enforce_nonce: true });
    expect(r.ok && [r.value.nonce, r.value.enforceNonce]).toEqual(['n-1', true]);
    expect(parseLobbyMessage({ content: 'a', nonce: 'x'.repeat(26) }).ok).toBeFalse();
    expect(parseLobbyMessage({ content: 'a', enforce_nonce: 'yes' }).ok).toBeFalse();
    const plain = parseLobbyMessage({ content: 'a' });
    expect(plain.ok && [plain.value.nonce, plain.value.enforceNonce]).toEqual([null, false]);
  });
  test('rich message fields are rejected, allowed_mentions accepted', () => {
    expect(errorsOf(parseLobbyMessage({ content: 'a', embeds: [{ title: 't' }] }))).toHaveProperty('embeds');
    expect(errorsOf(parseLobbyMessage({ content: 'a', tts: true }))).toHaveProperty('tts');
    expect(parseLobbyMessage({ content: 'a', embeds: [], tts: false, allowed_mentions: { parse: [] } }).ok).toBeTrue();
  });
  test('limit 1-200, default 50', () => {
    expect(parseMessageLimit(undefined)).toEqual({ ok: true, value: 50 });
    expect(parseMessageLimit('200')).toEqual({ ok: true, value: 200 });
    expect(parseMessageLimit('0').ok).toBeFalse();
    expect(parseMessageLimit('201').ok).toBeFalse();
    expect(parseMessageLimit('abc').ok).toBeFalse();
  });
  test('moderation metadata: at most 5 keys, key <= 1024, value <= 2000', () => {
    expect(parseModerationMetadata({ a: '1', b: '2', c: '3', d: '4', e: '5' }).ok).toBeTrue();
    expect(parseModerationMetadata({ a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' }).ok).toBeFalse();
    expect(parseModerationMetadata({ ['k'.repeat(1025)]: 'v' }).ok).toBeFalse();
    expect(parseModerationMetadata({ k: 'v'.repeat(2001) }).ok).toBeFalse();
    expect(parseModerationMetadata({ k: 1 }).ok).toBeFalse();
    expect(parseModerationMetadata([]).ok).toBeFalse();
  });
  test('forward text defuses mass mentions and escapes the name', () => {
    const t = linkedChannelForwardText('*Bob*', 'hi @everyone and @here');
    expect(t).toBe('**\\*Bob\\***: hi @​everyone and @​here');
    expect(linkedChannelForwardText('A', 'x'.repeat(3000)).length).toBe(2000);
  });
});

describe('secrets and idle expiry', () => {
  test('secret hashes are per application', () => {
    expect(hashLobbySecret(U1, 's')).toBe(hashLobbySecret(U1.toUpperCase(), 's'));
    expect(hashLobbySecret(U1, 's')).not.toBe(hashLobbySecret(U2, 's'));
    expect(hashLobbySecret(U1, 's')).not.toBe(hashLobbySecret(U1, 't'));
  });
  test('a lobby expires after idle_timeout_seconds without activity', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    const last = new Date(now - 301_000);
    expect(isLobbyExpired({ id: U1, applicationId: U2, idleTimeoutSeconds: 300, lastActivityAt: last }, now)).toBeTrue();
    expect(isLobbyExpired({ id: U1, applicationId: U2, idleTimeoutSeconds: 600, lastActivityAt: last }, now)).toBeFalse();
    expect(isLobbyExpired({ id: U1, applicationId: U2, idleTimeoutSeconds: null, lastActivityAt: last }, now)).toBeTrue();
  });
  test('limits match Discord', () => {
    expect(LOBBY_LIMITS.maxMembers).toBe(1000);
    expect(LOBBY_LIMITS.lobbiesPerUserPerApp).toBe(100);
    expect(LOBBY_LIMITS.idleDefaultSeconds).toBe(300);
  });
});

describe('serializers', () => {
  test('lobby object', () => {
    const lobby = toDiscordLobby(
      { id: U1, applicationId: U2, metadata: { topic: 'we need more redstone' }, flags: 0 },
      [{ userId: U2, metadata: null, flags: 1, additionalName: 'Twindly Shimmerleaf' }],
    );
    expect(lobby).toEqual({
      id: U1,
      application_id: U2,
      metadata: { topic: 'we need more redstone' },
      members: [{ id: U2, metadata: null, flags: 1, additional_name: 'Twindly Shimmerleaf' }],
      flags: 0,
    });
    expect(toDiscordLobby({ id: U1, applicationId: U2 }, [], { id: 'c', type: 0 })).toHaveProperty('linked_channel');
  });
  test('member without additional_name omits it', () => {
    expect(toDiscordLobbyMember({ userId: U1 })).toEqual({ id: U1, metadata: null, flags: 0 });
  });
  test('lobby message object', () => {
    const msg = toDiscordLobbyMessage(
      { id: U1, lobbyId: U2, applicationId: U2, flags: 0, additionalName: 'Hero', moderationMetadata: { verdict: 'ok' } },
      'hello',
      { id: U1, username: 'a' },
      { metadata: { k: 'v' } },
    );
    expect(msg).toEqual({
      id: U1, type: 0, content: 'hello', lobby_id: U2, channel_id: U2, author: { id: U1, username: 'a' },
      lobby_member: { additional_name: 'Hero' }, metadata: { k: 'v' }, moderation_metadata: { verdict: 'ok' }, flags: 0, application_id: U2,
    });
    const plain = toDiscordLobbyMessage({ id: U1, lobbyId: U2, applicationId: U2 }, 'x', { id: U1 });
    expect(plain).not.toHaveProperty('lobby_member');
    expect(plain).not.toHaveProperty('metadata');
    expect(plain).not.toHaveProperty('moderation_metadata');
  });
});
