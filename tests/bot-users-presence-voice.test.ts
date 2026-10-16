import { describe, expect, test } from 'bun:test';
import { discordConnection, parseBotUserPatch, parseGuildPageQuery, parseImageDataUri, partialGuild } from '../src/lib/botapi/users';
import { activitiesToRichPresence, buildPresences, customStatusOf, sanitizeActivities } from '../src/lib/services/botPresence';
import { botVoiceState, channelIdOfVoiceRoom, voiceSessionId, voiceStateOf } from '../src/lib/services/voiceStates';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('GET /users/@me/guilds query', () => {
  test('defaults and bounds', () => {
    expect(parseGuildPageQuery({})).toEqual({ before: null, after: null, limit: 200, withCounts: false });
    expect(parseGuildPageQuery({ limit: '5', with_counts: 'true' })).toMatchObject({ limit: 5, withCounts: true });
    expect(parseGuildPageQuery({ limit: '0' })).toEqual({ error: 'limit' });
    expect(parseGuildPageQuery({ limit: '201' })).toEqual({ error: 'limit' });
    expect(parseGuildPageQuery({ after: 'x; drop' })).toEqual({ error: 'after' });
  });
  test('partial guild shape', () => {
    const g = partialGuild({ id: 'g', name: 'G', icon: null, banner: null, ownerId: 'U', features: [], memberCount: 3, onlineCount: 1, createdAt: null }, 'u', 8n, true);
    expect(g).toEqual({ id: 'g', name: 'G', icon: null, banner: null, owner: true, permissions: '8', features: [], approximate_member_count: 3, approximate_presence_count: 1 });
  });
});

describe('PATCH /users/@me (bots)', () => {
  test('username follows Serika handle rules', () => {
    expect(parseBotUserPatch({ username: 'Cool_Bot' })).toEqual({ ok: true, patch: { username: 'cool_bot' } });
    const bad = parseBotUserPatch({ username: 'has space' });
    expect(bad.ok).toBe(false);
    expect(parseBotUserPatch({ username: 'x' }).ok).toBe(false);
    expect(parseBotUserPatch({ username: 'mydiscordbot' }).ok).toBe(false);
    expect(parseBotUserPatch({ username: 5 }).ok).toBe(false);
  });
  test('avatar data URIs: type sniffed, null clears', () => {
    const uri = `data:image/png;base64,${PNG.toString('base64')}`;
    const r = parseBotUserPatch({ avatar: uri, banner: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.avatar).toMatchObject({ kind: 'set', mime: 'image/png' });
      expect(r.patch.banner).toEqual({ kind: 'clear' });
    }
    // declared PNG, JPEG bytes
    expect(parseImageDataUri(`data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`)).toBeNull();
    expect(parseImageDataUri('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(parseImageDataUri('https://example.com/a.png')).toBeNull();
    expect(parseBotUserPatch({ avatar: 'nope' }).ok).toBe(false);
  });
});

describe('connections', () => {
  test('maps providers and never leaks metadata', () => {
    const c = discordConnection({ id: 'row', provider: 'psn', accountId: 'acc', username: 'name', displayName: null, visible: false });
    expect(c).toEqual({ id: 'acc', name: 'name', type: 'playstation', verified: true, friend_sync: false, show_activity: true, two_way_link: false, visibility: 0 });
  });
});

describe('bot presence', () => {
  test('activities -> rich presence rows', () => {
    const rows = activitiesToRichPresence([
      { name: 'Minecraft', type: 0 },
      { name: 'Spotify', type: 2, details: 'Song' },
      { name: 'Custom Status', type: 4, state: 'hi' },
      { name: 'Minecraft', type: 0 },
      { type: 0 },
    ]);
    expect(rows).toEqual([
      { type: 'game', name: 'Minecraft', details: null, state: null },
      { type: 'music', name: 'Spotify', details: 'Song', state: null },
    ]);
    expect(customStatusOf([{ type: 4, name: 'Custom Status', state: 'Helping' }])).toBe('Helping');
    expect(customStatusOf([{ type: 0, name: 'x' }])).toBeNull();
  });
  test('sanitized activities for other bots', () => {
    const out = sanitizeActivities([{ name: 'x'.repeat(300), type: 1, url: 'javascript:alert(1)', secrets: { join: 'abc' } }, { type: 9, name: 'bad' }]);
    expect(out).toHaveLength(1);
    expect((out[0].name as string).length).toBe(128);
    expect(out[0].url).toBeUndefined();
    expect(out[0].secrets).toBeUndefined();
  });
  test('GUILD_CREATE presences: online only, activity privacy respected', () => {
    const now = Date.now();
    const p = buildPresences([
      { id: 'a', status: 'online', presenceLastHeartbeatAt: new Date(now) },
      { id: 'b', status: 'offline', presenceLastHeartbeatAt: new Date(now) },
      { id: 'c', status: 'dnd', presenceLastHeartbeatAt: new Date(now), settings: { privacy: { showActivity: false } } },
      { id: 'd', status: 'online', presenceLastHeartbeatAt: new Date(now - 3600_000) },
    ], new Map([['a', [{ type: 'game', name: 'Chess' }]], ['c', [{ type: 'game', name: 'Hidden' }]]]), now);
    expect(p.map((x) => x.user)).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect((p[0].activities as Array<{ name: string }>)[0].name).toBe('Chess');
    expect(p[1].activities).toEqual([]);
  });
});

describe('voice states', () => {
  test('participant -> Discord voice state', () => {
    const v = voiceStateOf({ userId: 'u', audio: false, deafened: true, video: true, serverMute: true, sessionId: 'tab-1' }, 'c');
    expect(v).toMatchObject({ channel_id: 'c', user_id: 'u', self_mute: true, self_deaf: true, self_video: true, mute: true, deaf: false, suppress: false });
    expect(v.session_id).toBe(voiceSessionId('tab-1', 'u'));
    expect(v.session_id).not.toContain('tab-1');
  });
  test('room ids', () => {
    expect(channelIdOfVoiceRoom('channel-0E0A2D3C-1111-2222-3333-444455556666')).toBe('0e0a2d3c-1111-2222-3333-444455556666');
    expect(channelIdOfVoiceRoom('dm:a_b')).toBeNull();
    expect(channelIdOfVoiceRoom('gdm:0e0a2d3c-1111-2222-3333-444455556666')).toBeNull();
  });
  test('op 4 reply state', () => {
    expect(botVoiceState({ guildId: 'g', channelId: null, botId: 'b', sessionId: 's', selfMute: true, selfDeaf: false })).toMatchObject({ guild_id: 'g', channel_id: null, user_id: 'b', self_mute: true });
  });
});
