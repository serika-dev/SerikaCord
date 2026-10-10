"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, Lock, Plus, RefreshCw, Search, Shield, Slash, Trash2, User as UserIcon, X } from "lucide-react";
import { useGT } from "gt-next";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useServerMembersOptional } from "@/contexts/ServerContext";
import { cn, cdnImage } from "@/lib/utils";
import { PERMISSION_BITS, type PermissionName } from "@/lib/permissions/bits";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
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

/** Discord's deny / inherit / allow switch for one permission of one override. */
function TriState({
  state,
  onSet,
  label,
  labels,
}: {
  state: OverwriteState;
  onSet: (s: OverwriteState) => void;
  label: string;
  labels: { deny: string; inherit: string; allow: string };
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center rounded-md overflow-hidden border border-[var(--border-subtle)] shrink-0">
      <button
        type="button"
        role="radio"
        aria-checked={state === "deny"}
        aria-label={labels.deny}
        onClick={() => onSet("deny")}
        title={labels.deny}
        className={cn("w-8 h-7 flex items-center justify-center transition-colors", state === "deny" ? "bg-red-500 text-white" : "text-red-400 hover:bg-red-500/10")}
      >
        <X className="w-4 h-4" />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={state === "neutral"}
        aria-label={labels.inherit}
        onClick={() => onSet("neutral")}
        title={labels.inherit}
        className={cn(
          "w-8 h-7 flex items-center justify-center border-x border-[var(--border-subtle)] transition-colors",
          state === "neutral" ? "bg-[var(--app-surface-alt)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]",
        )}
      >
        <Slash className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={state === "allow"}
        aria-label={labels.allow}
        onClick={() => onSet("allow")}
        title={labels.allow}
        className={cn("w-8 h-7 flex items-center justify-center transition-colors", state === "allow" ? "bg-green-500 text-white" : "text-green-500 hover:bg-green-500/10")}
      >
        <Check className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * The Permissions tab of a channel or category, like Discord's: sync status
 * with the category, the "Private Channel" toggle with who can access it, and
 * per-role / per-member overrides with tri-state (deny / inherit / allow)
 * switches grouped by section.
 */
export function ChannelPermissionsPanel({
  channel,
  parent,
  serverId,
  roles,
  overwrites,
  onChange,
  onSyncNow,
  syncing,
}: {
  channel: { id: string; name: string; type: string };
  parent: { id: string; name: string; permissionOverwrites?: EditableOverwrite[] } | null;
  serverId: string;
  roles: PanelRole[];
  overwrites: EditableOverwrite[];
  onChange: (next: EditableOverwrite[]) => void;
  onSyncNow: () => void;
  syncing?: boolean;
}) {
  const gt = useGT();
  const rawMembers = useServerMembersOptional()?.members;
  const members = useMemo(() => (rawMembers || []) as PanelMember[], [rawMembers]);
  const isCategory = channel.type === "category";
  const isVoice = channel.type === "voice" || channel.type === "stage";
  const everyoneRole = roles.find((r) => r.isDefault) ?? null;
  const everyoneId = everyoneRole?.id ?? null;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState<Target | null>(null);
  const [picker, setPicker] = useState<"access" | "advanced" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [permQuery, setPermQuery] = useState("");
  const pickerInputRef = useRef<HTMLInputElement>(null);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id.toLowerCase(), r] as const)), [roles]);
  const memberById = useMemo(() => new Map(members.map((mem) => [String(mem.id).toLowerCase(), mem] as const)), [members]);

  const synced = parent ? overwritesInSync(overwrites, parent.permissionOverwrites || []) : false;
  const isPrivate = isPrivateChannel(overwrites, everyoneId, serverId);
  const holders = useMemo(() => accessHolders(overwrites, everyoneId), [overwrites, everyoneId]);

  const targetName = (t: Target) => {
    if (t.type === "member") {
      const mem = memberById.get(t.id.toLowerCase());
      return mem ? mem.displayName || mem.username : gt("Unknown member");
    }
    if (everyoneId && t.id.toLowerCase() === everyoneId.toLowerCase()) return "@everyone";
    if (t.id.toLowerCase() === serverId.toLowerCase()) return "@everyone";
    return roleById.get(t.id.toLowerCase())?.name ?? gt("Deleted role");
  };

  const targetBadge = (t: Target, size = "w-5 h-5") => {
    if (t.type === "member") {
      const mem = memberById.get(t.id.toLowerCase());
      return (
        <Avatar className={cn(size, "shrink-0")}>
          <AvatarImage src={cdnImage(mem?.avatar || undefined)} />
          <AvatarFallback className="text-[9px] bg-[var(--app-surface-alt)]">{(mem?.username || "?").charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      );
    }
    const role = roleById.get(t.id.toLowerCase());
    return (
      <span className="w-3 h-3 rounded-full shrink-0 border border-[var(--border-subtle)]" style={{ backgroundColor: role?.color || "var(--text-muted)" }} />
    );
  };

  // Left list: @everyone first, then roles by position, then members (Discord order).
  const listed = useMemo(() => {
    const roleRows = overwrites
      .filter((o) => o.type === "role")
      .sort((a, b) => {
        const aEveryone = everyoneId && a.id.toLowerCase() === everyoneId.toLowerCase();
        const bEveryone = everyoneId && b.id.toLowerCase() === everyoneId.toLowerCase();
        if (aEveryone !== bEveryone) return aEveryone ? 1 : -1;
        return (roleById.get(b.id.toLowerCase())?.position ?? 0) - (roleById.get(a.id.toLowerCase())?.position ?? 0);
      });
    const memberRows = overwrites.filter((o) => o.type === "member");
    const rows = [...roleRows, ...memberRows];
    // @everyone is always editable even without an overwrite yet.
    if (everyoneId && !rows.some((o) => o.type === "role" && o.id.toLowerCase() === everyoneId.toLowerCase())) {
      rows.push({ id: everyoneId, type: "role", allow: "0", deny: "0" });
    }
    return rows;
  }, [overwrites, everyoneId, roleById]);

  const activeTarget: Target | null = selected ?? (listed[0] ? { id: listed[0].id, type: listed[0].type } : null);
  const activeOverwrite = activeTarget
    ? overwrites.find((o) => o.type === activeTarget.type && o.id.toLowerCase() === activeTarget.id.toLowerCase()) ?? null
    : null;

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const exclude = (t: Target) =>
      picker === "advanced"
        ? overwrites.some((o) => o.type === t.type && o.id.toLowerCase() === t.id.toLowerCase())
        : holders.some((o) => o.type === t.type && o.id.toLowerCase() === t.id.toLowerCase());
    const roleItems = roles
      .filter((r) => !r.isDefault)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => !exclude({ id: r.id, type: "role" }))
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .slice(0, 25)
      .map((r) => ({ id: r.id, type: "role" as const }));
    const memberItems = members
      .filter((mem) => !q || (mem.displayName || "").toLowerCase().includes(q) || mem.username.toLowerCase().includes(q))
      .filter((mem) => !exclude({ id: mem.id, type: "member" }))
      .slice(0, 25)
      .map((mem) => ({ id: mem.id, type: "member" as const }));
    return { roleItems, memberItems };
  }, [pickerQuery, roles, members, overwrites, holders, picker]);

  const openPicker = (which: "access" | "advanced") => {
    setPicker(which);
    setPickerQuery("");
    setTimeout(() => pickerInputRef.current?.focus(), 30);
  };

  const pick = (t: Target) => {
    if (picker === "access") {
      let next = setOverwriteState(overwrites, t, PERMISSION_BITS.VIEW_CHANNEL, "allow");
      if (isVoice) next = setOverwriteState(next, t, PERMISSION_BITS.CONNECT, "allow");
      onChange(next);
    } else {
      onChange(addOverwrite(overwrites, t));
      setSelected(t);
      setShowAdvanced(true);
    }
    setPicker(null);
  };

  const removeAccess = (t: Target) => {
    let next = setOverwriteState(overwrites, t, PERMISSION_BITS.VIEW_CHANNEL, "neutral");
    if (isVoice) next = setOverwriteState(next, t, PERMISSION_BITS.CONNECT, "neutral");
    // Drop overwrites that no longer carry anything.
    next = next.filter((o) => !(o.type === t.type && o.id.toLowerCase() === t.id.toLowerCase() && o.allow === "0" && o.deny === "0"));
    onChange(next);
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

  const pickerPopover = (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setPicker(null)} />
      <div className="absolute left-0 right-0 sm:right-auto sm:w-80 mt-1 z-50 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)] shadow-xl">
        <div className="p-2 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              ref={pickerInputRef}
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPicker(null);
                }
              }}
              placeholder={gt("Search members and roles")}
              aria-label={gt("Search members and roles")}
              className="w-full pl-7 pr-2 py-1.5 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {pickerResults.roleItems.length > 0 && (
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Roles")}</p>
          )}
          {pickerResults.roleItems.map((t) => (
            <button
              key={`r-${t.id}`}
              type="button"
              onClick={() => pick(t)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]"
            >
              {targetBadge(t)}
              <span className="truncate">{targetName(t)}</span>
            </button>
          ))}
          {pickerResults.memberItems.length > 0 && (
            <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Members")}</p>
          )}
          {pickerResults.memberItems.map((t) => {
            const mem = memberById.get(t.id.toLowerCase());
            return (
              <button
                key={`m-${t.id}`}
                type="button"
                onClick={() => pick(t)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]"
              >
                {targetBadge(t)}
                <span className="truncate">{targetName(t)}</span>
                {mem && <span className="truncate text-xs text-[var(--text-muted)]">{mem.username}</span>}
              </button>
            );
          })}
          {pickerResults.roleItems.length === 0 && pickerResults.memberItems.length === 0 && (
            <p className="px-3 py-3 text-xs text-center text-[var(--text-muted)]">{gt("No roles or members found")}</p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="max-w-[720px] space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">{isCategory ? gt("Category Permissions") : gt("Channel Permissions")}</h2>
        <p className="text-sm text-[var(--text-muted)]">{gt("Use permissions to customise who can do what in this channel.")}</p>
      </div>

      {/* Category sync status */}
      {parent && !isCategory && (
        synced ? (
          <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)]">
            <RefreshCw className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
            <span>
              {gt("Permissions synced with category:")} <strong className="text-[var(--text-primary)]">{parent.name}</strong>
            </span>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-500">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {gt("Permissions not synced with category:")} <strong>{parent.name}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncing}
              className="self-start sm:self-auto px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold disabled:opacity-60"
            >
              {gt("Sync Now")}
            </button>
          </div>
        )
      )}
      {isCategory && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)]">
          <RefreshCw className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
          <span>{gt("Changes here also apply to every channel in this category that is synced with it.")}</span>
        </div>
      )}

      {/* Private channel */}
      <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
        <div className="p-5 flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="p-2 rounded-lg bg-[var(--app-surface-alt)] text-[var(--text-secondary)] shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{isCategory ? gt("Private Category") : gt("Private Channel")}</span>
              <p className="text-xs text-[var(--text-muted)] max-w-md leading-relaxed">
                {isCategory
                  ? gt("By making a category private, only selected members and roles will be able to view this category. Synced channels in this category will also be updated.")
                  : gt("By making a channel private, only selected members and roles will be able to view this channel.")}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={isPrivate}
            disabled={!everyoneId}
            onCheckedChange={(checked) => everyoneId && onChange(setPrivateChannel(overwrites, everyoneId, checked, { voice: isVoice }))}
            aria-label={isCategory ? gt("Private Category") : gt("Private Channel")}
          />
        </div>
        {isPrivate && (
          <div className="px-5 pb-5 border-t border-[var(--border-subtle)] pt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 relative">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Who can access this channel?")}</span>
              <button
                type="button"
                onClick={() => openPicker("access")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--app-accent)] text-white text-xs font-semibold hover:opacity-90"
              >
                <Plus className="w-3.5 h-3.5" />
                {gt("Add members or roles")}
              </button>
              {picker === "access" && <div className="absolute top-full right-0 left-0">{pickerPopover}</div>}
            </div>
            {holders.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">{gt("Only administrators and the server owner can see this channel. Add roles or members to give them access.")}</p>
            ) : (
              <ul className="space-y-1">
                {holders.map((o) => {
                  const t: Target = { id: o.id, type: o.type };
                  return (
                    <li key={`${o.type}-${o.id}`} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-hover)]">
                      {targetBadge(t, "w-6 h-6")}
                      <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">{targetName(t)}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{o.type === "role" ? gt("Role") : gt("Member")}</span>
                      <button
                        type="button"
                        onClick={() => removeAccess(t)}
                        title={gt("Remove")}
                        aria-label={gt("Remove")}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Advanced permissions */}
      <div className="border-t border-[var(--border-subtle)] pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex items-center justify-between w-full py-2 text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--text-secondary)]"
        >
          <span>{gt("Advanced permissions")}</span>
          {showAdvanced ? <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />}
        </button>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-[210px_1fr] gap-4 border border-[var(--border-subtle)] rounded-xl p-4 bg-[var(--bg-app)]">
            <div className="md:border-r border-[var(--border-subtle)] md:pr-3 flex flex-col gap-1">
              <div className="flex items-center justify-between mb-1 relative">
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{gt("Roles/Members")}</span>
                <button
                  type="button"
                  onClick={() => openPicker("advanced")}
                  title={gt("Add a role or member")}
                  aria-label={gt("Add a role or member")}
                  className="p-1 rounded bg-[var(--bg-sidebar)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {picker === "advanced" && <div className="absolute top-full left-0 right-0">{pickerPopover}</div>}
              </div>
              {listed.map((o) => {
                const t: Target = { id: o.id, type: o.type };
                const isActive = activeTarget && activeTarget.type === t.type && activeTarget.id.toLowerCase() === t.id.toLowerCase();
                const isEveryone = everyoneId && o.type === "role" && o.id.toLowerCase() === everyoneId.toLowerCase();
                return (
                  <button
                    key={`${o.type}-${o.id}`}
                    type="button"
                    onClick={() => setSelected(t)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-left transition-colors",
                      isActive ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
                    )}
                  >
                    {o.type === "member" ? <UserIcon className="w-3.5 h-3.5 shrink-0" /> : targetBadge(t)}
                    <span className="truncate flex-1">{targetName(t)}</span>
                    {!isEveryone && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={gt("Remove")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(removeOverwrite(overwrites, t));
                          if (isActive) setSelected(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onChange(removeOverwrite(overwrites, t));
                            if (isActive) setSelected(null);
                          }
                        }}
                        className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/20"
                      >
                        <X className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="min-w-0">
              {activeTarget ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-subtle)]">
                    <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5 min-w-0">
                      {targetBadge(activeTarget)}
                      <strong className="text-[var(--text-primary)] truncate">{targetName(activeTarget)}</strong>
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)]" />
                        <input
                          value={permQuery}
                          onChange={(e) => setPermQuery(e.target.value)}
                          placeholder={gt("Search permissions")}
                          aria-label={gt("Search permissions")}
                          className="w-40 pl-6 pr-2 py-1 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onChange(clearOverwrite(overwrites, activeTarget))}
                        disabled={!activeOverwrite || (activeOverwrite.allow === "0" && activeOverwrite.deny === "0")}
                        title={gt("Clear all overrides")}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {gt("Clear")}
                      </button>
                    </div>
                  </div>
                  {groups.map((group) => {
                    const keys = group.keys.filter((k) => !q || permLabel(k).toLowerCase().includes(q));
                    if (keys.length === 0) return null;
                    return (
                      <section key={group.id} className="space-y-1">
                        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] pt-2">{groupLabel(group.id)}</h4>
                        {keys.map((key) => {
                          const flag = PERMISSION_BITS[key];
                          const state = getOverwriteState(activeOverwrite, flag);
                          return (
                            <div key={key} className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border-subtle)]/40 last:border-0">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--text-primary)]">{permLabel(key)}</p>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{permDescription(key)}</p>
                              </div>
                              <TriState
                                state={state}
                                label={permLabel(key)}
                                labels={triLabels}
                                onSet={(s) => onChange(setOverwriteState(overwrites, activeTarget, flag, s))}
                              />
                            </div>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-10 text-[var(--text-muted)] text-xs">
                  <Shield className="w-8 h-8 mb-2 opacity-50" />
                  <span>{gt("Select a role or member on the left")}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
