"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Search, ShieldCheck, Trash2, Users } from "lucide-react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { StaffAccess } from "@/hooks/useStaffAccess";
import type { StaffPermission } from "@/lib/staff/permissions";
import { useStaffPermissionGroups } from "./staffPermissionLabels";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

interface StaffRole {
  id: string;
  name: string;
  description: string;
  permissions: StaffPermission[];
}

interface StaffMember {
  id: string;
  username: string;
  displayName: string | null;
  isSuperAdmin: boolean;
  roleIds: string[];
  permissions: StaffPermission[];
}

const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass = "bg-[var(--app-bg)] border-[var(--app-border)] text-[var(--app-text)]";
// Lookup permission is explicit: choosing an action in this editor selects its
// companion lookup as well, so saved roles can use the corresponding screen.
const VIEW_DEPENDENCIES: Partial<Record<StaffPermission, StaffPermission>> = {
  "users.moderate": "users.view",
  "servers.manage": "servers.view",
};

async function request<T>(url: string, fallback: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data as T;
}

function RoleEditor({ role, access, onSaved, onDeleted }: {
  role: StaffRole | null;
  access: StaffAccess;
  onSaved: (role: StaffRole) => void;
  onDeleted: () => void;
}) {
  const gt = useGT();
  const confirm = useConfirm();
  const groups = useStaffPermissionGroups();
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [permissions, setPermissions] = useState<StaffPermission[]>(role?.permissions || []);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = access.isSuperAdmin || (!access.roles.some((assigned) => assigned.id === role?.id) && (!role || role.permissions.every((permission) => access.permissions.includes(permission))));
  const canGrant = (permission: StaffPermission) => access.isSuperAdmin || access.permissions.includes(permission);
  const missingDependency = permissions.some((permission) => {
    const dependency = VIEW_DEPENDENCIES[permission];
    return dependency && !permissions.includes(dependency);
  });
  const togglePermission = (permission: StaffPermission, enabled: boolean) => {
    setPermissions((previous) => {
      if (!enabled) return previous.filter((id) => id !== permission && VIEW_DEPENDENCIES[id] !== permission);
      const dependency = VIEW_DEPENDENCIES[permission];
      return [...new Set([...previous, permission, ...(dependency ? [dependency] : [])])];
    });
  };
  const presets: { name: string; permissions: StaffPermission[] }[] = [
    { name: gt("Support"), permissions: ["users.view", "reports.manage"] },
    { name: gt("Moderator"), permissions: ["users.view", "users.moderate", "servers.view", "reports.manage", "logs.view"] },
    { name: gt("Release editor"), permissions: ["changelog.manage"] },
    { name: gt("Release publisher"), permissions: ["changelog.manage", "changelog.publish"] },
  ];

  const save = async () => {
    if (!editable || busy || !name.trim() || missingDependency) return;
    setBusy(true);
    try {
      const data = await request<{ role: StaffRole }>(role ? `/api/admin/staff/roles/${role.id}` : "/api/admin/staff/roles", gt("Unable to save this role."), {
        method: role ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), permissions }),
      });
      onSaved(data.role);
      window.dispatchEvent(new Event("serika:staff-access-changed"));
      toast.success(gt("Staff role saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : gt("Unable to save this role."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!role || !editable || busy) return;
    if (!(await confirm({ title: gt("Delete {name}?", { name: role.name }), description: gt("Remove this role from all members before deleting it."), confirmLabel: gt("Delete role") }))) return;
    setBusy(true);
    try {
      await request(`/api/admin/staff/roles/${role.id}`, gt("Unable to delete this role."), { method: "DELETE" });
      onDeleted();
      window.dispatchEvent(new Event("serika:staff-access-changed"));
      toast.success(gt("Staff role deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : gt("Unable to delete this role."));
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-w-0 space-y-5 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">{role ? gt("Edit role") : gt("New staff role")}</h3>
      <span className="text-xs text-[var(--app-muted)]">{gt("{count} permissions enabled", { count: permissions.length })}</span>
    </div>
    {!editable && <p className="rounded-lg border border-[var(--app-border)] p-3 text-sm text-[var(--app-muted)]">{gt("An administrator must edit your own roles and roles with access beyond yours.")}</p>}
    <fieldset disabled={!editable || busy} className="space-y-4 disabled:opacity-70">
      <label className="block space-y-2 text-sm font-medium">
        <span>{gt("Role name")}</span>
        <Input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder={gt("For example, Community Support")} />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        <span>{gt("Description")}</span>
        <Textarea className={fieldClass} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder={gt("Describe what this team is responsible for.")} />
      </label>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{gt("Start with a preset")}</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => <button type="button" key={preset.name} className={buttonClass} disabled={!preset.permissions.every(canGrant)} onClick={() => { setPermissions(preset.permissions); if (!name) setName(preset.name); }}>{preset.name}</button>)}
        </div>
        <p className="text-xs text-[var(--app-muted)]">{gt("Presets replace the selection below. You can adjust each permission before saving.")}</p>
      </div>
    </fieldset>
    <label className="flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3">
      <Search className="size-4 shrink-0 text-[var(--app-muted)]" />
      <input className="min-h-10 w-full bg-transparent text-sm outline-none" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={gt("Find a permission")} aria-label={gt("Find a permission")} />
    </label>
    <fieldset disabled={!editable || busy} className="space-y-5">
      {groups.map((group) => {
        const visible = group.permissions.filter((permission) => `${permission.name} ${permission.description}`.toLowerCase().includes(filter.toLowerCase()));
        if (!visible.length) return null;
        return <div key={group.name}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{group.name}</h4>
          <div className="divide-y divide-[var(--app-border)] rounded-lg border border-[var(--app-border)]">
            {visible.map((permission) => <label key={permission.id} className={cn("flex cursor-pointer items-start gap-3 p-3", !canGrant(permission.id) && "opacity-50")}>
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--app-accent)]" checked={permissions.includes(permission.id)} disabled={!canGrant(permission.id) || (!!VIEW_DEPENDENCIES[permission.id] && !canGrant(VIEW_DEPENDENCIES[permission.id]!))} onChange={(event) => togglePermission(permission.id, event.target.checked)} />
              <span className="min-w-0"><span className="block text-sm font-medium">{permission.name}</span><span className="mt-0.5 block text-xs leading-relaxed text-[var(--app-muted)]">{permission.description}</span></span>
            </label>)}
          </div>
        </div>;
      })}
    </fieldset>
    <p className="text-xs leading-relaxed text-[var(--app-muted)]">{gt("Moderating users also selects View users; managing servers also selects View servers. Turning off a view permission turns off its related actions.")}</p>
    {permissions.includes("badges.manage") && !permissions.includes("users.view") && <p className="rounded-lg border border-[var(--app-border)] p-3 text-sm text-[var(--app-muted)]">{gt("Badge management can configure badge definitions. Also enable View users to assign badges to individual accounts.")}</p>}
    {missingDependency && <p role="alert" className="text-sm text-[var(--app-muted)]">{gt("Enable the matching view permission before saving this role.")}</p>}
    <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--app-border)] pt-4">
      {role && <button className={buttonClass} disabled={!editable || busy} onClick={() => void remove()}><Trash2 className="size-4" />{gt("Delete role")}</button>}
      <button className={cn(primaryClass, "ml-auto")} disabled={!editable || busy || !name.trim() || missingDependency} onClick={() => void save()}><Check className="size-4" />{busy ? gt("Saving...") : gt("Save role")}</button>
    </div>
  </div>;
}

