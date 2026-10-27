import { describe, expect, test } from 'bun:test';
import {
  INVITE_TARGET_LIMITS, TARGET_JOB_STATUS, buildTargetUsersCsv, parseTargetUsersCsv, parseUserIdList, targetUsersJobStatus,
  targetUsersMarker, withTargetUsersMarker,
} from '../src/lib/botapi/inviteTargets';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('user_ids', () => {
  test('required, a list of 1-1000 ids', () => {
    expect(parseUserIdList(undefined).ok).toBeFalse();
    expect(parseUserIdList('x').ok).toBeFalse();
    expect(parseUserIdList([]).ok).toBeFalse();
    expect(parseUserIdList(Array.from({ length: INVITE_TARGET_LIMITS.bulk + 1 }, () => U1)).ok).toBeFalse();
  });
  test('de-duplicates and lower-cases; untranslated snowflakes are errors at their index', () => {
    expect(parseUserIdList([U1, U1.toUpperCase(), U2])).toEqual({ ok: true, ids: [U1, U2] });
    const bad = parseUserIdList([U1, '123456789012345678']);
    expect(bad.ok).toBeFalse();
    if (!bad.ok) expect(bad.errors.toBody().errors).toEqual({ user_ids: { 1: { _errors: [{ code: 'NUMBER_TYPE_COERCE', message: 'Value "123456789012345678" is not snowflake.' }] } } });
  });
});

describe('CSV', () => {
  test('header optional, blank lines skipped, line numbers kept', () => {
    const r = parseTargetUsersCsv('user_id\n123456789012345678\n\n' + U1.toUpperCase() + '\r\n123456789012345678\n');
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual([{ id: '123456789012345678', line: 2 }, { id: U1, line: 4 }]);
  });
  test('reports invalid lines like Discord', () => {
    const r = parseTargetUsersCsv('user_id\nabc\n12\n');
    expect(r.errors).toEqual(['Line 2: invalid user ID format', 'Line 3: invalid user ID - must be a valid Discord snowflake']);
  });
  test('quoted cells and extra columns', () => {
    expect(parseTargetUsersCsv('"123456789012345678",x').entries).toEqual([{ id: '123456789012345678', line: 1 }]);
  });
  test('round trip output', () => {
    expect(buildTargetUsersCsv([U1, U2])).toBe(`user_id\n${U1}\n${U2}\n`);
    expect(buildTargetUsersCsv([])).toBe('user_id\n');
  });
});

describe('marker + job status', () => {
  test('marker is set for a non-empty list and removed for an empty one, keeping other metadata', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    const withList = withTargetUsersMarker({ source: 'lobby' }, 3, now);
    expect(withList).toEqual({ source: 'lobby', target_users: { count: 3, updated_at: now.toISOString() } });
    expect(targetUsersMarker(withList)).toEqual({ count: 3, updated_at: now.toISOString() });
    const cleared = withTargetUsersMarker(withList, 0);
    expect(cleared).toEqual({ source: 'lobby' });
    expect(targetUsersMarker(cleared)).toBeNull();
    expect(targetUsersMarker(null)).toBeNull();
    expect(targetUsersMarker({ target_users: { count: 0 } })).toBeNull();
  });
  test('job status: completed synchronously, unspecified without a list', () => {
    expect(targetUsersJobStatus(null)).toEqual({ status: TARGET_JOB_STATUS.UNSPECIFIED, total_users: 0, processed_users: 0, created_at: null, completed_at: null, error_message: null });
    expect(targetUsersJobStatus({ count: 41, updated_at: '2026-01-08T12:00:00.000Z' })).toEqual({
      status: 2, total_users: 41, processed_users: 41, created_at: '2026-01-08T12:00:00.000Z', completed_at: '2026-01-08T12:00:00.000Z', error_message: null,
    });
  });
});
