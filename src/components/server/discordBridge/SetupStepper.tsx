"use client";

import { useCallback, useEffect, useState } from "react";
import { T, useGT } from "gt-next";
import { toast } from "sonner";
import { Check, ExternalLink, KeyRound, Link2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/Loader";
import { cn } from "@/lib/utils";
import { DiscordMark, btnDiscord, btnGhost, btnPrimary, btnSecondary } from "./bits";
import { bridgeApi, type BridgeState, type PickableGuild } from "./types";

type GuildChoice = { id: string; name: string; icon: string | null; memberCount: number | null };

function GuildIcon({ guild, size = "md" }: { guild: { name: string | null; icon: string | null }; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-12 rounded-2xl text-base" : "size-10 rounded-xl text-sm";
  if (guild.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={guild.icon} alt="" className={cn(box, "shrink-0 object-cover bg-[var(--bg-hover)]")} />;
  }
  const initials = (guild.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
  return <span className={cn(box, "shrink-0 inline-flex items-center justify-center bg-[var(--discord-brand)]/20 font-semibold text-[var(--text-primary)]")}>{initials}</span>;
}
export { GuildIcon };

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {/* rail */}
      <span className="absolute left-[13px] top-8 bottom-0 w-px bg-[var(--border-subtle)] last:hidden" aria-hidden="true" />
      <span
        className={cn(
          "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-200",
          done ? "bg-emerald-500 text-white" : active ? "bg-[var(--app-accent)] text-[var(--text-on-accent)]" : "bg-[var(--bg-hover)] text-[var(--text-secondary)]",
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={cn("text-sm font-semibold", active || done ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{title}</p>
        {active && <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">{children}</div>}
      </div>
    </li>
  );
}

/**
 * Setup tab: connect Discord account -> add the bot -> pick the Discord server
 * from a list (or paste an id) -> confirm. Every step explains what to do next
 * when it fails.
 */
export function SetupStepper({
  serverId,
  state,
  onLinked,
  onCancel,
}: {
  serverId: string;
  state: BridgeState;
  onLinked: (s: BridgeState) => void;
  /** Shown when switching an existing link. */
  onCancel?: () => void;
}) {
  const gt = useGT();
  const [botAdded, setBotAdded] = useState(Boolean(state.guild));
  const [guilds, setGuilds] = useState<PickableGuild[] | null>(null);
  const [guildsError, setGuildsError] = useState<string | null>(null);
  const [refreshingGuilds, setRefreshingGuilds] = useState(false);
  const [picked, setPicked] = useState<GuildChoice | null>(null);
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [linking, setLinking] = useState(false);

  const accountDone = state.account.connected;
  const step = !accountDone ? 1 : !botAdded ? 2 : !picked ? 3 : 4;

  const fetchGuilds = useCallback((fresh: boolean): Promise<void> =>
    bridgeApi<{ guilds: PickableGuild[] }>(serverId, `/guilds${fresh ? "?fresh=1" : ""}`).then((res) => {
      if (res.ok) {
        setGuilds(res.data.guilds);
        setGuildsError(null);
      } else {
        setGuildsError(res.error || gt("Could not load your Discord servers"));
      }
    }), [serverId, gt]);

  // First visit to step 3 loads the list; refreshes come from the buttons.
  const wantGuilds = step === 3 && guilds === null && guildsError === null && !refreshingGuilds;
  useEffect(() => {
    if (wantGuilds) void fetchGuilds(false);
  }, [wantGuilds, fetchGuilds]);
  const loadingGuilds = refreshingGuilds || wantGuilds;
  const loadGuilds = async (fresh: boolean) => {
    setRefreshingGuilds(true);
    setGuildsError(null);
    await fetchGuilds(fresh);
    setRefreshingGuilds(false);
  };

  const openConnections = () => {
    window.dispatchEvent(new CustomEvent("openUserSettings", { detail: { tab: "connections" } }));
  };

  const confirmLink = async () => {
    if (!picked) return;
    setLinking(true);
    const res = await bridgeApi<BridgeState>(serverId, "/link", { method: "POST", body: { guildId: picked.id } });
    setLinking(false);
    if (!res.ok) {
      toast.error(res.error || gt("Could not link that Discord server"));
      return;
    }
    toast.success(gt("Linked {name}. Now choose which channels to bridge.", { name: res.data.guild?.name || picked.name }));
    onLinked(res.data);
  };

  const usePastedId = () => {
    const id = manualId.trim();
    if (!/^\d{17,20}$/.test(id)) {
      toast.error(gt("A Discord server ID is a 17 to 20 digit number"));
      return;
    }
    setPicked({ id, name: gt("Server {id}", { id }), icon: null, memberCount: null });
  };

  const permissionList = [
    { icon: Users, text: gt("View channels and read message history, to mirror messages into SerikaCord") },
    { icon: Link2, text: gt("Manage webhooks, to post SerikaCord messages under each author's name") },
    { icon: ShieldCheck, text: gt("Timeout members, only if you require members to agree to data processing") },
  ];

  return (
    <div className="space-y-4">
      {state.guild && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-[var(--text-primary)]">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
          <p><T>Switching to a different Discord server removes every channel link and its options. Linking the same server again keeps them.</T></p>
        </div>
      )}
      <ol className="list-none">
        <Step n={1} title={gt("Connect your Discord account")} done={accountDone} active={step === 1}>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            <T>The bridge checks that you own or manage the Discord server, using the Discord account linked to your SerikaCord profile.</T>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnDiscord} onClick={openConnections}>
              <DiscordMark className="size-4" />
              <T>Open Connections</T>
            </button>
            <button type="button" className={btnSecondary} onClick={() => window.location.reload()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              <T>I&apos;ve connected it</T>
            </button>
          </div>
        </Step>
        {accountDone && step > 1 && (
          <li className="sr-only">{gt("Connected as {name}", { name: state.account.username || "Discord" })}</li>
        )}

        <Step n={2} title={gt("Add the Serika bot to your Discord server")} done={botAdded} active={step === 2}>
          <ul className="mb-3 space-y-1.5">
            {permissionList.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                <Icon className="mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <a href={state.bot.inviteUrl} target="_blank" rel="noopener noreferrer" className={btnDiscord}>
              <T>Add bot to Discord</T>
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
            <button type="button" className={btnSecondary} onClick={() => setBotAdded(true)}>
              <T>It&apos;s added, continue</T>
            </button>
          </div>
        </Step>

        <Step n={3} title={gt("Choose the Discord server")} done={Boolean(picked)} active={step === 3}>
          {!manual ? (
            <>
              {loadingGuilds && !guilds ? (
                <div className="flex items-center gap-2 py-4 text-xs text-[var(--text-secondary)]">
                  <Loader size={16} />
                  <T>Looking for servers you manage…</T>
                </div>
              ) : guildsError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-[var(--text-primary)]">
                  <p>{guildsError}</p>
                  <button type="button" className={cn(btnGhost, "mt-2 h-8 text-xs")} onClick={() => void loadGuilds(true)}>
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    <T>Try again</T>
                  </button>
                </div>
              ) : guilds && guilds.length === 0 ? (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 text-xs text-[var(--text-secondary)]">
                  <p><T>The Serika bot isn&apos;t in any Discord server where you have Manage Server. Add the bot first, then refresh.</T></p>
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(guilds ?? []).map((g) => {
                    const claimed = g.claimedBy;
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          disabled={Boolean(claimed)}
                          onClick={() => setPicked({ id: g.id, name: g.name, icon: g.icon, memberCount: g.memberCount })}
                          className="flex w-full items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2.5 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:border-[var(--app-accent)] hover:bg-[var(--bg-hover)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] disabled:opacity-55 disabled:hover:border-[var(--border-subtle)] disabled:active:scale-100 motion-reduce:transition-none"
                        >
                          <GuildIcon guild={g} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{g.name}</span>
                            <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                              {claimed
                                ? claimed.yours && claimed.name
                                  ? gt("Bridged to your server {name}", { name: claimed.name })
                                  : gt("Bridged to another SerikaCord server")
                                : g.memberCount !== null
                                  ? gt("{count} members", { count: g.memberCount })
                                  : gt("Ready to link")}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={cn(btnGhost, "h-8 text-xs")} onClick={() => void loadGuilds(true)} disabled={loadingGuilds}>
                  <RefreshCw className={cn("size-3.5", loadingGuilds && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                  <T>Refresh list</T>
                </button>
                <button type="button" className={cn(btnGhost, "h-8 text-xs")} onClick={() => setManual(true)}>
                  <T>Paste a server ID instead</T>
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  inputMode="numeric"
                  placeholder={gt("e.g. 1161608848428236902")}
                  aria-label={gt("Discord server ID")}
                  className="h-9 font-mono text-sm bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                />
                <button type="button" className={btnPrimary} onClick={usePastedId}><T>Continue</T></button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                <T>In Discord, turn on Developer Mode (Settings › Advanced), then right-click your server › Copy Server ID.</T>
              </p>
              <button type="button" className={cn(btnGhost, "h-8 text-xs")} onClick={() => setManual(false)}>
                <T>Back to the list</T>
              </button>
            </div>
          )}
        </Step>

        <Step n={4} title={gt("Confirm")} done={false} active={step === 4}>
          {picked && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3">
                <GuildIcon guild={picked} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{picked.name}</p>
                  <p className="text-xs text-[var(--text-secondary)]"><T>Messages will start mirroring once you link channels in the next tab.</T></p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={confirmLink} disabled={linking}>
                  {linking ? <Loader size={14} /> : <Link2 className="size-4" aria-hidden="true" />}
                  {gt("Link {name}", { name: picked.name })}
                </button>
                <button type="button" className={btnGhost} onClick={() => setPicked(null)} disabled={linking}>
                  <T>Pick a different server</T>
                </button>
              </div>
            </div>
          )}
        </Step>
      </ol>
      {onCancel && (
        <div className="flex justify-end">
          <button type="button" className={btnGhost} onClick={onCancel}><T>Cancel</T></button>
        </div>
      )}
    </div>
  );
}
