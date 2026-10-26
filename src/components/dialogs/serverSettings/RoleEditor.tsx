"use client";

import { memo, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ArrowLeft, Check, Plus, Shield, Trash2, Users, X } from "lucide-react";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { Input } from "@/components/ui/input";
import { RoleIconEditor } from "@/components/dialogs/RoleIconEditor";
import { RoleIcon } from "@/components/chat/RoleIcon";
import { SettingsCard, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsSubTabs, type SettingsSubTab } from "@/components/settings/blocks/SettingsSubTabs";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
import { hasPermissionBit, setPermissionBit } from "@/lib/roles/bitfield";
import { cn, cdnImage } from "@/lib/utils";
import type { Role, RoleDraft, ServerMember } from "./types";

type EditorTab = "display" | "permissions" | "links" | "members";

/** Discord's role colour swatches (role data, not theme colours). */
const ROLE_SWATCHES = [
  "#1ABC9C", "#2ECC71", "#3498DB", "#9B59B6", "#E91E63", "#F1C40F", "#E67E22", "#E74C3C", "#95A5A6", "#607D8B",
  "#11806A", "#1F8B4C", "#206694", "#71368A", "#AD1457", "#C27C0E", "#A84300", "#992D22", "#979C9F", "#546E7A",
];
const DEFAULT_ROLE_COLOR = "#99AAB5";

