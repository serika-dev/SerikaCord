"use client";

/**
 * Discord's server "Members" page (/channels/:serverId/members) for
 * moderators: the "Recent Members" table with search (name or id), sort
 * (newest joined first), when each member joined the server and SerikaCord,
 * their roles, moderation signals and the user menu (profile, mod view,
 * timeout, kick, ban ... whatever the viewer may use; the server re-checks).
 *
 * Reads the member list the app shell already keeps for the open server
 * (ServerMembersContext, polled), so opening the page costs no extra request.
 * Search / sort / paging use the same rules as Server Settings → Members.
 */

import { memo, useCallback, useDeferredValue, useMemo, useState, type ComponentProps, type MouseEvent } from "react";
import { useGT, useLocale } from "gt-next";
import { ArrowUpDown, Clock, Crown, EllipsisVertical, ShieldAlert, UserRound, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { MembersPager, MEMBERS_PAGE_SIZE } from "@/components/dialogs/serverSettings/MembersPager";
import type { ServerMember } from "@/components/dialogs/serverSettings/types";
import { ServerTagPill } from "@/components/user/ServerTagPill";
import { useUserContextMenu, type ContextMenuUser } from "@/components/user/UserContextMenu";
import { useServer, useServerMembers } from "@/contexts/ServerContext";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { filterAndSortMembers, type MemberSort } from "@/lib/servers/memberView";
import {
  memberNameColor,
  memberSignals,
  relativeAge,
  visibleMemberRoles,
  type MemberSignal,
  type RelativeAge,
} from "@/lib/servers/serverPages";
import { openUserAction } from "@/lib/social/userActions";
import { cdnImage, cn } from "@/lib/utils";

/** What the members API sends on top of the settings page's member shape. */
type MemberRowData = ServerMember & {
  isOwner?: boolean;
  isSystem?: boolean;
  customization?: ComponentProps<typeof ServerTagPill>["customization"];
};

/** Shared column template so header and rows line up (desktop). */
const GRID =
  "lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4";

function useRelativeFormatter() {
  const locale = useLocale();
  return useMemo(() => {
    let rtf: Intl.RelativeTimeFormat | null = null;
    try {
      rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "long" });
    } catch {
      rtf = null;
    }
    const dateFmt = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return {
      relative: (age: RelativeAge | null) => (age && rtf ? rtf.format(-age.value, age.unit) : null),
      full: (value: string | null | undefined) => {
        const t = value ? Date.parse(value) : NaN;
        return Number.isFinite(t) ? dateFmt.format(t) : undefined;
      },
    };
  }, [locale]);
}

interface RowProps {
  member: MemberRowData;
  isOwner: boolean;
  now: number;
  serverId: string;
  format: ReturnType<typeof useRelativeFormatter>;
  onMenu: (event: MouseEvent<HTMLElement>, member: MemberRowData, anchor: "pointer" | "button") => void;
}