function MemberEditor({ member, roles, access, onSaved }: { member: StaffMember; roles: StaffRole[]; access: StaffAccess; onSaved: (member: StaffMember) => void }) {
  const gt = useGT();
  const { user } = useAuth();
  const groups = useStaffPermissionGroups();
  const [roleIds, setRoleIds] = useState(member.roleIds);
  const [busy, setBusy] = useState(false);
  const editable = !member.isSuperAdmin && member.id !== user?.id && (access.isSuperAdmin || member.permissions.every((permission) => access.permissions.includes(permission)));
  const effective = new Set(roles.filter((role) => roleIds.includes(role.id)).flatMap((role) => role.permissions));
  const changed = roleIds.length !== member.roleIds.length || roleIds.some((id) => !member.roleIds.includes(id));
  const save = async () => {
    setBusy(true);
    try {
      const data = await request<{ member: StaffMember }>(`/api/admin/staff/members/${member.id}`, gt("Unable to update staff access."), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleIds }),
      });
      onSaved(data.member);
      toast.success(gt("Staff access updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : gt("Unable to update staff access."));
    } finally { setBusy(false); }
  };
  return <div className="space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
    <div><h3 className="font-semibold">{member.displayName || member.username}</h3><p className="text-sm text-[var(--app-muted)]">@{member.username}</p></div>
    {member.isSuperAdmin ? <p className="text-sm text-[var(--app-muted)]">{gt("Administrator: full access is retained independently of custom roles.")}</p> : <>
      {!editable && <p className="text-sm text-[var(--app-muted)]">{gt("Another administrator must change this member's access.")}</p>}
      <fieldset disabled={!editable || busy} className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">{gt("Assigned roles")}</legend>
        {roles.map((role) => <label key={role.id} className="flex items-start gap-3 rounded-lg border border-[var(--app-border)] p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--app-accent)]" checked={roleIds.includes(role.id)} disabled={!access.isSuperAdmin && !role.permissions.every((permission) => access.permissions.includes(permission))} onChange={(event) => setRoleIds((previous) => event.target.checked ? [...previous, role.id] : previous.filter((id) => id !== role.id))} />
          <span><span className="font-medium">{role.name}</span>{role.description && <span className="mt-1 block text-xs text-[var(--app-muted)]">{role.description}</span>}</span>
        </label>)}
        {!roles.length && <p className="text-sm text-[var(--app-muted)]">{gt("Create a staff role before assigning access.")}</p>}
      </fieldset>
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{gt("Effective access")}</h4>
        <p className="text-xs text-[var(--app-muted)]">{gt("Permissions from all assigned roles are combined. Removing every role removes delegated admin access.")}</p>
        <div className="flex flex-wrap gap-1.5">{groups.flatMap((group) => group.permissions).filter((permission) => effective.has(permission.id)).map((permission) => <span className="rounded-md bg-[var(--app-bg)] px-2 py-1 text-xs" key={permission.id}>{permission.name}</span>)}</div>
        {!effective.size && <p className="text-sm text-[var(--app-muted)]">{gt("No delegated permissions")}</p>}
      </div>
      <button className={primaryClass} disabled={!editable || busy || !changed} onClick={() => void save()}>{busy ? gt("Saving...") : gt("Save member access")}</button>
    </>}
  </div>;
}

