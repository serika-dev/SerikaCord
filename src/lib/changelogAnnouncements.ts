/** Client-safe content contract for the platform's published release notes. */
export const CHANGELOG_LIMITS = { title: 120, version: 32, body: 30_000 } as const;

export interface ChangelogDraft {
  title: string;
  version?: string | null;
  body: string;
}

export interface AdminChangelogAnnouncement {
  id: string;
  title: string;
  version: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ChangelogAnnouncement extends AdminChangelogAnnouncement {
  publishedAt: string;
}

export interface ChangelogFeed {
  entries: ChangelogAnnouncement[];
  unreadId: string | null;
}

export function normalizeChangelogDraft(input: ChangelogDraft): Required<ChangelogDraft> {
  return {
    title: input.title.trim(),
    version: input.version?.trim() || null,
    body: input.body.trim(),
  };
}

export function validateChangelogDraft(input: ChangelogDraft): string | null {
  const normalized = normalizeChangelogDraft(input);
  if (!normalized.title || input.title.length > CHANGELOG_LIMITS.title) {
    return 'A changelog title of 1–120 characters is required';
  }
  if (!normalized.body || input.body.length > CHANGELOG_LIMITS.body) {
    return 'Changelog content of 1–30,000 characters is required';
  }
  if (input.version && input.version.length > CHANGELOG_LIMITS.version) {
    return 'The version must be at most 32 characters';
  }
  return null;
}

/** An explicit projection keeps author IDs and future internal fields private. */
export function serializeChangelogAnnouncement(entry: {
  id: string;
  title: string;
  version: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}): AdminChangelogAnnouncement {
  return {
    id: entry.id,
    title: entry.title,
    version: entry.version,
    body: entry.body,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    publishedAt: entry.publishedAt?.toISOString() ?? null,
  };
}

/** Only the latest release prompts automatically; earlier releases stay in history. */
export function buildChangelogFeed(
  entries: readonly AdminChangelogAnnouncement[],
  seenIds: ReadonlySet<string>,
  now = Date.now(),
): ChangelogFeed {
  const published = entries
    .filter((entry): entry is ChangelogAnnouncement => (
      entry.publishedAt !== null && Number.isFinite(Date.parse(entry.publishedAt)) && Date.parse(entry.publishedAt) <= now
    ))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id.localeCompare(a.id))
    .slice(0, 50);
  const newest = published[0];
  return { entries: published, unreadId: newest && !seenIds.has(newest.id) ? newest.id : null };
}
