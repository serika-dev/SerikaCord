"use client";

import { useCallback, useEffect, useState } from "react";
import { T, useGT } from "gt-next";
import { AlertTriangle, ChevronDown, Settings2 } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useServer } from "@/contexts/ServerContext";
import { cn } from "@/lib/utils";
import { ChannelMapper } from "./ChannelMapper";
import { BridgeOptionsTab } from "./BridgeOptionsTab";
import { BridgeStatusTab } from "./BridgeStatusTab";
import { SetupStepper, GuildIcon } from "./SetupStepper";
import { DiscordMark, StatusPill, btnGhost, btnSecondary, type PillTone } from "./bits";
import { DISCORD_BRAND_STYLE, bridgeApi, type BridgeState, type DiscordChannelView } from "./types";

type Tab = "setup" | "channels" | "options" | "status";

/**
 * Server Settings → Integrations → Discord bridge. An integration card that
 * opens a focused setup view with segmented tabs: Setup (guided linking),
 * Channels (mapping editor), Options (defaults, import) and Status (health).
 * Talks to src/lib/api/discordBridge.ts.
 */
export default function DiscordBridgePanel({ serverId }: { serverId: string }) {
  const gt = useGT();
  const { fetchChannels } = useServer();
  const [state, setState] = useState<BridgeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("setup");
  const [switching, setSwitching] = useState(false);
  // The linked guild's channels, tagged with the guild they belong to.
  const [channels, setChannels] = useState<{ guildId: string; list: DiscordChannelView[] | null; error: string | null } | null>(null);
  const [refreshingChannels, setRefreshingChannels] = useState(false);

  const loadState = useCallback(async () => {
    const res = await bridgeApi<BridgeState>(serverId, "");
    if (res.ok) {
      setState(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error || gt("Could not load the Discord bridge"));
    }
  }, [serverId, gt]);

  useEffect(() => {
    let active = true;
    bridgeApi<BridgeState>(serverId, "").then((res) => {
      if (!active) return;
      if (res.ok) setState(res.data);
      else setLoadError(res.error || "error");
    });
    return () => {
      active = false;
    };
  }, [serverId]);

  const guildId = state?.guild?.id ?? null;

  const fetchDiscordChannels = useCallback((fresh: boolean): Promise<void> => {
    if (!guildId) return Promise.resolve();
    const forGuild = guildId;
    return bridgeApi<{ channels: DiscordChannelView[] }>(serverId, `/channels${fresh ? "?fresh=1" : ""}`).then((res) => {
      setChannels({ guildId: forGuild, list: res.ok ? res.data.channels : null, error: res.ok ? null : res.error });
    });
  }, [serverId, guildId]);

  // Discord channels load the first time a tab that needs them opens, and again after switching guilds.
  const wantChannels = open && guildId !== null && (tab === "channels" || tab === "status") && channels?.guildId !== guildId;
  useEffect(() => {
    if (wantChannels) void fetchDiscordChannels(false);
  }, [wantChannels, fetchDiscordChannels]);

  const reloadChannels = useCallback(async () => {
    setRefreshingChannels(true);
    await fetchDiscordChannels(true);
    setRefreshingChannels(false);
  }, [fetchDiscordChannels]);
  const current = channels && channels.guildId === guildId ? channels : null;
  const discordChannels = current?.list ?? null;
  const channelsLoading = refreshingChannels || wantChannels;

  const onState = useCallback((next: BridgeState) => setState(next), []);
  const refreshServerChannels = useCallback(() => {
    void fetchChannels(serverId);
    void loadState();
  }, [fetchChannels, serverId, loadState]);

  if (!state) {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4" style={DISCORD_BRAND_STYLE}>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--discord-brand)]/15 text-[var(--discord-brand)]">
            <DiscordMark className="size-5" />
          </span>
          <div className="flex-1">
            <p className="font-semibold text-[var(--text-primary)]"><T>Discord Bridge</T></p>
            <p className="text-sm text-[var(--text-secondary)]">{loadError ? gt("Could not load the Discord bridge") : gt("Loading…")}</p>
          </div>
          {!loadError && <Loader size={18} />}
        </div>
      </div>
    );
  }

  const linked = Boolean(state.guild);
  const problems = state.links.filter((l) => l.health?.error || !l.hasWebhook).length;
  const pill: { tone: PillTone; label: string } = !state.configured
    ? { tone: "muted", label: gt("Unavailable") }
    : !linked
      ? { tone: "muted", label: gt("Not set up") }
      : state.conflict || problems > 0
        ? { tone: "error", label: gt("Needs attention") }
        : !state.enabled
          ? { tone: "warn", label: gt("Off") }
          : { tone: "ok", label: gt("Connected") };

  const tabs: Array<{ id: Tab; label: string; disabled: boolean }> = [
    { id: "setup", label: gt("Setup"), disabled: false },
    { id: "channels", label: gt("Channels"), disabled: !linked },
    { id: "options", label: gt("Options"), disabled: !linked },
    { id: "status", label: gt("Status"), disabled: !linked },
  ];
  const activeTab: Tab = linked || tab === "setup" ? tab : "setup";

  const toggleOpen = () => {
    if (!open) setTab(linked ? "channels" : "setup");
    setOpen((o) => !o);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] transition-[border-color] duration-200" style={DISCORD_BRAND_STYLE}>
        {/* Integration card */}
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--discord-brand)]/15 text-[var(--discord-brand)]">
              <DiscordMark className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--text-primary)]">
                <T>Discord Bridge</T>
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
              </p>
              <p className="truncate text-sm text-[var(--text-secondary)]">
                {linked && state.guild
                  ? gt("Bridging {count} channels with {name}", { count: state.links.length, name: state.guild.name || state.guild.id })
                  : gt("Mirror messages both ways between Discord and SerikaCord channels")}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={cn(btnSecondary, "shrink-0 max-sm:w-full")}
            onClick={toggleOpen}
            aria-expanded={open}
            disabled={!state.configured}
          >
            <Settings2 className="size-4" aria-hidden="true" />
            {open ? gt("Close") : linked ? gt("Configure") : gt("Set up")}
            <ChevronDown className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
        {!state.configured && (
          <p className="px-4 pb-4 -mt-1 text-xs text-[var(--text-secondary)]">
            <T>The Discord bridge isn&apos;t available on this SerikaCord instance yet.</T>
          </p>
        )}

        {/* Focused setup view */}
        {open && state.configured && (
          <div className="border-t border-[var(--border-subtle)] p-4 animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none">
            {state.conflict && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-[var(--text-primary)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden="true" />
                <p>
                  {state.conflict.serverName
                    ? gt("This Discord server is also bridged to your server \"{name}\", which takes priority, so nothing mirrors here. Turn the bridge off there, or unlink it here.", { name: state.conflict.serverName })
                    : gt("This Discord server is also bridged to another SerikaCord server, which takes priority, so nothing mirrors here.")}
                </p>
              </div>
            )}

            <div role="tablist" aria-label={gt("Discord bridge sections")} className="mb-5 grid grid-cols-4 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  disabled={t.disabled}
                  onClick={() => {
                    setTab(t.id);
                    setSwitching(false);
                  }}
                  className={cn(
                    "h-8 rounded-lg px-2 text-xs font-semibold transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] disabled:opacity-40 disabled:cursor-not-allowed",
                    activeTab === t.id ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div key={activeTab} role="tabpanel" className="animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none">
              {activeTab === "setup" &&
                (linked && !switching && state.guild ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <GuildIcon guild={state.guild} size="lg" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--text-primary)]">{state.guild.name || state.guild.id}</p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {state.account.connected
                              ? gt("Linked with your Discord account {name}", { name: state.account.username || "" })
                              : gt("Linked")}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btnSecondary} onClick={() => setTab("channels")}><T>Map channels</T></button>
                        <button type="button" className={btnGhost} onClick={() => setSwitching(true)}><T>Switch server</T></button>
                      </div>
                    </div>
                    <a href={state.bot.inviteUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-[var(--app-accent)] hover:underline">
                      <T>Re-invite the bot with the right permissions</T>
                    </a>
                  </div>
                ) : (
                  <SetupStepper
                    serverId={serverId}
                    state={state}
                    onCancel={switching ? () => setSwitching(false) : undefined}
                    onLinked={(next) => {
                      setState(next);
                      setSwitching(false);
                      setTab("channels");
                    }}
                  />
                ))}
              {activeTab === "channels" && (
                <ChannelMapper
                  serverId={serverId}
                  state={state}
                  onState={onState}
                  discordChannels={discordChannels}
                  loadingChannels={channelsLoading}
                  channelsError={current?.error ?? null}
                  onReloadChannels={() => void reloadChannels()}
                  onChannelsCreated={refreshServerChannels}
                />
              )}
              {activeTab === "options" && (
                <BridgeOptionsTab serverId={serverId} state={state} onState={onState} onImported={() => { refreshServerChannels(); void reloadChannels(); }} />
              )}
              {activeTab === "status" && <BridgeStatusTab serverId={serverId} state={state} onState={onState} discordChannels={discordChannels} />}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
