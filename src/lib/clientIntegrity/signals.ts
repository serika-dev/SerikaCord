/**
 * Signs that the web app is running inside a client mod (Vencord, Equicord,
 * BetterDiscord-style loaders, userscripts that patch the app). Detected in
 * the browser (detect.ts), reported once per session, kept per user for staff
 * (src/lib/api/clientIntegrity.ts). Log only: a determined mod can hide, and
 * some normal extensions can trip the softer signals, so nothing is enforced
 * automatically from this.
 *
 * Only these ids are stored; anything else a client sends is dropped. No
 * extension ids, script URLs or page content leave the browser. Scripts that
 * browser extensions inject aren't a signal: password managers, accessibility
 * and dev tools do it too (and the Vencord extension is caught by its global).
 */
export const CLIENT_INTEGRITY_SIGNALS = {
  /** A known client mod's global (window.Vencord, BdApi, ...). Strong. */
  mod_global: 'A known client mod is loaded',
  /** The webpack chunk loader was replaced or trapped (how mods patch modules). Strong. */
  webpack_hook: 'The app module loader is hooked',
  /** fetch / XMLHttpRequest / WebSocket / EventSource replaced by page script. */
  network_patched: 'Network functions are patched',
  /** A <script> from a host the app never loads from. */
  remote_script: 'A script from an unknown host is on the page',
} as const;

export type ClientIntegritySignal = keyof typeof CLIENT_INTEGRITY_SIGNALS;

export const STRONG_SIGNALS: ReadonlySet<ClientIntegritySignal> = new Set(['mod_global', 'webpack_hook']);

/** The known signal ids in `input` (deduplicated, stable order). */
export function parseSignals(input: unknown): ClientIntegritySignal[] {
  if (!Array.isArray(input)) return [];
  const known = Object.keys(CLIENT_INTEGRITY_SIGNALS) as ClientIntegritySignal[];
  const given = new Set(input.filter((v): v is string => typeof v === 'string').slice(0, 20));
  return known.filter((id) => given.has(id));
}
