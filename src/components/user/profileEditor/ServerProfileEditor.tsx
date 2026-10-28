"use client";

import { useMemo, useState, type ReactNode, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { AlertCircle, Camera, ChevronDown, Clock, Copy, Eye, ImagePlus, Loader2, Lock, RotateCcw, Undo2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DisplayNameStyleEditor, NameplateEditor, ProfileColourEditor, type DisplayNameStyle } from "@/components/settings/user/ProfileStyleEditors";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import type { ProfileMediaKind } from "@/components/user/profileEditor/useProfileMediaUpload";
import { mainProfileOf, type ServerProfileDraft } from "@/components/user/profileEditor/useServerProfileDraft";
import { getNameplateBackground, type NameplateCustomization } from "@/lib/constants/nameplates";
import {
  MEMBER_PROFILE_LIMITS,
  mainValueOf,
  overriddenFields,
  withServerProfile,
  type MemberOverrideField,
  type MemberProfileTheme,
} from "@/lib/profiles/memberProfile";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { cn, cdnImage } from "@/lib/utils";

const ProfileCard = dynamic(() => import("@/components/user/ProfileCard").then((m) => m.ProfileCard), {
  ssr: false,
  loading: () => <div className="h-[420px] rounded-2xl bg-[var(--bg-hover)] animate-pulse" />,
});

export interface ServerProfileMedia {
  pick: (target: { kind: ProfileMediaKind; serverId?: string; onDone?: (url: string) => void }) => void;
  uploading: Record<ProfileMediaKind, boolean>;
}

interface ServerProfileEditorProps {
  draft: ServerProfileDraft;
  serverName: string;
  media: ServerProfileMedia;
  /** The server picker, rendered at the top. */
  picker: ReactNode;
  /**
   * `page`: settings (fields + sticky live preview; preview stacks above on
   * phones). `panel`: the narrow column of your full profile, which itself
   * is the preview.
   */
  layout: "page" | "panel";
}

const INPUT = cn(
  "w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input,var(--bg-app))] px-3 text-sm text-[var(--text-primary)]",
  "placeholder:text-[var(--text-muted)] outline-none transition-[border-color,box-shadow] duration-150",
  "focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_25%,transparent)]",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

/** "Customised" / "Main profile" chip + "Use main profile" for one field. */
function FieldHeader({
  title,
  htmlFor,
  overridden,
  dirty,
  onReset,
  compact,
  extra,
}: {
  title: string;
  htmlFor?: string;
  overridden: boolean;
  dirty: boolean;
  onReset: () => void;
  compact: boolean;
  extra?: ReactNode;
}) {
  const gt = useGT();
  const Label = htmlFor ? "label" : "span";
  return (
    <div className="mb-2 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
      <Label htmlFor={htmlFor} className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{title}</Label>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          overridden
            ? "bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)]"
            : "bg-[var(--bg-hover)] text-[var(--text-muted)]",
        )}
      >
        {overridden ? gt("Customised") : gt("Main profile")}
      </span>
      {dirty && <span className="size-1.5 rounded-full bg-[var(--status-idle)]" role="img" aria-label={gt("Unsaved change")} title={gt("Unsaved change")} />}
      {extra}
      {overridden && (
        <button
          type="button"
          onClick={onReset}
          title={gt("Use main profile")}
          aria-label={gt("Use main profile")}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-[var(--text-muted)] transition-colors duration-150",
            "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
            compact ? "size-7 justify-center" : "h-7 px-2",
          )}
        >
          <Undo2 className="w-3.5 h-3.5 shrink-0" />
          {!compact && <span>{gt("Use main profile")}</span>}
        </button>
      )}
    </div>
  );
}

/** A style section folded to a one-line preview; opens its full editor. */
function Expandable({ open, onToggle, summary, label, children }: { open: boolean; onToggle: () => void; summary: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] max-md:bg-[var(--bg-card)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={label}
        className="flex w-full min-h-12 items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown className={cn("w-4 h-4 shrink-0 text-[var(--text-muted)] transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-[var(--border-subtle)] p-3">{children}</div>}
    </div>
  );
}

/**
 * Edit your profile for one server. Every field shows whether it is
 * customised here or comes from your main profile, and can go back to the
 * main profile on its own. Edits stay in the draft until it is saved (the
 * caller renders the unsaved-changes bar).
 */
