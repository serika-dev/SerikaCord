"use client";

import { useMemo, useState } from "react";
import { T, useGT } from "gt-next";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Pause, RefreshCw, Search, Settings2, Sparkles, Unlink, Wand2, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/Loader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { ChannelGlyph, ChannelPicker, PICK_CREATE, PICK_NONE, type PickerGroup } from "./ChannelPicker";
import { LinkOptionsForm } from "./LinkOptionsForm";
import { DiscordMark, btnGhost, btnSecondary, useHealthMessage } from "./bits";
import { bridgeApi, type BridgeLinkOptions, type BridgeLinkView, type BridgeState, type DiscordChannelView, type SerikaChannelView } from "./types";

type View = "discord" | "serika";

interface BulkResult {
  linked: number;
  created: number;
  unlinked: number;
  failed: Array<{ discordChannelId: string; error: string }>;
  skipped?: number;
  state: BridgeState;
}

function groupBy<T>(items: T[], key: (item: T) => string | null, order: Map<string, number>): Array<[string | null, T[]]> {
  const map = new Map<string | null, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.entries()].sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)));
}

function DirectionGlyph({ link }: { link: BridgeLinkView | undefined }) {
  const gt = useGT();
  if (!link) return <span className="hidden sm:block size-4 shrink-0" aria-hidden="true" />;
  const { direction, paused } = link.options;
  const Icon = paused ? Pause : direction === "to_serika" ? ArrowRight : direction === "to_discord" ? ArrowLeft : ArrowLeftRight;
  const label = paused ? gt("Paused") : direction === "to_serika" ? gt("Discord → SerikaCord only") : direction === "to_discord" ? gt("SerikaCord → Discord only") : gt("Both ways");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("hidden sm:inline-flex size-6 shrink-0 items-center justify-center rounded-md", paused ? "text-amber-500" : "text-[var(--app-accent)]")} aria-label={label}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Channels tab: map Discord channels to SerikaCord channels (or the other way
 * round), with search, bulk actions and per-link options.
 */
