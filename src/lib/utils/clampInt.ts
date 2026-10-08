/**
 * Parse a positive integer query param with a default and an upper bound.
 *
 * `Math.min(parseInt(v), max)` is unsafe for limits: '0' gives 0 and 'abc'
 * gives NaN, both of which the models treat as "no LIMIT", and a negative
 * value reaches Postgres as an invalid LIMIT. Anything that is not a finite
 * positive integer falls back to `def`.
 */
export function clampInt(value: string | number | undefined | null, def: number, max: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}
