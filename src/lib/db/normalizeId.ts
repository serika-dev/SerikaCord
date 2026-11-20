import { eq, inArray, type SQL } from 'drizzle-orm';

/**
 * Converts a legacy MongoDB ObjectId string (24 hex chars) to a UUID string
 * (36 chars with hyphens). If the input is already a UUID or a non-hex string
 * (e.g. "settings"), it is returned unchanged.
 *
 * The conversion pads the 24-char hex to 32 chars with trailing zeros,
 * then formats as: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export function normalizeId(id: string): string {
  if (!id || typeof id !== 'string') return id;
  // Already a UUID?
  // Lowercased: Postgres matches uuids in any case, so string comparisons of
  // ids (owner checks, role sets) must too.
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return id.toLowerCase();
  }
  // MongoDB ObjectId (24 hex chars)?
  if (/^[0-9a-fA-F]{24}$/.test(id)) {
    const padded = id.toLowerCase().padEnd(32, '0');
    return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
  }
  // Some other string (e.g. "settings" for platform_settings)
  return id;
}

/**
 * Builds a Drizzle condition from a filter value.
 * Supports `{ in: [...] }` syntax for inArray queries.
 * When isId is true, normalizes ID strings via normalizeId.
 */
export function buildCondition(column: any, value: unknown, isId: boolean = false): SQL {
  if (value && typeof value === 'object' && 'in' in value) {
    const items = (value as { in: any[] }).in;
    const normalizedItems = isId ? items.map(normalizeId) : items;
    return inArray(column, normalizedItems) as SQL;
  }
  const v = isId ? normalizeId(value as string) : value;
  return eq(column, v) as SQL;
}
