"use client";

import { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from "react";
import { useServer } from "@/contexts/ServerContext";
import { SERVER_THEME_DRAFT_KEYS, ServerThemeSettings } from "@/components/settings/ServerThemeSettings";
import { parseThemeGradientKey, serverThemeGradient, themeGradientKey } from "@/lib/appearance/customization";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useImageCropper } from "@/components/ui/useImageCropper";
import { toast } from "sonner";
import {
  Settings,
  Shield,
  Users,
  Smile,
  Sticker,
  Link2,
  Ban,
  FileText,
  Folder,
  Camera,
  Trash2,
  Plus,
  Copy,
  ExternalLink,
  Volume2,
  AlertTriangle,
  Play,
  Lock,
  Mail,
  Globe,
  ClipboardList,
  Bot,
  ChevronRight,
  Compass,
  BadgeCheck,
  Twitch,
  Youtube,
  Webhook,
  Image as ImageIcon,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { moveRoleId } from "@/lib/roles/reorder";
import { effectiveSoundPercent, soundVolume } from "@/lib/servers/soundboardVolume";
import { openUserAction, type UserActionKind } from "@/lib/social/userActions";
import { useSettingsDraft, type SettingsDraft } from "@/hooks/useSettingsDraft";
import { UnsavedChangesBar, useUnsavedShake } from "@/components/ui/unsaved-changes-bar";
import { SettingsContent, SettingsNav, type SettingsNavSection } from "@/components/settings/SettingsShell";
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsDangerZone } from "@/components/settings/blocks/SettingsDangerZone";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsRadioCards } from "@/components/settings/blocks/SettingsRadioCards";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsSubTabs } from "@/components/settings/blocks/SettingsSubTabs";
import { AudioTrimmerDialog } from "@/components/dialogs/AudioTrimmerDialog";
import { useGT, useLocale } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import {
  MobileSaveAction,
  MobileSettingsList,
  MobileSettingsScreen,
  type MobileSettingsGroup,
} from "@/components/settings/MobileSettingsShell";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import {
  VERIFICATION_ACTIONS,
  VERIFICATION_LEVEL_RANK,
  VERIFICATION_MAX_MINUTES,
  normalizeVerificationLevel,
  normalizeVerificationOptions,
  type VerificationAction,
} from "@/lib/servers/verification";
import {
  mobileSettingsBack,
  openMobileDetail,
  openMobileSection,
  type MobileSettingsNav,
} from "@/lib/settings/mobileSettingsNav";
import {
  byPositionDesc,
  type BannedUser,
  type Invite,
  type Role,
  type RoleDraft,
  type ServerApplication,
  type ServerChannel,
  type ServerEmoji,
  type ServerMember,
  type ServerSticker,
  type VanityInfo,
} from "@/components/dialogs/serverSettings/types";
import { useStableHandler } from "@/components/dialogs/serverSettings/useStableHandler";
import { MembersPage } from "@/components/dialogs/serverSettings/MembersPage";
import { RolesListPage } from "@/components/dialogs/serverSettings/RolesListPage";
import { RoleEditor } from "@/components/dialogs/serverSettings/RoleEditor";
import { InvitesPage } from "@/components/dialogs/serverSettings/InvitesPage";
import { BansPage } from "@/components/dialogs/serverSettings/BansPage";
import { EmojiPage } from "@/components/dialogs/serverSettings/EmojiPage";
import { StickersPage } from "@/components/dialogs/serverSettings/StickersPage";
import { AppDiscoveryPage } from "@/components/dialogs/serverSettings/AppDiscoveryPage";
import { IntegrationCard } from "@/components/dialogs/serverSettings/IntegrationCard";
import { UploadRequirements } from "@/components/dialogs/serverSettings/UploadRequirements";

/** Skeleton shown while a lazily loaded settings page's code arrives. */
function PanelSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div className="space-y-2 max-md:hidden">
        <span className="block h-5 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
        <span className="block h-3.5 w-72 max-w-full animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
      <SettingsSkeleton variant="rows" count={5} />
    </div>
  );
}

// The audit log tab (filters, diffs, pagination) loads on first open.
const ServerAuditLogPanel = dynamic(
  () => import("@/components/dialogs/ServerAuditLogPanel").then((m) => m.ServerAuditLogPanel),
  { ssr: false, loading: PanelSkeleton },
);

// AutoMod rules (keyword / spam / mention / link filters) load on first open.
const AutoModPanel = dynamic(
  () => import("@/components/dialogs/ServerAutoModPanel").then((m) => m.ServerAutoModPanel),
  { ssr: false, loading: PanelSkeleton },
);
// Community tabs (onboarding, welcome screen, rules screening, connections,
// server template) load on first open.
const ServerOnboardingPanel = dynamic(() => import("@/components/server/community/ServerOnboardingPanel"), { ssr: false, loading: PanelSkeleton });
const ServerConnectionsPanel = dynamic(() => import("@/components/server/community/ServerConnectionsPanel"), { ssr: false, loading: PanelSkeleton });
const ServerWelcomeScreenPanel = dynamic(() => import("@/components/server/community/ServerWelcomeScreenPanel"), { ssr: false, loading: PanelSkeleton });
const ServerScreeningPanel = dynamic(() => import("@/components/server/community/ServerScreeningPanel"), { ssr: false, loading: PanelSkeleton });
const ServerTemplatePanel = dynamic(() => import("@/components/server/community/ServerTemplatePanel"), { ssr: false, loading: PanelSkeleton });
const ServerProfileSettings = dynamic(() => import("@/components/settings/ServerProfileSettings").then((m) => m.ServerProfileSettings), { ssr: false, loading: PanelSkeleton });
const DiscordBridgePanel = dynamic(() => import("@/components/server/discordBridge/DiscordBridgePanel"), { ssr: false, loading: () => <SettingsSkeleton variant="list" count={1} /> });
const ServerWebhooksPanel = dynamic(() => import("@/components/dialogs/ServerWebhooksPanel"), { ssr: false, loading: () => <SettingsSkeleton variant="list" count={3} /> });

// Helper to get audio duration from a File
function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(audio.src);
      resolve(0); // Treat errors as 0 duration (will fail later if needed)
    });
    audio.src = URL.createObjectURL(file);
  });
}

type WaitUnit = "minutes" | "hours" | "days";
const WAIT_UNIT_MINUTES: Record<WaitUnit, number> = { minutes: 1, hours: 60, days: 1440 };

function unitFor(totalMinutes: number): WaitUnit {
  if (totalMinutes % 1440 === 0) return "days";
  if (totalMinutes % 60 === 0) return "hours";
  return "minutes";
}

function clampWait(totalMinutes: number): number {
  return Math.min(VERIFICATION_MAX_MINUTES, Math.max(1, Math.round(totalMinutes)));
}

/** A verification wait as number + unit (minutes / hours / days), stored in minutes. */
function DurationInput({
  value,
  onChange,
  label,
  id,
}: {
  value: number;
  onChange: (minutes: number) => void;
  label: string;
  id: string;
}) {
  const gt = useGT();
  const [unit, setUnit] = useState<WaitUnit>(() => unitFor(value));
  // Raw text while typing, so the field can be cleared and retyped.
  const [typing, setTyping] = useState<string | null>(null);
  const factor = WAIT_UNIT_MINUTES[unit];
  const shown = typing ?? String(Math.round((value / factor) * 100) / 100);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={unit === "minutes" ? 1 : 0.1}
          step={unit === "minutes" ? 1 : "any"}
          value={shown}
          onChange={(e) => {
            setTyping(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() && Number.isFinite(n) && n > 0) onChange(clampWait(n * factor));
          }}
          onBlur={() => setTyping(null)}
          className="h-10 w-24 sm:w-28 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
        />
        <select
          value={unit}
          onChange={(e) => {
            const next = e.target.value as WaitUnit;
            const n = Number(shown);
            setUnit(next);
            setTyping(null);
            if (Number.isFinite(n) && n > 0) onChange(clampWait(n * WAIT_UNIT_MINUTES[next]));
          }}
          aria-label={gt("Unit")}
          className="h-10 flex-1 sm:flex-none sm:w-36 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
        >
          <option value="minutes">{gt("Minutes")}</option>
          <option value="hours">{gt("Hours")}</option>
          <option value="days">{gt("Days")}</option>
        </select>
      </div>
    </div>
  );
}

interface ServerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section to open on (e.g. "connections" after an OAuth link returns); the overview otherwise. */
  initialTab?: ServerSettingsTab | null;
}

type SettingsTab =
  | "overview"
  | "roles"
  | "emoji"
  | "stickers"
  | "soundboard"
  | "widget"
  | "invites"
  | "bans"
  | "audit-log"
  | "automod"
  | "integrations"
  | "moderation"
  | "safety"
  | "members"
  | "channels"
  | "access"
  | "applications"
  | "app_discovery"
  | "server_profile"
  | "onboarding"
  | "welcome"
  | "screening"
  | "connections"
  | "template";

/** Tabs whose content is a multi-column / table layout and needs full width. */
const WIDE_SETTINGS_TABS = new Set<SettingsTab>([
  "members",
  "audit-log",
  "stickers",
  "soundboard",
  "app_discovery",
]);

export type ServerSettingsTab = SettingsTab;

/** The editable copy of a role (role editor draft). */
function draftFromRole(role: Role): RoleDraft {
  return {
    name: role.name,
    color: role.color || "#99AAB5",
    permissions: role.permissions || "0",
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    icon: role.icon ?? null,
    unicodeEmoji: role.unicodeEmoji ?? null,
  };
}

/** Emoji / sticker rows as the API returns them (older rows use `_id` / `url`). */
interface RawMedia {
  id?: string;
  _id?: string;
  name: string;
  imageUrl?: string;
  url?: string;
  animated?: boolean;
  description?: string;
  tags?: string[];
}

