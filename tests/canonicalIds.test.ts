import { describe, expect, test } from 'bun:test';
import { canonicalUuid, canonicalizeUuidPath, withCanonicalUuidPath } from '../src/lib/security/canonicalIds';
import { normalizeId } from '../src/lib/db/normalizeId';

const LOWER = '0f8b2c3e-1a2b-4c5d-8e9f-a1b2c3d4e5f6';
const UPPER = LOWER.toUpperCase();

describe('canonical uuids', () => {
  test('lowercases every uuid in a path', () => {
    expect(canonicalizeUuidPath(`/api/servers/${UPPER}/bans/${UPPER}`)).toBe(`/api/servers/${LOWER}/bans/${LOWER}`);
  });

  test('leaves paths without uppercase uuids untouched', () => {
    expect(canonicalizeUuidPath(`/api/servers/${LOWER}`)).toBe(`/api/servers/${LOWER}`);
    expect(canonicalizeUuidPath('/api/v10/gateway')).toBe('/api/v10/gateway');
    expect(canonicalizeUuidPath('/api/invites/AbCdEf')).toBe('/api/invites/AbCdEf');
  });

  test('returns the same request object when nothing changes', () => {
    const req = new Request(`https://serika.chat/api/servers/${LOWER}`);
    expect(withCanonicalUuidPath(req)).toBe(req);
  });

  test('rewrites the request url and keeps method, headers and query', () => {
    const req = new Request(`https://serika.chat/api/servers/${UPPER}?a=B`, { method: 'DELETE', headers: { 'x-test': '1' } });
    const out = withCanonicalUuidPath(req);
    expect(out.url).toBe(`https://serika.chat/api/servers/${LOWER}?a=B`);
    expect(out.method).toBe('DELETE');
    expect(out.headers.get('x-test')).toBe('1');
  });

  test('canonicalUuid and normalizeId lowercase uuids only', () => {
    expect(canonicalUuid(UPPER)).toBe(LOWER);
    expect(canonicalUuid('NotAUuid')).toBe('NotAUuid');
    expect(normalizeId(UPPER)).toBe(LOWER);
    expect(normalizeId('settings')).toBe('settings');
    expect(normalizeId('507F1F77BCF86CD799439011')).toBe('507f1f77-bcf8-6cd7-9943-901100000000');
  });
});
