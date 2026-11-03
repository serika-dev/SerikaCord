/**
 * Browser-side checks for client mods (see signals.ts). Pure over the
 * `window`-like object it is given, so tests can pass a fake one.
 */
import type { ClientIntegritySignal } from './signals';

/** Globals that only client mods define. */
const MOD_GLOBALS = [
  'Vencord', 'VencordNative', 'Equicord', 'EquicordNative', 'BdApi', 'BetterDiscord',
  'shelter', 'replugged', 'powercord', 'goosemod', 'GooseMod', 'Aliucord', 'enmity', 'vendetta', 'bunny', 'revenge',
] as const;

/** Next.js's webpack chunk queue. Its runtime replaces `push` with a bound function. */
const CHUNK_GLOBAL = 'webpackChunk_N_E';

type Win = Record<string, unknown> & {
  location?: { origin?: string };
  document?: { scripts?: ArrayLike<{ src?: string }> };
};

function isNative(fn: unknown): boolean {
  if (typeof fn !== 'function') return true; // missing: nothing patched it
  try {
    return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

function hasModGlobal(w: Win): boolean {
  return MOD_GLOBALS.some((name) => {
    try {
      return w[name] !== undefined && w[name] !== null;
    } catch {
      return true; // a throwing getter on a mod's name is a trap
    }
  });
}

function webpackHooked(w: Win): boolean {
  try {
    const desc = Object.getOwnPropertyDescriptor(w, CHUNK_GLOBAL);
    if (!desc) return false; // not loaded yet / not a webpack page
    if (desc.get || desc.set) return true; // trapped before webpack ran
    const queue = desc.value as { push?: unknown } | undefined;
    if (!queue || typeof queue.push !== 'function') return false;
    if (queue.push === Array.prototype.push) return false; // runtime not started yet
    // webpack's runtime installs `webpackJsonpCallback.bind(...)`; a mod's wrapper isn't bound.
    return !(queue.push as { name?: string }).name?.startsWith('bound ');
  } catch {
    return true;
  }
}

function networkPatched(w: Win): boolean {
  const xhr = w.XMLHttpRequest as { prototype?: { open?: unknown; send?: unknown } } | undefined;
  const ws = w.WebSocket as { prototype?: { send?: unknown } } | undefined;
  // The desktop shells (Qt, Tauri) wrap fetch themselves to tag their requests.
  const shellWrapsFetch = Boolean(w.__TAURI__);
  return (!shellWrapsFetch && !isNative(w.fetch)) || !isNative(w.WebSocket) || !isNative(w.EventSource)
    || !isNative(xhr?.prototype?.open) || !isNative(xhr?.prototype?.send) || !isNative(ws?.prototype?.send);
}

function scriptSignals(w: Win, allowedHosts: readonly string[]): ClientIntegritySignal[] {
  const out = new Set<ClientIntegritySignal>();
  const scripts = w.document?.scripts;
  if (!scripts) return [];
  const origin = w.location?.origin ?? '';
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i]?.src;
    if (!src) continue;
    let url: URL;
    try {
      url = new URL(src, origin || undefined);
    } catch {
      continue;
    }
    if (/^(chrome|moz|safari-web|ms-browser)-extension:$/.test(url.protocol)) out.add('extension_script');
    else if (url.origin !== origin && !allowedHosts.includes(url.hostname)) out.add('remote_script');
  }
  return [...out];
}

export function detectClientIntegrity(w: Win, opts: { allowedScriptHosts?: readonly string[] } = {}): ClientIntegritySignal[] {
  const out: ClientIntegritySignal[] = [];
  if (hasModGlobal(w)) out.push('mod_global');
  if (webpackHooked(w)) out.push('webpack_hook');
  if (networkPatched(w)) out.push('network_patched');
  out.push(...scriptSignals(w, opts.allowedScriptHosts ?? []));
  return out;
}
