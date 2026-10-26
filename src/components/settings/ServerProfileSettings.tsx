"use client";

import { useEffect, useRef, useState } from "react";
import { useGT } from "gt-next";
import { Gamepad2, Plus, Search, X } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";
import { ServerTagBadge, ServerTagPill, SERVER_TAG_ICON_COMPONENTS } from "@/components/user/ServerTagPill";
import {
  DISCOVERY_TAGS_MAX,
  DISCOVERY_TAG_MAX_LENGTH,
  SERVER_GAMES_MAX,
  SERVER_TAG_COLORS,
  SERVER_TAG_ICONS,
  SERVER_TAG_MAX,
  isServerTagIcon,
  normalizeDiscoveryTags,
  validateServerTagText,
  validateTagEmoji,
  type ServerGame,
} from "@/lib/servers/serverProfile";
import type { SettingsDraftApi } from "@/hooks/useSettingsDraft";

interface Props {
  serverId: string;
  serverName: string;
  settingsDraft: SettingsDraftApi;
  fieldErrors: Record<string, string>;
}

interface ServerEmojiItem {
  id: string;
  name: string;
  url: string;
}

/**
 * "Server Profile" settings tab: server tag (CORD-53), discovery traits
 * (CORD-52) and games (CORD-51). Edits go into the shared settings draft and
 * are saved with everything else by the bulk settings endpoint, which
 * validates them server-side.
 */