export function ServerProfileEditor({ draft, serverName, media, picker, layout }: ServerProfileEditorProps) {
  const gt = useGT();
  const { user } = useAuth();
  const compact = layout === "panel";
  const [expanded, setExpanded] = useState<"style" | "nameplate" | "theme" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Narrow screens (page: below lg; panel: phones, where the panel covers
  // the profile it previews) fold the preview above the fields; only one
  // card is ever mounted.
  const narrow = useIsMobile(compact ? 768 : 1024);
  const main = useMemo(() => mainProfileOf(user), [user]);
  const d = draft.draft;
  const overridden = overriddenFields(d);
  const has = (f: MemberOverrideField) => overridden.includes(f);
  const dirty = (f: MemberOverrideField) => draft.dirtyFields.includes(f);
  const toggle = (id: "style" | "nameplate" | "theme") => setExpanded((cur) => (cur === id ? null : id));
  const serverId = draft.serverId;

  // What each style section shows: the override, else the main value.
  const style = (d.displayNameStyle ?? mainValueOf(main, "displayNameStyle")) as DisplayNameStyle;
  const nameplate = (d.nameplate ?? mainValueOf(main, "nameplate")) as NameplateCustomization;
  const theme = (d.theme ?? mainValueOf(main, "theme")) as MemberProfileTheme;
  const shownName = d.nickname || main.displayName || main.username || "";
  const shownAvatar = d.avatar || main.avatar || undefined;
  const nameplateBg = getNameplateBackground({ nameplate });

  const setStyle = draft.updater("displayNameStyle") as (v: SetStateAction<DisplayNameStyle>) => void;
  const setNameplate = draft.updater("nameplate") as (v: SetStateAction<NameplateCustomization>) => void;
  const setTheme = draft.updater("theme");
  const setProfileColor = (v: SetStateAction<string>) => setTheme((t) => ({ ...t, profileColor: typeof v === "function" ? v(t.profileColor) : v }));
  const setProfileGradient = (v: SetStateAction<string[]>) => setTheme((t) => ({ ...t, profileGradient: typeof v === "function" ? v(t.profileGradient) : v }));

  const previewUser = useMemo<ProfileCardUser | null>(() => {
    if (!user) return null;
    const base: ProfileCardUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      nickname: null,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      pronouns: user.pronouns,
      timezone: user.timezone,
      showTimezone: user.showTimezone,
      customStatus: user.customStatus,
      status: (user.status as ProfileCardUser["status"]) || "online",
      badges: user.badges || [],
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      isPremium: user.isPremium || false,
      customization: (user.customization || {}) as ProfileCardUser["customization"],
    };
    return withServerProfile(base, d);
  }, [user, d]);

  const fieldError = (f: MemberOverrideField) =>
    draft.fieldError && draft.fieldError.field === f ? (
      <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-[var(--destructive,#EF4444)]">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        {draft.fieldError.message}
      </p>
    ) : null;

  const header = (
    <div className="space-y-3">
      {picker}
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        {gt("Changes here only show in {server}. Anything you leave alone uses your main profile.", { server: serverName })}
      </p>
      <div className={cn("flex flex-wrap items-center gap-2", compact && "gap-1.5")}>
        <span className="mr-auto text-xs font-medium text-[var(--text-secondary)]" aria-live="polite">
          {gt("Customised fields: {count}", { count: overridden.length })}
        </span>
        <button
          type="button"
          onClick={draft.copyFromMain}
          disabled={draft.loading || draft.failed}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
        >
          <Copy className="w-3.5 h-3.5" />
          {gt("Copy from main profile")}
        </button>
        <button
          type="button"
          onClick={draft.clearAll}
          disabled={draft.loading || draft.failed || overridden.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 text-xs font-medium text-[var(--destructive,#EF4444)] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--destructive,#EF4444)_10%,transparent)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {gt("Reset all for this server")}
        </button>
      </div>
      {draft.timedOutUntil && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2.5 text-xs text-[var(--text-secondary)]">
          <Clock className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          {gt("You're timed out in this server, so you can't change your server profile until the timeout ends.")}
        </p>
      )}
    </div>
  );

  if (draft.loading) {
    return (
      <div className="space-y-5">
        {header}
        <div className="space-y-3" aria-busy="true" aria-label={gt("Loading server profile…")}>
          <div className="h-10 rounded-lg bg-[var(--bg-hover)] animate-pulse" />
          <div className="h-10 rounded-lg bg-[var(--bg-hover)] animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="aspect-square rounded-xl bg-[var(--bg-hover)] animate-pulse" />
            <div className="aspect-square rounded-xl bg-[var(--bg-hover)] animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (draft.failed) {
    return (
      <div className="space-y-5">
        {header}
        <p className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] p-3 text-sm text-[var(--text-secondary)]">
          <AlertCircle className="w-4 h-4 shrink-0 text-[var(--destructive,#EF4444)]" />
          <span className="flex-1">{gt("Couldn't load your server profile.")}</span>
          <button
            type="button"
            onClick={draft.reload}
            className="shrink-0 rounded-md border border-[var(--border-subtle)] px-2.5 h-8 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
          >
            {gt("Try again")}
          </button>
        </p>
      </div>
    );
  }

  const nickId = `server-nick-${serverId}`;
  const pronounsId = `server-pronouns-${serverId}`;
  const bioId = `server-bio-${serverId}`;
  const bioLength = Array.from(d.bio ?? "").length;

  const imageTile = (kind: "avatar" | "banner", className?: string) => {
    const own = d[kind];
    const shown = own || (kind === "avatar" ? main.avatar : main.banner) || undefined;
    const label = kind === "avatar" ? gt("Change Avatar") : gt("Change Banner");
    return (
      <div className={className}>
        <FieldHeader
          title={kind === "avatar" ? gt("Avatar") : gt("Banner")}
          overridden={has(kind)}
          dirty={dirty(kind)}
          onReset={() => draft.clearField(kind)}
          compact={compact}
        />
        <button
          type="button"
          onClick={() => serverId && media.pick({ kind, serverId, onDone: (url) => draft.setField(kind, url) })}
          aria-label={label}
          className={cn(
            "group relative flex w-full items-center justify-center overflow-hidden rounded-xl border bg-[var(--bg-hover)] transition-[border-color] duration-150",
            "hover:border-[color-mix(in_srgb,var(--app-accent)_60%,var(--border-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
            own ? "border-[var(--border-subtle)]" : "border-dashed border-[var(--border-subtle)]",
            kind === "avatar" ? "aspect-square" : "aspect-[5/2] sm:aspect-square",
            compact && kind === "banner" && "aspect-square sm:aspect-square",
          )}
        >
          {kind === "avatar" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cdnImage(shown)} alt="" className={cn("size-[68%] rounded-full object-cover bg-[var(--bg-card)]", !own && "opacity-55")} />
          ) : shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cdnImage(shown)} alt="" className={cn("absolute inset-0 size-full object-cover", !own && "opacity-55")} />
          ) : (
            <ImagePlus className="w-6 h-6 text-[var(--text-muted)]" />
          )}
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-[11px] font-semibold text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:bg-black/30">
            {media.uploading[kind] ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            {label}
          </span>
        </button>
        {fieldError(kind)}
      </div>
    );
  };

  const fields = (
    <div className={cn("min-w-0", compact ? "space-y-5" : "space-y-6")}>
      {/* Nickname + pronouns */}
      <div className={cn("grid gap-4", !compact && "sm:grid-cols-2")}>
        <div>
          <FieldHeader
            title={gt("Server Nickname")}
            htmlFor={nickId}
            overridden={has("nickname")}
            dirty={dirty("nickname")}
            onReset={() => draft.clearField("nickname")}
            compact={compact}
            extra={!draft.canChangeNickname ? <Lock className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden /> : undefined}
          />
          <input
            id={nickId}
            value={d.nickname ?? ""}
            onChange={(e) => draft.setField("nickname", e.target.value)}
            maxLength={MEMBER_PROFILE_LIMITS.nickname}
            placeholder={main.displayName || main.username || ""}
            disabled={!draft.canChangeNickname}
            className={cn(INPUT, "h-10")}
          />
          {!draft.canChangeNickname && (
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">{gt("You can't change your nickname in this server.")}</p>
          )}
          {fieldError("nickname")}
        </div>
        <div>
          <FieldHeader
            title={gt("Pronouns")}
            htmlFor={pronounsId}
            overridden={has("pronouns")}
            dirty={dirty("pronouns")}
            onReset={() => draft.clearField("pronouns")}
            compact={compact}
          />
          <input
            id={pronounsId}
            value={d.pronouns ?? ""}
            onChange={(e) => draft.setField("pronouns", e.target.value)}
            maxLength={MEMBER_PROFILE_LIMITS.pronouns}
            placeholder={main.pronouns || gt("Add your pronouns")}
            className={cn(INPUT, "h-10")}
          />
          {fieldError("pronouns")}
        </div>
      </div>

      {/* Avatar + banner */}
      <div className="grid grid-cols-2 gap-3">
        {imageTile("avatar", compact ? undefined : "col-span-2 sm:col-span-1 max-sm:max-w-[160px]")}
        {/* Phones (page layout): the wide banner gets its own row. */}
        {imageTile("banner", compact ? undefined : "col-span-2 sm:col-span-1")}
      </div>

      {/* About me */}
      <div>
        <FieldHeader
          title={gt("About Me")}
          htmlFor={bioId}
          overridden={has("bio")}
          dirty={dirty("bio")}
          onReset={() => draft.clearField("bio")}
          compact={compact}
        />
        <textarea
          id={bioId}
          value={d.bio ?? ""}
          onChange={(e) => draft.setField("bio", e.target.value)}
          maxLength={MEMBER_PROFILE_LIMITS.bio}
          placeholder={main.bio || gt("Tell this server about yourself")}
          rows={compact ? 4 : 5}
          className={cn(INPUT, "min-h-[96px] resize-y py-2 leading-relaxed")}
        />
        <span className="mt-1 block text-right text-xs tabular-nums text-[var(--text-muted)]">{bioLength}/{MEMBER_PROFILE_LIMITS.bio}</span>
        {fieldError("bio")}
      </div>

      {/* Display name style */}
      <div>
        <FieldHeader
          title={gt("Display Name Style")}
          overridden={has("displayNameStyle")}
          dirty={dirty("displayNameStyle")}
          onReset={() => draft.clearField("displayNameStyle")}
          compact={compact}
        />
        <Expandable
          open={expanded === "style"}
          onToggle={() => toggle("style")}
          label={gt("Edit display name style")}
          summary={
            <span className={cn("block truncate text-lg font-bold text-[var(--text-primary)]", getDisplayNameStyleClasses(style))} style={getDisplayNameStyleInline(style)}>
              {shownName}
            </span>
          }
        >
          <DisplayNameStyleEditor value={style} onChange={setStyle} />
        </Expandable>
        {fieldError("displayNameStyle")}
      </div>

      {/* Nameplate */}
      <div>
        <FieldHeader
          title={gt("Nameplate")}
          overridden={has("nameplate")}
          dirty={dirty("nameplate")}
          onReset={() => draft.clearField("nameplate")}
          compact={compact}
        />
        <Expandable
          open={expanded === "nameplate"}
          onToggle={() => toggle("nameplate")}
          label={gt("Edit nameplate")}
          summary={
            <span className="relative flex h-9 items-center gap-2 overflow-hidden rounded-lg px-2">
              {nameplateBg && <span aria-hidden className="absolute inset-0" style={{ background: nameplateBg, opacity: 0.6 }} />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cdnImage(shownAvatar)} alt="" className="relative size-6 rounded-full object-cover bg-[var(--bg-hover)]" />
              <span className={cn("relative min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]", getDisplayNameStyleClasses(style))} style={getDisplayNameStyleInline(style)}>
                {shownName}
              </span>
              {!nameplateBg && <span className="relative ml-auto text-xs text-[var(--text-muted)]">{gt("None")}</span>}
            </span>
          }
        >
          <NameplateEditor nameplate={nameplate} onChange={setNameplate} displayName={shownName} displayNameStyle={style} avatar={shownAvatar} />
        </Expandable>
        {fieldError("nameplate")}
      </div>

      {/* Profile theme */}
      <div>
        <FieldHeader
          title={gt("Profile Colour")}
          overridden={has("theme")}
          dirty={dirty("theme")}
          onReset={() => draft.clearField("theme")}
          compact={compact}
        />
        <Expandable
          open={expanded === "theme"}
          onToggle={() => toggle("theme")}
          label={gt("Edit profile colour")}
          summary={
            <span
              className="block h-9 rounded-lg border border-[var(--border-subtle)]"
              style={{
                background: theme.profileGradient.length >= 2
                  ? `linear-gradient(135deg, ${theme.profileGradient.join(", ")})`
                  : theme.profileColor || "var(--bg-hover)",
              }}
            />
          }
        >
          <ProfileColourEditor
            profileColor={theme.profileColor}
            setProfileColor={setProfileColor}
            profileGradient={theme.profileGradient}
            setProfileGradient={setProfileGradient}
          />
        </Expandable>
        {fieldError("theme")}
      </div>
    </div>
  );

  const previewToggle = (
          <div>
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              aria-expanded={previewOpen}
              className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 h-10 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
            >
              <Eye className="w-4 h-4 text-[var(--text-muted)]" />
              <span className="flex-1 text-left">{gt("Preview in {server}", { server: serverName })}</span>
              <ChevronDown className={cn("w-4 h-4 text-[var(--text-muted)] transition-transform duration-150", previewOpen && "rotate-180")} />
            </button>
            {previewOpen && previewUser && (
              <div className="mt-3 mx-auto max-w-[340px]">
                <ProfileCard user={previewUser} isCurrentUser hideConnections />
              </div>
            )}
          </div>
  );

  if (compact) {
    return (
      <div className="space-y-5">
        {header}
        {narrow && previewToggle}
        {fields}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
        {narrow ? previewToggle : null}
        {fields}
        {!narrow && (
          <aside className="min-w-0 self-start lg:sticky lg:top-20">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              {gt("Preview in {server}", { server: serverName })}
            </p>
            {previewUser && <ProfileCard user={previewUser} isCurrentUser hideConnections />}
          </aside>
        )}
      </div>
    </div>
  );
}
