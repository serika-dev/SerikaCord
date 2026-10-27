"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Link2, Unlink } from "lucide-react";
import { Loader } from "@/components/ui/Loader";

interface DiscordLink {
  discord_bot_user_id: string;
  discord_application_id: string | null;
  linked_at: string;
  discord_username: string | null;
}

/**
 * "Linked Discord bot" card on the Developer Portal Bot page. Linking proves
 * the app owns a Discord bot (its token is checked with Discord once and not
 * kept); the Discord bridge then relays that bot's messages in bridged
 * servers as this app's own bot. API: /api/developers/applications/:id/discord-link.
 */
export function DiscordLinkCard({ appId }: { appId: string }) {
  const gt = useGT();
  const [link, setLink] = useState<DiscordLink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/developers/applications/${appId}/discord-link`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setLink(data?.link ?? null);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [appId]);

  const handleLink = async () => {
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/discord-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord_bot_token: value }),
      });
      // The token is only needed for this one request.
      setToken("");
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setLink(data?.link ?? null);
        toast.success(gt("Discord bot linked"));
      } else if (res.status === 429) {
        toast.error(gt("Too many attempts. Try again later."));
      } else if (res.status === 400) {
        toast.error(gt("Discord did not accept that bot token."));
      } else if (res.status === 403) {
        toast.error(gt("You don't have permission to change this application."));
      } else {
        toast.error(gt("Could not reach Discord. Try again later."));
      }
    } catch {
      toast.error(gt("Could not reach Discord. Try again later."));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm(gt("Unlink this Discord bot? Its messages in bridged servers will show as a Discord account again."))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/discord-link`, { method: "DELETE" });
      if (res.ok) {
        setLink(null);
        toast.success(gt("Discord bot unlinked"));
      } else if (res.status === 403) {
        toast.error(gt("You don't have permission to change this application."));
      } else {
        toast.error(gt("Failed to unlink the Discord bot"));
      }
    } catch {
      toast.error(gt("Failed to unlink the Discord bot"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-white/[0.02] overflow-hidden">
      <div className="p-5 border-b border-[var(--app-border)]">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Link2 className="size-4 text-[var(--app-accent)]" />
          {gt("Linked Discord bot")}
        </h2>
        <p className="text-[11px] text-[var(--app-muted)] mt-1">
          {gt("If the same bot also runs on Discord, link it here. In servers bridged with Discord, its Discord messages then show as this bot instead of a Discord copy, as long as this bot is in the server and can see the channel.")}
        </p>
      </div>
      <div className="p-5">
        {!loaded ? (
          <div className="flex justify-center py-2"><Loader size={24} className="size-4" /></div>
        ) : link ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {link.discord_username ? `@${link.discord_username}` : gt("Discord bot")}
              </p>
              <p className="text-xs text-[var(--app-muted)] font-mono truncate">
                {gt("Discord bot id: {id}", { id: link.discord_bot_user_id })}
              </p>
            </div>
            <button
              onClick={handleUnlink}
              disabled={busy}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 text-red-400 text-sm font-medium rounded-lg transition-colors shrink-0"
            >
              {busy ? <Loader size={24} className="size-4" /> : <Unlink className="size-4" />}
              {gt("Unlink")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="discord-bot-token" className="block text-xs font-semibold text-[var(--app-muted)] uppercase tracking-wide">
              {gt("Discord bot token")}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="discord-bot-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleLink(); }}
                placeholder={gt("Paste your Discord bot token")}
                className="flex-1 min-w-0 bg-white/[0.03] border border-[var(--app-border)] rounded-lg px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-accent)] transition-colors"
              />
              <button
                onClick={handleLink}
                disabled={busy || !token.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--app-accent)] hover:opacity-90 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-opacity shrink-0"
              >
                {busy ? <Loader size={24} className="size-4" /> : <Link2 className="size-4" />}
                {gt("Link")}
              </button>
            </div>
            <p className="text-[11px] text-[var(--app-muted)]">
              {gt("We send the token to Discord once to check which bot it belongs to, then forget it. Only the Discord bot id is saved. Reset the token on Discord afterwards if you prefer.")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