export function ServerSettingsDialog({ open, onOpenChange, initialTab = null }: ServerSettingsDialogProps) {
  const { currentServer, fetchServers, channels } = useServer();
  const gt = useGT();
  const locale = useLocale();
  const confirmDialog = useConfirm();
  const { user } = useAuth();
  const { can, isAdmin, loading: permsLoading } = usePermissions(currentServer?.id);
  const canManageServer = can("MANAGE_SERVER") || isAdmin;
  // The sidebar follows `navTab` at once; the page renders from the deferred
  // `activeTab` so switching to a heavy page never freezes the UI.
  const [navTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "overview");
  const activeTab = useDeferredValue(navTab);
  const [navQuery, setNavQuery] = useState("");
  // Phone layout: grouped section list → pushed section page → detail page.
  const isMobile = useIsMobile();
  const [mobileNav, setMobileNav] = useState<MobileSettingsNav<SettingsTab>>(
    initialTab ? { section: initialTab, page: true, detail: null } : { section: "overview", page: false, detail: null },
  );
  // Desktop: Roles shows the role list until a role is opened (phones use mobileNav.detail).
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  // Every (re)open starts at the section list, or at `initialTab` when given
  // (adjusted during render, not in an effect).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setRoleEditorOpen(false);
      setMobileNav(initialTab ? { section: initialTab, page: true, detail: null } : { section: "overview", page: false, detail: null });
      if (initialTab) setActiveTab(initialTab);
    }
  }
  const [isSaving, setIsSaving] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);

  // Image cropper state
  const cropper = useImageCropper();

  // Icon/banner are uploaded immediately (not part of the draft transaction)
  const [serverIcon, setServerIcon] = useState<string | null>(null);
  const [serverBanner, setServerBanner] = useState<string | null>(null);

  // Transactional draft covering overview + advanced settings. Saved via one
  // atomic bulk endpoint; supports dirty tracking, undo/redo, and discard.
  const settingsDraft = useSettingsDraft({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const draft = settingsDraft.draft;
  const draftString = (key: string, fallback = "") => {
    const value = draft[key];
    return typeof value === "string" ? value : fallback;
  };
  const draftBool = (key: string, fallback = false) => {
    const value = draft[key];
    return typeof value === "boolean" ? value : fallback;
  };
  const draftNumber = (key: string, fallback: number) => {
    const value = draft[key];
    return typeof value === "number" ? value : fallback;
  };

  // Data state
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  // Linked roles (CORD-57): role id (lowercase) → role ids members also get.
  const [roleLinks, setRoleLinks] = useState<Record<string, string[]>>({});
  const [isSavingRoleLinks, setIsSavingRoleLinks] = useState(false);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isReorderingRoles, setIsReorderingRoles] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  // Vanity URL (partnered servers)
  const [vanityInfo, setVanityInfo] = useState<VanityInfo | null>(null);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [stickers, setStickers] = useState<ServerSticker[]>([]);
  const [soundboardSounds, setSoundboardSounds] = useState<{ id: string; name: string; url: string; emoji: string; volume?: number }[]>([]);
  // Debounced saves of per-sound volume sliders (CORD-31), keyed by sound id.
  const soundVolumeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const [trimmerOpen, setTrimmerOpen] = useState(false);
  const [trimmerFile, setTrimmerFile] = useState<File | null>(null);
  const soundInputRef = useRef<HTMLInputElement>(null);
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const [pendingAppCount, setPendingAppCount] = useState(0);
  const [applications, setApplications] = useState<ServerApplication[]>([]);
  const [applicationFilter, setApplicationFilter] = useState<"all" | "pending" | "approved" | "rejected" | "interviewed">("all");
  // Inline reject form on one application: optional reason + remove-from-server.
  const [rejecting, setRejecting] = useState<{ id: string; reason: string; remove: boolean } | null>(null);
  // Integrations overview: which card is expanded.
  const [openIntegration, setOpenIntegration] = useState<"twitch" | "youtube" | "webhooks" | null>(null);

  const [isTriggeringTwitch, setIsTriggeringTwitch] = useState(false);
  const [isTriggeringYoutube, setIsTriggeringYoutube] = useState(false);
  const [, setIsTriggeringDiscord] = useState(false);

  const handleMockTrigger = async (type: "twitch" | "youtube" | "discord") => {
    if (!currentServer) return;
    let channelId = "";
    if (type === "twitch") {
      channelId = draftString("integrations.twitchNotificationChannelId", "");
      setIsTriggeringTwitch(true);
    } else if (type === "youtube") {
      channelId = draftString("integrations.youtubeNotificationChannelId", "");
      setIsTriggeringYoutube(true);
    } else if (type === "discord") {
      channelId = textChannels[0]?.id || "";
      setIsTriggeringDiscord(true);
    }

    if (!channelId) {
      toast.error(gt("Please configure and select a notification channel first"));
      setIsTriggeringTwitch(false);
      setIsTriggeringYoutube(false);
      setIsTriggeringDiscord(false);
      return;
    }

    try {
      const res = await fetch(`/api/servers/${currentServer.id}/integrations/${type}/mock-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      if (res.ok) {
        toast.success(gt("Mock alert triggered successfully!"));
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || gt("Failed to trigger mock alert"));
      }
    } catch {
      toast.error(gt("Failed to trigger mock alert"));
    } finally {
      setIsTriggeringTwitch(false);
      setIsTriggeringYoutube(false);
      setIsTriggeringDiscord(false);
    }
  };

  const [isUploadingEmoji, setIsUploadingEmoji] = useState(false);
  const [isUploadingSticker, setIsUploadingSticker] = useState(false);

  // Load overview + advanced settings into one draft when the dialog opens
  const loadDraft = settingsDraft.load;
  useEffect(() => {
    if (!open || !currentServer) return;
    const server = currentServer as typeof currentServer & {
      description?: string;
      banner?: string | null;
      systemChannelId?: string | null;
      rulesChannelId?: string | null;
      afkChannelId?: string | null;
      afkTimeout?: number;
    };
    setServerIcon(server.icon || null);
    setServerBanner(server.banner || null);
    setFieldErrors({});

    let cancelled = false;
    const defaultVerification = normalizeVerificationOptions(undefined);
    const load = async () => {
      const base: SettingsDraft = {
        name: currentServer.name,
        description: server.description || "",
        systemChannelId: server.systemChannelId || null,
        rulesChannelId: server.rulesChannelId || null,
        afkChannelId: server.afkChannelId || null,
        afkTimeout: server.afkTimeout || 300,
        "widget.enabled": false,
        "widget.publicMessages": false,
        "widget.channelId": null,
        "moderation.verificationLevel": "none",
        "moderation.explicitContentFilter": "disabled",
        "moderation.require2FA": false,
        "moderation.verification.accountAgeMinutes": defaultVerification.accountAgeMinutes,
        "moderation.verification.memberAgeMinutes": defaultVerification.memberAgeMinutes,
        ...Object.fromEntries(VERIFICATION_ACTIONS.map((a) => [`moderation.verification.restrict.${a}`, defaultVerification.restrict.includes(a)])),
        "safety.raidProtection": false,
        "safety.antiSpam": true,
        "safety.mentionSpamLimit": 5,
        "integrations.discord": false,
        "integrations.discordRestrictUnconsented": false,
        "integrations.discordGuildId": "",
        "integrations.discordMode": "add",
        "integrations.twitch": false,
        "integrations.twitchChannel": "",
        "integrations.twitchNotificationChannelId": "",
        "integrations.youtube": false,
        "integrations.youtubeChannel": "",
        "integrations.youtubeNotificationChannelId": "",
        "integrations.webhooks": false,
        "soundboard.enabled": true,
        "soundboard.volume": 100,
        "access.joinMode": "invite_only",
        isAgeGated: false,
        discoveryDescription: "",
        discoveryCategories: [],
        "serverTag.enabled": false,
        "serverTag.tag": "",
        "serverTag.icon": "star",
        "serverTag.color": "#8B5CF6",
        "serverTag.emoji": "",
        "serverTag.emojiId": "",
        discoveryTags: [],
        games: [],
        [SERVER_THEME_DRAFT_KEYS.accent]: "",
        [SERVER_THEME_DRAFT_KEYS.gradient]: "",
      };
      try {
        const res = await fetch(`/api/servers/${currentServer.id}/settings`);
        if (res.ok) {
          const data = await res.json();
          const s = data.settings || {};
          base["widget.enabled"] = s.widget?.enabled === true;
          base["widget.publicMessages"] = s.widget?.publicMessages === true;
          base["widget.channelId"] = s.widget?.channelId || null;
          base["moderation.verificationLevel"] = s.moderation?.verificationLevel || "none";
          base["moderation.explicitContentFilter"] = s.moderation?.explicitContentFilter || "disabled";
          base["moderation.require2FA"] = Boolean(s.moderation?.require2FA);
          const verification = normalizeVerificationOptions(s.moderation?.verification);
          base["moderation.verification.accountAgeMinutes"] = verification.accountAgeMinutes;
          base["moderation.verification.memberAgeMinutes"] = verification.memberAgeMinutes;
          for (const a of VERIFICATION_ACTIONS) base[`moderation.verification.restrict.${a}`] = verification.restrict.includes(a);
          base["safety.raidProtection"] = Boolean(s.safety?.raidProtection);
          base["safety.antiSpam"] = s.safety?.antiSpam ?? true;
          base["safety.mentionSpamLimit"] = s.safety?.mentionSpamLimit ?? 5;
          base["integrations.discord"] = Boolean(s.integrations?.discord);
          base["integrations.discordRestrictUnconsented"] = Boolean(s.integrations?.discordRestrictUnconsented);
          base["integrations.discordGuildId"] = s.integrations?.discordGuildId || "";
          base["integrations.discordMode"] = s.integrations?.discordMode || "add";
          base["integrations.twitch"] = Boolean(s.integrations?.twitch);
          base["integrations.twitchChannel"] = s.integrations?.twitchChannel || "";
          base["integrations.twitchNotificationChannelId"] = s.integrations?.twitchNotificationChannelId || "";
          base["integrations.youtube"] = Boolean(s.integrations?.youtube);
          base["integrations.youtubeChannel"] = s.integrations?.youtubeChannel || "";
          base["integrations.youtubeNotificationChannelId"] = s.integrations?.youtubeNotificationChannelId || "";
          base["integrations.webhooks"] = Boolean(s.integrations?.webhooks);
          base["soundboard.enabled"] = s.soundboard?.enabled ?? true;
          base["soundboard.volume"] = s.soundboard?.volume ?? 100;
          base["access.joinMode"] = s.access?.joinMode || "invite_only";
          base.isAgeGated = Boolean(s.isAgeGated);
          base.discoveryDescription = s.discoveryDescription || "";
          base.discoveryCategories = s.discoveryCategories || [];
          base["serverTag.enabled"] = s.serverTag?.enabled === true;
          base["serverTag.tag"] = s.serverTag?.tag || "";
          base["serverTag.icon"] = s.serverTag?.icon || "star";
          base["serverTag.color"] = s.serverTag?.color || "#8B5CF6";
          base["serverTag.emoji"] = s.serverTag?.emoji || "";
          base["serverTag.emojiId"] = s.serverTag?.emojiId || "";
          base.discoveryTags = Array.isArray(s.discoveryTags) ? s.discoveryTags : [];
          base.games = Array.isArray(s.games) ? s.games : [];
          // Server theme: a legacy tint-only theme shows as its derived gradient.
          base[SERVER_THEME_DRAFT_KEYS.accent] = typeof s.theme?.accentColor === "string" ? s.theme.accentColor : "";
          base[SERVER_THEME_DRAFT_KEYS.gradient] = themeGradientKey(serverThemeGradient(s.theme));
        }
      } catch {
        // Defaults stay in place; a failed load must not block the dialog
      }
      if (!cancelled) loadDraft(base);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentServer?.id, loadDraft]);

  // Text / voice channels for the channel pickers (derived, not mirrored into state).
  const textChannels = useMemo<ServerChannel[]>(
    () => (channels ?? []).filter((ch) => ch.type === "text").map((ch) => ({ id: ch.id, name: ch.name, type: ch.type })),
    [channels],
  );
  const voiceChannels = useMemo<ServerChannel[]>(
    () => (channels ?? []).filter((ch) => ch.type === "voice").map((ch) => ({ id: ch.id, name: ch.name, type: ch.type })),
    [channels],
  );

  // Keyed on the id: the server-list poll swaps in a fresh currentServer
  // object every 25s, which used to refetch the open tab (incl. 1000 members).
  const serverId = currentServer?.id;
  const fetchRolesData = useCallback(async () => {
    if (!serverId) return;
    const rolesRes = await fetch(`/api/servers/${serverId}/roles`);
    if (!rolesRes.ok) return;
    const data = await rolesRes.json();
    const nextRoles = (data.roles || []) as Role[];
    setRoles(nextRoles);
    setRoleLinks(data.roleLinks && typeof data.roleLinks === "object" ? data.roleLinks : {});
  }, [serverId]);

  const fetchMembersData = useCallback(async () => {
    if (!serverId) return;
    const membersRes = await fetch(`/api/servers/${serverId}/members?limit=1000`);
    if (!membersRes.ok) return;
    const data = await membersRes.json();
    setMembers((data.members || []) as ServerMember[]);
  }, [serverId]);

  // Tabs (per server) that have loaded once. Pages render their last data on
  // a revisit and refresh it in the background; only a first visit (no data
  // yet) shows skeleton rows (CORD-30). Derived per tab, so a slow fetch on
  // one tab never puts another tab into a loading state.
  const [loadedKeys, setLoadedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const markLoaded = useCallback((key: string) => {
    setLoadedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const isTabLoaded = (tab: SettingsTab) => loadedKeys.has(`${serverId}:${tab}`);

  // Fetch data based on active tab
  useEffect(() => {
    if (!open || !serverId) return;
    const loadKey = `${serverId}:${activeTab}`;

    const fetchData = async () => {
      try {
        switch (activeTab) {
          case "roles":
          case "onboarding":
          case "audit-log":
          case "automod":
            await fetchRolesData();
            break;
          case "invites": {
            const [invitesRes, vanityRes] = await Promise.all([
              fetch(`/api/servers/${serverId}/invites`),
              fetch(`/api/servers/${serverId}/vanity-url`),
            ]);
            if (invitesRes.ok) {
              const data = await invitesRes.json();
              setInvites(data.invites || []);
            }
            if (vanityRes.ok) {
              const data = await vanityRes.json();
              setVanityInfo({
                code: data.code ?? null,
                uses: data.uses ?? 0,
                isPartnered: Boolean(data.isPartnered),
                lockToVanity: Boolean(data.lockToVanity),
              });
            }
            break;
          }
          case "bans": {
            const bansRes = await fetch(`/api/servers/${serverId}/bans`);
            if (bansRes.ok) {
              const data = await bansRes.json();
              setBans(data.bans || []);
            }
            break;
          }
          case "members":
            await Promise.all([fetchMembersData(), fetchRolesData()]);
            break;
          case "emoji": {
            const emojisRes = await fetch(`/api/servers/${serverId}/emojis`);
            if (emojisRes.ok) {
              const data = await emojisRes.json();
              setEmojis((data.emojis || []).map((e: RawMedia) => ({ id: e.id || e._id || "", name: e.name, imageUrl: e.imageUrl || e.url || "", animated: Boolean(e.animated) })));
            }
            break;
          }
          case "stickers": {
            const stickersRes = await fetch(`/api/servers/${serverId}/stickers`);
            if (stickersRes.ok) {
              const data = await stickersRes.json();
              setStickers((data.stickers || []).map((s: RawMedia) => ({ id: s.id || s._id || "", name: s.name, description: s.description, imageUrl: s.imageUrl || s.url || "", tags: s.tags })));
            }
            break;
          }
          case "soundboard": {
            // Settings themselves live in the shared draft (loaded on open);
            // only the sound list needs fetching per visit.
            const soundsRes = await fetch(`/api/servers/${serverId}/soundboard`);
            if (soundsRes.ok) {
              const soundsData = await soundsRes.json();
              setSoundboardSounds(soundsData.sounds || []);
            }
            break;
          }
          case "applications": {
            const appsRes = await fetch(`/api/servers/${serverId}/applications?status=${applicationFilter}`);
            if (appsRes.ok) {
              const appsData = await appsRes.json();
              setApplications(appsData.applications || []);
            }
            break;
          }
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        markLoaded(loadKey);
      }
    };

    void fetchData();
  }, [activeTab, open, serverId, fetchMembersData, fetchRolesData, applicationFilter, markLoaded]);

  // The role editor's Manage Members tab needs the member list even when the
  // Members page hasn't been opened yet.
  const membersRequestedRef = useRef<string | null>(null);
  const requestMembers = useCallback(() => {
    if (!serverId || membersRequestedRef.current === serverId) return;
    membersRequestedRef.current = serverId;
    void fetchMembersData().finally(() => markLoaded(`${serverId}:members`));
  }, [serverId, fetchMembersData, markLoaded]);

  // Reset role draft init ref when dialog closes (so opening again starts fresh)
  useEffect(() => {
    if (!open) {
      roleDraftInitIdRef.current = null;
      return;
    }
    if (!serverId) return;

    const fetchAppCount = async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/applications/count`);
        if (res.ok) {
          const data = await res.json();
          setPendingAppCount(data.count ?? 0);
        }
      } catch {
        setPendingAppCount(0);
      }
    };
    void fetchAppCount();
  }, [open, serverId]);

  // Track the last role ID we initialized the draft for, so updates to the
  // roles list (e.g. after a member role assignment) don't wipe unsaved edits.
  const roleDraftInitIdRef = useRef<string | null>(null);

  /**
   * Select a role and load its draft in the same render, so the editor never
   * shows one role with another role's draft (which flashed the save bar).
   */
  const selectRole = (role: Role) => {
    roleDraftInitIdRef.current = role.id;
    setSelectedRoleId(role.id);
    setRoleDraft(draftFromRole(role));
  };

  useEffect(() => {
    if (!roles.length) {
      roleDraftInitIdRef.current = null;
      setSelectedRoleId(null);
      setRoleDraft(null);
      return;
    }

    const fallbackRole = roles.find((role) => !role.isDefault) || roles[0];
    const targetRole = roles.find((role) => role.id === selectedRoleId) || fallbackRole;
    if (!targetRole) return;

    const effectiveId = targetRole.id;

    // Sync the selection if it differs from what was requested
    if (selectedRoleId !== effectiveId) {
      setSelectedRoleId(effectiveId);
    }

    // Only reset the draft when the selected role actually changes – not when
    // the roles array is refreshed (which would discard the user's edits).
    if (roleDraftInitIdRef.current !== effectiveId) {
      roleDraftInitIdRef.current = effectiveId;
      setRoleDraft(draftFromRole(targetRole));
    }
  }, [roles, selectedRoleId]);

  // Pick → crop when the shape is off (animated images may skip it) → upload.
  const handleServerImageSelect = async (e: React.ChangeEvent<HTMLInputElement>, kind: "icon" | "banner") => {
    const file = e.target.files?.[0];
    // Clear input so the same file can be selected again
    e.target.value = "";
    if (!file || !currentServer) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    const ready = await cropper.prepare(file, kind === "icon" ? "serverIcon" : "serverBanner");
    if (!ready) return;

    if (kind === "banner" && ready.type === "image/gif") {
      if (ready.size > 50 * 1024 * 1024) {
        toast.error(gt("GIF must be less than 50MB"));
        return;
      }
    } else if (ready.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    await handleCropComplete(kind, ready);
  };
  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => void handleServerImageSelect(e, "icon");
  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => void handleServerImageSelect(e, "banner");

  const handleCropComplete = async (cropperType: "icon" | "banner", croppedBlob: File) => {
    if (!currentServer) return;

    const isIcon = cropperType === "icon";
    const setUploading = isIcon ? setIsUploadingIcon : setIsUploadingBanner;
    const setImage = isIcon ? setServerIcon : setServerBanner;
    const endpoint = isIcon
      ? `/api/upload/server/${currentServer.id}/icon`
      : `/api/upload/server/${currentServer.id}/banner`;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", croppedBlob, croppedBlob.name);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setImage(data.url);
        toast.success(gt("Server {type} updated!", { type: cropperType }));
        await fetchServers();
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to upload {type}", { type: cropperType }));
      }
    } catch {
      toast.error(gt("Failed to upload {type}", { type: cropperType }));
    } finally {
      setUploading(false);
    }
  };

  // Human-readable labels for server-side field errors
  const FIELD_LABELS: Record<string, string> = {
    name: gt("Server name"),
    description: gt("Description"),
    systemChannelId: gt("System messages channel"),
    rulesChannelId: gt("Rules channel"),
    afkChannelId: gt("AFK channel"),
    afkTimeout: gt("AFK timeout"),
    "widget.enabled": gt("Widget"),
    "widget.publicMessages": gt("Widget recent messages"),
    "widget.channelId": gt("Widget invite channel"),
    "moderation.verificationLevel": gt("Verification level"),
    "moderation.explicitContentFilter": gt("Content filter"),
    "moderation.require2FA": gt("2FA requirement"),
    "moderation.verification.accountAgeMinutes": gt("Minimum account age"),
    "moderation.verification.memberAgeMinutes": gt("Minimum time in the server"),
    "moderation.verification.restrict.send": gt("Verification: send messages"),
    "moderation.verification.restrict.attach": gt("Verification: upload files"),
    "moderation.verification.restrict.links": gt("Verification: post links"),
    "moderation.verification.restrict.react": gt("Verification: add reactions"),
    "moderation.verification.restrict.voice": gt("Verification: join voice"),
    "moderation.verification.restrict.threads": gt("Verification: create threads"),
    "safety.raidProtection": gt("Raid protection"),
    "safety.antiSpam": gt("Anti-spam"),
    "safety.mentionSpamLimit": gt("Mention spam limit"),
    "integrations.discord": gt("Discord integration"),
    "integrations.twitch": gt("Twitch integration"),
    "integrations.youtube": gt("YouTube integration"),
    "integrations.webhooks": gt("Webhooks integration"),
    "soundboard.enabled": gt("Soundboard"),
    "soundboard.volume": gt("Soundboard volume"),
    "access.joinMode": gt("Server access"),
    "serverTag.enabled": gt("Server tag"),
    "serverTag.tag": gt("Server tag"),
    "serverTag.icon": gt("Server tag badge"),
    "serverTag.color": gt("Server tag color"),
    "serverTag.emoji": gt("Server tag emoji"),
    "serverTag.emojiId": gt("Server tag emoji"),
    discoveryTags: gt("Traits"),
    games: gt("Games"),
    isAgeGated: gt("Age-restricted server"),
    "theme.accentColor": gt("Server theme accent colour"),
    "theme.gradient": gt("Server theme gradient"),
  };

  // The draft keeps the server gradient as its string key; the API takes the object.
  const bulkChanges = (patch: SettingsDraft): Record<string, unknown> => {
    const changes: Record<string, unknown> = { ...patch };
    if (SERVER_THEME_DRAFT_KEYS.gradient in changes) {
      changes[SERVER_THEME_DRAFT_KEYS.gradient] = parseThemeGradientKey(changes[SERVER_THEME_DRAFT_KEYS.gradient]);
    }
    return changes;
  };

  // One atomic bulk save for every dirty field across all settings tabs.
  const handleSaveAll = async () => {
    if (!currentServer || !settingsDraft.isDirty) return;
    setIsSaving(true);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/settings/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: bulkChanges(settingsDraft.dirtyPatch) }),
      });
      const data = await response.json().catch(() => null);

      if (response.ok) {
        settingsDraft.markSaved();
        toast.success(gt("Settings saved"));
        await fetchServers();
      } else if (response.status === 400 && data?.fieldErrors) {
        setFieldErrors(data.fieldErrors as Record<string, string>);
        const entries = Object.entries(data.fieldErrors as Record<string, string>);
        const [firstField, firstMessage] = entries[0];
        toast.error(`${FIELD_LABELS[firstField] || firstField}: ${firstMessage}`, {
          description: entries.length > 1 ? gt("{count} more fields need attention", { count: entries.length - 1 }) : undefined,
        });
      } else {
        toast.error(data?.error || gt("Failed to save settings"));
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(gt("Failed to save settings. Check your connection and try again."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = () => {
    settingsDraft.reset();
    setFieldErrors({});
  };

  // Closing with unsaved changes requires an explicit choice. On desktop the
  // first attempt shakes the save bar (Discord); trying again right away asks
  // whether to discard.
  const closePromptOpenRef = useRef(false);
  const [unsavedShake, shakeUnsaved] = useUnsavedShake();
  const lastShakeAtRef = useRef(0);
  const handleRequestClose = useCallback(async () => {
    if (settingsDraft.isDirty) {
      // Escape also reaches the window listener below while the prompt is up.
      if (closePromptOpenRef.current) return;
      if (!isMobile && Date.now() - lastShakeAtRef.current > 2500) {
        lastShakeAtRef.current = Date.now();
        shakeUnsaved();
        return;
      }
      closePromptOpenRef.current = true;
      const discard = await confirmDialog({
        title: gt("You have unsaved changes. Discard them and close?"),
        confirmLabel: gt("Discard"),
      }).finally(() => { closePromptOpenRef.current = false; });
      if (!discard) return;
      settingsDraft.reset();
      setFieldErrors({});
    }
    onOpenChange(false);
  }, [settingsDraft, onOpenChange, confirmDialog, gt, isMobile, shakeUnsaved]);

  // Handle escape key (respects the unsaved-changes guard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        // A dialog opened on top (e.g. kick / ban / timeout from Members) closes first.
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
        // Escape in the sidebar search clears it before it closes anything.
        const target = e.target as HTMLElement | null;
        if (target?.dataset?.settingsSearch !== undefined && navQuery) {
          setNavQuery("");
          return;
        }
        void handleRequestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleRequestClose, navQuery]);

  const handleCreateRole = async () => {
    if (!currentServer) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "new role",
          color: "#99AAB5",
          permissions: "0",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const createdRole = data.role as Role;
        setRoles((prev) => {
          const deduped = prev.filter((role) => role.id !== createdRole.id);
          return [...deduped, createdRole].sort((a, b) => b.position - a.position);
        });
        selectRole(createdRole);
        if (isMobile) setMobileNav((nav) => openMobileDetail(nav, createdRole.id));
        else setRoleEditorOpen(true);
        toast.success(gt("Role created!"));
      } else {
        toast.error(gt("Failed to create role"));
      }
    } catch (error) {
      console.error("Failed to create role:", error);
      toast.error(gt("Failed to create role"));
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    if (!currentServer) return;
    const roleName = roles.find((r) => r.id === roleId)?.name || "";
    const ok = await confirmDialog({
      title: gt("Delete Role"),
      description: gt("Are you sure you want to delete the role \"{name}\"? Members will lose it.", { name: roleName }),
      confirmLabel: gt("Delete"),
    });
    if (!ok) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/roles/${roleId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.roles) {
          setRoles(data.roles as Role[]);
        } else {
          setRoles(prev => prev.filter(r => r.id !== roleId));
        }
        if (roleId === selectedRoleId) {
          setRoleEditorOpen(false);
          setMobileNav((nav) => (nav.detail === roleId ? { ...nav, detail: null } : nav));
        }
        toast.success(gt("Role deleted"));
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to delete role"));
      }
    } catch (error) {
      console.error("Failed to delete role:", error);
      toast.error(gt("Failed to delete role"));
    }
  };

  const selectedRole = roles.find((role) => role.id === selectedRoleId) || null;

  const hasUnsavedRoleChanges = (() => {
    if (!selectedRole || !roleDraft) return false;
    const normalizeColor = (c: string) => (c || "").toLowerCase().replace(/^#/, "").padStart(6, "0");
    return (
      roleDraft.name !== selectedRole.name ||
      normalizeColor(roleDraft.color) !== normalizeColor(selectedRole.color || "#99AAB5") ||
      roleDraft.permissions !== (selectedRole.permissions || "0") ||
      roleDraft.hoist !== Boolean(selectedRole.hoist) ||
      roleDraft.mentionable !== Boolean(selectedRole.mentionable) ||
      (roleDraft.icon ?? null) !== (selectedRole.icon ?? null) ||
      (roleDraft.unicodeEmoji ?? null) !== (selectedRole.unicodeEmoji ?? null)
    );
  })();

  // Put the role editor back to the saved role.
  const resetRoleDraft = () => {
    if (selectedRole) setRoleDraft(draftFromRole(selectedRole));
  };

  /** Asks before throwing away unsaved role edits; true when it's fine to move on. */
  const confirmLeaveRole = async () => {
    if (!hasUnsavedRoleChanges || !selectedRole) return true;
    const discard = await confirmDialog({
      title: gt("Discard unsaved changes to this role?"),
      confirmLabel: gt("Discard"),
    });
    if (discard) resetRoleDraft();
    return discard;
  };

  // Phone: one back press (header arrow or Android back) walks
  // role editor → section page → section list → close.
  const handleMobileBack = async () => {
    if (mobileNav.detail !== null && !(await confirmLeaveRole())) return;
    const next = mobileSettingsBack(mobileNav);
    if (next) setMobileNav(next);
    else void handleRequestClose();
  };
  useBackHandler(open && isMobile, () => {
    void handleMobileBack();
    return true;
  });

  const openMobileTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setMobileNav((nav) => openMobileSection(nav, tab));
  };

  const handleReorderRoles = async (draggedRoleId: string, targetRoleId: string, mode: "before" | "after") => {
    if (!currentServer || draggedRoleId === targetRoleId) return;

    const reorderable = roles.filter((role) => !role.isDefault).sort(byPositionDesc);
    const orderedIds = moveRoleId(reorderable.map((role) => role.id), draggedRoleId, targetRoleId, mode);
    if (!orderedIds) return;
    const byId = new Map(reorderable.map((role) => [role.id, role]));
    const reordered = orderedIds.map((id) => byId.get(id)!);

    const reorderedWithPositions = reordered.map((role, index) => ({
      ...role,
      position: reordered.length - index,
    }));
    const defaultRoles = roles.filter((role) => role.isDefault);
    const optimistic = [...reorderedWithPositions, ...defaultRoles].sort((a, b) => b.position - a.position);
    const previous = roles;
    setRoles(optimistic);
    setIsReorderingRoles(true);

    try {
      const response = await fetch(`/api/servers/${currentServer.id}/roles/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedRoleIds: reorderedWithPositions.map((role) => role.id) }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || gt("Failed to reorder roles"));
      }

      const data = await response.json();
      setRoles((data.roles || []) as Role[]);
    } catch (error) {
      setRoles(previous);
      toast.error(error instanceof Error ? error.message : gt("Failed to reorder roles"));
    } finally {
      setIsReorderingRoles(false);
    }
  };

  // Linked roles: save the full list for one role; the server gives newly
  // linked roles to current holders and returns the cleaned map.
  const handleSetRoleLinks = async (roleId: string, linkedIds: string[]) => {
    if (!currentServer) return;
    const key = roleId.toLowerCase();
    const previous = roleLinks;
    setRoleLinks((prev) => {
      const next = { ...prev };
      if (linkedIds.length > 0) next[key] = linkedIds.map((id) => id.toLowerCase());
      else delete next[key];
      return next;
    });
    setIsSavingRoleLinks(true);
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/roles/${roleId}/links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: linkedIds }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || gt("Failed to update linked roles"));
      setRoleLinks((data?.roleLinks ?? {}) as Record<string, string[]>);
      if (typeof data?.applied === "number" && data.applied > 0) {
        toast.success(gt("Linked roles saved and given to {count} members", { count: data.applied }));
        void fetchRolesData();
      } else {
        toast.success(gt("Linked roles saved"));
      }
    } catch (error) {
      setRoleLinks(previous);
      toast.error(error instanceof Error ? error.message : gt("Failed to update linked roles"));
    } finally {
      setIsSavingRoleLinks(false);
    }
  };

  const handleSaveRole = async () => {
    if (!currentServer || !selectedRole || !roleDraft) return;
    setIsSavingRole(true);

    try {
      const response = await fetch(`/api/servers/${currentServer.id}/roles/${selectedRole.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roleDraft.name.trim() || selectedRole.name,
          color: roleDraft.color,
          permissions: roleDraft.permissions,
          hoist: roleDraft.hoist,
          mentionable: roleDraft.mentionable,
          ...(selectedRole.isDefault
            ? {}
            : (roleDraft.icon ?? null) !== (selectedRole.icon ?? null) || (roleDraft.unicodeEmoji ?? null) !== (selectedRole.unicodeEmoji ?? null)
              ? { icon: roleDraft.icon ?? null, unicodeEmoji: roleDraft.unicodeEmoji ?? null }
              : {}),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to update role");
      }

      const data = await response.json();
      const updatedRole = data.role as Role;
      setRoles((prev) =>
        prev.map((role) => (role.id === updatedRole.id ? updatedRole : role)).sort((a, b) => b.position - a.position)
      );
      // Re-sync draft from saved data by resetting the init ref
      roleDraftInitIdRef.current = null;
      toast.success(gt("Role updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : gt("Failed to update role"));
    } finally {
      setIsSavingRole(false);
    }
  };

  // Optimistic member role toggle: flip locally (including the role's member
  // count) so rapid toggling never blocks, and roll back if the server
  // rejects the change. No full refetch.
  const handleToggleMemberRole = async (member: ServerMember, roleId: string, checked: boolean) => {
    if (!currentServer) return;

    const toggledRole = roles.find((role) => role.id === roleId);
    if (!toggledRole) return;

    const previousMembers = members;
    const previousRoles = roles;

    setMembers((prev) =>
      prev.map((entry) => {
        if (entry.id !== member.id) return entry;
        const withoutRole = entry.roles.filter((r) => r.id !== roleId);
        return {
          ...entry,
          roles: checked ? [...withoutRole, toggledRole] : withoutRole,
        };
      })
    );
    setRoles((prev) =>
      prev.map((r) =>
        r.id === roleId
          ? { ...r, memberCount: Math.max(0, (r.memberCount ?? 0) + (checked ? 1 : -1)) }
          : r
      )
    );

    const currentRoleIds = new Set(member.roles.map((role) => role.id));
    if (checked) {
      currentRoleIds.add(roleId);
    } else {
      currentRoleIds.delete(roleId);
    }
    const everyoneRole = roles.find((role) => role.isDefault);
    if (everyoneRole) {
      currentRoleIds.add(everyoneRole.id);
    }

    try {
      const response = await fetch(`/api/servers/${currentServer.id}/members/${member.id}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: Array.from(currentRoleIds) }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to update member roles");
      }

      // Reconcile with the authoritative member from the server
      const data = await response.json();
      const updatedMember = data.member as ServerMember;
      setMembers((prev) => prev.map((entry) => (entry.id === updatedMember.id ? updatedMember : entry)));
      // Linked roles were added too: refresh role member counts.
      if (updatedMember.roles?.some((role) => !currentRoleIds.has(role.id))) void fetchRolesData();
    } catch (error) {
      setMembers(previousMembers);
      setRoles(previousRoles);
      toast.error(error instanceof Error ? error.message : gt("Failed to update member roles"));
    }
  };

  const handleEmojiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    // Square it up (or fit it) and scale it to emoji size when needed
    const ready = await cropper.prepare(file, "emoji");
    if (!ready) {
      e.target.value = "";
      return;
    }

    // Validate file size (256KB max for emoji)
    if (ready.size > 256 * 1024) {
      toast.error(gt("Emoji must be less than 256KB"));
      return;
    }

    // Get emoji name from filename
    const emojiName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 32);

    setIsUploadingEmoji(true);
    const formData = new FormData();
    formData.append("file", ready, ready.name);

    try {
      // First upload the image
      const uploadRes = await fetch(`/api/upload/emoji`, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload emoji image");
      }

      const uploadData = await uploadRes.json();

      // Then create the emoji
      const response = await fetch(`/api/servers/${currentServer.id}/emojis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: emojiName,
          imageUrl: uploadData.url,
          animated: file.type === "image/gif",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const e = data.emoji;
        setEmojis(prev => [...prev, { id: e.id || e._id, name: e.name, imageUrl: e.imageUrl || e.url, animated: e.animated }]);
        toast.success(gt("Emoji uploaded!"));
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to create emoji"));
      }
    } catch (error) {
      console.error("Failed to upload emoji:", error);
      toast.error(gt("Failed to upload emoji"));
    } finally {
      setIsUploadingEmoji(false);
      e.target.value = "";
    }
  };

  const handleDeleteEmoji = async (emojiId: string) => {
    if (!currentServer) return;
    if (!(await confirmDialog({ title: gt("Delete this emoji?"), confirmLabel: gt("Delete") }))) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/emojis/${emojiId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setEmojis(prev => prev.filter(e => e.id !== emojiId));
        toast.success(gt("Emoji deleted"));
      } else {
        toast.error(gt("Failed to delete emoji"));
      }
    } catch (error) {
      console.error("Failed to delete emoji:", error);
      toast.error(gt("Failed to delete emoji"));
    }
  };

  const handleRenameEmoji = async (emojiId: string, name: string): Promise<boolean> => {
    if (!currentServer || !name.trim()) return false;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/emojis/${emojiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setEmojis(prev => prev.map(e => e.id === emojiId ? { ...e, name: data.emoji.name } : e));
        toast.success(gt("Emoji renamed"));
        return true;
      }
      const data = await response.json().catch(() => null);
      toast.error(data?.error || gt("Failed to rename emoji"));
    } catch {
      toast.error(gt("Failed to rename emoji"));
    }
    return false;
  };

  const handleRenameSticker = async (stickerId: string, name: string): Promise<boolean> => {
    if (!currentServer || !name.trim()) return false;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/stickers/${stickerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setStickers(prev => prev.map(s => s.id === stickerId ? { ...s, name: data.sticker.name } : s));
        toast.success(gt("Sticker renamed"));
        return true;
      }
      const data = await response.json().catch(() => null);
      toast.error(data?.error || gt("Failed to rename sticker"));
    } catch {
      toast.error(gt("Failed to rename sticker"));
    }
    return false;
  };

  const handleStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    const ready = await cropper.prepare(file, "sticker");
    if (!ready) {
      e.target.value = "";
      return;
    }

    if (ready.size > 512 * 1024) {
      toast.error(gt("Sticker must be less than 512KB"));
      return;
    }

    const stickerName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_ ]/g, "").trim().slice(0, 30) || "sticker";
    const formData = new FormData();
    formData.append("file", ready, ready.name);
    setIsUploadingSticker(true);

    try {
      const uploadRes = await fetch(`/api/upload/sticker/${currentServer.id}`, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        throw new Error(data.error || "Failed to upload sticker");
      }

      const uploadData = await uploadRes.json();
      const createRes = await fetch(`/api/servers/${currentServer.id}/stickers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: stickerName,
          imageUrl: uploadData.url,
          tags: ["reaction"],
        }),
      });

      if (createRes.ok) {
        const data = await createRes.json();
        const s = data.sticker;
        setStickers((prev) => [{ id: s.id || s._id, name: s.name, description: s.description, imageUrl: s.imageUrl || s.url, tags: s.tags }, ...prev]);
        toast.success(gt("Sticker uploaded"));
      } else {
        const data = await createRes.json();
        toast.error(data.error || gt("Failed to save sticker"));
      }
    } catch (error) {
      console.error("Failed to upload sticker:", error);
      toast.error(error instanceof Error ? error.message : gt("Failed to upload sticker"));
    } finally {
      setIsUploadingSticker(false);
      e.target.value = "";
    }
  };

  const handleDeleteSticker = async (stickerId: string) => {
    if (!currentServer) return;
    if (!(await confirmDialog({ title: gt("Delete this sticker?"), confirmLabel: gt("Delete") }))) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/stickers/${stickerId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setStickers((prev) => prev.filter((sticker) => sticker.id !== stickerId));
        toast.success(gt("Sticker deleted"));
      } else {
        toast.error(gt("Failed to delete sticker"));
      }
    } catch (error) {
      console.error("Failed to delete sticker:", error);
      toast.error(gt("Failed to delete sticker"));
    }
  };

  // Shared upload path for both direct files and trimmed clips
  const uploadSound = async (audio: Blob, rawName: string, filename: string) => {
    if (!currentServer) return;
    const soundName = rawName.replace(/[^a-zA-Z0-9_ ]/g, "").substring(0, 32) || "sound";

    setIsUploadingSound(true);
    const formData = new FormData();
    formData.append("file", audio, filename);

    try {
      const uploadRes = await fetch(`/api/upload/audio`, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => null);
        throw new Error(data?.error || "Failed to upload sound file");
      }

      const uploadData = await uploadRes.json();

      const response = await fetch(`/api/servers/${currentServer.id}/soundboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: soundName,
          url: uploadData.url,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSoundboardSounds((prev) => [...prev, data.sound]);
        toast.success(gt("Sound added!"));
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to add sound"));
      }
    } catch (error) {
      console.error("Failed to upload sound:", error);
      toast.error(error instanceof Error ? error.message : gt("Failed to upload sound"));
    } finally {
      setIsUploadingSound(false);
      if (soundInputRef.current) {
        soundInputRef.current.value = "";
      }
    }
  };

  const handleSoundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    if (!file.type.startsWith("audio/")) {
      toast.error(gt("File must be an audio file"));
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error(gt("Sound must be less than 20MB"));
      return;
    }

    // Sounds over 30 seconds open the trimmer instead of being rejected
    const duration = await getAudioDuration(file);
    if (duration > 30) {
      setTrimmerFile(file);
      setTrimmerOpen(true);
      if (soundInputRef.current) {
        soundInputRef.current.value = "";
      }
      return;
    }

    await uploadSound(file, file.name.replace(/\.[^/.]+$/, ""), file.name);
  };

  const handleDeleteSound = async (soundId: string) => {
    if (!currentServer) return;
    if (!(await confirmDialog({ title: gt("Delete this sound?"), confirmLabel: gt("Delete") }))) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/soundboard/${soundId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setSoundboardSounds((prev) => prev.filter((s) => s.id !== soundId));
        toast.success(gt("Sound deleted"));
      } else {
        toast.error(gt("Failed to delete sound"));
      }
    } catch {
      toast.error(gt("Failed to delete sound"));
    }
  };

  // Per-sound volume (0..1, CORD-31): update locally right away, save after
  // the slider settles.
  const handleSoundVolumeChange = (soundId: string, volume: number) => {
    if (!currentServer) return;
    const serverIdForSave = currentServer.id;
    setSoundboardSounds((prev) => prev.map((s) => (s.id === soundId ? { ...s, volume } : s)));
    const timers = soundVolumeTimersRef.current;
    const pending = timers.get(soundId);
    if (pending) clearTimeout(pending);
    timers.set(soundId, setTimeout(() => {
      timers.delete(soundId);
      void fetch(`/api/servers/${serverIdForSave}/soundboard/${soundId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            toast.error(data?.error || gt("Failed to update sound volume"));
          }
        })
        .catch(() => toast.error(gt("Failed to update sound volume")));
    }, 400));
  };

  const playSound = (sound: { id: string; url: string; volume?: number }) => {
    const audio = new Audio(sound.url);
    // Server volume × this sound's volume. Audio.volume caps at 1.0; values
    // above 100% previously threw IndexSizeError.
    audio.volume = Math.min(Math.max(effectiveSoundPercent(draftNumber("soundboard.volume", 100), sound), 0) / 100, 1);
    audio.play().catch(() => toast.error(gt("Failed to play sound")));
    setPlayingSoundId(sound.id);
    audio.onended = () => setPlayingSoundId(null);
  };

  const handleCreateInvite = async () => {
    if (!currentServer) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxUses: 0, // Unlimited
          maxAge: 604800, // 7 days
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setInvites(prev => [data.invite, ...prev]);
        toast.success(gt("Invite created!"));
      } else {
        toast.error(gt("Failed to create invite"));
      }
    } catch (error) {
      console.error("Failed to create invite:", error);
      toast.error(gt("Failed to create invite"));
    }
  };

  const handleDeleteInvite = async (code: string) => {
    if (!currentServer) return;
    try {
      const res = await fetch(`/api/servers/${currentServer.id}/invites/${code}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        toast.error(data?.error || gt("Failed to delete invite"));
        return;
      }
      setInvites(prev => prev.filter(i => i.code !== code));
      toast.success(gt("Invite deleted"));
    } catch (error) {
      console.error("Failed to delete invite:", error);
      toast.error(gt("Failed to delete invite"));
    }
  };

  const handleUnban = async (userId: string) => {
    if (!currentServer) return;
    try {
      const res = await fetch(`/api/servers/${currentServer.id}/bans/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        toast.error(data?.error || gt("Failed to unban user"));
        return;
      }
      setBans(prev => prev.filter(b => b.id !== userId));
      toast.success(gt("User unbanned"));
    } catch (error) {
      console.error("Failed to unban user:", error);
      toast.error(gt("Failed to unban user"));
    }
  };

  const handleDeleteServer = async () => {
    if (!currentServer) return;
    const confirmed = await confirmDialog({
      title: gt("Delete Server"),
      description: gt("Are you sure you want to delete \"{name}\"? This action cannot be undone.", { name: currentServer.name }),
      confirmLabel: gt("Delete"),
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/servers/${currentServer.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success(gt("Server deleted"));
        onOpenChange(false);
        window.location.href = "/channels/me";
      }
    } catch (error) {
      console.error("Failed to delete server:", error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(gt("Copied to clipboard!"));
  };

  const handleReviewApplication = async (
    applicationId: string,
    status: "approved" | "rejected" | "interviewed",
    rejectionReason?: string,
    removeMember?: boolean,
  ): Promise<boolean> => {
    if (!currentServer) return false;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason, removeMember: status === "rejected" && removeMember ? true : undefined }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to update application"));
        return false;
      }
      const result = await response.json().catch(() => null);

      setApplications((prev) =>
        prev.map((app) =>
          app.id === applicationId
            ? { ...app, status, processedAt: new Date().toISOString(), rejectionReason }
            : app
        )
      );
      if (status === "approved") {
        setPendingAppCount((prev) => Math.max(0, prev - 1));
        toast.success(gt("Application approved. User has been added to the server."));
      } else if (status === "rejected") {
        setPendingAppCount((prev) => Math.max(0, prev - 1));
        toast.success(result?.removed === true
          ? gt("Application rejected and the member was removed from the server.")
          : gt("Application rejected."));
      } else {
        toast.success(gt("Application marked for interview."));
      }
      return true;
    } catch (error) {
      console.error("Failed to review application:", error);
      toast.error(gt("Failed to update application"));
      return false;
    }
  };

  // Highest role first: shared by the roles list, the role editor and the member pages.
  const sortedRoles = useMemo(() => [...roles].sort(byPositionDesc), [roles]);

  // Stable handlers for the memoized pages: they always run the latest
  // handler, so those pages only re-render when their own data changes.
  const onToggleMemberRole = useStableHandler((member: ServerMember, roleId: string, checked: boolean) => {
    void handleToggleMemberRole(member, roleId, checked);
  });
  const onMemberAction = useStableHandler((kind: UserActionKind, member: ServerMember) => {
    if (!currentServer) return;
    openUserAction(kind, {
      id: member.id,
      username: member.username,
      displayName: member.displayName ?? null,
      avatar: member.avatar ?? null,
      isBot: member.isBot,
      serverId: currentServer.id,
      communicationDisabledUntil: member.communicationDisabledUntil ?? null,
      onDone: () => void fetchMembersData(),
    });
  });
  const onUnban = useStableHandler((userId: string) => void handleUnban(userId));
  const onCreateInvite = useStableHandler(() => void handleCreateInvite());
  const onRevokeInvite = useStableHandler((code: string) => void handleDeleteInvite(code));
  const onEmojiUpload = useStableHandler((e: React.ChangeEvent<HTMLInputElement>) => void handleEmojiUpload(e));
  const onEmojiRename = useStableHandler(handleRenameEmoji);
  const onEmojiDelete = useStableHandler((id: string) => void handleDeleteEmoji(id));
  const onStickerUpload = useStableHandler((e: React.ChangeEvent<HTMLInputElement>) => void handleStickerUpload(e));
  const onStickerRename = useStableHandler(handleRenameSticker);
  const onStickerDelete = useStableHandler((id: string) => void handleDeleteSticker(id));
  const onCreateRole = useStableHandler(() => void handleCreateRole());
  const onDeleteRole = useStableHandler((roleId: string) => void handleDeleteRole(roleId));
  const onReorderRoles = useStableHandler((dragged: string, target: string, mode: "before" | "after") => {
    void handleReorderRoles(dragged, target, mode);
  });
  const onSetRoleLinks = useStableHandler((roleId: string, ids: string[]) => void handleSetRoleLinks(roleId, ids));
  const onOpenRole = useStableHandler((roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    if (roleId !== selectedRoleId) selectRole(role);
    if (isMobile) setMobileNav((nav) => openMobileDetail(nav, roleId));
    else setRoleEditorOpen(true);
  });
  const onSelectRoleInEditor = useStableHandler(async (roleId: string) => {
    if (roleId === selectedRoleId || !(await confirmLeaveRole())) return;
    const role = roles.find((r) => r.id === roleId);
    if (role) selectRole(role);
  });
  const onRoleEditorBack = useStableHandler(async () => {
    if (!(await confirmLeaveRole())) return;
    setRoleEditorOpen(false);
  });

  const menuSections = useMemo(
    () => [
      {
        title: currentServer?.name ?? "",
        items: [
          { id: "overview" as SettingsTab, label: gt("Overview"), icon: Settings },
          { id: "roles" as SettingsTab, label: gt("Roles"), icon: Shield },
          { id: "emoji" as SettingsTab, label: gt("Emoji"), icon: Smile },
          { id: "stickers" as SettingsTab, label: gt("Stickers"), icon: Sticker },
          { id: "soundboard" as SettingsTab, label: gt("Soundboard"), icon: Volume2 },
          { id: "widget" as SettingsTab, label: gt("Widget"), icon: ExternalLink },
        ],
      },
      {
        title: gt("Moderation"),
        items: [
          { id: "safety" as SettingsTab, label: gt("Safety Setup"), icon: Shield },
          { id: "moderation" as SettingsTab, label: gt("Moderation"), icon: AlertTriangle },
          { id: "automod" as SettingsTab, label: gt("AutoMod"), icon: Shield },
          { id: "audit-log" as SettingsTab, label: gt("Audit Log"), icon: FileText },
          { id: "bans" as SettingsTab, label: gt("Bans"), icon: Ban },
        ],
      },
      {
        title: gt("User Management"),
        items: [
          { id: "members" as SettingsTab, label: gt("Members"), icon: Users },
          { id: "applications" as SettingsTab, label: gt("Applications"), icon: ClipboardList },
          { id: "app_discovery" as SettingsTab, label: gt("App Discovery"), icon: Bot },
          { id: "invites" as SettingsTab, label: gt("Invites"), icon: Link2 },
          { id: "integrations" as SettingsTab, label: gt("Integrations"), icon: Folder },
        ],
      },
      {
        title: gt("Access"),
        items: [
          { id: "access" as SettingsTab, label: gt("Access"), icon: Lock },
          { id: "server_profile" as SettingsTab, label: gt("Server Profile"), icon: BadgeCheck },
        ],
      },
      {
        title: gt("Community"),
        items: [
          { id: "onboarding" as SettingsTab, label: gt("Onboarding"), icon: Compass },
          { id: "welcome" as SettingsTab, label: gt("Welcome Screen"), icon: Smile },
          { id: "screening" as SettingsTab, label: gt("Rules Screening"), icon: ClipboardList },
          { id: "connections" as SettingsTab, label: gt("Server Connections"), icon: BadgeCheck },
          { id: "template" as SettingsTab, label: gt("Server Template"), icon: Folder },
        ],
      },
    ],
    [gt, currentServer?.name],
  );
  const navSections = useMemo<SettingsNavSection<SettingsTab>[]>(
    () =>
      menuSections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          badge: pendingAppCount > 0 && (item.id === "applications" || item.id === "members") ? pendingAppCount : undefined,
        })),
      })),
    [menuSections, pendingAppCount],
  );

  if (!open || !currentServer) return null;

  // Permission guard: non-admin users cannot access server settings UI
  if (!permsLoading && !canManageServer) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={gt("Access Denied")}
        className="theme-backdrop fixed inset-0 z-50 bg-[var(--bg-app)] flex items-center justify-center p-6"
      >
        <SettingsEmptyState
          icon={Lock}
          title={gt("Access Denied")}
          description={gt("You don't have permission to view server settings.")}
          action={
            <SettingsButton variant="primary" onClick={() => onOpenChange(false)}>
              {gt("Close")}
            </SettingsButton>
          }
          className="max-w-md border-none"
        />
      </div>
    );
  }

  const isOwner = currentServer.ownerId === user?.id;
  const selectClass =
    "h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--app-accent)] disabled:opacity-60";
  const inputClass = "h-10 bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-primary)]";
  const fieldError = (key: string) =>
    fieldErrors[key] ? <p className="mt-1.5 text-xs text-red-500">{fieldErrors[key]}</p> : null;

  const renderOverview = () => {
    const afkTimeout = draftNumber("afkTimeout", 300);
    const afkOptions = [
      { value: 60, label: gt("1 minute") },
      { value: 300, label: gt("{n} minutes", { n: 5 }) },
      { value: 900, label: gt("{n} minutes", { n: 15 }) },
      { value: 1800, label: gt("{n} minutes", { n: 30 }) },
      { value: 3600, label: gt("1 hour") },
    ];
    if (!afkOptions.some((o) => o.value === afkTimeout)) {
      afkOptions.push({ value: afkTimeout, label: gt("{n} seconds", { n: afkTimeout }) });
    }
    const initial = (draftString("name") || currentServer.name || "?").charAt(0).toUpperCase();
    return (
      <div className="space-y-8">
        <SettingsPageHeader title={gt("Server Overview")} description={gt("Customize your server's identity")} className="mb-0" />

        {/* Hidden file inputs */}
        <input type="file" ref={iconInputRef} onChange={handleIconUpload} accept="image/*" className="hidden" />
        <input type="file" ref={bannerInputRef} onChange={handleBannerUpload} accept="image/*" className="hidden" />

        {/* Icon uploader + name side by side (Discord) */}
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => iconInputRef.current?.click()}
              disabled={isUploadingIcon}
              aria-label={gt("Change server icon")}
              className="group relative h-[88px] w-[88px] shrink-0 rounded-2xl disabled:cursor-not-allowed"
            >
              <Avatar className="h-full w-full rounded-2xl">
                <AvatarImage src={cdnImage(serverIcon || undefined)} />
                <AvatarFallback className="rounded-2xl bg-[var(--app-accent)] text-3xl text-white">{initial}</AvatarFallback>
              </Avatar>
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-2xl bg-black/55 text-[10px] font-bold uppercase text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-100 max-md:bg-black/35">
                {isUploadingIcon ? <Loader size={28} /> : <><Camera className="h-5 w-5" />{gt("Change Icon")}</>}
              </span>
            </button>
            <div className="min-w-0 space-y-2">
              <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
                {gt("We recommend an image of at least 512x512 for the server.")}
              </p>
              <SettingsButton variant="secondary" onClick={() => iconInputRef.current?.click()} disabled={isUploadingIcon}>
                {gt("Upload Image")}
              </SettingsButton>
            </div>
          </div>
          <SettingsSection title={gt("Server name")}>
            <div>
              <Input
                value={draftString("name")}
                onChange={(e) => settingsDraft.update("name", e.target.value)}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-label={gt("Server name")}
                maxLength={100}
                className={cn(inputClass, fieldErrors.name && "border-red-500 focus-visible:ring-red-500")}
                placeholder={gt("Enter server name")}
              />
              {fieldError("name")}
            </div>
          </SettingsSection>
        </div>

        <div className="h-px bg-[var(--border-subtle)]" />

        <SettingsSection title={gt("Description")} description={gt("Describe what your server is about")}>
          <div>
            <Textarea
              value={draftString("description")}
              onChange={(e) => settingsDraft.update("description", e.target.value)}
              aria-invalid={Boolean(fieldErrors.description)}
              aria-label={gt("Description")}
              maxLength={1024}
              className={cn(
                "min-h-[96px] bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-primary)]",
                fieldErrors.description && "border-red-500 focus-visible:ring-red-500",
              )}
              placeholder={gt("Describe what your server is about")}
            />
            {fieldError("description")}
          </div>
        </SettingsSection>

        <SettingsSection
          title={gt("Inactive channel")}
          description={gt("Members idle for longer than the inactive timeout are moved to this voice channel and muted.")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <select
                value={draftString("afkChannelId", "") || ""}
                onChange={(e) => settingsDraft.update("afkChannelId", e.target.value || null)}
                aria-label={gt("AFK channel")}
                className={selectClass}
              >
                <option value="">{gt("No inactive channel")}</option>
                {voiceChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
              {fieldError("afkChannelId")}
            </div>
            <div>
              <select
                value={afkTimeout}
                onChange={(e) => settingsDraft.update("afkTimeout", Number(e.target.value))}
                aria-label={gt("AFK timeout")}
                className={selectClass}
              >
                {afkOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {fieldError("afkTimeout")}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title={gt("System messages channel")} description={gt("Where system messages like welcome messages are sent")}>
          <div>
            <select
              value={draftString("systemChannelId", "") || ""}
              onChange={(e) => settingsDraft.update("systemChannelId", e.target.value || null)}
              aria-label={gt("System messages channel")}
              className={selectClass}
            >
              <option value="">{gt("No system messages")}</option>
              {textChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
            {fieldError("systemChannelId")}
          </div>
        </SettingsSection>

        <SettingsSection title={gt("Rules channel")} description={gt("Display your server rules in Community servers")}>
          <div>
            <select
              value={draftString("rulesChannelId", "") || ""}
              onChange={(e) => settingsDraft.update("rulesChannelId", e.target.value || null)}
              aria-label={gt("Rules channel")}
              className={selectClass}
            >
              <option value="">{gt("No rules channel")}</option>
              {textChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
            {fieldError("rulesChannelId")}
          </div>
        </SettingsSection>

        <div className="h-px bg-[var(--border-subtle)]" />

        <SettingsSection
          title={gt("Server Banner")}
          description={gt("Shown at the top of your channel list and in invites. GIFs keep their animation.")}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              disabled={isUploadingBanner}
              aria-label={gt("Change server banner")}
              className="group relative aspect-[2/1] w-full max-w-[320px] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-gradient-to-br from-[var(--app-accent)] to-[var(--accent-hover)] disabled:cursor-not-allowed"
            >
              {serverBanner ? (
                <img src={cdnImage(serverBanner)} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-white/80">
                  <ImageIcon className="h-8 w-8" />
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-100 max-md:bg-black/30">
                {isUploadingBanner ? <Loader size={28} /> : <Camera className="h-6 w-6" />}
              </span>
            </button>
            <div className="space-y-2">
              <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
                {gt("We recommend an image of at least 960x480. Images up to 8MB, GIFs up to 50MB.")}
              </p>
              <SettingsButton variant="secondary" onClick={() => bannerInputRef.current?.click()} disabled={isUploadingBanner}>
                {gt("Upload Banner")}
              </SettingsButton>
            </div>
          </div>
        </SettingsSection>

        {/* Server theme (CORD-50) */}
        {canManageServer && (
          <ServerThemeSettings
            draft={settingsDraft}
            errors={{ accent: fieldErrors[SERVER_THEME_DRAFT_KEYS.accent], gradient: fieldErrors[SERVER_THEME_DRAFT_KEYS.gradient] }}
          />
        )}

        {isOwner && (
          <SettingsDangerZone title={gt("Danger Zone")}>
            <SettingsRow
              label={gt("Delete Server")}
              description={gt("Permanently delete this server and everything in it. This can't be undone.")}
              danger
              control={
                <SettingsButton variant="danger" onClick={() => void handleDeleteServer()}>
                  <Trash2 />
                  {gt("Delete Server")}
                </SettingsButton>
              }
            />
          </SettingsDangerZone>
        )}
      </div>
    );
  };

  // Phone: the role list and the role editor are separate pushed pages.
  const roleEditing = isMobile ? mobileNav.detail !== null : roleEditorOpen;

  const renderRoles = () =>
    roleEditing && selectedRole && roleDraft ? (
      <RoleEditor
        role={selectedRole}
        draft={roleDraft}
        setDraft={setRoleDraft}
        roles={sortedRoles}
        roleLinks={roleLinks}
        isSavingRoleLinks={isSavingRoleLinks}
        members={members}
        membersLoading={!isTabLoaded("members")}
        isMobile={isMobile}
        onRequestMembers={requestMembers}
        onBack={onRoleEditorBack}
        onSelectRole={onSelectRoleInEditor}
        onCreateRole={onCreateRole}
        onDeleteRole={onDeleteRole}
        onSetRoleLinks={onSetRoleLinks}
        onToggleMemberRole={onToggleMemberRole}
      />
    ) : (
      <RolesListPage
        roles={sortedRoles}
        roleLinks={roleLinks}
        loading={!isTabLoaded("roles")}
        isMobile={isMobile}
        isReordering={isReorderingRoles}
        onOpenRole={onOpenRole}
        onCreateRole={onCreateRole}
        onDeleteRole={onDeleteRole}
        onReorder={onReorderRoles}
      />
    );

  const renderAccess = () => {
    const joinMode = draftString("access.joinMode", "invite_only") as "invite_only" | "apply_to_join" | "discoverable";
    const categories = [
      { id: "gaming", name: gt("Gaming") },
      { id: "music", name: gt("Music") },
      { id: "tech", name: gt("Tech & Programming") },
      { id: "art", name: gt("Art & Design") },
      { id: "education", name: gt("Education") },
      { id: "entertainment", name: gt("Entertainment") },
      { id: "anime", name: gt("Anime & Manga") },
      { id: "science", name: gt("Science") },
      { id: "sports", name: gt("Sports & Fitness") },
      { id: "food", name: gt("Food & Drink") },
      { id: "travel", name: gt("Travel") },
      { id: "languages", name: gt("Languages") },
      { id: "photography", name: gt("Photography") },
      { id: "business", name: gt("Business") },
      { id: "lifestyle", name: gt("Lifestyle") },
    ];
    const selectedCats = (settingsDraft.draft.discoveryCategories as string[]) || [];

    return (
      <div className="space-y-8">
        <SettingsPageHeader title={gt("Access")} description={gt("Control how people join your server")} className="mb-0" />

        <SettingsSection
          title={gt("How can people join your server?")}
          description={
            <>
              {gt("Keep your server private, or open it up for more people to join.")}{" "}
              <a
                href="https://support.discord.com/hc/en-us/articles/29729107418519-Server-Member-Applications"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--app-accent)] hover:underline"
              >
                {gt("Learn More")}
              </a>
            </>
          }
        >
          <SettingsRadioCards
            layout="tiles"
            ariaLabel={gt("How can people join your server?")}
            value={joinMode}
            onChange={(value) => settingsDraft.update("access.joinMode", value)}
            options={[
              { value: "invite_only", icon: Lock, label: gt("Invite Only"), description: gt("People can join your server directly with an invite") },
              { value: "apply_to_join", icon: Mail, label: gt("Apply to Join"), description: gt("People must submit an application and be approved to join") },
              { value: "discoverable", icon: Globe, label: gt("Discoverable"), description: gt("Anyone can join your server directly through Server Discovery") },
            ]}
          />
        </SettingsSection>

        {joinMode === "discoverable" && (
          <SettingsSection title={gt("Server Discovery")}>
            <SettingsCard>
              <div className="space-y-2 px-4 py-3.5" data-settings-row>
                <label className="text-sm font-medium text-[var(--text-primary)]" htmlFor="discovery-description">
                  {gt("Discovery Description")}
                </label>
                <Textarea
                  id="discovery-description"
                  placeholder={gt("A brief description of your server shown in Server Discovery...")}
                  value={draftString("discoveryDescription")}
                  onChange={(e) => settingsDraft.update("discoveryDescription", e.target.value)}
                  maxLength={1024}
                  className="min-h-[80px] bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--app-accent)]"
                />
                <p className="text-right text-xs text-[var(--text-muted)]">{draftString("discoveryDescription").length}/1024</p>
              </div>
              <div className="space-y-2 px-4 py-3.5" data-settings-row>
                <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Discovery Categories")}</p>
                <p className="text-[13px] text-[var(--text-secondary)]">{gt("Select up to 3 categories that best describe your server")}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {categories.map((cat) => {
                    const isSelected = selectedCats.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          const nextCats = [...selectedCats];
                          const idx = nextCats.indexOf(cat.id);
                          if (idx > -1) {
                            nextCats.splice(idx, 1);
                          } else {
                            if (nextCats.length >= 3) {
                              toast.error(gt("You can select up to 3 categories"));
                              return;
                            }
                            nextCats.push(cat.id);
                          }
                          settingsDraft.update("discoveryCategories", nextCats);
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-95",
                          isSelected
                            ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-white"
                            : "border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
                        )}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </SettingsCard>
          </SettingsSection>
        )}

        <SettingsCard>
          <SettingsToggleRow
            label={gt("Age-Restricted Server")}
            description={
              <>
                {gt("Users will need to confirm they are over the legal age to view the content in this server.")}{" "}
                <a
                  href="https://support.discord.com/hc/en-us/articles/115000084051"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--app-accent)] hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {gt("Learn more")}
                </a>
              </>
            }
            checked={draftBool("isAgeGated")}
            onCheckedChange={(checked) => {
              settingsDraft.update("isAgeGated", checked);
              if (checked) {
                settingsDraft.update("access.joinMode", "invite_only");
              }
            }}
          />
        </SettingsCard>
      </div>
    );
  };

  const renderApplications = () => {
    const filtered = applicationFilter === "all"
      ? applications
      : applications.filter((app) => app.status === applicationFilter);

    const statusPill = (status: ServerApplication["status"]) => {
      const tone = { pending: "warning", approved: "success", rejected: "danger", interviewed: "info" } as const;
      const labels = {
        pending: gt("Pending"),
        approved: gt("Approved"),
        rejected: gt("Rejected"),
        interviewed: gt("Interviewed"),
      };
      return <SettingsStatusPill tone={tone[status]} dot>{labels[status]}</SettingsStatusPill>;
    };

    const submitReject = async () => {
      if (!rejecting) return;
      const ok = await handleReviewApplication(rejecting.id, "rejected", rejecting.reason.trim() || undefined, rejecting.remove);
      if (ok) setRejecting(null);
    };

    return (
      <div className="space-y-4">
        <SettingsPageHeader
          title={gt("Member Applications")}
          description={
            <>
              {gt("Review and manage server member applications")}
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                {gt("Members waiting in Rules Screening with manual approval show up here too.")}
              </span>
            </>
          }
          className="mb-2"
        />

        <SettingsSubTabs
          variant="segmented"
          ariaLabel={gt("Filter applications")}
          value={applicationFilter}
          onChange={setApplicationFilter}
          tabs={[
            { id: "all", label: gt("All Types") },
            { id: "pending", label: pendingAppCount > 0 ? `${gt("Pending")} (${pendingAppCount})` : gt("Pending") },
            { id: "approved", label: gt("Approved") },
            { id: "rejected", label: gt("Rejected") },
            { id: "interviewed", label: gt("Interviewed") },
          ]}
        />

        {!isTabLoaded("applications") && applications.length === 0 ? (
          <SettingsSkeleton variant="list" count={3} />
        ) : filtered.length === 0 ? (
          <SettingsEmptyState
            icon={ClipboardList}
            title={gt("No applications")}
            description={
              applicationFilter === "all"
                ? gt("There are no member applications to review")
                : gt("No {filter} applications", { filter: applicationFilter })
            }
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((app) => (
              <div key={app.id} className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={cdnImage(app.user.avatar)} />
                      <AvatarFallback className="bg-[var(--app-accent)] text-white">
                        {(app.user.displayName || app.user.username || "?").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-[var(--text-primary)]">{app.user.displayName || app.user.username}</p>
                      <p className="truncate text-xs text-[var(--text-secondary)]">
                        @{app.user.username} · {gt("Submitted")} {new Date(app.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {statusPill(app.status)}
                </div>

                {app.answers.length > 0 ? (
                  <dl className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                    {app.answers.map((answer, index) => {
                      const reply = decodeHtmlEntities(answer.answer ?? "").trim();
                      return (
                        <div key={index} className="px-3 py-2.5">
                          <dt className="text-xs font-semibold text-[var(--text-secondary)]">{decodeHtmlEntities(answer.question ?? "")}</dt>
                          <dd className={cn("mt-1 whitespace-pre-wrap break-words text-sm", reply ? "text-[var(--text-primary)]" : "italic text-[var(--text-muted)]")}>
                            {reply || gt("No answer")}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">{gt("Accepted the rules without answering any questions.")}</p>
                )}

                {app.status === "pending" && rejecting?.id !== app.id && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <SettingsButton
                      onClick={() => void handleReviewApplication(app.id, "approved")}
                      className="h-9 bg-green-600 px-4 text-white hover:bg-green-700 max-sm:flex-1"
                    >
                      {gt("Approve")}
                    </SettingsButton>
                    <SettingsButton
                      variant="secondary"
                      onClick={() => void handleReviewApplication(app.id, "interviewed")}
                      className="h-9 px-4 max-sm:flex-1"
                    >
                      {gt("Interview")}
                    </SettingsButton>
                    <SettingsButton
                      variant="danger"
                      onClick={() => setRejecting({ id: app.id, reason: "", remove: false })}
                      className="h-9 px-4 max-sm:flex-1"
                    >
                      {gt("Reject")}
                    </SettingsButton>
                  </div>
                )}

                {app.status === "pending" && rejecting?.id === app.id && (
                  <div className="space-y-3 rounded-md border border-red-500/40 bg-red-500/5 p-3">
                    <div>
                      <label htmlFor={`reject-reason-${app.id}`} className="mb-1.5 block text-xs font-bold uppercase text-[var(--text-secondary)]">
                        {gt("Reason (optional)")}
                      </label>
                      <Textarea
                        id={`reject-reason-${app.id}`}
                        value={rejecting.reason}
                        maxLength={500}
                        rows={2}
                        autoFocus
                        onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })}
                        placeholder={gt("Shown to the applicant")}
                        className="resize-none bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                    <label className="flex min-h-10 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={rejecting.remove}
                        onChange={(e) => setRejecting({ ...rejecting, remove: e.target.checked })}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--app-accent)]"
                      />
                      <span>
                        <span className="block text-sm text-[var(--text-primary)]">{gt("Also remove them from the server")}</span>
                        <span className="block text-xs text-[var(--text-muted)]">
                          {gt("Only applies if they joined and are still waiting to be let in. They can join again with an invite.")}
                        </span>
                      </span>
                    </label>
                    <div className="flex flex-wrap justify-end gap-2">
                      <SettingsButton variant="ghost" onClick={() => setRejecting(null)} className="h-9 px-4 max-sm:flex-1">
                        {gt("Cancel")}
                      </SettingsButton>
                      <SettingsButton variant="dangerFilled" onClick={() => void submitReject()} className="h-9 px-4 max-sm:flex-1">
                        {gt("Reject application")}
                      </SettingsButton>
                    </div>
                  </div>
                )}

                {app.rejectionReason && (
                  <p className="whitespace-pre-wrap break-words text-xs text-red-500">
                    {gt("Reason: {reason}", { reason: decodeHtmlEntities(app.rejectionReason) })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const widgetCode = `<iframe src="https://serika.chat/widget/${currentServer.id}" width="350" height="500" />`;
  const renderWidget = () => (
    <div className="space-y-8">
      <SettingsPageHeader title={gt("Server Widget")} description={gt("Embed your server on your website")} className="mb-0" />

      <SettingsCard>
        <SettingsToggleRow
          label={gt("Enable Server Widget")}
          description={gt("Allow people to embed your server info on their websites")}
          checked={draftBool("widget.enabled", false)}
          onCheckedChange={(checked) => settingsDraft.update("widget.enabled", checked)}
        />
        <SettingsToggleRow
          label={gt("Show recent messages")}
          description={gt("Anyone with the widget link can read the latest messages of channels that have no permission overwrites.")}
          checked={draftBool("widget.publicMessages", false)}
          disabled={!draftBool("widget.enabled", false)}
          onCheckedChange={(checked) => settingsDraft.update("widget.publicMessages", checked)}
        />
        <SettingsRow
          label={gt("Server ID")}
          control={
            <span className="flex items-center gap-1">
              <code className="font-mono text-[13px] text-[var(--text-secondary)]">{currentServer.id}</code>
              <SettingsButton size="sm" variant="ghost" onClick={() => copyToClipboard(currentServer.id)} aria-label={gt("Copy")}>
                <Copy />
              </SettingsButton>
            </span>
          }
          stackOnMobile
        />
      </SettingsCard>

      <SettingsSection title={gt("Invite channel")} description={gt("The channel new members land in when they join from the widget.")}>
        <div>
          <select
            value={draftString("widget.channelId", "") || ""}
            onChange={(e) => settingsDraft.update("widget.channelId", e.target.value || null)}
            aria-label={gt("Widget invite channel")}
            className={selectClass}
          >
            <option value="">{gt("Select a channel")}</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
          {fieldError("widget.channelId")}
        </div>
      </SettingsSection>

      <SettingsSection
        title={gt("Widget code")}
        action={
          <SettingsButton size="sm" variant="secondary" onClick={() => copyToClipboard(widgetCode)}>
            <Copy />
            {gt("Copy Code")}
          </SettingsButton>
        }
      >
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 font-mono text-[13px] text-[var(--text-secondary)]">
          {widgetCode}
        </pre>
      </SettingsSection>
    </div>
  );

  /** "5 minutes", "2 hours", "3 days". */
  const formatWait = (totalMinutes: number) => {
    const m = Math.max(1, Math.round(totalMinutes));
    if (m % 1440 === 0) {
      const n = m / 1440;
      return n === 1 ? gt("1 day") : gt("{n} days", { n });
    }
    if (m % 60 === 0) {
      const n = m / 60;
      return n === 1 ? gt("1 hour") : gt("{n} hours", { n });
    }
    return m === 1 ? gt("1 minute") : gt("{n} minutes", { n: m });
  };

  const joinList = (items: string[], type: "conjunction" | "disjunction") => {
    try {
      return new Intl.ListFormat(locale, { style: "long", type }).format(items);
    } catch {
      return items.join(", ");
    }
  };

  // Waits and locked actions for members who don't meet the level yet.
  const renderVerificationOptions = () => {
    const level = normalizeVerificationLevel(draftString("moderation.verificationLevel", "none"));
    const rank = VERIFICATION_LEVEL_RANK[level];
    if (rank === 0) return null;
    const accountAge = draftNumber("moderation.verification.accountAgeMinutes", 5);
    const memberAge = draftNumber("moderation.verification.memberAgeMinutes", 10);
    const actions: Record<VerificationAction, { label: string; summary: string }> = {
      send: { label: gt("Send messages"), summary: gt("send messages") },
      attach: { label: gt("Upload files"), summary: gt("upload files") },
      links: { label: gt("Post links"), summary: gt("post links") },
      react: { label: gt("Add reactions"), summary: gt("add reactions") },
      voice: { label: gt("Join voice"), summary: gt("join voice") },
      threads: { label: gt("Create threads or forum posts"), summary: gt("create threads or forum posts") },
    };
    const restricted = VERIFICATION_ACTIONS.filter((a) => draftBool(`moderation.verification.restrict.${a}`, true));
    const conditions = [gt("verify their email")];
    if (rank >= 2) conditions.push(gt("have an account older than {time}", { time: formatWait(accountAge) }));
    if (rank >= 3) conditions.push(gt("have been in the server for {time}", { time: formatWait(memberAge) }));
    if (rank >= 4) conditions.push(gt("link a verified account"));
    const summary = restricted.length === 0
      ? gt("Nothing is locked, so this verification level has no effect. Pick at least one action below.")
      : gt("Until new members {conditions}, they can't {actions}. Members with a role are exempt.", {
          conditions: joinList(conditions, "conjunction"),
          actions: joinList(restricted.map((a) => actions[a].summary), "disjunction"),
        });
    const baseline = settingsDraft.baseline;
    return (
      <SettingsCard>
        {rank >= 2 && (
          <div className="space-y-2 px-4 py-3.5" data-settings-row>
            <div className="grid gap-4 sm:grid-cols-2">
              <DurationInput
                key={`account-${String(baseline["moderation.verification.accountAgeMinutes"])}`}
                id="verification-account-age"
                label={gt("Account older than")}
                value={accountAge}
                onChange={(minutes) => settingsDraft.update("moderation.verification.accountAgeMinutes", minutes)}
              />
              {rank >= 3 && (
                <DurationInput
                  key={`member-${String(baseline["moderation.verification.memberAgeMinutes"])}`}
                  id="verification-member-age"
                  label={gt("Member of the server for")}
                  value={memberAge}
                  onChange={(minutes) => settingsDraft.update("moderation.verification.memberAgeMinutes", minutes)}
                />
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)]">{gt("Each wait can be up to 30 days.")}</p>
          </div>
        )}

        <div className="px-4 py-3.5" data-settings-row>
          <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">{gt("While waiting, members can't:")}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {VERIFICATION_ACTIONS.map((a) => {
              const key = `moderation.verification.restrict.${a}`;
              const checked = draftBool(key, true);
              return (
                <label key={a} className="-mx-2 flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-[var(--bg-hover)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => settingsDraft.update(key, e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-[var(--app-accent)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{actions[a].label}</span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {gt("Tip: let new members react but not chat by unchecking Add reactions and keeping Send messages checked.")}
          </p>
        </div>

        <p
          className={cn(
            "flex items-start gap-2 px-4 py-3 text-sm text-[var(--text-primary)]",
            restricted.length === 0 ? "bg-yellow-500/10" : "bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]",
          )}
          aria-live="polite"
        >
          {restricted.length === 0
            ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
            : <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-accent)]" />}
          <span>{summary}</span>
        </p>
      </SettingsCard>
    );
  };

  const renderModeration = () => (
    <div className="space-y-8">
      <SettingsPageHeader title={gt("Moderation")} description={gt("Configure moderation settings for your server")} className="mb-0" />

      <SettingsSection
        title={gt("Verification Level")}
        description={gt("New members must meet these criteria before they can do the things you lock. Members with a role are exempt.")}
      >
        <SettingsRadioCards
          ariaLabel={gt("Verification level")}
          value={draftString("moderation.verificationLevel", "none")}
          onChange={(value) => settingsDraft.update("moderation.verificationLevel", value)}
          options={[
            { value: "none", label: gt("None"), description: gt("Unrestricted") },
            { value: "low", label: gt("Low"), description: gt("Must have a verified email on their account.") },
            { value: "medium", label: gt("Medium"), description: gt("Must also be registered on SerikaCord for longer than {time}.", { time: formatWait(draftNumber("moderation.verification.accountAgeMinutes", 5)) }) },
            { value: "high", label: gt("High"), description: gt("Must also be a member of this server for longer than {time}.", { time: formatWait(draftNumber("moderation.verification.memberAgeMinutes", 10)) }) },
            { value: "very_high", label: gt("Highest"), description: gt("Must also have a verified linked account: a connection like GitHub or Discord, or a website domain verified with DNS.") },
          ]}
        />
        {renderVerificationOptions()}
      </SettingsSection>

      <SettingsSection
        title={gt("Explicit Media Content Filter")}
        description={gt("Images and videos from the members you choose are blurred until clicked. Age-restricted channels are never filtered.")}
      >
        <SettingsRadioCards
          ariaLabel={gt("Explicit media content filter")}
          value={draftString("moderation.explicitContentFilter", "disabled")}
          onChange={(value) => settingsDraft.update("moderation.explicitContentFilter", value)}
          options={[
            { value: "disabled", label: gt("Don't scan any media content"), description: gt("My friends are nice most of the time.") },
            { value: "members_without_roles", label: gt("Scan media content from members without a role"), description: gt("Recommended for servers that use roles for trusted members.") },
            { value: "all_members", label: gt("Scan media content from all members"), description: gt("Recommended when you want images to be squeaky clean.") },
          ]}
        />
      </SettingsSection>
    </div>
  );

  const goTab = (tab: SettingsTab) => (isMobile ? openMobileTab(tab) : setActiveTab(tab));

  // Safety Setup (Discord): spam + raid protection, and shortcuts to every
  // other protection tool. Who may talk lives on the Moderation tab.
  const renderSafetySetup = () => (
    <div className="space-y-8">
      <SettingsPageHeader title={gt("Safety Setup")} description={gt("Protect your server from spam, raids and unwanted content")} className="mb-0" />

      <SettingsSection title={gt("DM and spam protection")}>
        <SettingsCard>
          <SettingsRow
            label={gt("Mention Spam Limit")}
            description={gt("Messages that mention more people than this are blocked.")}
            control={<span className="min-w-[2ch] text-right text-sm font-semibold tabular-nums text-[var(--text-primary)]">{draftNumber("safety.mentionSpamLimit", 5)}</span>}
          >
            <input
              type="range"
              min={2}
              max={20}
              value={draftNumber("safety.mentionSpamLimit", 5)}
              onChange={(e) => settingsDraft.update("safety.mentionSpamLimit", Number(e.target.value))}
              aria-label={gt("Mention spam limit")}
              className="w-full accent-[var(--app-accent)]"
            />
          </SettingsRow>
          <SettingsToggleRow
            label={gt("Enable anti-spam checks")}
            description={gt("Block messages that look like spam, such as the same message posted again and again.")}
            checked={draftBool("safety.antiSpam", true)}
            onCheckedChange={(checked) => settingsDraft.update("safety.antiSpam", checked)}
          />
        </SettingsCard>
      </SettingsSection>

      {/* Not enforced by the server yet: shown read-only so owners don't
          rely on protection that doesn't exist. */}
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            {gt("Raid protection")}
            <SettingsStatusPill>{gt("Coming soon")}</SettingsStatusPill>
          </span>
        }
        description={gt("The 2FA requirement and raid protection are coming soon and are not enforced yet.")}
      >
        <fieldset disabled aria-disabled="true" className="cursor-not-allowed">
          <SettingsCard>
            <SettingsToggleRow
              label={gt("2FA Requirement")}
              description={gt("Require moderators to have 2FA enabled")}
              checked={draftBool("moderation.require2FA")}
              disabled
              onCheckedChange={(checked) => settingsDraft.update("moderation.require2FA", checked)}
            />
            <SettingsToggleRow
              label={gt("Raid Protection")}
              description={gt("Auto-enable stricter checks during suspicious joins")}
              checked={draftBool("safety.raidProtection")}
              disabled
              onCheckedChange={(checked) => settingsDraft.update("safety.raidProtection", checked)}
            />
          </SettingsCard>
        </fieldset>
      </SettingsSection>

      <SettingsSection title={gt("More protection")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { tab: "moderation", title: gt("Verification level"), desc: gt("Decide who can talk, react or join voice, and for how long new members wait."), icon: Shield },
            { tab: "automod", title: gt("AutoMod"), desc: gt("Block keywords, spam and harmful links automatically."), icon: AlertTriangle },
            { tab: "screening", title: gt("Rules Screening"), desc: gt("Make new members accept your rules, or approve them by hand."), icon: ClipboardList },
            { tab: "onboarding", title: gt("Onboarding"), desc: gt("Ask new members questions and give them roles."), icon: Smile },
          ] as const).map((card) => (
            <button
              key={card.tab}
              type="button"
              onClick={() => goTab(card.tab)}
              className="group flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 text-left transition-colors duration-(--motion-fast) hover:bg-[var(--bg-hover)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)]">
                <card.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--text-primary)]">{card.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-[var(--text-secondary)]">{card.desc}</span>
              </span>
              <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </SettingsSection>
    </div>
  );

  const renderSoundboard = () => {
    const uploadButton = (
      <SettingsButton variant="primary" onClick={() => soundInputRef.current?.click()} disabled={isUploadingSound}>
        {isUploadingSound ? <Loader size={16} /> : <Plus />}
        {gt("Upload Sound")}
      </SettingsButton>
    );
    return (
      <div className="space-y-8">
        <SettingsPageHeader title={gt("Soundboard")} description={gt("Configure soundboard availability")} className="mb-0" />

        <SettingsCard>
          <SettingsToggleRow
            label={gt("Enable Soundboard")}
            description={gt("Each sound has its own volume below, which applies for everyone in the server. How loud sounds play for you is a personal preference in User Settings → Voice & Video.")}
            checked={draftBool("soundboard.enabled", true)}
            onCheckedChange={(checked) => settingsDraft.update("soundboard.enabled", checked)}
          />
        </SettingsCard>

        <input
          type="file"
          ref={soundInputRef}
          onChange={handleSoundUpload}
          accept="audio/mpeg,audio/wav,audio/ogg,audio/mp3,audio/x-wav"
          className="hidden"
        />

        <UploadRequirements
          title={gt("Upload requirements")}
          items={[gt("File type: MP3, WAV, OGG"), gt("Max file size: 20 MB"), gt("Longer than 30 seconds? You can trim it after choosing the file.")]}
          action={uploadButton}
        />

        <SettingsSection
          title={gt("Sounds")}
          action={<span className="text-xs text-[var(--text-muted)]">{gt("{count} slots available", { count: Math.max(0, 500 - soundboardSounds.length) })}</span>}
        >
          {!isTabLoaded("soundboard") && soundboardSounds.length === 0 ? (
            <SettingsSkeleton variant="list" count={4} />
          ) : soundboardSounds.length === 0 ? (
            <SettingsEmptyState
              icon={Volume2}
              title={gt("No sounds yet")}
              description={gt("Upload audio files to use in voice channels")}
              action={uploadButton}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {soundboardSounds.map((sound) => {
                const percent = Math.round(soundVolume(sound) * 100);
                return (
                  <div
                    key={sound.id}
                    data-settings-row
                    className="group/sound relative flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 transition-colors duration-(--motion-fast) hover:border-[var(--border-strong)]"
                  >
                    <button
                      type="button"
                      onClick={() => playSound(sound)}
                      aria-label={gt("Play {sound}", { sound: sound.name })}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--app-accent)] text-white transition-[filter] hover:brightness-110"
                    >
                      {playingSoundId === sound.id ? <Loader size={20} /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {sound.emoji && <span className="mr-1">{sound.emoji}</span>}
                        {sound.name}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Volume2 className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={percent}
                          onChange={(event) => handleSoundVolumeChange(sound.id, Number(event.target.value) / 100)}
                          aria-label={gt("Volume for {sound}", { sound: sound.name })}
                          className="h-1 w-full min-w-0 cursor-pointer accent-[var(--app-accent)]"
                        />
                        <span className="w-8 text-right text-[10px] tabular-nums text-[var(--text-muted)]">{percent}%</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSound(sound.id)}
                      aria-label={gt("Delete sound {sound}", { sound: sound.name })}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-opacity hover:bg-red-500/10 hover:text-red-500 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/sound:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>
      </div>
    );
  };

  const renderIntegrations = () => {
    const isTwitchEnabled = draftBool("integrations.twitch");
    const isYoutubeEnabled = draftBool("integrations.youtube");
    const isWebhooksEnabled = draftBool("integrations.webhooks");
    const toggleCard = (id: "twitch" | "youtube" | "webhooks") => setOpenIntegration((cur) => (cur === id ? null : id));
    const enabledLabel = (on: boolean) => (on ? gt("Enabled") : gt("Disabled"));
    const notificationFields = (
      kind: "twitch" | "youtube",
      channelLabel: string,
      placeholder: string,
      channelKey: string,
      notifyKey: string,
    ) => (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{channelLabel}</span>
          <Input
            type="text"
            placeholder={placeholder}
            value={draftString(channelKey, "")}
            onChange={(e) => settingsDraft.update(channelKey, e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{gt("NOTIFICATION CHANNEL")}</span>
          <select
            value={draftString(notifyKey, "")}
            onChange={(e) => settingsDraft.update(notifyKey, e.target.value)}
            className={selectClass}
            aria-label={kind === "twitch" ? gt("Twitch notification channel") : gt("YouTube notification channel")}
          >
            <option value="">{gt("Select a channel")}</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    );

    return (
      <div className="space-y-8">
        <SettingsPageHeader
          title={gt("Integrations")}
          description={gt("Connect other services to your server and manage webhooks.")}
          className="mb-0"
        />

        <SettingsSection title={gt("Connected services")}>
          <div className="space-y-3">
            {/* Discord bridge: guided linking, channel mapping, options, health */}
            <DiscordBridgePanel serverId={currentServer.id} />

            <IntegrationCard
              icon={<Twitch className="h-5 w-5" />}
              iconStyle={{ color: "#9146FF" }}
              title={gt("Twitch")}
              description={gt("Post stream notifications automatically")}
              status={enabledLabel(isTwitchEnabled)}
              statusTone={isTwitchEnabled ? "success" : "neutral"}
              open={openIntegration === "twitch"}
              onToggle={() => toggleCard("twitch")}
            >
              <div className="space-y-4">
                <SettingsCard>
                  <SettingsToggleRow
                    label={gt("Twitch Integration")}
                    description={gt("Post stream notifications automatically")}
                    checked={isTwitchEnabled}
                    onCheckedChange={(checked) => settingsDraft.update("integrations.twitch", checked)}
                  />
                </SettingsCard>
                {isTwitchEnabled && (
                  <>
                    {notificationFields("twitch", gt("TWITCH CHANNEL NAME"), gt("e.g. shroud"), "integrations.twitchChannel", "integrations.twitchNotificationChannelId")}
                    <SettingsButton variant="secondary" onClick={() => void handleMockTrigger("twitch")} disabled={isTriggeringTwitch}>
                      {isTriggeringTwitch ? <><Loader size={14} />{gt("Triggering...")}</> : gt("Trigger Mock Stream Live Alert")}
                    </SettingsButton>
                  </>
                )}
              </div>
            </IntegrationCard>

            <IntegrationCard
              icon={<Youtube className="h-5 w-5" />}
              iconStyle={{ color: "#FF0000" }}
              title={gt("YouTube")}
              description={gt("Post notifications for new uploads and videos")}
              status={enabledLabel(isYoutubeEnabled)}
              statusTone={isYoutubeEnabled ? "success" : "neutral"}
              open={openIntegration === "youtube"}
              onToggle={() => toggleCard("youtube")}
            >
              <div className="space-y-4">
                <SettingsCard>
                  <SettingsToggleRow
                    label={gt("YouTube Integration")}
                    description={gt("Post notifications for new uploads and videos")}
                    checked={isYoutubeEnabled}
                    onCheckedChange={(checked) => settingsDraft.update("integrations.youtube", checked)}
                  />
                </SettingsCard>
                {isYoutubeEnabled && (
                  <>
                    {notificationFields("youtube", gt("YOUTUBE CHANNEL ID OR NAME"), gt("e.g. MrBeast"), "integrations.youtubeChannel", "integrations.youtubeNotificationChannelId")}
                    <SettingsButton variant="secondary" onClick={() => void handleMockTrigger("youtube")} disabled={isTriggeringYoutube}>
                      {isTriggeringYoutube ? <><Loader size={14} />{gt("Triggering...")}</> : gt("Trigger Mock Video Upload Alert")}
                    </SettingsButton>
                  </>
                )}
              </div>
            </IntegrationCard>

            <IntegrationCard
              icon={<Webhook className="h-5 w-5" />}
              iconStyle={{ color: "var(--app-accent)" }}
              title={gt("Webhooks")}
              description={gt("Allow inbound/outbound webhook automations")}
              status={enabledLabel(isWebhooksEnabled)}
              statusTone={isWebhooksEnabled ? "success" : "neutral"}
              open={openIntegration === "webhooks"}
              onToggle={() => toggleCard("webhooks")}
            >
              <div className="space-y-5">
                <SettingsCard>
                  <SettingsToggleRow
                    label={gt("Custom Webhooks")}
                    description={gt("Allow inbound/outbound webhook automations")}
                    checked={isWebhooksEnabled}
                    onCheckedChange={(checked) => settingsDraft.update("integrations.webhooks", checked)}
                  />
                </SettingsCard>
                {/* Every channel webhook in the server, grouped by channel */}
                <ServerWebhooksPanel serverId={currentServer.id} channels={channels} />
              </div>
            </IntegrationCard>
          </div>
        </SettingsSection>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return renderOverview();
      case "roles":
        return renderRoles();
      case "invites":
        return (
          <InvitesPage
            serverId={currentServer.id}
            invites={invites}
            vanity={vanityInfo}
            loading={!isTabLoaded("invites")}
            onCreate={onCreateInvite}
            onRevoke={onRevokeInvite}
            onVanityChange={setVanityInfo}
          />
        );
      case "bans":
        return <BansPage bans={bans} loading={!isTabLoaded("bans")} onUnban={onUnban} />;
      case "members":
        return (
          <MembersPage
            members={members}
            roles={sortedRoles}
            ownerId={currentServer.ownerId}
            currentUserId={user?.id}
            loading={!isTabLoaded("members")}
            canKick={can("KICK_MEMBERS")}
            canBan={can("BAN_MEMBERS")}
            canTimeout={can("MODERATE_MEMBERS")}
            onToggleRole={onToggleMemberRole}
            onAction={onMemberAction}
          />
        );
      case "emoji":
        return (
          <EmojiPage
            emojis={emojis}
            loading={!isTabLoaded("emoji")}
            uploading={isUploadingEmoji}
            onUpload={onEmojiUpload}
            onRename={onEmojiRename}
            onDelete={onEmojiDelete}
          />
        );
      case "stickers":
        return (
          <StickersPage
            stickers={stickers}
            loading={!isTabLoaded("stickers")}
            uploading={isUploadingSticker}
            onUpload={onStickerUpload}
            onRename={onStickerRename}
            onDelete={onStickerDelete}
          />
        );
      case "widget":
        return renderWidget();
      case "audit-log":
        return <ServerAuditLogPanel serverId={currentServer.id} roles={roles} />;
      case "automod":
        return <AutoModPanel serverId={currentServer.id} roles={roles} />;
      case "soundboard":
        return renderSoundboard();
      case "moderation":
        return renderModeration();
      case "safety":
        return renderSafetySetup();
      case "integrations":
        return renderIntegrations();
      case "server_profile":
        return (
          <ServerProfileSettings
            serverId={currentServer.id}
            serverName={currentServer.name}
            settingsDraft={settingsDraft}
            fieldErrors={fieldErrors}
          />
        );
      case "access":
        return renderAccess();
      case "onboarding":
        return <ServerOnboardingPanel serverId={currentServer.id} roles={roles} />;
      case "welcome":
        return <ServerWelcomeScreenPanel serverId={currentServer.id} />;
      case "screening":
        return <ServerScreeningPanel serverId={currentServer.id} onOpenApplications={() => goTab("applications")} />;
      case "connections":
        return <ServerConnectionsPanel serverId={currentServer.id} isOwner={isOwner} />;
      case "template":
        return <ServerTemplatePanel serverId={currentServer.id} serverName={currentServer.name} />;
      case "applications":
        return renderApplications();
      case "app_discovery":
        return <AppDiscoveryPage serverId={currentServer.id} />;
      default:
        return renderOverview();
    }
  };

  const overlays = (
    <>
      {cropper.element}

      {/* Audio Trimmer (soundboard sounds over 30 seconds) */}
      <AudioTrimmerDialog
        open={trimmerOpen}
        onOpenChange={(open) => {
          setTrimmerOpen(open);
          if (!open) setTrimmerFile(null);
        }}
        file={trimmerFile}
        maxDuration={30}
        onTrimmed={(blob, name) => {
          setTrimmerFile(null);
          void uploadSound(blob, name, `${name || "sound"}.wav`);
        }}
      />
    </>
  );

  if (isMobile) {
    const allItems = menuSections.flatMap((section) => section.items);
    const sectionLabel = allItems.find((item) => item.id === mobileNav.section)?.label ?? "";
    const mobileGroups: MobileSettingsGroup<SettingsTab | "delete-server">[] = menuSections.map((section, index) => ({
      title: index === 0 ? gt("Settings") : section.title,
      items: section.items.map((item) => ({
        ...item,
        badge: item.id === "applications" ? pendingAppCount : undefined,
      })),
    }));
    if (isOwner) {
      mobileGroups.push({ items: [{ id: "delete-server", label: gt("Delete Server"), icon: Trash2, destructive: true }] });
    }
    const roleDetailOpen = mobileNav.page && mobileNav.section === "roles" && mobileNav.detail !== null && Boolean(selectedRole);
    const unsavedBar = (
      <UnsavedChangesBar
        visible={settingsDraft.isDirty}
        isSaving={isSaving}
        onSave={handleSaveAll}
        onDiscard={handleDiscardChanges}
        changeCount={settingsDraft.dirtyFields.size}
        className="mt-0"
      />
    );
    const roleBar = hasUnsavedRoleChanges ? (
      <div className="theme-solid flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 shadow-2xl">
        <p className="text-sm font-medium text-[var(--text-primary)] min-w-0">{gt("You have unsaved changes")}</p>
        <button
          type="button"
          onClick={() => void handleSaveRole()}
          disabled={isSavingRole || Boolean(selectedRole?.managed)}
          className="h-11 px-5 shrink-0 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
        >
          {isSavingRole && <Loader size={16} />}
          {gt("Save")}
        </button>
      </div>
    ) : null;

    return (
      <>
        {!mobileNav.page ? (
          <MobileSettingsScreen
            leading="close"
            onLeading={() => void handleRequestClose()}
            title={gt("Server Settings")}
            ariaLabel={gt("Server settings for {name}", { name: currentServer.name })}
            animate={false}
            footer={settingsDraft.isDirty ? unsavedBar : undefined}
          >
            <MobileSettingsList
              groups={mobileGroups}
              onSelect={(id) => {
                if (id === "delete-server") void handleDeleteServer();
                else openMobileTab(id);
              }}
              header={
                <div className="flex items-center gap-3 px-1">
                  <Avatar className="w-14 h-14 rounded-2xl">
                    <AvatarImage src={cdnImage(serverIcon || currentServer.icon || undefined)} />
                    <AvatarFallback className="bg-[var(--app-accent)] text-white text-xl rounded-2xl">
                      {currentServer.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-[var(--text-primary)] truncate">{currentServer.name}</p>
                    <p className="text-sm text-[var(--text-muted)]">{gt("Server Settings")}</p>
                  </div>
                </div>
              }
            />
          </MobileSettingsScreen>
        ) : (
          <MobileSettingsScreen
            key={`${mobileNav.section}:${mobileNav.detail ?? ""}`}
            leading="back"
            onLeading={() => void handleMobileBack()}
            title={roleDetailOpen && selectedRole ? selectedRole.name : sectionLabel}
            subtitle={roleDetailOpen ? gt("Edit Role") : currentServer.name}
            ariaLabel={gt("Server settings for {name}", { name: currentServer.name })}
            action={
              roleDetailOpen ? (
                <MobileSaveAction
                  onSave={() => void handleSaveRole()}
                  disabled={!hasUnsavedRoleChanges || Boolean(selectedRole?.managed)}
                  saving={isSavingRole}
                />
              ) : DRAFT_TABS.has(mobileNav.section) ? (
                <MobileSaveAction onSave={() => void handleSaveAll()} disabled={!settingsDraft.isDirty} saving={isSaving} />
              ) : null
            }
            footer={roleDetailOpen ? roleBar : settingsDraft.isDirty ? unsavedBar : undefined}
          >
            <div className="px-4 pt-4 pb-10">{renderContent()}</div>
          </MobileSettingsScreen>
        )}
        {overlays}
      </>
    );
  }

  const activeNavLabel = menuSections.flatMap((section) => section.items).find((item) => item.id === activeTab)?.label ?? gt("Server Settings");
  const roleEditorVisible = activeTab === "roles" && roleEditing && Boolean(selectedRole && roleDraft);
  const showRoleSaveBar = roleEditorVisible && hasUnsavedRoleChanges && !selectedRole?.managed;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={gt("Server settings for {name}", { name: currentServer.name })}
      className="theme-backdrop fixed inset-0 z-50 bg-[var(--bg-app)] flex"
    >
      {/* Sidebar */}
      <SettingsNav
        sections={navSections}
        activeId={navTab}
        onSelect={setActiveTab}
        query={navQuery}
        onQueryChange={setNavQuery}
        ariaLabel={gt("Server Settings")}
      />

      {/* Main Content — table pages and the role editor use the wide column;
          form-style pages stay comfortably readable at a narrower width. */}
      <SettingsContent
        pageKey={activeTab === "roles" ? `roles:${roleEditorVisible ? "edit" : "list"}` : activeTab}
        title={roleEditorVisible && selectedRole ? `${activeNavLabel} — ${selectedRole.name}` : activeNavLabel}
        width={WIDE_SETTINGS_TABS.has(activeTab) || roleEditorVisible ? "wide" : "narrow"}
        onClose={() => void handleRequestClose()}
        closeLabel={gt("Close server settings")}
        highlightQuery={navQuery}
        footer={
          showRoleSaveBar ? (
            /* Role editor: Discord's unsaved-changes bar saves the role. */
            <UnsavedChangesBar
              visible
              isSaving={isSavingRole}
              onSave={() => void handleSaveRole()}
              onDiscard={resetRoleDraft}
              className="mt-0 max-w-none"
            />
          ) : (
            /* Sticky transactional save bar (covers every settings tab) */
            <UnsavedChangesBar
              visible={settingsDraft.isDirty}
              isSaving={isSaving}
              onSave={handleSaveAll}
              onDiscard={handleDiscardChanges}
              onUndo={settingsDraft.undo}
              onRedo={settingsDraft.redo}
              canUndo={settingsDraft.canUndo}
              canRedo={settingsDraft.canRedo}
              changeCount={settingsDraft.dirtyFields.size}
              shakeSignal={unsavedShake}
              className="mt-0 max-w-none"
            />
          )
        }
      >
        {renderContent()}
      </SettingsContent>

      {overlays}
    </div>
  );
}

// Sections whose edits go into the settings draft (saved with one bulk PATCH).
const DRAFT_TABS = new Set<SettingsTab>(["overview", "widget", "moderation", "safety", "soundboard", "integrations", "access"]);
