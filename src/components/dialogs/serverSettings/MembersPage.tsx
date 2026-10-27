"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import { Clock, Crown, Plus, Users, X } from "lucide-react";
import { useGT, useLocale } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { filterAndSortMembers, type MemberSort } from "@/lib/servers/memberView";
import type { UserActionKind } from "@/lib/social/userActions";
import { cn, cdnImage } from "@/lib/utils";
import { formatShortDate } from "./formatDate";
import { MembersPager, MEMBERS_PAGE_SIZE } from "./MembersPager";
import type { Role, ServerMember } from "./types";

const PAGE_SIZE = MEMBERS_PAGE_SIZE;

const selectClass =
  "h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)]";

/** Shared column template so header and rows line up (desktop). */
const GRID = "lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-center lg:gap-4";

interface MemberRowProps {
  member: ServerMember;
  assignableRoles: Role[];
  isOwner: boolean;
  canModerate: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  locale: string;
  onToggleRole: (member: ServerMember, roleId: string, checked: boolean) => void;
  onAction: (kind: UserActionKind, member: ServerMember) => void;
}

const MemberRow = memo(function MemberRow({
  member,
  assignableRoles,
  isOwner,
  canModerate,
  canKick,
  canBan,
  canTimeout,
  locale,
  onToggleRole,
  onAction,
}: MemberRowProps) {
  const gt = useGT();
  const visibleRoles = member.roles.filter((r) => !r.isDefault);
  const joined = formatShortDate(member.joinedAt, locale);
  const created = formatShortDate(member.accountCreatedAt, locale);
  // Rendered once per row on mount: a stale "timed out" pill until the next refresh is fine.
  // eslint-disable-next-line react-hooks/purity
  const timedOut = Boolean(member.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now());
  const name = member.displayName || member.username;

  return (
    <div
      data-settings-row
      className={cn(
        "group/member relative px-4 py-3 transition-colors duration-(--motion-fast) [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60",
        GRID,
      )}
    >
      {/* Name */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={cdnImage(member.avatar || undefined)} />
          <AvatarFallback className="bg-[var(--app-accent)] text-sm text-white">{(name || "?").charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-[var(--text-primary)]">{name}</span>
            {isOwner && <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-label={gt("Server Owner")} />}
            {member.isBot && <SettingsStatusPill tone="accent">{gt("BOT")}</SettingsStatusPill>}
            {timedOut && (
              <SettingsStatusPill tone="danger">
                <Clock className="h-3 w-3" />
                {gt("Timed out")}
              </SettingsStatusPill>
            )}
          </div>
          <p className="truncate text-[13px] text-[var(--text-secondary)]">@{member.username}</p>
          {/* Dates under the name below the table breakpoint. */}
          <p className="truncate text-xs text-[var(--text-muted)] lg:hidden">
            {[joined && gt("Joined {date}", { date: joined }), created && gt("Account created {date}", { date: created })]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="hidden truncate text-[13px] text-[var(--text-secondary)] lg:block">{joined ?? "—"}</div>
      <div className="hidden truncate text-[13px] text-[var(--text-secondary)] lg:block">{created ?? "—"}</div>

      {/* Roles */}
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1 pl-12 lg:mt-0 lg:pl-0">
        {visibleRoles.slice(0, 3).map((role) => (
          <span
            key={role.id}
            className="inline-flex max-w-[160px] items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-app)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)]"
          >
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: role.color || "var(--text-muted)" }} />
            <span className="truncate">{role.name}</span>
            {!role.managed && (
              <button
                type="button"
                onClick={() => onToggleRole(member, role.id, false)}
                className="-mr-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] max-md:p-1"
                title={gt("Remove role")}
                aria-label={gt("Remove role {role}", { role: role.name })}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {visibleRoles.length > 3 && (
          <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
            +{visibleRoles.length - 3}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] transition-colors hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] max-md:h-7 max-md:w-7"
              title={gt("Assign roles")}
              aria-label={gt("Assign roles")}
            >
              <Plus className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]">
            <DropdownMenuLabel className="text-xs font-bold uppercase text-[var(--text-muted)]">{gt("Manage Roles")}</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
            <ScrollArea className="h-[200px]">
              {assignableRoles.map((role) => {
                const hasRole = member.roles.some((r) => r.id === role.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={role.id}
                    checked={hasRole}
                    onCheckedChange={(checked) => onToggleRole(member, role.id, checked)}
                    className="focus:bg-[var(--app-accent)] focus:text-white"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: role.color }} />
                      <span className={hasRole ? "text-[var(--text-primary)]" : ""}>{role.name}</span>
                    </div>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Moderation (the server re-checks permissions and role hierarchy) */}
      <div
        className={cn(
          "mt-2 flex items-center justify-end gap-1 lg:mt-0 lg:min-w-[168px]",
          "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/member:opacity-100 [@media(hover:hover)]:group-focus-within/member:opacity-100 transition-opacity duration-(--motion-fast)",
        )}
      >
        {canModerate && canTimeout && (
          <SettingsButton size="sm" variant="ghost" onClick={() => onAction("timeout", member)}>
            {gt("Timeout")}
          </SettingsButton>
        )}
        {canModerate && canKick && (
          <SettingsButton size="sm" variant="ghost" className="text-red-500 hover:text-red-500 hover:bg-red-500/10" onClick={() => onAction("kick", member)}>
            {gt("Kick")}
          </SettingsButton>
        )}
        {canModerate && canBan && (
          <SettingsButton size="sm" variant="danger" onClick={() => onAction("ban", member)}>
            {gt("Ban")}
          </SettingsButton>
        )}
      </div>
    </div>
  );
});

/**
 * Server Settings → Members: Discord's member table with a sticky search /
 * sort / role filter bar, role chips you can add or remove inline and
 * moderation actions on hover. Search state lives here so typing never
 * re-renders the whole settings dialog.
 */
export const MembersPage = memo(function MembersPage({
  members,
  roles,
  ownerId,
  currentUserId,
  loading,
  canKick,
  canBan,
  canTimeout,
  onToggleRole,
  onAction,
}: {
  members: ServerMember[];
  /** Highest first. */
  roles: Role[];
  ownerId: string | undefined;
  currentUserId: string | undefined;
  loading: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  onToggleRole: (member: ServerMember, roleId: string, checked: boolean) => void;
  onAction: (kind: UserActionKind, member: ServerMember) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MemberSort>("joined_desc");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(0);
  // Filtering 1000 members runs behind the keystroke, not on it.
  const deferredSearch = useDeferredValue(search);

  const visibleMembers = useMemo(
    () => filterAndSortMembers(members, { search: deferredSearch, roleId: roleFilter || null, sort }),
    [members, deferredSearch, roleFilter, sort],
  );
  const filterRoles = useMemo(() => roles.filter((r) => !r.isDefault), [roles]);
  const assignableRoles = useMemo(() => roles.filter((r) => !r.isDefault && !r.managed), [roles]);

  const pageCount = Math.max(1, Math.ceil(visibleMembers.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visibleMembers.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const filtered = Boolean(deferredSearch.trim() || roleFilter);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={gt("Server Members")}
        description={
          visibleMembers.length === members.length
            ? gt("{count} members", { count: members.length })
            : gt("Showing {shown} of {count} members", { shown: visibleMembers.length, count: members.length })
        }
        className="mb-2"
      />

      {/* Sort + role filter (CORD-54) */}
      <SettingsToolbar>
        <SettingsSearchInput
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          placeholder={gt("Search members...")}
          clearLabel={gt("Clear search")}
          className="w-full sm:w-64 sm:flex-none"
        />
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            {gt("Sort by")}
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as MemberSort);
                setPage(0);
              }}
              className={selectClass}
            >
              <option value="joined_desc">{gt("Joined server (newest)")}</option>
              <option value="joined_asc">{gt("Joined server (oldest)")}</option>
              <option value="created_desc">{gt("Account created (newest)")}</option>
              <option value="created_asc">{gt("Account created (oldest)")}</option>
              <option value="name_asc">{gt("Name (A to Z)")}</option>
              <option value="name_desc">{gt("Name (Z to A)")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            {gt("Role")}
            <select
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(0);
              }}
              className={selectClass}
            >
              <option value="">{gt("All roles")}</option>
              {filterRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </SettingsToolbar>

      {loading && members.length === 0 ? (
        <SettingsSkeleton variant="list" count={8} />
      ) : visibleMembers.length === 0 ? (
        <SettingsEmptyState
          icon={Users}
          title={filtered ? gt("No members match these filters.") : gt("No members")}
          action={
            filtered ? (
              <SettingsButton
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setRoleFilter("");
                  setPage(0);
                }}
              >
                {gt("Clear filters")}
              </SettingsButton>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]">
          <div
            className={cn(
              "hidden border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]",
              GRID,
            )}
          >
            <span>{gt("Name")}</span>
            <span>{gt("Member Since")}</span>
            <span>{gt("Joined SerikaCord")}</span>
            <span>{gt("Roles")}</span>
            <span className="lg:min-w-[168px]" aria-hidden />
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {pageRows.map((member, index) => (
              <MemberRow
                key={member.id || `member-${index}`}
                member={member}
                assignableRoles={assignableRoles}
                isOwner={ownerId === member.id}
                canModerate={member.id !== currentUserId && member.id !== ownerId}
                canKick={canKick}
                canBan={canBan}
                canTimeout={canTimeout}
                locale={locale}
                onToggleRole={onToggleRole}
                onAction={onAction}
              />
            ))}
          </div>
          <MembersPager page={safePage} pageCount={pageCount} total={visibleMembers.length} onPage={setPage} />
        </div>
      )}
    </div>
  );
});
