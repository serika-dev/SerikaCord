import { describe, expect, test } from 'bun:test';
import {
  CHANGELOG_LIMITS,
  buildChangelogFeed,
  normalizeChangelogDraft,
  serializeChangelogAnnouncement,
  validateChangelogDraft,
  type AdminChangelogAnnouncement,
} from '../src/lib/changelogAnnouncements';

const now = Date.parse('2026-10-11T12:00:00Z');
function entry(id: string, publishedAt: string | null): AdminChangelogAnnouncement {
  return { id, title: 'Release notes', version: null, body: 'An update', createdAt: '2026-10-10T12:00:00Z', updatedAt: '2026-10-10T12:00:00Z', publishedAt };
}

describe('changelog publication and receipts', () => {
  test('drafts, future publication dates, and malformed publication dates never reach the feed', () => {
    expect(buildChangelogFeed([
      entry('draft', null), entry('future', '2026-10-12T00:00:00Z'), entry('invalid', 'invalid'),
    ], new Set(), now)).toEqual({ entries: [], unreadId: null });
  });

  test('only the newest published release opens automatically', () => {
    const old = entry('old', '2026-10-10T00:00:00Z');
    const latest = entry('latest', '2026-10-11T00:00:00Z');
    expect(buildChangelogFeed([old, latest], new Set(), now)).toEqual({ entries: [latest, old], unreadId: 'latest' });
    expect(buildChangelogFeed([old, latest], new Set(['latest']), now).unreadId).toBeNull();
  });

  test('unpublishing and republishing an acknowledged entry does not reset its receipt', () => {
    const seen = new Set(['same-entry']);
    expect(buildChangelogFeed([entry('same-entry', null)], seen, now).unreadId).toBeNull();
    expect(buildChangelogFeed([entry('same-entry', '2026-10-11T11:59:00Z')], seen, now).unreadId).toBeNull();
    expect(buildChangelogFeed([entry('new-entry', '2026-10-11T12:00:00Z')], seen, now).unreadId).toBe('new-entry');
  });

  test('receipt sets are account-specific', () => {
    const entries = [entry('release', '2026-10-11T00:00:00Z')];
    expect(buildChangelogFeed(entries, new Set(['release']), now).unreadId).toBeNull();
    expect(buildChangelogFeed(entries, new Set(), now).unreadId).toBe('release');
  });

  test('public history is capped, sorted deterministically, and does not mutate input', () => {
    const entries = Array.from({ length: 55 }, (_, index) => entry(`entry-${String(index).padStart(2, '0')}`, '2026-10-11T00:00:00Z'));
    const before = [...entries];
    const feed = buildChangelogFeed(entries, new Set(), now);
    expect(feed.entries).toHaveLength(50);
    expect(feed.entries[0].id).toBe('entry-54');
    expect(entries).toEqual(before);
  });

  test('serialization exposes only public content, never authors or internal metadata', () => {
    const date = new Date('2026-10-11T00:00:00Z');
    const record = { id: 'release', title: 'Title', version: '2.1', body: 'Content', createdAt: date, updatedAt: date, publishedAt: date, createdBy: 'private-author', internalNote: 'secret' };
    expect(serializeChangelogAnnouncement(record)).toEqual({
      id: 'release', title: 'Title', version: '2.1', body: 'Content', createdAt: date.toISOString(), updatedAt: date.toISOString(), publishedAt: date.toISOString(),
    });
  });
});

describe('changelog content validation', () => {
  test('trims outside whitespace without changing markdown or unicode', () => {
    expect(normalizeChangelogDraft({ title: ' New release ✨ ', version: '  ', body: '\n## Changes\n\n- **Improved** chat\n' })).toEqual({
      title: 'New release ✨', version: null, body: '## Changes\n\n- **Improved** chat',
    });
  });

  test('rejects whitespace-only content and validates field limits', () => {
    expect(validateChangelogDraft({ title: ' ', body: 'Text' })).not.toBeNull();
    expect(validateChangelogDraft({ title: 'Title', body: '\n\t' })).not.toBeNull();
    expect(validateChangelogDraft({ title: 'x'.repeat(CHANGELOG_LIMITS.title + 1), body: 'Text' })).not.toBeNull();
    expect(validateChangelogDraft({ title: 'Title', body: 'x'.repeat(CHANGELOG_LIMITS.body + 1) })).not.toBeNull();
    expect(validateChangelogDraft({ title: 'Title', body: 'Text', version: 'x'.repeat(CHANGELOG_LIMITS.version + 1) })).not.toBeNull();
    expect(validateChangelogDraft({ title: 'x'.repeat(CHANGELOG_LIMITS.title), body: 'x'.repeat(CHANGELOG_LIMITS.body), version: 'x'.repeat(CHANGELOG_LIMITS.version) })).toBeNull();
  });
});