const sameColor = (a: string, b: string) =>
  (a || "").toLowerCase().replace(/^#/, "").padStart(6, "0") === (b || "").toLowerCase().replace(/^#/, "").padStart(6, "0");

/** Native colour picker that commits on blur, so dragging doesn't spam the draft. */
const ColorInput = memo(function ColorInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  // Callers key this on the committed colour, so a new value remounts it.
  const [localColor, setLocalColor] = useState(value);
  return (
    <label
      className={cn(
        "relative flex h-12 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-[var(--border-subtle)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{ backgroundColor: localColor }}
      title={label}
    >
      <input
        type="color"
        value={localColor}
        onChange={(e) => setLocalColor(e.target.value)}
        onBlur={() => onChange(localColor)}
        disabled={disabled}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span aria-hidden className="pointer-events-none rounded bg-black/35 px-1 font-mono text-[10px] text-white">
        {localColor.toUpperCase()}
      </span>
    </label>
  );
});

function DisplayTab({
  role,
  draft,
  setDraft,
}: {
  role: Role;
  draft: RoleDraft;
  setDraft: Dispatch<SetStateAction<RoleDraft | null>>;
}) {
  const gt = useGT();
  const locked = role.managed;
  const update = (patch: Partial<RoleDraft>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  return (
    <div className="space-y-8">
      <SettingsSection title={gt("Role name")}>
        <Input
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          disabled={role.isDefault || locked}
          maxLength={100}
          aria-label={gt("Role name")}
          className="h-10 border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] disabled:opacity-60"
        />
      </SettingsSection>

      <SettingsSection
        title={gt("Role colour")}
        description={gt("Members use the colour of the highest role they have on the roles list.")}
      >
        <div className="flex flex-wrap items-start gap-3">
          <button
            type="button"
            disabled={locked}
            onClick={() => update({ color: DEFAULT_ROLE_COLOR })}
            aria-label={gt("Default colour")}
            aria-pressed={sameColor(draft.color, DEFAULT_ROLE_COLOR)}
            className="relative h-12 w-16 rounded-md border border-[var(--border-subtle)] disabled:opacity-60"
            style={{ backgroundColor: DEFAULT_ROLE_COLOR }}
          >
            {sameColor(draft.color, DEFAULT_ROLE_COLOR) && <Check className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow" />}
          </button>
          <ColorInput
            key={draft.color}
            value={draft.color}
            onChange={(color) => update({ color })}
            disabled={locked}
            label={gt("Custom colour")}
          />
          <div className="grid grid-cols-10 gap-1.5">
            {ROLE_SWATCHES.map((hex) => {
              const selected = sameColor(draft.color, hex);
              return (
                <button
                  key={hex}
                  type="button"
                  disabled={locked}
                  onClick={() => update({ color: hex })}
                  aria-label={hex}
                  aria-pressed={selected}
                  className="relative h-[21px] w-[21px] rounded-[4px] transition-transform hover:scale-110 disabled:opacity-60"
                  style={{ backgroundColor: hex }}
                >
                  {selected && <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      {/* Role icon (not for @everyone) */}
      {!role.isDefault && (
        <RoleIconEditor
          roleName={draft.name || role.name}
          roleColor={draft.color}
          icon={draft.icon}
          unicodeEmoji={draft.unicodeEmoji}
          disabled={locked}
          onChange={(next) => update(next)}
        />
      )}

      <SettingsCard>
        <SettingsToggleRow
          label={gt("Display role members separately from online members")}
          description={gt("Show members with this role separately")}
          checked={draft.hoist}
          disabled={locked}
          onCheckedChange={(checked) => update({ hoist: checked })}
        />
        <SettingsToggleRow
          label={gt("Allow anyone to @mention this role")}
          description={gt("Anyone can mention this role")}
          checked={draft.mentionable}
          disabled={locked}
          onCheckedChange={(checked) => update({ mentionable: checked })}
        />
      </SettingsCard>
    </div>
  );
}

function PermissionsTab({
  role,
  draft,
  setDraft,
}: {
  role: Role;
  draft: RoleDraft;
  setDraft: Dispatch<SetStateAction<RoleDraft | null>>;
}) {
  const gt = useGT();
  const [search, setSearch] = useState("");
  const categories = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return ROLE_PERMISSION_CATEGORIES;
    return ROLE_PERMISSION_CATEGORIES.map((cat) => ({
      ...cat,
      permissions: cat.permissions.filter(
        (p) => p.label.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle),
      ),
    })).filter((cat) => cat.permissions.length > 0);
  }, [search]);
  const toggle = (bit: bigint, enabled: boolean) =>
    setDraft((prev) => (prev ? { ...prev, permissions: setPermissionBit(prev.permissions, bit, enabled) } : prev));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={gt("Search permissions")}
          clearLabel={gt("Clear search")}
          className="min-w-[180px] flex-1"
        />
        <SettingsButton
          variant="ghost"
          disabled={role.managed || draft.permissions === "0"}
          onClick={() => setDraft((prev) => (prev ? { ...prev, permissions: "0" } : prev))}
        >
          {gt("Clear permissions")}
        </SettingsButton>
      </div>
      {categories.length === 0 ? (
        <SettingsEmptyState compact icon={Shield} title={gt("No permissions match your search.")} />
      ) : (
        categories.map((category) => (
          <section key={category.id} className="space-y-2">
            <h4 className="px-0.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{category.label}</h4>
            <SettingsCard>
              {category.permissions.map((permission) => (
                <SettingsToggleRow
                  key={permission.key}
                  label={permission.label}
                  description={permission.description}
                  checked={hasPermissionBit(draft.permissions, permission.bit)}
                  disabled={role.managed}
                  onCheckedChange={(next) => toggle(permission.bit, next)}
                />
              ))}
            </SettingsCard>
          </section>
        ))
      )}
    </div>
  );
}

function LinksTab({
  role,
  roles,
  roleLinks,
  saving,
  onSetRoleLinks,
}: {
  role: Role;
  roles: Role[];
  roleLinks: Record<string, string[]>;
  saving: boolean;
  onSetRoleLinks: (roleId: string, linkedIds: string[]) => void;
}) {
  const gt = useGT();
  const linked = roleLinks[role.id.toLowerCase()] ?? [];
  const linkedRoles = linked
    .map((id) => roles.find((r) => r.id.toLowerCase() === id))
    .filter((r): r is Role => Boolean(r));
  const available = roles.filter((r) => !r.isDefault && !r.managed && r.id !== role.id && !linked.includes(r.id.toLowerCase()));
  return (
    <SettingsSection
      title={gt("Linked roles")}
      description={gt("Members who get this role also get these roles. It only works one way, and removing this role later keeps the linked roles.")}
      action={saving ? <Loader size={16} /> : undefined}
    >
      <SettingsCard>
        {linkedRoles.length === 0 ? (
          <SettingsEmptyState compact title={gt("No linked roles yet.")} />
        ) : (
          linkedRoles.map((r) => (
            <div key={r.id} data-settings-row className="flex items-center gap-3 px-4 py-2.5">
              <Shield className="h-4 w-4 shrink-0" style={{ color: r.color || "var(--text-muted)" }} fill="currentColor" fillOpacity={0.25} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{r.name}</span>
              <button
                type="button"
                disabled={saving}
                onClick={() => onSetRoleLinks(role.id, linkedRoles.filter((x) => x.id !== r.id).map((x) => x.id))}
                aria-label={gt("Unlink role {role}", { role: r.name })}
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
        {available.length > 0 && linked.length < 10 && (
          <div className="px-4 py-3">
            <select
              value=""
              disabled={saving}
              onChange={(event) => {
                const id = event.target.value;
                if (id) onSetRoleLinks(role.id, [...linkedRoles.map((x) => x.id), id]);
              }}
              aria-label={gt("Add a linked role")}
              className="h-9 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)] disabled:opacity-50 sm:w-64"
            >
              <option value="">{gt("Add a linked role...")}</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function MembersTab({
  role,
  members,
  loading,
  onToggleMemberRole,
}: {
  role: Role;
  members: ServerMember[];
  loading: boolean;
  onToggleMemberRole: (member: ServerMember, roleId: string, checked: boolean) => void;
}) {
  const gt = useGT();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const needle = search.trim().toLowerCase();
  const matches = (m: ServerMember) =>
    !needle || [m.username, m.displayName, m.id].some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
  const holders = useMemo(() => members.filter((m) => m.roles.some((r) => r.id === role.id)), [members, role.id]);
  const shown = holders.filter(matches);
  const candidates = adding && needle ? members.filter((m) => !m.roles.some((r) => r.id === role.id) && matches(m)).slice(0, 8) : [];

  const row = (m: ServerMember, action: ReactNode) => (
    <div key={m.id} data-settings-row className="group/holder flex items-center gap-3 px-4 py-2.5">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={cdnImage(m.avatar || undefined)} />
        <AvatarFallback className="bg-[var(--app-accent)] text-xs text-white">{(m.displayName || m.username || "?").charAt(0)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium text-[var(--text-primary)]">{m.displayName || m.username}</span>
        <span className="ml-1.5 text-[var(--text-muted)]">{m.username}</span>
      </span>
      {action}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={adding ? gt("Search members to add") : gt("Search members")}
          clearLabel={gt("Clear search")}
          className="min-w-[180px] flex-1"
        />
        <SettingsButton variant={adding ? "secondary" : "primary"} disabled={role.managed} onClick={() => setAdding((v) => !v)}>
          {adding ? gt("Done") : (
            <>
              <Plus />
              {gt("Add Members")}
            </>
          )}
        </SettingsButton>
      </div>

      {adding && (
        <SettingsCard>
          {!needle ? (
            <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">{gt("Type a name to find members without this role.")}</p>
          ) : candidates.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">{gt("No members found.")}</p>
          ) : (
            candidates.map((m) =>
              row(
                m,
                <SettingsButton size="sm" variant="primary" onClick={() => onToggleMemberRole(m, role.id, true)}>
                  {gt("Add")}
                </SettingsButton>,
              ),
            )
          )}
        </SettingsCard>
      )}

      {loading && members.length === 0 ? (
        <SettingsSkeleton variant="list" count={4} />
      ) : holders.length === 0 ? (
        <SettingsEmptyState icon={Users} title={gt("No members have this role yet.")} description={gt("Use Add Members to give it to people.")} />
      ) : (
        <SettingsCard>
          {shown.length === 0 ? (
            <SettingsEmptyState compact title={gt("No members found.")} />
          ) : (
            shown.map((m) =>
              row(
                m,
                !role.managed && (
                  <button
                    type="button"
                    onClick={() => onToggleMemberRole(m, role.id, false)}
                    aria-label={gt("Remove role {role}", { role: role.name })}
                    title={gt("Remove role")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/holder:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ),
              ),
            )
          )}
        </SettingsCard>
      )}
    </div>
  );
}

/**
 * Discord's role editor: a slim role list with a back arrow on the left and
 * the selected role's Display | Permissions | Links | Manage Members tabs on
 * the right. Saving goes through the dialog's unsaved-changes bar.
 */
export const RoleEditor = memo(function RoleEditor({
  role,
  draft,
  setDraft,
  roles,
  roleLinks,
  isSavingRoleLinks,
  members,
  membersLoading,
  isMobile,
  onRequestMembers,
  onBack,
  onSelectRole,
  onCreateRole,
  onDeleteRole,
  onSetRoleLinks,
  onToggleMemberRole,
}: {
  role: Role;
  draft: RoleDraft;
  setDraft: Dispatch<SetStateAction<RoleDraft | null>>;
  /** Highest first. */
  roles: Role[];
  roleLinks: Record<string, string[]>;
  isSavingRoleLinks: boolean;
  members: ServerMember[];
  membersLoading: boolean;
  isMobile: boolean;
  onRequestMembers: () => void;
  onBack: () => void;
  onSelectRole: (roleId: string) => void;
  onCreateRole: () => void;
  onDeleteRole: (roleId: string) => void;
  onSetRoleLinks: (roleId: string, linkedIds: string[]) => void;
  onToggleMemberRole: (member: ServerMember, roleId: string, checked: boolean) => void;
}) {
  const gt = useGT();
  const [tab, setTab] = useState<EditorTab>("display");
  const canLink = !role.isDefault && !role.managed;
  const canManageMembers = !role.isDefault;
  // Tabs this role can't use (Links / Manage Members on @everyone) fall back to Display.
  const activeTab: EditorTab =
    (tab === "links" && !canLink) || (tab === "members" && !canManageMembers) ? "display" : tab;

  const tabs: SettingsSubTab<EditorTab>[] = [
    { id: "display", label: gt("Display") },
    { id: "permissions", label: gt("Permissions") },
    ...(canLink ? [{ id: "links" as const, label: gt("Links") }] : []),
    ...(canManageMembers
      ? [{ id: "members" as const, label: gt("Manage Members ({count})", { count: role.memberCount ?? 0 }) }]
      : []),
  ];

  return (
    <div className={cn(!isMobile && "grid grid-cols-[200px_minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]")}>
      {/* Slim role list */}
      {!isMobile && (
        <aside className="sticky top-16 self-start">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" />
              {gt("Back")}
            </button>
            <button
              type="button"
              onClick={onCreateRole}
              aria-label={gt("Create Role")}
              title={gt("Create Role")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <nav className="max-h-[calc(100vh-180px)] space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
            {roles.map((r) => {
              const active = r.id === role.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRole(r.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm",
                    active
                      ? "bg-[var(--bg-active)] font-medium text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: r.color || "var(--text-muted)" }} />
                  <span className="min-w-0 flex-1 truncate">{r.isDefault ? "@everyone" : r.name}</span>
                  <RoleIcon role={r} size={12} />
                </button>
              );
            })}
          </nav>
        </aside>
      )}

      <div className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)] max-md:hidden">
            <span className="truncate">{gt("Edit Role — {name}", { name: role.isDefault ? "@everyone" : role.name })}</span>
            {role.isDefault && <SettingsStatusPill>{gt("Default")}</SettingsStatusPill>}
            {role.managed && <SettingsStatusPill>{gt("Managed")}</SettingsStatusPill>}
          </h2>
          {!role.isDefault && !role.managed && (
            <SettingsButton size="sm" variant="danger" onClick={() => onDeleteRole(role.id)} className="max-md:ml-auto">
              <Trash2 />
              {gt("Delete Role")}
            </SettingsButton>
          )}
        </div>

        <SettingsSubTabs
          tabs={tabs}
          value={activeTab}
          onChange={(next) => {
            setTab(next);
            if (next === "members") onRequestMembers();
          }}
          ariaLabel={gt("Role settings")}
          className="mb-6"
        />

        {activeTab === "display" && <DisplayTab role={role} draft={draft} setDraft={setDraft} />}
        {activeTab === "permissions" && <PermissionsTab key={role.id} role={role} draft={draft} setDraft={setDraft} />}
        {activeTab === "links" && (
          <LinksTab role={role} roles={roles} roleLinks={roleLinks} saving={isSavingRoleLinks} onSetRoleLinks={onSetRoleLinks} />
        )}
        {activeTab === "members" && (
          <MembersTab key={role.id} role={role} members={members} loading={membersLoading} onToggleMemberRole={onToggleMemberRole} />
        )}
      </div>
    </div>
  );
});