export function ServerProfileSettings({ serverId, serverName, settingsDraft, fieldErrors }: Props) {
  const gt = useGT();
  const draft = settingsDraft.draft;
  const str = (key: string) => (typeof draft[key] === "string" ? (draft[key] as string) : "");

  // ── Server tag ──
  const enabled = draft["serverTag.enabled"] === true;
  const tagText = str("serverTag.tag");
  const icon = isServerTagIcon(draft["serverTag.icon"]) ? draft["serverTag.icon"] : "star";
  const color = str("serverTag.color") || SERVER_TAG_COLORS[0];
  const emoji = str("serverTag.emoji");
  const emojiId = str("serverTag.emojiId");
  const [emojiInput, setEmojiInput] = useState("");
  const [emojis, setEmojis] = useState<ServerEmojiItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/servers/${serverId}/emojis`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEmojis(((data.emojis || []) as Array<{ id?: string; _id?: string; name: string; imageUrl?: string; url?: string }>)
          .map((e) => ({ id: String(e.id || e._id), name: e.name, url: String(e.imageUrl || e.url || "") }))
          .filter((e) => e.url.startsWith("https://")));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serverId]);

  const emojiUrl = emojiId ? emojis.find((e) => e.id === emojiId)?.url ?? null : null;
  const tagValid = validateServerTagText(tagText).ok;
  const previewTag = {
    serverId,
    serverName,
    tag: tagValid ? tagText : "TAG",
    icon,
    color,
    emoji: emoji || null,
    emojiUrl,
  };

  const applyEmoji = () => {
    const parsed = validateTagEmoji(emojiInput);
    if (!parsed.ok) return;
    settingsDraft.updateMany({ "serverTag.emoji": parsed.value, "serverTag.emojiId": "" });
    setEmojiInput("");
  };

  // ── Discovery tags ──
  const discoveryTags = Array.isArray(draft.discoveryTags) ? (draft.discoveryTags as string[]) : [];
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const addDiscoveryTag = () => {
    const parsed = normalizeDiscoveryTags([...discoveryTags, tagInput]);
    if (!parsed.ok) {
      setTagError(parsed.error);
      return;
    }
    setTagError(null);
    settingsDraft.update("discoveryTags", parsed.value);
    setTagInput("");
  };

  // ── Games ──
  const games = Array.isArray(draft.games) ? (draft.games as ServerGame[]) : [];
  const [gameQuery, setGameQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: number; name: string; coverUrl: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const onGameQuery = (value: string) => {
    setGameQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/igdb/games?query=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data.games) ? data.games : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const addGame = (g: { id: number; name: string; coverUrl: string | null }) => {
    if (games.length >= SERVER_GAMES_MAX || games.some((x) => x.igdbId === g.id)) return;
    settingsDraft.update("games", [...games, { igdbId: g.id, name: g.name, coverUrl: g.coverUrl }]);
    setGameQuery("");
    setResults([]);
  };

  const sectionCls = "p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-4";
  const inputCls = "w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";
  const errorText = (key: string) => fieldErrors[key] ? <p className="text-xs text-[var(--destructive,#EF4444)]">{fieldErrors[key]}</p> : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1 max-md:hidden">{gt("Server Profile")}</h2>
        <p className="text-sm text-[var(--text-secondary)]">{gt("A tag your members can wear, plus traits and games shown in Server Discovery and invites.")}</p>
      </div>

      {/* Server tag */}
      <div className={sectionCls}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[var(--text-primary)] font-medium">{gt("Server Tag")}</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{gt("Members can choose to show this tag next to their name everywhere on Serika.")}</p>
          </div>
          <ToggleSwitch checked={enabled} onCheckedChange={(v) => settingsDraft.update("serverTag.enabled", v)} aria-label={gt("Enable server tag")} />
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
          <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Preview")}</span>
          <ServerTagPill tag={previewTag} size="md" interactive={false} />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="server-tag-text">{gt("Tag")}</label>
          <input
            id="server-tag-text"
            value={tagText}
            maxLength={SERVER_TAG_MAX * 2}
            onChange={(e) => settingsDraft.update("serverTag.tag", e.target.value.replace(/\s/g, ""))}
            placeholder={gt("2 to 4 letters or numbers")}
            className={cn(inputCls, "max-w-[12rem]")}
          />
          {errorText("serverTag.tag")}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Badge")}</span>
          <div className="flex flex-wrap gap-1.5">
            {SERVER_TAG_ICONS.map((id) => {
              const Icon = SERVER_TAG_ICON_COMPONENTS[id];
              const selected = !emoji && !emojiId && icon === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => settingsDraft.updateMany({ "serverTag.icon": id, "serverTag.emoji": "", "serverTag.emojiId": "" })}
                  className={cn(
                    "w-9 h-9 rounded-lg border flex items-center justify-center transition-colors",
                    selected ? "border-[var(--app-accent)] bg-[var(--bg-hover)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]",
                  )}
                  aria-label={id}
                  aria-pressed={selected}
                >
                  <Icon className="w-4 h-4" style={{ color }} />
                </button>
              );
            })}
          </div>
          {errorText("serverTag.icon")}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Badge color")}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SERVER_TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => settingsDraft.update("serverTag.color", c)}
                className={cn("w-7 h-7 rounded-full border-2", color.toUpperCase() === c ? "border-[var(--text-primary)]" : "border-transparent")}
                style={{ backgroundColor: c }}
                aria-label={c}
                aria-pressed={color.toUpperCase() === c}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => settingsDraft.update("serverTag.color", e.target.value.toUpperCase())}
              className="w-8 h-8 rounded cursor-pointer bg-transparent border border-[var(--border-subtle)]"
              aria-label={gt("Custom color")}
            />
          </div>
          {errorText("serverTag.color")}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">{gt("Or use an emoji")}</span>
          <div className="flex items-center gap-2">
            <input
              value={emojiInput}
              onChange={(e) => setEmojiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyEmoji(); } }}
              placeholder={gt("Paste one emoji")}
              className={cn(inputCls, "max-w-[10rem]")}
            />
            <button
              type="button"
              onClick={applyEmoji}
              disabled={!validateTagEmoji(emojiInput).ok}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-[var(--app-accent)] text-[var(--text-on-accent,white)] disabled:opacity-50"
            >
              {gt("Use")}
            </button>
            {(emoji || emojiId) && (
              <button
                type="button"
                onClick={() => settingsDraft.updateMany({ "serverTag.emoji": "", "serverTag.emojiId": "" })}
                className="px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {gt("Remove emoji")}
              </button>
            )}
          </div>
          {errorText("serverTag.emoji")}
          {emojis.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 max-h-40 overflow-y-auto">
              {emojis.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  title={`:${e.name}:`}
                  onClick={() => settingsDraft.updateMany({ "serverTag.emojiId": e.id, "serverTag.emoji": "" })}
                  className={cn(
                    "w-9 h-9 rounded-lg border flex items-center justify-center",
                    emojiId === e.id ? "border-[var(--app-accent)] bg-[var(--bg-hover)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]",
                  )}
                >
                  <ServerTagBadge tag={{ icon: "star", color, emoji: null, emojiUrl: e.url }} size={20} />
                </button>
              ))}
            </div>
          )}
          {errorText("serverTag.emojiId")}
        </div>
      </div>

      {/* Discovery traits */}
      <div className={sectionCls}>
        <div>
          <h3 className="text-[var(--text-primary)] font-medium">{gt("Traits")}</h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {gt("Up to {max} short tags that describe your server. Shown in Server Discovery, where people can search and filter by them.", { max: DISCOVERY_TAGS_MAX })}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {discoveryTags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
              {t}
              <button
                type="button"
                onClick={() => settingsDraft.update("discoveryTags", discoveryTags.filter((x) => x !== t))}
                className="p-0.5 rounded-full hover:bg-[var(--bg-card)]"
                aria-label={gt("Remove {tag}", { tag: t })}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        {discoveryTags.length < DISCOVERY_TAGS_MAX && (
          <div className="flex items-center gap-2">
            <input
              value={tagInput}
              maxLength={DISCOVERY_TAG_MAX_LENGTH}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDiscoveryTag(); } }}
              placeholder={gt("e.g. Chill, Art, Speedrunning")}
              className={cn(inputCls, "max-w-xs")}
            />
            <button
              type="button"
              onClick={addDiscoveryTag}
              disabled={!tagInput.trim()}
              className="p-2 rounded-lg bg-[var(--app-accent)] text-[var(--text-on-accent,white)] disabled:opacity-50"
              aria-label={gt("Add trait")}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
        {tagError && <p className="text-xs text-[var(--destructive,#EF4444)]">{tagError}</p>}
        {errorText("discoveryTags")}
      </div>

      {/* Games */}
      <div className={sectionCls}>
        <div>
          <h3 className="text-[var(--text-primary)] font-medium">{gt("Games")}</h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {gt("Up to {max} games your community plays. Shown on your discovery card and invites.", { max: SERVER_GAMES_MAX })}
          </p>
        </div>
        {games.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {games.map((g) => (
              <div key={g.igdbId} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] min-w-0">
                {g.coverUrl ? (
                  <img src={g.coverUrl} alt="" className="w-8 h-10 rounded object-cover shrink-0" loading="lazy" />
                ) : (
                  <span className="w-8 h-10 rounded bg-[var(--bg-hover)] flex items-center justify-center shrink-0"><Gamepad2 className="w-4 h-4 text-[var(--text-muted)]" /></span>
                )}
                <span className="text-xs text-[var(--text-primary)] truncate flex-1">{g.name}</span>
                <button
                  type="button"
                  onClick={() => settingsDraft.update("games", games.filter((x) => x.igdbId !== g.igdbId))}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] shrink-0"
                  aria-label={gt("Remove {game}", { game: g.name })}
                >
                  <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                </button>
              </div>
            ))}
          </div>
        )}
        {games.length < SERVER_GAMES_MAX && (
          <div className="space-y-2">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                value={gameQuery}
                onChange={(e) => onGameQuery(e.target.value)}
                placeholder={gt("Search for a game…")}
                className={cn(inputCls, "pl-9")}
              />
            </div>
            {searching && <p className="text-xs text-[var(--text-muted)]">{gt("Searching…")}</p>}
            {results.length > 0 && (
              <div className="max-w-sm space-y-1">
                {results.filter((r) => !games.some((g) => g.igdbId === r.id)).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addGame(r)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg text-left hover:bg-[var(--bg-hover)]"
                  >
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt="" className="w-8 h-10 rounded object-cover shrink-0" loading="lazy" />
                    ) : (
                      <span className="w-8 h-10 rounded bg-[var(--bg-hover)] shrink-0" />
                    )}
                    <span className="text-sm text-[var(--text-primary)] truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {errorText("games")}
      </div>
    </div>
  );
}
