"use client";

import { memo, useMemo, useState } from "react";
import { ChevronRight, GripVertical, Pencil, Plus, Shield, Trash2, Users } from "lucide-react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { RoleIcon } from "@/components/chat/RoleIcon";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { moveRoleId } from "@/lib/roles/reorder";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type DropTarget = { roleId: string; mode: "before" | "after" } | null;

/**
 * Server Settings → Roles (list): Discord's role table with the @everyone
 * "Default Permissions" card on top, search + Create Role, drag handles to
 * reorder (desktop) and edit / delete on hover. Opening a role hands over to
 * the role editor.
 */
export const RolesListPage = memo(function RolesListPage({
  roles,
  roleLinks,
  loading,
  isMobile,
  isReordering,
  onOpenRole,
  onCreateRole,
  onDeleteRole,
  onReorder,
}: {
  /** Highest first. */
  roles: Role[];
  roleLinks: Record<string, string[]>;
  loading: boolean;
  isMobile: boolean;
  isReordering: boolean;
  onOpenRole: (roleId: string) => void;
  onCreateRole: () => void;
  onDeleteRole: (roleId: string) => void;
  onReorder: (draggedId: string, targetId: string, mode: "before" | "after") => void;
}) {
  const gt = useGT();
  const [search, setSearch] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Where the dragged role would land: above or below this row (CORD-32).
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const everyone = useMemo(() => roles.find((r) => r.isDefault) ?? null, [roles]);
  const listRoles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rest = roles.filter((r) => !r.isDefault);
    return needle ? rest.filter((r) => r.name.toLowerCase().includes(needle)) : rest;
  }, [roles, search]);
  const reorderIds = useMemo(() => roles.filter((r) => !r.isDefault).map((r) => r.id), [roles]);
  // No HTML5 drag-and-drop on touch screens, nor while the list is filtered.
  const dragEnabled = !isMobile && !search.trim();

  const endDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={gt("Roles")}
        description={gt("Use roles to group your server members and assign permissions.")}
        className="mb-0"
      />

      {everyone && (
        <button
          type="button"
          onClick={() => onOpenRole(everyone.id)}
          className="group flex w-full items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3.5 text-left transition-colors duration-(--motion-fast) hover:bg-[var(--bg-hover)]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)]">
            <Users className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-[var(--text-primary)]">{gt("Default Permissions")}</span>
            <span className="block truncate text-[13px] text-[var(--text-secondary)]">
              {gt("@everyone · applies to all server members")}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      <div className="space-y-2">
        <SettingsToolbar>
          <SettingsSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder={gt("Search roles...")}
            clearLabel={gt("Clear search")}
            className="min-w-[180px] flex-1"
          />
          <SettingsButton variant="primary" onClick={onCreateRole}>
            <Plus />
            {gt("Create Role")}
          </SettingsButton>
        </SettingsToolbar>
        <p className="px-0.5 text-[13px] text-[var(--text-secondary)]">
          {gt("Members use the colour of the highest role they have on this list. Drag roles to reorder them.")}
        </p>
      </div>

      {loading && roles.length === 0 ? (
        <SettingsSkeleton variant="list" count={6} />
      ) : listRoles.length === 0 ? (
        search.trim() ? (
          <SettingsEmptyState compact icon={Shield} title={gt("No roles match your search.")} />
        ) : (
          <SettingsEmptyState
            icon={Shield}
            title={gt("No roles yet")}
            description={gt("Create a role to give members a colour, a badge and permissions.")}
            action={
              <SettingsButton variant="primary" onClick={onCreateRole}>
                <Plus />
                {gt("Create Role")}
              </SettingsButton>
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]">
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">
            <span className="flex-1">{gt("Roles — {count}", { count: listRoles.length })}</span>
            <span className="w-24 max-sm:hidden">{gt("Members")}</span>
            <span className="w-[72px]" aria-hidden />
          </div>
          <div
            className="divide-y divide-[var(--border-subtle)]"
            onDragOver={(event) => {
              if (draggingId) event.preventDefault();
            }}
            onDrop={(event) => {
              // Drops in the gaps between rows use the last insertion bar shown.
              if (!draggingId) return;
              event.preventDefault();
              if (dropTarget) onReorder(draggingId, dropTarget.roleId, dropTarget.mode);
              endDrag();
            }}
          >
            {listRoles.map((role) => {
              const canDrag = dragEnabled && !role.managed;
              const isDragged = draggingId === role.id;
              const dropMode = dropTarget?.roleId === role.id ? dropTarget.mode : null;
              const linked = roleLinks[role.id.toLowerCase()]?.length ?? 0;
              return (
                <div
                  key={role.id}
                  data-settings-row
                  draggable={canDrag}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", role.id);
                    setDraggingId(role.id);
                  }}
                  onDragEnd={endDrag}
                  onDragOver={(event) => {
                    if (!draggingId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const mode = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    const next = moveRoleId(reorderIds, draggingId, role.id, mode) ? ({ roleId: role.id, mode } as const) : null;
                    if (next?.roleId !== dropTarget?.roleId || next?.mode !== dropTarget?.mode) setDropTarget(next);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (draggingId && dropMode) onReorder(draggingId, role.id, dropMode);
                    endDrag();
                  }}
                  onClick={() => onOpenRole(role.id)}
                  className={cn(
                    "group/role relative flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-(--motion-fast) max-md:min-h-[56px] touch-manipulation",
                    "[@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60",
                    canDrag && "active:cursor-grabbing",
                    isDragged && "opacity-40",
                  )}
                >
                  {/* Insertion bar where the dragged role will land (CORD-32) */}
                  {dropMode === "before" && (
                    <span aria-hidden className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded-full bg-[var(--app-accent)]" />
                  )}
                  {dropMode === "after" && (
                    <span aria-hidden className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-[var(--app-accent)]" />
                  )}
                  <GripVertical
                    aria-hidden
                    className={cn(
                      "-ml-1 h-4 w-4 shrink-0 text-[var(--text-muted)] max-md:hidden",
                      canDrag ? "cursor-grab opacity-0 group-hover/role:opacity-100" : "opacity-0",
                    )}
                  />
                  <Shield className="h-4 w-4 shrink-0" style={{ color: role.color || "var(--text-muted)" }} fill="currentColor" fillOpacity={0.25} />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5 text-[15px] font-medium text-[var(--text-primary)]">
                      <span className="truncate">{role.name}</span>
                      <RoleIcon role={role} size={14} />
                      {role.managed && <SettingsStatusPill>{gt("Managed")}</SettingsStatusPill>}
                    </p>
                    {(linked > 0 || isMobile) && (
                      <p className="text-xs text-[var(--text-muted)]">
                        {isMobile && gt("{count} members", { count: role.memberCount ?? 0 })}
                        {isMobile && linked > 0 && " · "}
                        {linked > 0 && gt("{count} linked", { count: linked })}
                      </p>
                    )}
                  </div>
                  <span className="flex w-24 items-center gap-1.5 text-[13px] tabular-nums text-[var(--text-secondary)] max-sm:hidden">
                    <Users className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    {role.memberCount ?? 0}
                  </span>
                  <div className="flex w-[72px] items-center justify-end gap-0.5">
                    {isMobile ? (
                      <ChevronRight className="h-5 w-5 text-[var(--text-muted)]" />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRole(role.id);
                          }}
                          aria-label={gt("Edit role {role}", { role: role.name })}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)] opacity-70 transition-opacity hover:text-[var(--text-primary)] group-hover/role:opacity-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteRole(role.id);
                          }}
                          aria-label={gt("Delete role {role}", { role: role.name })}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 group-hover/role:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {isReordering && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Loader size={14} />
          {gt("Saving role order...")}
        </p>
      )}
    </div>
  );
});
