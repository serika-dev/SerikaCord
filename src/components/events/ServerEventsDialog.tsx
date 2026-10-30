"use client";

/**
 * Server events (Discord "Events"): list of upcoming/live events, an event's
 * details with its Interested list, and the create / edit form. Lazy-loaded by
 * ServerEventsEntry. Rules live in lib/chat/scheduledEvents.ts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarDays, CalendarPlus, Check, ImagePlus, MapPin, MoreHorizontal, Pencil, Play, Radio, Square, Star, Trash2, Users, Volume2, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useImageCropper } from "@/components/ui/useImageCropper";
import { cdnImage, cn } from "@/lib/utils";
import {
  MAX_EVENT_DESCRIPTION_LENGTH, MAX_EVENT_LOCATION_LENGTH, MAX_EVENT_NAME_LENGTH, defaultEventStart, fromLocalInputValue, isStartingSoon,
  sortEvents, toLocalInputValue, type EventEntityType, type EventStatus,
} from "@/lib/chat/scheduledEvents";
import type { EventUser, ServerEventView } from "@/components/events/types";

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "form"; editing: ServerEventView | null };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  events: ServerEventView[];
  canCreate: boolean;
  canManage: boolean;
  focusEventId: string | null;
  onChanged: () => void;
}

const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: {} };
  }
}

function useWhen() {
  const locale = useLocale();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale || undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return (iso: string) => fmt.format(new Date(iso));
  }, [locale]);
}

export function ServerEventsDialog({ open, onOpenChange, serverId, events, canCreate, canManage, focusEventId, onChanged }: Props) {
  const gt = useGT();
  const { user } = useAuth();
  const [view, setView] = useState<View>(() => (focusEventId ? { kind: "detail", id: focusEventId } : { kind: "list" }));
  const sorted = useMemo(() => sortEvents(events), [events]);
  const mayManage = (ev: ServerEventView) => canManage || (canCreate && same(ev.creatorId, user?.id));
  const detail = view.kind === "detail" ? sorted.find((e) => same(e.id, view.id)) ?? null : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] p-0 gap-0 sm:max-w-xl max-h-[85dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 h-14 border-b border-[var(--border-subtle)] shrink-0">
          {view.kind !== "list" && (
            <button type="button" onClick={() => setView({ kind: "list" })} aria-label={gt("Back")} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <CalendarDays className="h-5 w-5 text-[var(--text-secondary)]" />
          <DialogTitle className="flex-1 text-base font-semibold truncate">
            {view.kind === "form" ? (view.editing ? gt("Edit Event") : gt("Create Event")) : sorted.length === 1 ? gt("1 Event") : gt("{count} Events", { count: sorted.length })}
          </DialogTitle>
          {view.kind === "list" && canCreate && (
            <button
              type="button"
              onClick={() => setView({ kind: "form", editing: null })}
              className="flex items-center gap-1.5 rounded-md bg-[var(--app-accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-on-accent)] hover:opacity-90"
            >
              <CalendarPlus className="h-4 w-4" /> {gt("Create Event")}
            </button>
          )}
          <button type="button" onClick={() => onOpenChange(false)} aria-label={gt("Close")} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {view.kind === "list" && (
            sorted.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <CalendarDays className="h-10 w-10 text-[var(--text-muted)]" />
                <p className="font-semibold">{gt("There are no upcoming events.")}</p>
                <p className="text-sm text-[var(--text-muted)]">{gt("Schedule an event for any planned activity in your server.")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {sorted.map((ev) => (
                  <EventCard
                    key={ev.id}
                    ev={ev}
                    serverId={serverId}
                    manageable={mayManage(ev)}
                    onOpen={() => setView({ kind: "detail", id: ev.id })}
                    onEdit={() => setView({ kind: "form", editing: ev })}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            )
          )}
          {view.kind === "detail" && (
            detail ? (
              <EventDetail
                ev={detail}
                serverId={serverId}
                manageable={mayManage(detail)}
                onEdit={() => setView({ kind: "form", editing: detail })}
                onChanged={onChanged}
              />
            ) : (
              <p className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">{gt("This event has ended or no longer exists.")}</p>
            )
          )}
          {view.kind === "form" && (
            <EventForm
              key={view.editing?.id ?? "new"}
              serverId={serverId}
              editing={view.editing}
              onDone={(saved) => {
                onChanged();
                setView(saved ? { kind: "detail", id: saved } : { kind: "list" });
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card / detail ────────────────────────────────────────────────────────────

function useEventActions(ev: ServerEventView, serverId: string, onChanged: () => void) {
  const gt = useGT();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const base = `/api/servers/${serverId}/scheduled-events/${ev.id}`;

  const toggleInterest = async () => {
    if (busy) return;
    setBusy(true);
    const { ok, data } = await api(`${base}/users/@me`, { method: ev.interested ? "DELETE" : "PUT" });
    setBusy(false);
    if (!ok) toast.error(typeof data.error === "string" ? data.error : gt("Something went wrong"));
    onChanged();
  };

  const setStatus = async (status: EventStatus) => {
    if (status === "canceled") {
      const yes = await confirm({
        title: gt("Cancel Event"),
        description: gt("Are you sure you want to cancel \"{name}\"?", { name: ev.name }),
        confirmLabel: gt("Cancel Event"),
      });
      if (!yes) return;
    }
    setBusy(true);
    const { ok, data } = await api(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (!ok) toast.error(typeof data.error === "string" ? data.error : gt("Something went wrong"));
    onChanged();
  };

  return { busy, toggleInterest, setStatus };
}

function EventWhen({ ev }: { ev: ServerEventView }) {
  const gt = useGT();
  const when = useWhen();
  if (ev.status === "active") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
        <Radio className="h-3.5 w-3.5" /> {gt("Happening now")}
      </span>
    );
  }
  return (
    <span className={cn("flex items-center gap-1.5 text-xs font-semibold", isStartingSoon(ev) ? "text-[var(--app-accent)]" : "text-[var(--text-secondary)]")}>
      <CalendarDays className="h-3.5 w-3.5" /> {when(ev.startAt)}
      {ev.endAt ? ` – ${when(ev.endAt)}` : ""}
    </span>
  );
}

function EventPlace({ ev }: { ev: ServerEventView }) {
  if (ev.entityType === "external") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--text-secondary)]">
        <MapPin className="h-4 w-4 shrink-0" /> <span className="truncate">{ev.location}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--text-secondary)]">
      {ev.entityType === "stage" ? <Radio className="h-4 w-4 shrink-0" /> : <Volume2 className="h-4 w-4 shrink-0" />}
      <span className="truncate">{ev.channelName ?? ""}</span>
    </span>
  );
}

function ManageMenu({ ev, onEdit, setStatus }: { ev: ServerEventView; onEdit: () => void; setStatus: (s: EventStatus) => void }) {
  const gt = useGT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={gt("More")} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
        <DropdownMenuItem onSelect={onEdit} className="cursor-pointer">
          <Pencil className="mr-2 h-4 w-4" /> {gt("Edit Event")}
        </DropdownMenuItem>
        {ev.status === "scheduled" && (
          <DropdownMenuItem onSelect={() => setStatus("active")} className="cursor-pointer">
            <Play className="mr-2 h-4 w-4" /> {gt("Start Event")}
          </DropdownMenuItem>
        )}
        {ev.status === "active" && (
          <DropdownMenuItem onSelect={() => setStatus("completed")} className="cursor-pointer">
            <Square className="mr-2 h-4 w-4" /> {gt("End Event")}
          </DropdownMenuItem>
        )}
        {ev.status === "scheduled" && (
          <DropdownMenuItem onSelect={() => setStatus("canceled")} className="cursor-pointer text-red-500 focus:text-red-500">
            <Trash2 className="mr-2 h-4 w-4" /> {gt("Cancel Event")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InterestButton({ ev, busy, onClick }: { ev: ServerEventView; busy: boolean; onClick: () => void }) {
  const gt = useGT();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-pressed={ev.interested}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
        ev.interested
          ? "bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:opacity-90"
          : "bg-[var(--app-surface-alt)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {ev.interested ? <Check className="h-4 w-4" /> : <Star className="h-4 w-4" />}
      {gt("Interested")}
    </button>
  );
}

function EventCard({ ev, serverId, manageable, onOpen, onEdit, onChanged }: {
  ev: ServerEventView; serverId: string; manageable: boolean; onOpen: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const gt = useGT();
  const { busy, toggleInterest, setStatus } = useEventActions(ev, serverId, onChanged);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      {ev.image && (
        <button type="button" onClick={onOpen} className="block w-full">
          <img src={cdnImage(ev.image)} alt="" className="h-32 w-full object-cover" />
        </button>
      )}
      <div className="flex flex-col gap-1.5 p-3">
        <EventWhen ev={ev} />
        <button type="button" onClick={onOpen} className="text-left text-base font-semibold hover:underline break-words">
          {ev.name}
        </button>
        {ev.description && <p className="line-clamp-2 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{ev.description}</p>}
        <div className="mt-1 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2">
          <div className="min-w-0 flex-1"><EventPlace ev={ev} /></div>
          <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]" title={gt("Interested")}>
            <Users className="h-3.5 w-3.5" /> {ev.userCount}
          </span>
          {manageable && <ManageMenu ev={ev} onEdit={onEdit} setStatus={(s) => void setStatus(s)} />}
          <InterestButton ev={ev} busy={busy} onClick={() => void toggleInterest()} />
        </div>
      </div>
    </div>
  );
}

function EventDetail({ ev, serverId, manageable, onEdit, onChanged }: {
  ev: ServerEventView; serverId: string; manageable: boolean; onEdit: () => void; onChanged: () => void;
}) {
  const gt = useGT();
  const { busy, toggleInterest, setStatus } = useEventActions(ev, serverId, onChanged);
  const [tab, setTab] = useState<"info" | "interested">("info");
  const [users, setUsers] = useState<EventUser[] | null>(null);
  const creatorName = ev.creator ? ev.creator.displayName || ev.creator.username : null;

  useEffect(() => {
    if (tab !== "interested") return;
    let alive = true;
    void api(`/api/servers/${serverId}/scheduled-events/${ev.id}/users`).then(({ ok, data }) => {
      if (alive) setUsers(ok && Array.isArray(data.users) ? (data.users as EventUser[]) : []);
    });
    return () => { alive = false; };
  }, [tab, serverId, ev.id, ev.userCount]);

  return (
    <div className="flex flex-col">
      {ev.image && <img src={cdnImage(ev.image)} alt="" className="h-40 w-full object-cover" />}
      <div className="flex flex-col gap-2 p-4">
        <EventWhen ev={ev} />
        <h3 className="text-xl font-bold break-words">{ev.name}</h3>
        <div className="flex gap-4 border-b border-[var(--border-subtle)] text-sm">
          {(["info", "interested"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn("-mb-px border-b-2 pb-2 font-medium", tab === k ? "border-[var(--app-accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]")}
            >
              {k === "info" ? gt("Event Info") : gt("{count} Interested", { count: ev.userCount })}
            </button>
          ))}
        </div>
        {tab === "info" ? (
          <div className="flex flex-col gap-2 pt-1">
            <EventPlace ev={ev} />
            {creatorName && (
              <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                <Avatar className="h-4 w-4">
                  {ev.creator?.avatar && <AvatarImage src={cdnImage(ev.creator.avatar)} />}
                  <AvatarFallback className="text-[8px]">{creatorName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                {gt("Created by {name}", { name: creatorName })}
              </span>
            )}
            {ev.description && <p className="whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">{ev.description}</p>}
          </div>
        ) : users === null ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">{gt("Loading...")}</p>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">{gt("No one has marked this event as interested yet.")}</p>
        ) : (
          <ul className="flex flex-col gap-1 pt-1">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                <Avatar className="h-8 w-8">
                  {u.avatar && <AvatarImage src={cdnImage(u.avatar)} />}
                  <AvatarFallback>{(u.displayName || u.username).slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate text-sm font-medium">{u.displayName || u.username}</span>
                {u.displayName && <span className="truncate text-xs text-[var(--text-muted)]">{u.username}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          {manageable && <ManageMenu ev={ev} onEdit={onEdit} setStatus={(s) => void setStatus(s)} />}
          <InterestButton ev={ev} busy={busy} onClick={() => void toggleInterest()} />
        </div>
      </div>
    </div>
  );
}

// ─── Create / edit form ───────────────────────────────────────────────────────

const fieldClass =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input,var(--bg-card))] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/50";

function EventForm({ serverId, editing, onDone }: { serverId: string; editing: ServerEventView | null; onDone: (savedId: string | null) => void }) {
  const gt = useGT();
  const { channels, channelsServerId } = useServer();
  const started = editing?.status === "active";
  const [entityType, setEntityType] = useState<EventEntityType>(editing?.entityType ?? "voice");
  const [channelId, setChannelId] = useState<string>(editing?.channelId ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [start, setStart] = useState(() => toLocalInputValue(editing?.startAt ?? defaultEventStart()));
  const [end, setEnd] = useState(() => toLocalInputValue(editing?.endAt ?? null));
  const [image, setImage] = useState<string | null>(editing?.image ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cropper = useImageCropper();

  const options = useMemo(
    () => (same(channelsServerId, serverId) ? channels : []).filter((c) => c.type === (entityType === "stage" ? "stage" : "voice")),
    [channels, channelsServerId, serverId, entityType],
  );
  const chosenChannel = options.some((c) => same(c.id, channelId)) ? channelId : options[0]?.id ?? "";

  const upload = async (picked: File) => {
    const file = await cropper.prepare(picked, "eventCover");
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file, file.name);
    const { ok, data } = await api(`/api/servers/${serverId}/scheduled-events/cover`, { method: "POST", body: form });
    setUploading(false);
    if (ok && typeof data.url === "string") setImage(data.url);
    else toast.error(typeof data.error === "string" ? data.error : gt("Failed to upload the cover image"));
  };

  const submit = async () => {
    if (saving) return;
    const body: Record<string, unknown> = {
      name,
      description,
      entityType,
      channelId: entityType === "external" ? null : chosenChannel || null,
      location: entityType === "external" ? location : null,
      image,
      endAt: fromLocalInputValue(end),
    };
    if (!started) body.startAt = fromLocalInputValue(start);
    setSaving(true);
    const url = editing ? `/api/servers/${serverId}/scheduled-events/${editing.id}` : `/api/servers/${serverId}/scheduled-events`;
    const { ok, data } = await api(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) {
      toast.error(typeof data.error === "string" ? data.error : gt("Something went wrong"));
      return;
    }
    toast.success(editing ? gt("Event updated") : gt("Event created"));
    const saved = (data.event as { id?: string } | undefined)?.id ?? null;
    onDone(saved);
  };

  const typeOptions: Array<{ id: EventEntityType; label: string; hint: string; icon: typeof Volume2 }> = [
    { id: "voice", label: gt("Voice Channel"), hint: gt("Hang out with voice, video and screen share"), icon: Volume2 },
    { id: "stage", label: gt("Stage Channel"), hint: gt("Speak to an audience"), icon: Radio },
    { id: "external", label: gt("Somewhere Else"), hint: gt("Text channel, external link or in-person location"), icon: MapPin },
  ];

  return (
    <form
      className="flex flex-col gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2" disabled={started}>
        <legend className="mb-1 text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Where is your event?")}</legend>
        {typeOptions.map((o) => (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2",
              entityType === o.id ? "border-[var(--app-accent)] bg-[var(--app-surface-alt)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]",
              started && "cursor-not-allowed opacity-60",
            )}
          >
            <input type="radio" name="entityType" className="sr-only" checked={entityType === o.id} onChange={() => setEntityType(o.id)} />
            <o.icon className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{o.label}</span>
              <span className="text-xs text-[var(--text-muted)]">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {entityType === "external" ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Location")}</span>
          <input className={fieldClass} value={location} maxLength={MAX_EVENT_LOCATION_LENGTH} onChange={(e) => setLocation(e.target.value)} placeholder={gt("Add a location, link, or something.")} required />
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Select a channel")}</span>
          <select className={fieldClass} value={chosenChannel} disabled={started} onChange={(e) => setChannelId(e.target.value)} required>
            {options.length === 0 && <option value="">{entityType === "stage" ? gt("No stage channels") : gt("No voice channels")}</option>}
            {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Event Topic")}</span>
        <input className={fieldClass} value={name} maxLength={MAX_EVENT_NAME_LENGTH} onChange={(e) => setName(e.target.value)} placeholder={gt("What's your event?")} required />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Start Date & Time")}</span>
          <input type="datetime-local" className={fieldClass} value={start} disabled={started} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">
            {entityType === "external" ? gt("End Date & Time") : gt("End Date & Time (optional)")}
          </span>
          <input type="datetime-local" className={fieldClass} value={end} onChange={(e) => setEnd(e.target.value)} required={entityType === "external"} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Description")}</span>
        <textarea className={cn(fieldClass, "min-h-[90px] resize-y")} value={description} maxLength={MAX_EVENT_DESCRIPTION_LENGTH} onChange={(e) => setDescription(e.target.value)} placeholder={gt("Tell people a little more about your event.")} />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Cover Image")}</span>
        {image ? (
          <div className="relative overflow-hidden rounded-md border border-[var(--border-subtle)]">
            <img src={cdnImage(image)} alt="" className="h-32 w-full object-cover" />
            <button type="button" onClick={() => setImage(null)} aria-label={gt("Remove")} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="flex h-20 items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            <ImagePlus className="h-5 w-5" /> {uploading ? gt("Uploading...") : gt("Upload Cover Image")}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        {cropper.element}
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
        <button type="button" onClick={() => onDone(editing?.id ?? null)} className="rounded-md px-4 py-2 text-sm text-[var(--text-secondary)] hover:underline">
          {gt("Cancel")}
        </button>
        <button type="submit" disabled={saving || uploading} className="rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] hover:opacity-90 disabled:opacity-60">
          {saving ? gt("Saving...") : editing ? gt("Save Event") : gt("Create Event")}
        </button>
      </div>
    </form>
  );
}
