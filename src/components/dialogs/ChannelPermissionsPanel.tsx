"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Lock, Plus, RefreshCw, Shield, Slash, Trash2, User as UserIcon, X } from "lucide-react";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useServerMembersOptional } from "@/contexts/ServerContext";
import { cn, cdnImage } from "@/lib/utils";
import { PERMISSION_BITS, type PermissionName } from "@/lib/permissions/bits";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsSection,
  SettingsToggleRow,
} from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import {
  accessHolders,
  addOverwrite,
  clearOverwrite,
  getOverwriteState,
  isPrivateChannel,
  overwritesInSync,
  permissionGroupsFor,
  removeOverwrite,
  setOverwriteState,
  setPrivateChannel,
  type EditableOverwrite,
  type OverwriteState,
  type PermissionGroup,
} from "@/lib/permissions/overwriteEditor";

export interface PanelRole {
  id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
  position?: number;
}

interface PanelMember {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string | null;
}

const PERMISSION_META = new Map<bigint, { label: string; description: string }>(
  ROLE_PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => [p.bit, { label: p.label, description: p.description }] as const)),
);

type Target = { id: string; type: "role" | "member" };
const sameTarget = (a: Target, b: Target) => a.type === b.type && a.id.toLowerCase() === b.id.toLowerCase();

