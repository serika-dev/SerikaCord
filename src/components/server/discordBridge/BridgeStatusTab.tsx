"use client";

import { useState } from "react";
import { T, useGT } from "gt-next";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Hash, RefreshCw, Send, Unplug, Wrench } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { GuildIcon } from "./SetupStepper";
import { StatusPill, btnDanger, btnGhost, btnSecondary, useHealthMessage, useRelativeTime } from "./bits";
import { bridgeApi, type BridgeState, type DiscordChannelView } from "./types";

/** Status tab: summary, per-link health with Repair / Test, and the danger zone. */
export function BridgeStatusTab({
  serverId,
  state,
  onState,
  discordChannels,
}: {
  serverId: string;
  state: BridgeState;
  onState: (s: BridgeState) => void;
  discordChannels: DiscordChannelView[] | null;
}) {
  const gt = useGT();
  const confirm = useConfirm();
  const relative = useRelativeTime();
  const healthMessage = useHealthMessage();
  const [busy, setBusy] = useState<string | null>(null);

  const discordName = (id: string) => discordChannels?.find((c) => c.id === id)?.name ?? null;
  const serikaName = (id: string) => state.serikaChannels.find((c) => c.id === id)?.name ?? null;
  const problems = state.links.filter((l) => l.health?.error || !l.hasWebhook).length;

  const check = async () => {
    setBusy("check");
    const res = await bridgeApi<{ missing: number; state: BridgeState }>(serverId, "/check", { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not check the links"));
      return;
    }
    onState(res.data.state);
    if (res.data.missing > 0) toast.error(gt("{count} links lost their Discord webhook. Use Repair on them.", { count: res.data.missing }));
    else toast.success(gt("Every link's webhook is in place"));
  };

  const repair = async (discordChannelId: string) => {
    setBusy(`repair:${discordChannelId}`);
    const res = await bridgeApi<BridgeState>(serverId, `/links/${discordChannelId}/repair`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not repair the link"));
      return;
    }
    onState(res.data);
    toast.success(gt("Webhook recreated. The link is working again."));
  };

  const test = async (discordChannelId: string) => {
    setBusy(`test:${discordChannelId}`);
    const res = await bridgeApi<{ success: boolean }>(serverId, `/links/${discordChannelId}/test`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || gt("The test message did not reach Discord"));
      return;
    }
    toast.success(gt("Test message sent to Discord"));
  };

  const unlinkServer = async () => {
    const ok = await confirm({
      title: gt("Unlink {name}?", { name: state.guild?.name || gt("this Discord server") }),
      description: gt("Mirroring stops, every channel link and its options are removed, and the bridge webhooks are deleted on Discord. Messages already mirrored stay where they are."),
      confirmLabel: gt("Unlink Discord server"),
    });
    if (!ok) return;
    setBusy("unlink");
    const res = await bridgeApi<BridgeState>(serverId, "/link", { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not unlink the Discord server"));
      return;
    }
    onState(res.data);
    toast.success(gt("Discord server unlinked"));
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
        <div className="flex items-center gap-3">
          {state.guild && <GuildIcon guild={state.guild} size="lg" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-[var(--text-primary)]">{state.guild?.name || state.guild?.id}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {gt("{count} channels bridged", { count: state.links.length })}
              {state.linkedAt ? ` · ${gt("linked {when}", { when: relative(state.linkedAt) ?? "" })}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {state.bot.online === null ? (
            <StatusPill tone="muted">{gt("Bot status unknown")}</StatusPill>
          ) : (
            <StatusPill tone={state.bot.online ? "ok" : "error"}>{state.bot.online ? gt("Bot online") : gt("Bot offline")}</StatusPill>
          )}
          <StatusPill tone={state.enabled ? "ok" : "muted"}>{state.enabled ? gt("Mirroring on") : gt("Mirroring off")}</StatusPill>
          {problems > 0 && <StatusPill tone="error">{gt("{count} need attention", { count: problems })}</StatusPill>}
        </div>
        {state.bot.online === null && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            <T>The bridge bot runs on another SerikaCord instance that doesn&apos;t report its status yet. Send a test message to check a link.</T>
          </p>
        )}
        {state.bot.online === false && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            <T>The bridge bot isn&apos;t connected to Discord right now, so Discord messages are not arriving. SerikaCord → Discord messages still go out through webhooks.</T>
          </p>
        )}
      </div>

      {/* Links */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]"><T>Linked channels</T></h4>
          <button type="button" className={cn(btnGhost, "h-8 text-xs")} onClick={check} disabled={busy !== null || state.links.length === 0}>
            {busy === "check" ? <Loader size={14} /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
            <T>Check webhooks</T>
          </button>
        </div>
        {state.links.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-secondary)]">
            <T>No channels are linked yet. Map them in the Channels tab.</T>
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
            {state.links.map((l) => {
              const problem = healthMessage(l.health) || (!l.hasWebhook ? gt("No webhook on Discord yet. Repair the link to create one.") : null);
              const inbound = relative(l.health?.lastInboundAt);
              const outbound = relative(l.health?.lastOutboundAt);
              return (
                <li key={l.discordChannelId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1 text-sm font-medium text-[var(--text-primary)]">
                      <Hash className="size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      <span className="truncate">{discordName(l.discordChannelId) ?? l.discordChannelId}</span>
                      <span className="shrink-0 px-1 text-[var(--text-muted)]">↔</span>
                      <Hash className="size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      <span className="truncate">{serikaName(l.serikaChannelId) ?? "?"}</span>
                      {l.options.paused && <StatusPill tone="warn" className="ml-1.5">{gt("Paused")}</StatusPill>}
                    </p>
                    {problem ? (
                      <p className="mt-0.5 text-xs text-red-500">{problem}</p>
                    ) : (
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1">
                          <ArrowDownLeft className="size-3" aria-hidden="true" />
                          {inbound ? gt("From Discord {when}", { when: inbound }) : gt("Nothing from Discord yet")}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ArrowUpRight className="size-3" aria-hidden="true" />
                          {outbound ? gt("To Discord {when}", { when: outbound }) : gt("Nothing sent to Discord yet")}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {problem && (
                      <button type="button" className={cn(btnSecondary, "h-8 text-xs")} onClick={() => repair(l.discordChannelId)} disabled={busy !== null}>
                        {busy === `repair:${l.discordChannelId}` ? <Loader size={14} /> : <Wrench className="size-3.5" aria-hidden="true" />}
                        <T>Repair</T>
                      </button>
                    )}
                    <button type="button" className={cn(btnGhost, "h-8 text-xs")} onClick={() => test(l.discordChannelId)} disabled={busy !== null || !l.hasWebhook}>
                      {busy === `test:${l.discordChannelId}` ? <Loader size={14} /> : <Send className="size-3.5" aria-hidden="true" />}
                      <T>Send test</T>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-red-500/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]"><T>Unlink Discord server</T></h4>
            <p className="text-xs text-[var(--text-secondary)]"><T>Stop the bridge and remove every channel link. You can link again later.</T></p>
          </div>
          <button type="button" className={btnDanger} onClick={unlinkServer} disabled={busy !== null}>
            {busy === "unlink" ? <Loader size={14} /> : <Unplug className="size-4" aria-hidden="true" />}
            <T>Unlink</T>
          </button>
        </div>
      </section>
    </div>
  );
}
