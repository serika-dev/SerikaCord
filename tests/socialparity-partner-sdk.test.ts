import { describe, expect, test } from 'bun:test';
import { PROVISIONAL_ACCOUNTS_NOT_ENABLED, parseBotTokenRequest, parseTokenExchange } from '../src/lib/botapi/partnerSdk';
import { CallbackType, InteractionType, checkInitialCallback, type InteractionState } from '../src/lib/botapi/interactionState';

describe('partner SDK token exchange', () => {
  test('requires the four fields and a known external_auth_type', () => {
    const missing = parseTokenExchange({});
    expect(missing.ok).toBeFalse();
    if (!missing.ok) expect(Object.keys(missing.errors.toBody().errors).sort()).toEqual(['client_id', 'client_secret', 'external_auth_token', 'external_auth_type']);
    const badType = parseTokenExchange({ client_id: '1', client_secret: 's', external_auth_type: 'MAGIC', external_auth_token: 't' });
    expect(badType.ok).toBeFalse();
    const ok = parseTokenExchange({ client_id: '1', client_secret: 's', external_auth_type: 'OIDC', external_auth_token: 't' });
    expect(ok).toEqual({ ok: true, value: { clientId: '1', clientSecret: 's', externalAuthType: 'OIDC', externalAuthToken: 't' } });
  });
  test('bot token endpoint needs external_user_id', () => {
    expect(parseBotTokenRequest({}).ok).toBeFalse();
    expect(parseBotTokenRequest({ external_user_id: 'player-1', preferred_global_name: 'x'.repeat(33) }).ok).toBeFalse();
    expect(parseBotTokenRequest({ external_user_id: 'player-1', preferred_global_name: 'Player' })).toEqual({ ok: true, externalUserId: 'player-1' });
    expect(parseBotTokenRequest({ external_user_id: 42 }, { unmerge: true })).toEqual({ ok: true, externalUserId: '42' });
  });
  test('the answer is Discord\'s provisional-accounts-not-enabled code', () => {
    expect(PROVISIONAL_ACCOUNTS_NOT_ENABLED.code).toBe(530000);
  });
});

describe('interaction callback types 10 and 12', () => {
  const state: InteractionState = {
    id: 'i', type: InteractionType.APPLICATION_COMMAND, applicationId: 'a', botId: 'b', channelId: 'c', guildId: null,
    invokerId: 'u', invokerName: 'u', createdAt: 1_000_000,
  };
  test('PREMIUM_REQUIRED fails with a 50035 tree on `type`', () => {
    const r = checkInitialCallback(state, CallbackType.PREMIUM_REQUIRED, false, 1_000_100);
    expect(r).toMatchObject({ ok: false, status: 400, code: 50035 });
    if (!r.ok) expect(r.errors?.type._errors[0]).toEqual({ code: 'BASE_TYPE_CHOICES', message: 'Value must be one of {1, 4, 5, 6, 7, 8, 9, 12}.' });
  });
  test('LAUNCH_ACTIVITY is a valid answer to commands, components and modals (Activities, CORD-92)', () => {
    // Apps without Activities enabled are refused later, when the callback is applied.
    expect(checkInitialCallback(state, CallbackType.LAUNCH_ACTIVITY, false, 1_000_100).ok).toBeTrue();
    expect(checkInitialCallback({ ...state, type: InteractionType.MESSAGE_COMPONENT, sourceMessageId: 'm' }, CallbackType.LAUNCH_ACTIVITY, false, 1_000_100).ok).toBeTrue();
    expect(checkInitialCallback({ ...state, type: InteractionType.MODAL_SUBMIT }, CallbackType.LAUNCH_ACTIVITY, false, 1_000_100).ok).toBeTrue();
    expect(checkInitialCallback({ ...state, type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE }, CallbackType.LAUNCH_ACTIVITY, false, 1_000_100).ok).toBeFalse();
  });
  test('supported types still pass', () => {
    expect(checkInitialCallback(state, CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, false, 1_000_100).ok).toBeTrue();
  });
});