const MemberRow = memo(function MemberRow({ member, isOwner, now, serverId, format, onMenu }: RowProps) {
  const gt = useGT();
  const name = decodeHtmlEntities(member.displayName || member.username);
  const color = memberNameColor(member.roles);
  const roles = visibleMemberRoles(member.roles);
  const signals = memberSignals(member, now);
  const joined = format.relative(relativeAge(member.joinedAt, now));
  const created = format.relative(relativeAge(member.accountCreatedAt, now));
  const signalLabel = (s: MemberSignal) => (s === "new_account" ? gt("New account") : gt("Timed out"));

  const openProfile = () =>
    openUserAction("profile", {
      id: member.id,
      username: member.username,
      displayName: member.displayName ?? null,
      avatar: member.avatar ?? null,
      isBot: member.isBot,
      serverId,
      communicationDisabledUntil: member.communicationDisabledUntil ?? null,
    });

  return (
    <div
      role="row"
      onContextMenu={(e) => onMenu(e, member, "pointer")}
      className={cn("group/member relative px-4 py-3 transition-colors [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60", GRID)}
    >
      {/* Name */}
      <div role="cell" className="flex min-w-0 items-center gap-3 pr-20 lg:pr-0">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={cdnImage(member.avatar || undefined)} alt="" />
          <AvatarFallback className="bg-[var(--app-accent)] text-sm text-[var(--text-on-accent)]">{(name || "?").charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openProfile}
              className="truncate rounded text-left text-[15px] font-medium text-[var(--text-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
              style={color ? { color } : undefined}
            >
              {name}
            </button>
            {isOwner && <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-label={gt("Server Owner")} />}
            {member.isBot && (
              <span className="shrink-0 rounded bg-[var(--app-accent)] px-1 py-0.5 text-[10px] font-bold leading-none text-[var(--text-on-accent)]">{gt("BOT")}</span>
            )}
            <ServerTagPill customization={member.customization} />
          </div>
          <p className="truncate text-[13px] text-[var(--text-secondary)]">{member.username}</p>
          {/* Dates and signals under the name below the table breakpoint. */}
          <p className="truncate text-xs text-[var(--text-muted)] lg:hidden">
            {[joined && gt("Joined {when}", { when: joined }), created && gt("Account {when}", { when: created }), ...signals.map(signalLabel)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div role="cell" className="hidden truncate text-sm text-[var(--text-primary)] lg:block" title={format.full(member.joinedAt)}>
        {joined ?? "—"}
      </div>
      <div role="cell" className="hidden truncate text-sm text-[var(--text-primary)] lg:block" title={format.full(member.accountCreatedAt)}>
        {created ?? "—"}
      </div>

      {/* Roles: the highest one + how many more */}
      <div role="cell" className="mt-2 flex min-w-0 items-center gap-1.5 pl-12 lg:mt-0 lg:pl-0">
        {roles.length > 0 ? (
          <>
            <span className="inline-flex min-w-0 max-w-[180px] items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs font-medium text-[var(--text-primary)]">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roles[0].color || "var(--text-muted)" }} />
              <span className="truncate">{decodeHtmlEntities(roles[0].name)}</span>
            </span>
            {roles.length > 1 && (
              <span
                className="shrink-0 text-xs font-semibold text-[var(--text-secondary)]"
                title={roles.slice(1).map((r) => decodeHtmlEntities(r.name)).join(", ")}
              >
                +{roles.length - 1}
              </span>
            )}
          </>
        ) : (
          <span className="hidden text-sm text-[var(--text-muted)] lg:inline">—</span>
        )}
      </div>

      {/* Signals */}
      <div role="cell" className="hidden min-w-0 flex-wrap items-center gap-1 lg:flex">
        {signals.map((s) => (
          <span
            key={s}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              s === "timed_out" ? "bg-red-500/12 text-red-500" : "bg-amber-500/12 text-amber-500",
            )}
          >
            {s === "timed_out" ? <Clock className="h-3 w-3" aria-hidden /> : <ShieldAlert className="h-3 w-3" aria-hidden />}
            {signalLabel(s)}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div role="cell" className="absolute right-3 top-3 flex items-center gap-1 lg:static">
        <button
          type="button"
          onClick={openProfile}
          title={gt("View Profile")}
          aria-label={gt("View profile of {name}", { name })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
        >
          <UserRound className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(e) => onMenu(e, member, "button")}
          title={gt("More")}
          aria-label={gt("More options for {name}", { name })}
          aria-haspopup="menu"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

export function ServerMembersView({ serverId }: { serverId: string }) {
  const gt = useGT();
  const format = useRelativeFormatter();
  const { currentServer } = useServer();
  const { members: rawMembers, isMembersLoading } = useServerMembers();
  const { openUserMenu, openUserMenuAt, userMenu } = useUserContextMenu(serverId);
  // "x days ago" is computed against when the page opened (good enough for a list).
  const [now] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MemberSort>("joined_desc");
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search);

  const ready = currentServer?.id === serverId;
  const members = useMemo(() => (ready ? (rawMembers as MemberRowData[]) : []), [ready, rawMembers]);
  const ownerId = currentServer?.ownerId;
  const visible = useMemo(() => filterAndSortMembers(members, { search: deferredSearch, sort }), [members, deferredSearch, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / MEMBERS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = visible.slice(safePage * MEMBERS_PAGE_SIZE, (safePage + 1) * MEMBERS_PAGE_SIZE);
  const loading = !ready || (isMembersLoading && members.length === 0);

  const onMenu = useCallback(
    (event: MouseEvent<HTMLElement>, member: MemberRowData, anchor: "pointer" | "button") => {
      const user: ContextMenuUser = {
        id: member.id,
        username: member.username,
        displayName: member.displayName ?? null,
        avatar: member.avatar ?? null,
        isBot: member.isBot,
        isSystem: member.isSystem,
      };
      if (anchor === "pointer") {
        openUserMenu(event, user);
        return;
      }
      // Keep this click away from the menu's outside-click listener.
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openUserMenuAt(Math.max(8, rect.right - 220), rect.bottom + 4, user);
    },
    [openUserMenu, openUserMenuAt],
  );

  const sortOptions: Array<{ id: MemberSort; label: string }> = [
    { id: "joined_desc", label: gt("Member since (newest first)") },
    { id: "joined_asc", label: gt("Member since (oldest first)") },
    { id: "created_desc", label: gt("Account age (newest first)") },
    { id: "created_asc", label: gt("Account age (oldest first)") },
    { id: "name_asc", label: gt("Name (A to Z)") },
    { id: "name_desc", label: gt("Name (Z to A)") },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] p-3 sm:p-5">
      <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]" aria-labelledby="recent-members-title">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 id="recent-members-title" className="mr-auto text-base font-semibold text-[var(--text-primary)]">
            {gt("Recent Members")}
            {ready && members.length > 0 && (
              <span className="ml-2 text-sm font-normal text-[var(--text-muted)] tabular-nums">
                {visible.length === members.length
                  ? gt("{count} members", { count: members.length })
                  : gt("Showing {shown} of {count} members", { shown: visible.length, count: members.length })}
              </span>
            )}
          </h2>
          <SettingsSearchInput
            value={search}
            onValueChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder={gt("Search by username or id")}
            clearLabel={gt("Clear search")}
            className="w-full sm:w-72"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SettingsButton variant="secondary" className="h-9">
                <ArrowUpDown aria-hidden />
                {gt("Sort")}
              </SettingsButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]">
              <DropdownMenuLabel className="text-xs font-bold uppercase text-[var(--text-muted)]">{gt("Sort by")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => {
                  setSort(v as MemberSort);
                  setPage(0);
                }}
              >
                {sortOptions.map((o) => (
                  <DropdownMenuRadioItem key={o.id} value={o.id} className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)]">
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--border-subtle)]" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="h-9 w-9 shrink-0 rounded-full bg-[var(--bg-hover)] animate-pulse" />
                <span className="h-4 w-40 rounded bg-[var(--bg-hover)] animate-pulse" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6">
            <SettingsEmptyState
              icon={Users}
              title={deferredSearch.trim() ? gt("No members match your search.") : gt("No members")}
              action={
                deferredSearch.trim() ? (
                  <SettingsButton variant="secondary" onClick={() => setSearch("")}>
                    {gt("Clear search")}
                  </SettingsButton>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div role="table" aria-labelledby="recent-members-title">
            <div
              role="row"
              className={cn("hidden border-b border-[var(--border-subtle)] px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)]", GRID)}
            >
              <span role="columnheader">{gt("Name")}</span>
              <span role="columnheader">{gt("Member Since")}</span>
              <span role="columnheader">{gt("Joined SerikaCord")}</span>
              <span role="columnheader">{gt("Roles")}</span>
              <span role="columnheader">{gt("Signals")}</span>
              <span role="columnheader" className="w-[68px]">
                <span className="sr-only">{gt("Actions")}</span>
              </span>
            </div>
            <div role="rowgroup" className="divide-y divide-[var(--border-subtle)]">
              {rows.map((member, index) => (
                <MemberRow
                  key={member.id || `member-${index}`}
                  member={member}
                  isOwner={Boolean(member.isOwner) || member.id === ownerId}
                  now={now}
                  serverId={serverId}
                  format={format}
                  onMenu={onMenu}
                />
              ))}
            </div>
            <MembersPager page={safePage} pageCount={pageCount} total={visible.length} onPage={setPage} />
          </div>
        )}
      </section>
      {userMenu}
    </div>
  );
}