export function ChannelMapper({
  serverId,
  state,
  onState,
  discordChannels,
  loadingChannels,
  channelsError,
  onReloadChannels,
  onChannelsCreated,
}: {
  serverId: string;
  state: BridgeState;
  onState: (s: BridgeState) => void;
  discordChannels: DiscordChannelView[] | null;
  loadingChannels: boolean;
  channelsError: string | null;
  onReloadChannels: () => void;
  onChannelsCreated: () => void;
}) {
  const gt = useGT();
  const confirm = useConfirm();
  const healthMessage = useHealthMessage();
  const [view, setView] = useState<View>("discord");
  const [query, setQuery] = useState("");
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const linkByDiscord = useMemo(() => new Map(state.links.map((l) => [l.discordChannelId, l])), [state.links]);
  const linkBySerika = useMemo(() => new Map(state.links.map((l) => [l.serikaChannelId, l])), [state.links]);
  const discordById = useMemo(() => new Map((discordChannels ?? []).map((c) => [c.id, c])), [discordChannels]);
  const serikaById = useMemo(() => new Map(state.serikaChannels.map((c) => [c.id, c])), [state.serikaChannels]);
  const bridgeableDiscord = useMemo(() => (discordChannels ?? []).filter((c) => c.kind !== "category"), [discordChannels]);
  const bridgeableSerika = useMemo(() => state.serikaChannels.filter((c) => c.type === "text" || c.type === "announcement"), [state.serikaChannels]);
  const discordCategories = useMemo(() => new Map((discordChannels ?? []).filter((c) => c.kind === "category").map((c) => [c.id, c])), [discordChannels]);
  const serikaCategories = useMemo(() => new Map(state.serikaChannels.filter((c) => c.type === "category").map((c) => [c.id, c])), [state.serikaChannels]);

  const q = query.trim().toLowerCase();
  const matches = (...names: Array<string | undefined>) => !q || names.some((n) => n?.toLowerCase().includes(q));

  // Picker options: SerikaCord channels (Discord view) and Discord channels (SerikaCord view).
  const serikaGroups: PickerGroup[] = useMemo(() => {
    const order = new Map([...serikaCategories.values()].map((c) => [c.id, c.position ?? 0]));
    return groupBy(bridgeableSerika, (c) => (c.parentId && serikaCategories.has(c.parentId) ? c.parentId : null), order).map(([cat, chans]) => ({
      heading: cat ? serikaCategories.get(cat)!.name : gt("No category"),
      options: chans.map((c) => {
        const taken = linkBySerika.get(c.id);
        const other = taken ? discordById.get(taken.discordChannelId) : undefined;
        return { value: c.id, label: c.name, kind: c.type === "announcement" ? "announcement" : "text", hint: taken ? (other ? gt("linked to #{name}", { name: other.name }) : gt("linked")) : undefined, disabled: Boolean(taken) };
      }),
    }));
  }, [bridgeableSerika, serikaCategories, linkBySerika, discordById, gt]);

  const discordGroups: PickerGroup[] = useMemo(() => {
    const order = new Map([...discordCategories.values()].map((c) => [c.id, c.position]));
    return groupBy(bridgeableDiscord, (c) => (c.parentId && discordCategories.has(c.parentId) ? c.parentId : null), order).map(([cat, chans]) => ({
      heading: cat ? discordCategories.get(cat)!.name : gt("No category"),
      options: chans.map((c) => {
        const taken = linkByDiscord.get(c.id);
        const other = taken ? serikaById.get(taken.serikaChannelId) : undefined;
        return { value: c.id, label: c.name, kind: c.kind === "announcement" ? "announcement" : "text", hint: taken ? (other ? gt("linked to #{name}", { name: other.name }) : gt("linked")) : undefined, disabled: Boolean(taken) };
      }),
    }));
  }, [bridgeableDiscord, discordCategories, linkByDiscord, serikaById, gt]);

  const linkedCount = bridgeableDiscord.filter((c) => linkByDiscord.has(c.id)).length;

  // ── Mutations ──
  const link = async (dc: DiscordChannelView, target: string) => {
    setBusyRow(dc.id);
    const create = target === PICK_CREATE;
    const res = await bridgeApi<BridgeState>(serverId, `/links/${dc.id}`, { method: "PUT", body: create ? { create: true } : { serikaChannelId: target } });
    setBusyRow(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not link that channel"));
      return;
    }
    onState(res.data);
    if (create) onChannelsCreated();
    const serika = res.data.links.find((l) => l.discordChannelId === dc.id);
    const serikaName = serika ? res.data.serikaChannels.find((c) => c.id === serika.serikaChannelId)?.name ?? "" : "";
    toast.success(create ? gt("Created #{serika} and linked it to #{discord}", { serika: serikaName, discord: dc.name }) : gt("Linked #{discord} to #{serika}", { discord: dc.name, serika: serikaName }));
  };

  const unlink = async (discordChannelId: string, rowKey: string) => {
    setBusyRow(rowKey);
    const res = await bridgeApi<BridgeState>(serverId, `/links/${discordChannelId}`, { method: "DELETE" });
    setBusyRow(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not unlink that channel"));
      return;
    }
    onState(res.data);
    toast.success(gt("Channel unlinked"));
  };

  const linkFromSerika = async (sc: SerikaChannelView, discordChannelId: string) => {
    if (discordChannelId === PICK_NONE) {
      const current = linkBySerika.get(sc.id);
      if (current) await unlink(current.discordChannelId, sc.id);
      return;
    }
    setBusyRow(sc.id);
    // Moving this SerikaCord channel to a different Discord channel: drop the old pair first.
    const current = linkBySerika.get(sc.id);
    if (current && current.discordChannelId !== discordChannelId) {
      const dropped = await bridgeApi<BridgeState>(serverId, `/links/${current.discordChannelId}`, { method: "DELETE" });
      if (!dropped.ok) {
        setBusyRow(null);
        toast.error(dropped.error || gt("Could not link that channel"));
        return;
      }
    }
    const res = await bridgeApi<BridgeState>(serverId, `/links/${discordChannelId}`, { method: "PUT", body: { serikaChannelId: sc.id } });
    setBusyRow(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not link that channel"));
      return;
    }
    onState(res.data);
    toast.success(gt("Linked #{discord} to #{serika}", { discord: discordById.get(discordChannelId)?.name ?? "", serika: sc.name }));
  };

  const saveOptions = async (discordChannelId: string, body: { options?: Partial<BridgeLinkOptions>; reset?: boolean }) => {
    const res = await bridgeApi<BridgeState>(serverId, `/links/${discordChannelId}/options`, { method: "PATCH", body });
    if (!res.ok) {
      toast.error(res.error || gt("Could not save the link options"));
      return;
    }
    onState(res.data);
    toast.success(body.reset ? gt("Link now follows the server defaults") : gt("Link options saved"));
  };

  const repair = async (discordChannelId: string) => {
    setBusyRow(discordChannelId);
    const res = await bridgeApi<BridgeState>(serverId, `/links/${discordChannelId}/repair`, { method: "POST" });
    setBusyRow(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not repair the link"));
      return;
    }
    onState(res.data);
    toast.success(gt("Webhook recreated. The link is working again."));
  };

  const bulk = async (action: "auto_match" | "create_missing" | "unlink_all") => {
    if (action === "unlink_all") {
      const ok = await confirm({
        title: gt("Unlink every channel?"),
        description: gt("Messages stop mirroring in all channels. The Discord server stays linked, and you can map channels again at any time."),
        confirmLabel: gt("Unlink all"),
      });
      if (!ok) return;
    }
    if (action === "create_missing") {
      const missing = bridgeableDiscord.length - linkedCount;
      const ok = await confirm({
        title: gt("Create {count} channels?", { count: missing }),
        description: gt("Every Discord channel that isn't bridged yet gets a new SerikaCord channel with the same name, placed in the matching category."),
        confirmLabel: gt("Create channels"),
        destructive: false,
      });
      if (!ok) return;
    }
    setBulkBusy(action);
    const res = await bridgeApi<BulkResult>(serverId, "/bulk", { method: "POST", body: { action } });
    setBulkBusy(null);
    if (!res.ok) {
      toast.error(res.error || gt("Something went wrong"));
      return;
    }
    onState(res.data.state);
    if (res.data.created > 0) onChannelsCreated();
    if (action === "unlink_all") toast.success(gt("Unlinked {count} channels", { count: res.data.unlinked }));
    else if (res.data.linked === 0 && res.data.failed.length === 0) toast.info(action === "auto_match" ? gt("No channels with matching names to link") : gt("Every Discord channel is already bridged"));
    else toast.success(gt("Linked {count} channels", { count: res.data.linked }));
    if (res.data.failed.length > 0) toast.error(gt("{count} channels could not be linked: {reason}", { count: res.data.failed.length, reason: res.data.failed[0].error }));
    if (res.data.skipped) toast.info(gt("{count} more remain. Run it again to continue.", { count: res.data.skipped }));
  };

  // ── Row bits ──
  const statusDot = (l: BridgeLinkView | undefined) => {
    if (!l) return null;
    const problem = healthMessage(l.health) || (!l.hasWebhook ? gt("No webhook on Discord yet. Repair the link to create one.") : null);
    const tone = problem ? "bg-red-500" : l.options.paused ? "bg-amber-500" : "bg-emerald-500";
    const label = problem || (l.options.paused ? gt("Paused") : gt("Working"));
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-label={label}>
            <span className={cn("size-2 rounded-full", tone)} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{label}</TooltipContent>
      </Tooltip>
    );
  };

  const rowActions = (l: BridgeLinkView | undefined) =>
    l ? (
      <div className="flex shrink-0 items-center gap-0.5">
        {(l.health?.error?.code === "webhook_missing" || !l.hasWebhook) && (
          <button type="button" className={cn(btnGhost, "h-8 px-2 text-red-500")} onClick={() => repair(l.discordChannelId)} disabled={busyRow === l.discordChannelId}>
            <Wrench className="size-3.5" aria-hidden="true" />
            <span className="max-sm:hidden"><T>Repair</T></span>
          </button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={cn(btnGhost, "h-8 w-8 px-0")} onClick={() => setEditing(l.discordChannelId)} aria-label={gt("Link options")}>
              <Settings2 className="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent><T>Link options</T></TooltipContent>
        </Tooltip>
      </div>
    ) : (
      <span className="hidden sm:block w-8 shrink-0" aria-hidden="true" />
    );

  const editingLink = editing ? linkByDiscord.get(editing) : undefined;

  if (!discordChannels) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        {loadingChannels ? (
          <>
            <Loader size={28} />
            <p className="text-sm text-[var(--text-secondary)]"><T>Loading Discord channels…</T></p>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm">{channelsError || gt("Could not load the Discord server's channels.")}</p>
            <button type="button" className={btnSecondary} onClick={onReloadChannels}>
              <RefreshCw className="size-4" aria-hidden="true" />
              <T>Try again</T>
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Discord view ──
  const discordOrder = new Map([...discordCategories.values()].map((c) => [c.id, c.position]));
  const discordRows = groupBy(
    bridgeableDiscord.filter((c) => {
      const l = linkByDiscord.get(c.id);
      return matches(c.name, l ? serikaById.get(l.serikaChannelId)?.name : undefined);
    }),
    (c) => (c.parentId && discordCategories.has(c.parentId) ? c.parentId : null),
    discordOrder,
  );

  // ── SerikaCord view ──
  const serikaOrder = new Map([...serikaCategories.values()].map((c) => [c.id, c.position ?? 0]));
  const serikaRows = groupBy(
    bridgeableSerika.filter((c) => {
      const l = linkBySerika.get(c.id);
      return matches(c.name, l ? discordById.get(l.discordChannelId)?.name : undefined);
    }),
    (c) => (c.parentId && serikaCategories.has(c.parentId) ? c.parentId : null),
    serikaOrder,
  );

  const empty = view === "discord" ? discordRows.length === 0 : serikaRows.length === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={gt("Search channels")}
            aria-label={gt("Search channels")}
            className="h-9 pl-9 bg-[var(--bg-app)] border-[var(--border-subtle)] text-[var(--text-primary)] text-sm"
          />
        </div>
        <div role="tablist" aria-label={gt("List channels from")} className="inline-flex shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-0.5">
          {(["discord", "serika"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "flex-1 h-8 px-3 rounded-md text-xs font-semibold transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]",
                view === v ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {v === "discord" ? gt("Discord channels") : gt("SerikaCord channels")}
            </button>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={cn(btnGhost, "h-9 w-9 px-0 shrink-0 max-sm:hidden")} onClick={onReloadChannels} disabled={loadingChannels} aria-label={gt("Refresh Discord channels")}>
              <RefreshCw className={cn("size-4", loadingChannels && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent><T>Refresh Discord channels</T></TooltipContent>
        </Tooltip>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--text-secondary)]">
          {gt("{linked} of {total} Discord channels bridged", { linked: linkedCount, total: bridgeableDiscord.length })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={cn(btnSecondary, "h-8 text-xs")} onClick={() => bulk("auto_match")} disabled={bulkBusy !== null}>
            {bulkBusy === "auto_match" ? <Loader size={14} /> : <Wand2 className="size-3.5" aria-hidden="true" />}
            <T>Auto-match by name</T>
          </button>
          <button type="button" className={cn(btnSecondary, "h-8 text-xs")} onClick={() => bulk("create_missing")} disabled={bulkBusy !== null || linkedCount === bridgeableDiscord.length}>
            {bulkBusy === "create_missing" ? <Loader size={14} /> : <Sparkles className="size-3.5" aria-hidden="true" />}
            <T>Create all missing</T>
          </button>
          <button type="button" className={cn(btnGhost, "h-8 text-xs text-red-500 hover:text-red-500")} onClick={() => bulk("unlink_all")} disabled={bulkBusy !== null || state.links.length === 0}>
            {bulkBusy === "unlink_all" ? <Loader size={14} /> : <Unlink className="size-3.5" aria-hidden="true" />}
            <T>Unlink all</T>
          </button>
        </div>
      </div>

      {/* Column headings (wide screens) */}
      <div className="hidden sm:flex items-center gap-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        <span className="w-[42%]">{view === "discord" ? gt("Discord channel") : gt("SerikaCord channel")}</span>
        <span className="w-6" />
        <span className="flex-1">{view === "discord" ? gt("SerikaCord channel") : gt("Discord channel")}</span>
      </div>

      {empty ? (
        <p className="py-10 text-center text-sm text-[var(--text-secondary)]">
          {q ? gt("No channels match your search.") : view === "discord" ? gt("This Discord server has no text or announcement channels the bot can see.") : gt("This server has no text or announcement channels yet.")}
        </p>
      ) : view === "discord" ? (
        <div className="space-y-4">
          {discordRows.map(([cat, chans]) => (
            <section key={cat ?? "none"} aria-label={cat ? discordCategories.get(cat)?.name : gt("No category")}>
              <h4 className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{cat ? discordCategories.get(cat)?.name : gt("No category")}</h4>
              <ul className="space-y-1">
                {chans.map((dc) => {
                  const l = linkByDiscord.get(dc.id);
                  const target = l ? serikaById.get(l.serikaChannelId) : undefined;
                  return (
                    <li
                      key={dc.id}
                      className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5 transition-colors duration-150 ease-out hover:border-[var(--border-strong)] sm:flex-row sm:items-center sm:gap-3 sm:border-transparent sm:bg-transparent sm:px-3 sm:py-1.5 sm:hover:bg-[var(--bg-hover)]"
                    >
                      <div className="flex min-w-0 items-center gap-2 sm:w-[42%]">
                        <DiscordMark className="size-3.5 shrink-0 text-[var(--discord-brand)]" />
                        <ChannelGlyph kind={dc.kind} />
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{dc.name}</span>
                      </div>
                      <DirectionGlyph link={l} />
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        {statusDot(l)}
                        <div className="min-w-0 flex-1">
                          <ChannelPicker
                            value={l?.serikaChannelId ?? null}
                            groups={serikaGroups}
                            createLabel={gt("Create new channel #{name}", { name: dc.name })}
                            busy={busyRow === dc.id}
                            ariaLabel={gt("SerikaCord channel for #{name}", { name: dc.name })}
                            onSelect={(v) => (v === PICK_NONE ? unlink(dc.id, dc.id) : link(dc, v))}
                            trigger={
                              target ? (
                                <>
                                  <ChannelGlyph kind={target.type} />
                                  <span className="truncate">{target.name}</span>
                                </>
                              ) : (
                                <span className="truncate"><T>Don&apos;t bridge</T></span>
                              )
                            }
                          />
                        </div>
                        {rowActions(l)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {serikaRows.map(([cat, chans]) => (
            <section key={cat ?? "none"} aria-label={cat ? serikaCategories.get(cat)?.name : gt("No category")}>
              <h4 className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{cat ? serikaCategories.get(cat)?.name : gt("No category")}</h4>
              <ul className="space-y-1">
                {chans.map((sc) => {
                  const l = linkBySerika.get(sc.id);
                  const target = l ? discordById.get(l.discordChannelId) : undefined;
                  return (
                    <li
                      key={sc.id}
                      className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5 transition-colors duration-150 ease-out hover:border-[var(--border-strong)] sm:flex-row sm:items-center sm:gap-3 sm:border-transparent sm:bg-transparent sm:px-3 sm:py-1.5 sm:hover:bg-[var(--bg-hover)]"
                    >
                      <div className="flex min-w-0 items-center gap-2 sm:w-[42%]">
                        <ChannelGlyph kind={sc.type} />
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{sc.name}</span>
                      </div>
                      <DirectionGlyph link={l} />
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        {statusDot(l)}
                        <div className="min-w-0 flex-1">
                          <ChannelPicker
                            value={l?.discordChannelId ?? null}
                            groups={discordGroups}
                            busy={busyRow === sc.id || (l ? busyRow === l.discordChannelId : false)}
                            ariaLabel={gt("Discord channel for #{name}", { name: sc.name })}
                            onSelect={(v) => linkFromSerika(sc, v)}
                            trigger={
                              target ? (
                                <>
                                  <DiscordMark className="size-3.5 shrink-0 text-[var(--discord-brand)]" />
                                  <span className="truncate">{target.name}</span>
                                </>
                              ) : l ? (
                                <span className="truncate text-[var(--text-secondary)]"><T>Discord channel not found</T></span>
                              ) : (
                                <span className="truncate"><T>Don&apos;t bridge</T></span>
                              )
                            }
                          />
                        </div>
                        {rowActions(l)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={Boolean(editingLink)} onOpenChange={(open) => !open && setEditing(null)}>
        {editingLink && (
          <DialogContent className="sm:max-w-lg bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="truncate">#{discordById.get(editingLink.discordChannelId)?.name ?? "discord"}</span>
                <ArrowLeftRight className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                <span className="truncate">#{serikaById.get(editingLink.serikaChannelId)?.name ?? "serikacord"}</span>
              </DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                <T>Options for this link. Anything you don&apos;t change here follows the server defaults in the Options tab.</T>
              </DialogDescription>
            </DialogHeader>
            <LinkOptionsForm
              value={editingLink.options}
              inherited={{ ...state.defaults, paused: false }}
              showPause
              onChange={(patch) => saveOptions(editingLink.discordChannelId, { options: patch })}
            />
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <button
                type="button"
                className={btnGhost}
                onClick={() => saveOptions(editingLink.discordChannelId, { reset: true })}
                disabled={Object.keys(editingLink.overrides).length === 0}
              >
                <T>Reset to server defaults</T>
              </button>
              <button
                type="button"
                className={cn(btnGhost, "text-red-500 hover:text-red-500")}
                onClick={async () => {
                  setEditing(null);
                  await unlink(editingLink.discordChannelId, editingLink.discordChannelId);
                }}
              >
                <Unlink className="size-4" aria-hidden="true" />
                <T>Unlink</T>
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
