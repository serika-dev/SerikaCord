/**
 * A (partial) user settings object. Settings are free-form JSON sections, so
 * values stay loosely typed like the rest of the settings UI.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsPatch = { [key: string]: any };

const isPlainObject = (v: unknown): v is SettingsPatch =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Client-side deep merge for user settings patches. Mirrors the server's
 * mergeDeep in src/lib/api/index.ts: plain objects merge key by key, arrays
 * and primitives replace, undefined values are skipped. Never mutates inputs.
 */
export function mergeSettingsDeep<T extends SettingsPatch>(
  base: T | null | undefined,
  patch: SettingsPatch | null | undefined,
): T {
  const output: SettingsPatch = {};
  for (const [key, value] of Object.entries(base || {})) {
    if (value !== undefined) output[key] = value;
  }
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value)) {
      const prev = output[key];
      output[key] = mergeSettingsDeep(isPlainObject(prev) ? prev : {}, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}
