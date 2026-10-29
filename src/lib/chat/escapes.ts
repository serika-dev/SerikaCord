/**
 * Discord's backslash escape, "send it ID-wise": `\@user`, `\@role`,
 * `\#channel`, `\:emoji:` go out as their raw markup (`\<@id>`, `\<@&id>`,
 * `\<#id>`, `\😭`, `\<:name:id>`) and show as literal text, never as a pill,
 * emoji image or ping. Pure; shared by the composer (send transform), the
 * server (escaped mentions don't ping) and tests. Emoji shortcodes are
 * handled in emojiShortcodes.ts (the backslash stays in front of the emoji).
 */
import { codeRanges, inUrl } from "./emojiShortcodes";

export interface EscapeLookup {
  users: ReadonlyArray<{ id: string; username: string; displayName?: string | null }>;
  roles: ReadonlyArray<{ id: string; name: string }>;
  channels: ReadonlyArray<{ id: string; name: string }>;
}

/** After a name: end, whitespace or punctuation (not another name character). */
function boundaryAt(text: string, pos: number): boolean {
  return pos >= text.length || !/[\p{L}\p{N}_-]/u.test(text[pos]);
}

function longestMatch(text: string, at: number, candidates: Array<{ label: string; token: string }>): { length: number; token: string } | null {
  const lower = text.slice(at, at + 101).toLowerCase();
  let best: { length: number; token: string } | null = null;
  for (const c of candidates) {
    const label = c.label.toLowerCase();
    if (!label || !lower.startsWith(label)) continue;
    if (!boundaryAt(text, at + label.length)) continue;
    if (!best || label.length > best.length) best = { length: label.length, token: c.token };
  }
  return best;
}

export interface EscapedMention {
  /** [start, end) of `\@name` / `\#name` in the text. */
  start: number;
  end: number;
  /** The raw markup it becomes, backslash included: `\<@id>`. */
  replacement: string;
}

/**
 * `\@name` / `\#name` typed as text that name a known user (username or
 * display name), role or channel, ascending. Unknown names, code, links and
 * `\@everyone` / `\@here` are left alone.
 */
export function findEscapedMentions(text: string, lookup: EscapeLookup): EscapedMention[] {
  const out: EscapedMention[] = [];
  if (!text.includes("\\@") && !text.includes("\\#")) return out;
  const code = codeRanges(text);
  const inCode = (pos: number) => code.ranges.some(([a, b]) => pos >= a && pos < b);
  const people = lookup.users.flatMap((u) => [
    { label: u.username, token: `<@${u.id}>` },
    ...(u.displayName ? [{ label: u.displayName, token: `<@${u.id}>` }] : []),
  ]);
  const roles = lookup.roles.map((r) => ({ label: r.name, token: `<@&${r.id}>` }));
  const channels = lookup.channels.map((c) => ({ label: c.name, token: `<#${c.id}>` }));

  let i = 0;
  while (i < text.length) {
    const sigil = text[i + 1];
    if (text[i] === "\\" && (sigil === "@" || sigil === "#") && !inCode(i) && !inUrl(text, i)) {
      const at = i + 2;
      // Users win a tie with a role of the same name (Discord does the same).
      const match = sigil === "@" ? longestMatch(text, at, people) ?? longestMatch(text, at, roles) : longestMatch(text, at, channels);
      if (match && !/^(everyone|here)$/i.test(text.slice(at, at + match.length))) {
        out.push({ start: i, end: at + match.length, replacement: "\\" + match.token });
        i = at + match.length;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** `text` with every escaped mention written out as raw markup. */
export function resolveEscapedMentions(text: string, lookup: EscapeLookup): string {
  let out = "";
  let at = 0;
  for (const m of findEscapedMentions(text, lookup)) {
    out += text.slice(at, m.start) + m.replacement;
    at = m.end;
  }
  return out + text.slice(at);
}

const ESCAPED_MENTION_RE = /\\<(?:@[!&]?|#)[\w-]{1,40}>/g;

/** Content with escaped mention tokens removed: what mention / ping extraction should read. */
export function stripEscapedMentions(content: string): string {
  return content.includes("\\<") ? content.replace(ESCAPED_MENTION_RE, "") : content;
}