export default function AdminStaffPanel({ access }: { access: StaffAccess }) {
  const gt = useGT();
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [tab, setTab] = useState<"roles" | "members">("roles");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => setRevision((previous) => previous + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ members: StaffMember[]; roles: StaffRole[] }>(`/api/admin/staff/members?q=${encodeURIComponent(submittedQuery)}`, gt("Unable to load staff roles."), { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setRoles(data.roles); setMembers(data.members); setError(null); setLoaded(true); } })
      .catch((reason) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : gt("Unable to load staff roles.")); setLoaded(true); } });
    return () => controller.abort();
  }, [submittedQuery, revision, gt]);

  const role = roles.find((item) => item.id === selectedRole) || null;
  const member = members.find((item) => item.id === selectedMember);

  return <section className="space-y-5 text-[var(--app-text)]">
    <div><h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="size-6 text-[var(--app-accent)]" />{gt("Staff roles & permissions")}</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--app-muted)]">{gt("Give each team the tools they need. Create named roles, choose their permissions, and assign one or more roles to staff members.")}</p></div>
    <div className="flex gap-2" role="tablist" aria-label={gt("Staff configuration")}>
      <button role="tab" aria-selected={tab === "roles"} className={tab === "roles" ? primaryClass : buttonClass} onClick={() => setTab("roles")}><ShieldCheck className="size-4" />{gt("Roles")}</button>
      <button role="tab" aria-selected={tab === "members"} className={tab === "members" ? primaryClass : buttonClass} onClick={() => setTab("members")}><Users className="size-4" />{gt("Members")}</button>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] p-3 text-sm"><span>{error}</span><button className={buttonClass} onClick={refresh}>{gt("Retry")}</button></div>}
    {!loaded ? <p role="status" className="text-sm text-[var(--app-muted)]">{gt("Loading staff configuration...")}</p> : tab === "roles" ? <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-2">
        <button className={cn(buttonClass, "w-full")} onClick={() => setSelectedRole(null)}><Plus className="size-4" />{gt("Create role")}</button>
        {roles.map((item) => <button key={item.id} className={cn("w-full rounded-lg border p-3 text-left", selectedRole === item.id ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10" : "border-[var(--app-border)] bg-[var(--app-surface)]")} onClick={() => setSelectedRole(item.id)}><span className="block break-words text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs text-[var(--app-muted)]">{gt("{count} permissions", { count: item.permissions.length })}</span></button>)}
        {!roles.length && <p className="p-3 text-sm text-[var(--app-muted)]">{gt("No custom roles yet. Start with a preset or build your own.")}</p>}
      </div>
      <RoleEditor key={`${selectedRole || "new"}:${revision}`} role={role} access={access} onSaved={(saved) => { setSelectedRole(saved.id); setRoles((previous) => [...previous.filter((item) => item.id !== saved.id), saved]); refresh(); }} onDeleted={() => { setSelectedRole(null); refresh(); }} />
    </div> : <div className="space-y-4">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSelectedMember(null); setSubmittedQuery(query.trim()); refresh(); }}>
        <Input className={cn(fieldClass, "min-w-0")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={gt("Find a member by username")} aria-label={gt("Find a member by username")} maxLength={100} />
        <button className={buttonClass} type="submit"><Search className="size-4" />{gt("Search")}</button>
      </form>
      <p className="text-xs text-[var(--app-muted)]">{gt("Search to add someone new. Clear the search to see current staff.")}</p>
      <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">{members.map((item) => <button key={item.id} onClick={() => setSelectedMember(item.id)} className={cn("w-full rounded-lg border p-3 text-left", item.id === selectedMember ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10" : "border-[var(--app-border)] bg-[var(--app-surface)]")}><span className="block truncate text-sm font-semibold">{item.displayName || item.username}</span><span className="block truncate text-xs text-[var(--app-muted)]">@{item.username}</span>{item.isSuperAdmin && <span className="mt-1 block text-xs text-[var(--app-accent)]">{gt("Administrator")}</span>}</button>)}{!members.length && <p className="text-sm text-[var(--app-muted)]">{gt("No members found")}</p>}</div>
        {member ? <MemberEditor key={`${member.id}:${member.roleIds.join(",")}`} member={member} roles={roles} access={access} onSaved={(saved) => { setMembers((previous) => previous.map((item) => item.id === saved.id ? saved : item)); refresh(); }} /> : <div className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">{gt("Select a member to review and change their access.")}</div>}
      </div>
    </div>}
  </section>;
}