/** Discord's deny / inherit / allow switch for one permission of one override. */
function TriState({
  state,
  onSet,
  label,
  labels,
  disabled,
}: {
  state: OverwriteState;
  onSet: (s: OverwriteState) => void;
  label: string;
  labels: { deny: string; inherit: string; allow: string };
  disabled?: boolean;
}) {
  const cell = "flex h-7 w-8 items-center justify-center transition-colors duration-(--motion-fast) disabled:cursor-not-allowed max-md:h-10 max-md:w-11";
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)]">
      <button
        type="button"
        role="radio"
        aria-checked={state === "deny"}
        aria-label={labels.deny}
        title={labels.deny}
        disabled={disabled}
        onClick={() => onSet("deny")}
        className={cn(cell, state === "deny" ? "bg-red-500 text-white" : "text-red-500 hover:bg-red-500/10")}
      >
        <X className="h-4 w-4" />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={state === "neutral"}
        aria-label={labels.inherit}
        title={labels.inherit}
        disabled={disabled}
        onClick={() => onSet("neutral")}
        className={cn(
          cell,
          "border-x border-[var(--border-subtle)]",
          state === "neutral" ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]",
        )}
      >
        <Slash className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={state === "allow"}
        aria-label={labels.allow}
        title={labels.allow}
        disabled={disabled}
        onClick={() => onSet("allow")}
        className={cn(cell, state === "allow" ? "bg-green-600 text-white" : "text-green-600 hover:bg-green-500/10")}
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Channel Settings → Permissions, laid out like Discord's: category sync
 * banner, the "Private Channel" toggle with who can see it, then Advanced
 * permissions (roles / members on the left, tri-state permission rows on the
 * right). Every change edits `overwrites` (the dialog's draft); nothing is
 * saved here.
 */
export function ChannelPermissionsPanel({
  channel,
  parent,
  serverId,
  roles,
  overwrites,
  onChange,
  disabled = false,
}: {
  channel: { id: string; name: string; type: string };
  parent: { id: string; name: string; permissionOverwrites?: EditableOverwrite[] } | null;
  serverId: string;
  roles: PanelRole[];
  overwrites: EditableOverwrite[];
  onChange: (next: EditableOverwrite[]) => void;
  disabled?: boolean;
}) {
  const gt = useGT();
  const rawMembers = useServerMembersOptional()?.members;
  const members = useMemo(() => (rawMembers || []) as PanelMember[], [rawMembers]);
  const isCategory = channel.type === "category";
  const isVoice = channel.type === "voice" || channel.type === "stage";
  const everyoneRole = roles.find((r) => r.isDefault) ?? null;
  const everyoneId = everyoneRole?.id ?? null;

  const [selected, setSelected] = useState<Target | null>(null);
  const [permQuery, setPermQuery] = useState("");

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id.toLowerCase(), r] as const)), [roles]);
  const memberById = useMemo(() => new Map(members.map((mem) => [String(mem.id).toLowerCase(), mem] as const)), [members]);

  const synced = parent ? overwritesInSync(overwrites, parent.permissionOverwrites || []) : false;
  const isPrivate = isPrivateChannel(overwrites, everyoneId, serverId);
  const holders = useMemo(() => accessHolders(overwrites, everyoneId), [overwrites, everyoneId]);
  const isEveryone = (t: Target) =>
    t.type === "role" && ((everyoneId && t.id.toLowerCase() === everyoneId.toLowerCase()) || t.id.toLowerCase() === serverId.toLowerCase());

  const targetName = (t: Target) => {
    if (t.type === "member") {
      const mem = memberById.get(t.id.toLowerCase());
      return mem ? mem.displayName || mem.username : gt("Unknown member");
    }
    if (isEveryone(t)) return "@everyone";
    return roleById.get(t.id.toLowerCase())?.name ?? gt("Deleted role");
  };

  const targetBadge = (t: Target, size = "h-5 w-5") => {
    if (t.type === "member") {
      const mem = memberById.get(t.id.toLowerCase());
      return (
        <Avatar className={cn(size, "shrink-0")}>
          <AvatarImage src={cdnImage(mem?.avatar || undefined)} />
          <AvatarFallback className="bg-[var(--bg-active)] text-[9px]">{(mem?.username || "?").charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      );
    }
    const role = roleById.get(t.id.toLowerCase());
    return (
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-full border border-[var(--border-subtle)]"
        style={{ backgroundColor: role?.color || "var(--text-muted)" }}
      />
    );
  };

  // Left list: roles by position (@everyone last, as in Discord), then members.
  // @everyone is always there even without an overwrite yet.
  const listed = useMemo(() => {
    const rows = overwrites
      .filter((o) => o.type === "role")
      .sort((a, b) => {
        const aEveryone = Boolean(everyoneId && a.id.toLowerCase() === everyoneId.toLowerCase());
        const bEveryone = Boolean(everyoneId && b.id.toLowerCase() === everyoneId.toLowerCase());
        if (aEveryone !== bEveryone) return aEveryone ? 1 : -1;
        return (roleById.get(b.id.toLowerCase())?.position ?? 0) - (roleById.get(a.id.toLowerCase())?.position ?? 0);
      })
      .concat(overwrites.filter((o) => o.type === "member"));
    if (everyoneId && !rows.some((o) => o.type === "role" && o.id.toLowerCase() === everyoneId.toLowerCase())) {
      rows.push({ id: everyoneId, type: "role", allow: "0", deny: "0" });
    }
    return rows;
  }, [overwrites, everyoneId, roleById]);

  const activeTarget: Target | null =
    (selected && listed.some((o) => sameTarget(o, selected)) ? selected : null) ??
    (listed[0] ? { id: listed[0].id, type: listed[0].type } : null);
  const activeOverwrite = activeTarget ? overwrites.find((o) => sameTarget(o, activeTarget)) ?? null : null;

  // Phones stack the list above the editor: bring the editor into view on pick.
  const selectTarget = (t: Target) => {
    setSelected(t);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches) {
      requestAnimationFrame(() => document.querySelector("[data-perm-editor]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const grantAccess = (t: Target) => {
    let next = setOverwriteState(overwrites, t, PERMISSION_BITS.VIEW_CHANNEL, "allow");
    if (isVoice) next = setOverwriteState(next, t, PERMISSION_BITS.CONNECT, "allow");
    onChange(next);
  };

  const removeAccess = (t: Target) => {
    let next = setOverwriteState(overwrites, t, PERMISSION_BITS.VIEW_CHANNEL, "neutral");
    if (isVoice) next = setOverwriteState(next, t, PERMISSION_BITS.CONNECT, "neutral");
    // Drop overwrites that no longer carry anything.
    onChange(next.filter((o) => !(sameTarget(o, t) && o.allow === "0" && o.deny === "0")));
  };

  const addAdvanced = (t: Target) => {
    onChange(addOverwrite(overwrites, t));
    selectTarget(t);
  };

  const groupLabel = (g: PermissionGroup["id"]) => {
    switch (g) {
      case "general": return isCategory ? gt("General Category Permissions") : gt("General Channel Permissions");
      case "membership": return gt("Membership Permissions");
      case "text": return gt("Text Channel Permissions");
      case "voice": return gt("Voice Channel Permissions");
      case "stage": return gt("Stage Channel Permissions");
      case "events": return gt("Events Permissions");
      case "apps": return gt("Apps Permissions");
    }
  };

  const permLabel = (key: PermissionName) => {
    if (key === "VIEW_CHANNEL") return isCategory ? gt("View Channels") : gt("View Channel");
    if (key === "MANAGE_CHANNELS") return isCategory ? gt("Manage Channels") : gt("Manage Channel");
    if (key === "MANAGE_ROLES") return gt("Manage Permissions");
    return PERMISSION_META.get(PERMISSION_BITS[key])?.label ?? key;
  };
  const permDescription = (key: PermissionName) => {
    if (key === "VIEW_CHANNEL") return gt("Allows members to view this channel by default. Disabling this for @everyone will make the channel private.");
    if (key === "MANAGE_ROLES") return gt("Allows members to change this channel's permissions.");
    return PERMISSION_META.get(PERMISSION_BITS[key])?.description ?? "";
  };

  const groups = permissionGroupsFor(channel.type);
  const q = permQuery.trim().toLowerCase();
  const triLabels = { deny: gt("Deny"), inherit: gt("Inherit"), allow: gt("Allow") };
  const visibleGroups = groups
    .map((g) => ({ ...g, keys: g.keys.filter((k) => !q || permLabel(k).toLowerCase().includes(q) || permDescription(k).toLowerCase().includes(q)) }))
    .filter((g) => g.keys.length > 0);

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={isCategory ? gt("Category Permissions") : gt("Channel Permissions")}
        description={gt("Use permissions to customise who can do what in this channel.")}
        className="mb-0"
      />

      {/* Category sync status */}
      {parent && !isCategory && (
        synced ? (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            <RefreshCw className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
            <span className="min-w-0">
              {gt("Permissions synced with category:")} <strong className="text-[var(--text-primary)]">{parent.name}</strong>
            </span>
          </div>
        ) : (
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3 text-[var(--text-primary)]">
              <AlertCircle className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <span className="min-w-0">
                {gt("Permissions not synced with category:")} <strong>{parent.name}</strong>
              </span>
            </div>
            <SettingsButton
              size="sm"
              variant="secondary"
              className="self-start sm:self-auto"
              disabled={disabled}
              onClick={() => onChange((parent.permissionOverwrites || []).map((o) => ({ ...o })))}
            >
              <RefreshCw />
              {gt("Sync Now")}
            </SettingsButton>
          </div>
        )
      )}
      {isCategory && (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <RefreshCw className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
          <span>{gt("Changes here also apply to every channel in this category that is synced with it.")}</span>
        </div>
      )}

      {/* Private channel */}
      <SettingsCard>
        <SettingsToggleRow
          icon={Lock}
          label={isCategory ? gt("Private Category") : gt("Private Channel")}
          description={
            isCategory
              ? gt("By making a category private, only selected members and roles will be able to view this category. Synced channels in this category will also be updated.")
              : gt("By making a channel private, only selected members and roles will be able to view this channel.")
          }
          checked={isPrivate}
          disabled={disabled || !everyoneId}
          onCheckedChange={(checked) => everyoneId && onChange(setPrivateChannel(overwrites, everyoneId, checked, { voice: isVoice }))}
        />
        {isPrivate && (
          <div className="space-y-3 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                {isCategory ? gt("Who can access this category?") : gt("Who can access this channel?")}
              </span>
              <TargetPicker
                roles={roles}
                members={members}
                exclude={holders}
                onPick={grantAccess}
                disabled={disabled}
                renderBadge={targetBadge}
                trigger={
                  <SettingsButton size="sm" variant="primary" disabled={disabled}>
                    <Plus />
                    {gt("Add members or roles")}
                  </SettingsButton>
                }
              />
            </div>
            {holders.length === 0 ? (
              <p className="text-[13px] text-[var(--text-secondary)]">
                {gt("Only administrators and the server owner can see this channel. Add roles or members to give them access.")}
              </p>
            ) : (
              <ul className="-mx-1.5 space-y-0.5">
                {holders.map((o) => {
                  const t: Target = { id: o.id, type: o.type };
                  return (
                    <li key={`${o.type}-${o.id}`} className="group/holder flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-[var(--bg-hover)] max-md:py-2.5">
                      {targetBadge(t, "h-6 w-6")}
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{targetName(t)}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{o.type === "role" ? gt("Role") : gt("Member")}</span>
                      <button
                        type="button"
                        onClick={() => removeAccess(t)}
                        disabled={disabled}
                        title={gt("Remove")}
                        aria-label={gt("Remove")}
                        className="rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40 max-md:p-2"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </SettingsCard>

      {/* Advanced permissions */}
      <SettingsSection
        title={gt("Advanced permissions")}
        description={gt("Allow or deny single permissions for a role or member. Anything left on inherit uses their server role permissions.")}
      >
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b border-[var(--border-subtle)] p-2 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between px-1.5 pb-1.5 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{gt("Roles/Members")}</span>
              <TargetPicker
                roles={roles}
                members={members}
                exclude={overwrites}
                onPick={addAdvanced}
                disabled={disabled}
                renderBadge={targetBadge}
                trigger={
                  <button
                    type="button"
                    disabled={disabled}
                    title={gt("Add a role or member")}
                    aria-label={gt("Add a role or member")}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 max-md:h-9 max-md:w-9"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                }
              />
            </div>
            <div className="max-h-[420px] space-y-0.5 overflow-y-auto max-md:max-h-56">
              {listed.map((o) => {
                const t: Target = { id: o.id, type: o.type };
                const active = activeTarget ? sameTarget(activeTarget, t) : false;
                return (
                  <div
                    key={`${o.type}-${o.id}`}
                    className={cn(
                      "group/target flex items-center rounded-md transition-colors",
                      active ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectTarget(t)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm max-md:py-2.5",
                        active ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                      )}
                    >
                      {o.type === "member" ? targetBadge(t, "h-5 w-5") : targetBadge(t)}
                      <span className="truncate">{targetName(t)}</span>
                    </button>
                    {!isEveryone(t) && (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={gt("Remove {name}", { name: targetName(t) })}
                        title={gt("Remove")}
                        onClick={() => {
                          onChange(removeOverwrite(overwrites, t));
                          if (active) setSelected(null);
                        }}
                        className="mr-1 rounded p-1 text-[var(--text-muted)] transition-opacity hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/target:opacity-100 [@media(hover:hover)]:group-focus-within/target:opacity-100 max-md:p-2"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div data-perm-editor="" className="min-w-0 scroll-mt-4 p-3 sm:p-4">
            {activeTarget ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {activeTarget.type === "member" ? <UserIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /> : targetBadge(activeTarget)}
                    <strong className="truncate text-[var(--text-primary)]">{targetName(activeTarget)}</strong>
                  </span>
                  <div className="flex items-center gap-2 max-md:w-full">
                    <SettingsSearchInput
                      value={permQuery}
                      onValueChange={setPermQuery}
                      placeholder={gt("Search permissions")}
                      clearLabel={gt("Clear search")}
                      className="w-48 max-md:flex-1"
                      inputClassName="h-8"
                    />
                    <SettingsButton
                      size="sm"
                      variant="ghost"
                      onClick={() => onChange(clearOverwrite(overwrites, activeTarget))}
                      disabled={disabled || !activeOverwrite || (activeOverwrite.allow === "0" && activeOverwrite.deny === "0")}
                      title={gt("Clear all overrides")}
                    >
                      <Trash2 />
                      {gt("Clear")}
                    </SettingsButton>
                  </div>
                </div>
                {visibleGroups.length === 0 ? (
                  <SettingsEmptyState compact icon={Shield} title={gt("No permissions match your search.")} />
                ) : (
                  visibleGroups.map((group) => (
                    <section key={group.id}>
                      <h4 className="pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{groupLabel(group.id)}</h4>
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {group.keys.map((key) => {
                          const flag = PERMISSION_BITS[key];
                          const state = getOverwriteState(activeOverwrite, flag);
                          return (
                            <div key={key} data-settings-row className="flex items-start justify-between gap-3 py-3 sm:gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--text-primary)]" data-settings-label={permLabel(key)}>{permLabel(key)}</p>
                                <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{permDescription(key)}</p>
                              </div>
                              <TriState
                                state={state}
                                label={permLabel(key)}
                                labels={triLabels}
                                disabled={disabled}
                                onSet={(s) => onChange(setOverwriteState(overwrites, activeTarget, flag, s))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            ) : (
              <SettingsEmptyState compact icon={Shield} title={gt("Select a role or member on the left")} />
            )}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

/** "Add members or roles" search popover (Radix: Escape closes it, not the settings). */
function TargetPicker({
  roles,
  members,
  exclude,
  onPick,
  trigger,
  disabled,
  renderBadge,
}: {
  roles: PanelRole[];
  members: PanelMember[];
  exclude: ReadonlyArray<Target>;
  onPick: (t: Target) => void;
  trigger: ReactNode;
  disabled?: boolean;
  renderBadge: (t: Target) => ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wheelCleanup = useRef<(() => void) | null>(null);
  // The settings dialog's scroll lock eats wheel events on this portaled
  // list (Firefox: the scrollbar still drags). Scroll it ourselves. A
  // callback ref binds whenever the popover actually mounts the node.
  const listRef = useCallback((node: HTMLDivElement | null) => {
    wheelCleanup.current?.();
    wheelCleanup.current = null;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      const max = node.scrollHeight - node.clientHeight;
      if (max <= 0) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * node.clientHeight : e.deltaY;
      if (!dy) return;
      const atEdge = (node.scrollTop <= 0 && dy < 0) || (node.scrollTop >= max - 1 && dy > 0);
      if (atEdge) return;
      e.preventDefault();
      e.stopPropagation();
      node.scrollTop = Math.min(max, Math.max(0, node.scrollTop + dy));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    wheelCleanup.current = () => node.removeEventListener("wheel", onWheel);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const excluded = (t: Target) => exclude.some((o) => sameTarget(o, t));
    const roleItems = roles
      .filter((r) => !r.isDefault && (!q || r.name.toLowerCase().includes(q)) && !excluded({ id: r.id, type: "role" }))
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .slice(0, 25);
    const memberItems = members
      .filter((m) => (!q || (m.displayName || "").toLowerCase().includes(q) || m.username.toLowerCase().includes(q)) && !excluded({ id: m.id, type: "member" }))
      .slice(0, 25);
    return { roleItems, memberItems };
  }, [query, roles, members, exclude]);

  const pick = (t: Target) => {
    onPick(t);
    setOpen(false);
    setQuery("");
  };

  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] max-md:py-2.5";

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-[var(--border-subtle)] p-2">
          <SettingsSearchInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={gt("Search members and roles")}
            clearLabel={gt("Clear search")}
            inputClassName="h-8"
          />
        </div>
        <div ref={listRef} className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
          {results.roleItems.length > 0 && (
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Roles")}</p>
          )}
          {results.roleItems.map((r) => (
            <button key={`r-${r.id}`} type="button" onClick={() => pick({ id: r.id, type: "role" })} className={row}>
              {renderBadge({ id: r.id, type: "role" })}
              <span className="truncate">{r.name}</span>
            </button>
          ))}
          {results.memberItems.length > 0 && (
            <p className="px-2 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Members")}</p>
          )}
          {results.memberItems.map((m) => (
            <button key={`m-${m.id}`} type="button" onClick={() => pick({ id: m.id, type: "member" })} className={row}>
              {renderBadge({ id: m.id, type: "member" })}
              <span className="truncate">{m.displayName || m.username}</span>
              {m.displayName && <span className="truncate text-xs text-[var(--text-muted)]">{m.username}</span>}
            </button>
          ))}
          {results.roleItems.length === 0 && results.memberItems.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">{gt("No roles or members found")}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ChannelPermissionsPanel;
