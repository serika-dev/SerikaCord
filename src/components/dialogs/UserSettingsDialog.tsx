"use client";

import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useStaffAccess } from "@/hooks/useStaffAccess";
import type { StaffPermission } from "@/lib/staff/permissions";
import { getConnectionIcon } from "@/components/user/ConnectionIcon";
import { SerikaWishlistSettingsCard } from "@/components/user/ProfileWishlistWidget";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useAuth } from "@/contexts/AuthContext";
import { mergeSettingsDeep, type SettingsPatch } from "@/lib/settings/mergeSettings";
import { useTheme } from "@/contexts/ThemeContext";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsContent, SettingsNav } from "@/components/settings/SettingsShell";
import { filterSettingsSections } from "@/components/settings/settingsSearch";
import { SettingsCard, SettingsPageHeader, SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { SettingsButton, settingsButtonClass } from "@/components/settings/blocks/SettingsButton";
import { SettingsDangerZone } from "@/components/settings/blocks/SettingsDangerZone";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsListItem } from "@/components/settings/blocks/SettingsListItem";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsStatCard } from "@/components/settings/blocks/SettingsStatCard";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsSubTabs } from "@/components/settings/blocks/SettingsSubTabs";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { MyAccountPage } from "@/components/settings/user/MyAccountPage";
import { DevicesPage, type DeviceSession } from "@/components/settings/user/DevicesPage";
import { AuthorizedAppsPage, type AuthorizedAppEntry } from "@/components/settings/user/AuthorizedAppsPage";
import { CONNECTION_PROVIDERS, ConnectionsPage, type UserConnection } from "@/components/settings/user/ConnectionsPage";
import type { UserSettingsValue } from "@/components/settings/user/types";
import { VoiceVideoPage } from "@/components/settings/user/VoiceVideoPage";
import { NotificationsPage } from "@/components/settings/user/NotificationsPage";
import { AppearancePage } from "@/components/settings/user/AppearancePage";
import { DisplayNameStyleEditor, NameplateEditor, ProfileColourEditor } from "@/components/settings/user/ProfileStyleEditors";
import { UnsavedChangesBar, useUnsavedShake } from "@/components/ui/unsaved-changes-bar";
import { ImageCropper } from "@/components/ui/image-cropper";
import { ProfileCard } from "@/components/user/ProfileCard";
import {
  User,
  Bell,
  Palette,
  Mic,
  Keyboard,
  Languages,
  Accessibility,
  Crown,
  LogOut,
  Camera,
  Check,
  ExternalLink,
  Pencil,
  Link2,
  Smartphone,
  MessageSquare,
  Lock,
  Volume2,
  Image,
  Plug,
  ShieldCheck,
  Users,
  Settings,
  Database,
  Activity,
  FlaskConical,
  Clock,
  MonitorSmartphone,
  Monitor,
  Award,
  Megaphone,
  Mic2,
  ChevronDown,
  Ban,
  FileText,
  Server,
  Globe,
  UserCog,
  AlertTriangle,
  Zap,
  BarChart3,
  Calendar,
  Bot,
  RefreshCw,
  Search,
  ShieldAlert,
  MessageSquareHeart,
  UserPlus,
  Gavel,
  type LucideIcon,
} from "lucide-react";
import { ActivityPrivacySettings, FriendRequestSettings, MessageRequestSettings } from "@/components/settings/SocialPrivacySettings";
import { setUserNotificationSettings } from "@/lib/services/notificationUX";
import { voiceService } from "@/lib/services/voiceService";
import { cn, cdnImage } from "@/lib/utils";
import { useBadges } from "@/hooks/useBadges";
import { BadgeIcon } from "@/components/ui/BadgeIcon";
import { badgeLabel } from "@/components/ui/badges";
import type { NameplateCustomization } from "@/lib/constants/nameplates";
import { ServerTagPicker } from "@/components/settings/ServerTagPicker";
import { AdminExperimentsPanel } from "@/components/settings/AdminExperimentsPanel";
import { KeybindSettingsPanel } from "@/components/settings/KeybindSettingsPanel";
import { DesktopSettingsPanel } from "@/components/settings/DesktopSettingsPanel";
import { StreamerModeSettings } from "@/components/settings/StreamerModeSettings";
import { useStreamerHides } from "@/hooks/useStreamerMode";
import { isDesktopShell } from "@/lib/desktop/bridge";
import { AdminTtsSoundsPanel, AdminTtsVoicesPanel } from "@/components/settings/AdminTtsPanel";
import { AdminTranslationsPanel } from "@/components/settings/AdminTranslationsPanel";
import { BugReportPanel } from "@/components/settings/BugReportPanel";
import { MobileSettingsHeader, MobileSettingsHome } from "@/components/settings/MobileSettingsHome";
import { readSettingsBackAction, SETTINGS_PHONE_QUERY } from "@/components/settings/mobileSettingsNav";
import { useBackHandler } from "@/hooks/useBackHandler";
import { AdminBugReportsPanel } from "@/components/settings/AdminBugReportsPanel";
import { AdminBadgesPanel } from "@/components/settings/AdminBadgesPanel";
import { toast } from "sonner";
import { useGT, useLocale } from "gt-next";
import { LocaleSelector } from "@/components/ui/LocaleSelector";
import { Loader } from "@/components/ui/Loader";
import { APP_VERSION, BUILD_COMMIT_URL, BUILD_SHA, BUILD_TIME, VERSION_LABEL } from "@/lib/version";
import { toServerStatus } from "@/lib/presenceChoice";
import { useConfirm } from "@/components/ui/confirm-dialog";
// End-to-end encryption settings (own chunk; only once the feature is on).
import { KeyRound as E2eeKeyIcon } from "lucide-react";
import { useE2ee } from "@/hooks/useE2ee";
const E2eeSettingsPanel = dynamic(() => import("@/components/e2ee/E2eeSettingsPanel"), { ssr: false });

const AdminStaffPanel = dynamic(() => import("@/components/settings/AdminStaffPanel"));
const AdminChangelogsPanel = dynamic(() => import("@/components/settings/AdminChangelogsPanel").then((module) => module.AdminChangelogsPanel));
const AccountStanding = dynamic(() => import("@/components/safety/AccountStanding").then((module) => module.AccountStanding));
const AdminTrustSafetyPanel = dynamic(() => import("@/components/settings/AdminTrustSafetyPanel"));
const AdminAppsPanel = dynamic(() => import("@/components/settings/AdminAppsPanel"));

/** Every IANA zone, computed once (the Profiles page rendered ~400 options from scratch on every keystroke). */
let timeZonesCache: string[] | null = null;
function allTimeZones(): string[] {
  if (!timeZonesCache) {
    try {
      timeZonesCache = Intl.supportedValuesOf("timeZone");
    } catch {
      timeZonesCache = [];
    }
  }
  return timeZonesCache;
}

const ADMIN_TAB_PERMISSIONS: Record<string, StaffPermission[]> = {
  "admin-users": ["users.view"],
  "admin-staff": ["staff.manage"],
  "admin-changelogs": ["changelog.manage", "changelog.publish"],
  "admin-servers": ["servers.view"],
  "admin-badges": ["badges.manage"],
  "admin-announcements": ["settings.manage", "broadcast.send"],
  "admin-settings": ["settings.manage"],
  "admin-logs": ["logs.view"],
  "admin-experiments": ["experiments.manage"],
  "admin-tts-sounds": ["tts.manage"],
  "admin-tts-voices": ["tts.manage"],
  "admin-translations": ["translations.manage"],
  "admin-stats": ["stats.view"],
  "admin-bug-reports": ["reports.manage"],
  "admin-trust-safety": ["safety.review", "reports.review"],
  "admin-apps": ["apps.manage"],
};

/* Shared form styling for the Profiles / admin forms (Discord: uppercase field labels, 40px inputs). */
const FIELD_LABEL = "mb-2 block text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]";
const FIELD_INPUT = "h-10 border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]";
const FORM_CARD = "space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4";
const SELECT_CLASS =
  "h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] duration-(--motion-fast) focus:border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] focus:ring-2 focus:ring-[var(--app-accent)]/25";

/** Clickable avatar / banner tile with a camera overlay (and a spinner while uploading). */
function MediaPickTile({
  shape,
  src,
  alt,
  uploading,
  onPick,
}: {
  shape: "avatar" | "banner";
  src?: string | null;
  alt: string;
  uploading: boolean;
  onPick: () => void;
}) {
  const FallbackIcon = shape === "avatar" ? Camera : Image;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={alt}
      className={cn(
        "group relative shrink-0 overflow-hidden border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)] transition-colors duration-(--motion-fast) hover:border-[var(--app-accent)]",
        shape === "avatar" ? "h-20 w-20 rounded-full" : "h-20 w-full rounded-lg",
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cdnImage(src)} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
          <FallbackIcon className="h-5 w-5" />
        </span>
      )}
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity duration-(--motion-fast)",
          uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      >
        {uploading ? <Loader size={20} /> : <Camera className="h-5 w-5 text-white" />}
      </span>
    </button>
  );
}

/** Icon + colour for an admin log action ("user_ban" → red ban icon). */
function adminLogActionStyle(action: string): { icon: LucideIcon; color: string } {
  if (action.includes("ban")) return { icon: Ban, color: "#EF4444" };
  if (action.includes("report")) return { icon: AlertTriangle, color: "#F59E0B" };
  if (action.includes("broadcast") || action.includes("announcement")) return { icon: Megaphone, color: "#3B82F6" };
  if (action.includes("partner") || action.includes("discovery")) return { icon: Globe, color: "#10B981" };
  if (action.includes("server") || action.includes("transfer")) return { icon: Server, color: "#8B5CF6" };
  if (action.includes("badge")) return { icon: Award, color: "#F59E0B" };
  if (action.includes("experiment")) return { icon: FlaskConical, color: "#06B6D4" };
  if (action.includes("timeout")) return { icon: Clock, color: "#F59E0B" };
  if (action.includes("settings") || action.includes("update")) return { icon: Settings, color: "#6B7280" };
  return { icon: Zap, color: "#8B5CF6" };
}

/** "3 hours ago" in the UI locale. */
function formatRelativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab to show when the dialog opens (e.g. from an `openUserSettings` event's `detail.tab`). */
  initialTab?: string | null;
}

type SettingsTab =
  | "account"
  | "profiles"
  | "content-social"
  | "friend-requests"
  | "activity-privacy"
  | "data-privacy"
  | "account-standing"
  | "authorized-apps"
  | "devices"
  | "encryption"
  | "connections"
  | "notifications"
  | "appearance"
  | "accessibility"
  | "voice-video"
  | "text-images"
  | "keybinds"
  | "desktop"
  | "language"
  | "advanced"
  | "streamer-mode"
  | "premium"
  | "admin-users"
  | "admin-staff"
  | "admin-changelogs"
  | "admin-servers"
  | "admin-badges"
  | "admin-announcements"
  | "admin-settings"
  | "admin-logs"
  | "admin-experiments"
  | "admin-tts-sounds"
  | "admin-tts-voices"
  | "admin-translations"
  | "admin-stats"
  | "bug-reports"
  | "admin-bug-reports"
  | "admin-trust-safety"
  | "admin-apps";


export function UserSettingsDialog({ open, onOpenChange, initialTab }: UserSettingsDialogProps) {
  const { user, logout, updateUser, refresh } = useAuth();
  const gt = useGT();
  const locale = useLocale();
  const streamerHidesPersonal = useStreamerHides("personal");
  const confirmDialog = useConfirm();
  const { list: badgeDefinitions } = useBadges();
  const { settings: themeSettings, applyUserSettingsPatch, updateSettings } = useTheme();
  const { servers } = useServer();
  // The sidebar follows `navTab` at once; the page itself renders from the
  // deferred `activeTab`, so a heavy page renders in the background instead
  // of freezing clicks while it mounts.
  const [navTab, setActiveTab] = useState<SettingsTab>((initialTab as SettingsTab | null | undefined) || "profiles");
  const activeTab = useDeferredValue(navTab);
  // Jump to the requested tab each time the dialog opens (state adjusted
  // during render rather than in an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  // Phone width: the settings open on a Discord-style list ("root") and each
  // tab is pushed on top with a back header. A deep link (initialTab) opens
  // straight on that page. Ignored at md+ where the sidebar is always shown.
  const [mobileOnRoot, setMobileOnRoot] = useState(!initialTab);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialTab) setActiveTab(initialTab as SettingsTab);
    if (open) setMobileOnRoot(!initialTab);
  }
  const openMobileTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setMobileOnRoot(false);
  };
  const [displayName, setDisplayName] = useState("");
  const [profileTab, setProfileTab] = useState<"main" | "server">("main");
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [serverNickname, setServerNickname] = useState("");
  const [serverAvatar, setServerAvatar] = useState<string | null>(null);
  const [serverBanner, setServerBanner] = useState<string | null>(null);
  const [serverMemberLoading, setServerMemberLoading] = useState(false);

  const [initialServerNickname, setInitialServerNickname] = useState("");
  const [initialServerAvatar, setInitialServerAvatar] = useState<string | null>(null);
  const [initialServerBanner, setInitialServerBanner] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [timezone, setTimezone] = useState("");
  const [showTimezone, setShowTimezone] = useState(false);
  const [customStatus, setCustomStatus] = useState("");
  const [status, setStatus] = useState("online");
  const [displayNameStyle, setDisplayNameStyle] = useState<{
    font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
    effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
    color?: string;
    gradient?: string[];
  }>({ font: 'default', effect: 'solid', color: '', gradient: [] });
  const [profileColor, setProfileColor] = useState("");
  const [profileGradient, setProfileGradient] = useState<string[]>([]);
  const [profileGradientAngle, setProfileGradientAngle] = useState(135);
  const [profileGradientType, setProfileGradientType] = useState<'linear' | 'radial'>('linear');
  const [profileGradientRadialPosition, setProfileGradientRadialPosition] = useState('center');
  const [profileCardEffect, setProfileCardEffect] = useState<'normal' | 'glassmorphism' | 'glow' | 'holographic' | 'neon'>('normal');
  const [profileCardBlur, setProfileCardBlur] = useState(8);
  const [profileCardOpacity, setProfileCardOpacity] = useState(0.85);
  const [profileCardBorderColor, setProfileCardBorderColor] = useState("");
  const [profileCardBorderGlow, setProfileCardBorderGlow] = useState(false);
  const [profileCardBorderWidth, setProfileCardBorderWidth] = useState(1);
  const [nameplate, setNameplate] = useState<NameplateCustomization>({ type: 'none' });

  const previewUser = useMemo(() => {
    const isServer = profileTab === "server";
    return {
      id: user?.id || "preview-id",
      username: user?.username || "username",
      displayName: isServer ? (serverNickname || displayName || user?.username || "") : (displayName || user?.username || ""),
      avatar: isServer ? (serverAvatar || user?.avatar) : (user?.avatar),
      banner: isServer ? (serverBanner || user?.banner) : (user?.banner),
      bio: bio,
      pronouns: pronouns,
      timezone: timezone,
      showTimezone: showTimezone,
      customStatus: customStatus,
      status: (status as "online" | "idle" | "dnd" | "offline") || "online",
      badges: user?.badges || [],
      createdAt: user?.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString(),
      isPremium: user?.isPremium || false,
      customization: {
        profileColor: profileColor,
        profileGradient: profileGradient,
        displayNameStyle: displayNameStyle,
        nameplate: nameplate,
        profileGradientAngle,
        profileGradientType,
        profileGradientRadialPosition,
        profileCardEffect,
        profileCardBlur,
        profileCardOpacity,
        profileCardBorderColor,
        profileCardBorderGlow,
        profileCardBorderWidth,
      }
    };
  }, [
    user,
    profileTab,
    serverNickname,
    displayName,
    serverAvatar,
    serverBanner,
    bio,
    pronouns,
    timezone,
    showTimezone,
    customStatus,
    status,
    profileColor,
    profileGradient,
    displayNameStyle,
    nameplate,
    profileGradientAngle,
    profileGradientType,
    profileGradientRadialPosition,
    profileCardEffect,
    profileCardBlur,
    profileCardOpacity,
    profileCardBorderColor,
    profileCardBorderGlow,
    profileCardBorderWidth,
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userSettings, setUserSettings] = useState<UserSettingsValue>(null);
  const [isSavingSettings, setIsSavingSettings] = useState<string | null>(null);
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedAppEntry[]>([]);
  const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([]);
  const [userConnections, setUserConnections] = useState<UserConnection[]>([]);
  const [connectionsEnabled, setConnectionsEnabled] = useState(true);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);

  // Avatar/Banner upload state
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string>("");
  const [cropperType, setCropperType] = useState<"avatar" | "banner">("avatar");

  // Admin state
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [adminServerSearch, setAdminServerSearch] = useState("");
  const [adminUsers, setAdminUsers] = useState<Array<{
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    avatar?: string;
    badges: string[];
    isVerified: boolean;
    isBanned: boolean;
    isStaff: boolean;
    createdAt: string;
  }>>([]);
  const [adminServers, setAdminServers] = useState<Array<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    memberCount: number;
    owner: { username: string; displayName?: string };
    isDiscoverable: boolean;
    isPartnered: boolean;
    createdAt: string;
  }>>([]);
  const [adminLogs, setAdminLogs] = useState<Array<{
    id: string;
    admin: { id?: string; username: string; displayName?: string; avatar?: string };
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
    reason?: string;
    createdAt: string;
  }>>([]);
  const [adminStats, setAdminStats] = useState<{
    users: number;
    servers: number;
    messages: number;
    banned: number;
    bots: number;
    newUsersToday: number;
    newUsersThisWeek: number;
    messagesToday: number;
    onlineUsers: number;
    totalMemberships: number;
    activeServers: number;
  } | null>(null);
  const [platformSettings, setPlatformSettings] = useState<{
    maintenanceMode: boolean;
    allowRegistration: boolean;
    connectionsEnabled?: boolean;
    disabledProviders?: string[];
    globalAnnouncement?: string;
    oembedWhitelist?: string[];
    allowedFileTypes?: { type: string; safe: boolean }[];
    warnOnUnknownFileTypes?: boolean;
  } | null>(null);
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    avatar?: string;
    banner?: string;
    bio?: string;
    badges: string[];
    isBanned: boolean;
    banReason?: string;
    isStaff?: boolean;
    staffRole?: string;
    isVerified?: boolean;
    isPremium?: boolean;
    premiumSince?: string;
    createdAt?: string;
    stats?: { servers: number; messages: number };
  } | null>(null);
  const [selectedServer, setSelectedServer] = useState<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    memberCount?: number;
    owner: { username: string; displayName?: string };
    isDiscoverable: boolean;
    isPartnered: boolean;
    createdAt: string;
  } | null>(null);
  // Separate flags: a stats refresh must not put a spinner on the user search
  // (or the log list) of another admin page.
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [isLoadingAdminStats, setIsLoadingAdminStats] = useState(false);
  const [isLoadingAdminLogs, setIsLoadingAdminLogs] = useState(false);
  const [adminLogFilter, setAdminLogFilter] = useState<string>("all");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [adminLogPage, setAdminLogPage] = useState(1);
  const [adminLogPagination, setAdminLogPagination] = useState<{ page: number; limit: number; total: number; pages: number } | null>(null);
  const [announcementText, setAnnouncementText] = useState("");
  const [oembedDomainInput, setOembedDomainInput] = useState("");
  const [fileTypeInput, setFileTypeInput] = useState("");
  const [fontTestText, setFontTestText] = useState("The quick brown fox jumps over the lazy dog");

  // Initialize form with user data
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
      setBio(user.bio || "");
      setPronouns(user.pronouns || "");
      setTimezone(user.timezone || "");
      setShowTimezone(user.showTimezone ?? false);
      setCustomStatus(user.customStatus || "");
      setStatus(user.status || "online");
      setDisplayNameStyle(user.customization?.displayNameStyle || { font: 'default', effect: 'solid', color: '', gradient: [] });
      setProfileColor(user.customization?.profileColor || "");
      setProfileGradient(user.customization?.profileGradient || []);
      setProfileGradientAngle(user.customization?.profileGradientAngle ?? 135);
      setProfileGradientType(user.customization?.profileGradientType || 'linear');
      setProfileGradientRadialPosition(user.customization?.profileGradientRadialPosition || 'center');
      setProfileCardEffect(user.customization?.profileCardEffect || 'normal');
      setProfileCardBlur(user.customization?.profileCardBlur ?? 8);
      setProfileCardOpacity(user.customization?.profileCardOpacity ?? 0.85);
      setProfileCardBorderColor(user.customization?.profileCardBorderColor || "");
      setProfileCardBorderGlow(user.customization?.profileCardBorderGlow ?? false);
      setProfileCardBorderWidth(user.customization?.profileCardBorderWidth ?? 1);
      setNameplate(user.customization?.nameplate || { type: 'none' });
    }
  }, [user]);

  const fetchUserSettings = async () => {
    // Pages show skeleton rows until the first load lands (userSettings ===
    // null); reopening settings refreshes in the background, keeping the old
    // data on screen (CORD-30).
    try {
      const [settingsRes, appsRes, devicesRes, connectionsRes] = await Promise.all([
        fetch("/api/users/me/settings"),
        fetch("/api/users/me/authorized-apps"),
        fetch("/api/users/me/devices"),
        fetch("/api/users/me/connections"),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setUserSettings(data.settings || {});
      }
      if (appsRes.ok) {
        const data = await appsRes.json();
        setAuthorizedApps(data.apps || []);
      }
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        setDeviceSessions(data.devices || []);
      }
      if (connectionsRes.ok) {
        const data = await connectionsRes.json();
        setUserConnections(data.connections || []);
      }
    } catch (error) {
      console.error("Failed to fetch user settings:", error);
    }
  };

  // Saves are applied locally first, then sent one at a time (so two quick
  // toggles can't race on the server's read-modify-write), and only the newest
  // request's response is reconciled into local + AuthContext state.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveSeqRef = useRef(0);
  const debouncedPatchRef = useRef<{ patch: SettingsPatch; sectionLabel: string; timer: ReturnType<typeof setTimeout> | null }>({ patch: {}, sectionLabel: "", timer: null });

  const applyLocalSettingsPatch = (patch: SettingsPatch) => {
    setUserSettings((prev) => mergeSettingsDeep(prev || {}, patch));
    applyUserSettingsPatch(patch);
    if (patch.notifications) {
      setUserNotificationSettings(mergeSettingsDeep(userSettings?.notifications || {}, patch.notifications));
    }
    if (typeof patch.voiceVideo?.soundboardVolume === "number") voiceService.setSoundboardVolume(patch.voiceVideo.soundboardVolume);
  };

  const resyncSettingsFromServer = async () => {
    try {
      const res = await fetch("/api/users/me/settings");
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.settings) return;
      setUserSettings(data.settings);
      applyUserSettingsPatch(data.settings);
      setUserNotificationSettings(data.settings.notifications);
      updateUser({ settings: data.settings });
    } catch {
      // keep the optimistic state; the next save reconciles
    }
  };

  const sendSettingsPatch = (patch: SettingsPatch, sectionLabel: string, opts?: { silent?: boolean }) => {
    const seq = ++saveSeqRef.current;
    const run = async () => {
      setIsSavingSettings(sectionLabel);
      try {
        const response = await fetch("/api/users/me/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: patch }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          if (seq === saveSeqRef.current && !debouncedPatchRef.current.timer && data?.settings) {
            setUserSettings(data.settings);
            setUserNotificationSettings(data.settings.notifications);
            updateUser({ settings: data.settings });
          }
          if (!opts?.silent) toast.success(gt("Settings saved"));
        } else {
          toast.error(data?.error || gt("Failed to save settings"));
          await resyncSettingsFromServer();
        }
      } catch (error) {
        console.error("Failed to save settings:", error);
        toast.error(gt("Failed to save settings"));
        await resyncSettingsFromServer();
      } finally {
        if (seq === saveSeqRef.current) setIsSavingSettings(null);
      }
    };
    const next = saveQueueRef.current.then(run, run);
    saveQueueRef.current = next;
    return next;
  };

  const saveSettingsPatch = (patch: SettingsPatch, sectionLabel: string, opts?: { silent?: boolean }) => {
    applyLocalSettingsPatch(patch);
    return sendSettingsPatch(patch, sectionLabel, opts);
  };

  /**
   * For sliders: apply the value live, but PATCH once ~300ms after the last
   * change, without a toast. Pass only the changed leaf (e.g.
   * `{ voiceVideo: { inputVolume } }`); pending leaves are merged.
   */
  const saveSettingsPatchDebounced = (patch: SettingsPatch, sectionLabel: string) => {
    applyLocalSettingsPatch(patch);
    const pending = debouncedPatchRef.current;
    pending.patch = mergeSettingsDeep(pending.patch, patch);
    pending.sectionLabel = sectionLabel;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const toSend = pending.patch;
      pending.patch = {};
      pending.timer = null;
      void sendSettingsPatch(toSend, pending.sectionLabel, { silent: true });
    }, 300);
  };

  const saveAppearancePatch = (appearancePatch: SettingsPatch, opts?: { debounce?: boolean }) => {
    if (opts?.debounce) {
      saveSettingsPatchDebounced({ appearance: appearancePatch }, "appearance");
      return;
    }
    void saveSettingsPatch({ appearance: appearancePatch }, "appearance");
  };

  // Stable identities for the extracted (memoized) pages: they call the
  // latest save functions without re-rendering every time this dialog does.
  const saveFnsRef = useRef({ saveSettingsPatch, saveSettingsPatchDebounced, saveAppearancePatch });
  useEffect(() => {
    saveFnsRef.current = { saveSettingsPatch, saveSettingsPatchDebounced, saveAppearancePatch };
  });
  const stableSaveSettingsPatch = useCallback(
    (patch: SettingsPatch, sectionLabel: string) => saveFnsRef.current.saveSettingsPatch(patch, sectionLabel),
    [],
  );
  const stableSaveSettingsPatchDebounced = useCallback(
    (patch: SettingsPatch, sectionLabel: string) => saveFnsRef.current.saveSettingsPatchDebounced(patch, sectionLabel),
    [],
  );
  const stableSaveAppearancePatch = useCallback(
    (patch: SettingsPatch, opts?: { debounce?: boolean }) => saveFnsRef.current.saveAppearancePatch(patch, opts),
    [],
  );

  // "Edit Profile" opens settings with { tab: "profiles" }. The dialog stays mounted, so
  // without this it reopened on whatever page was last open (CORD-21).
  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: SettingsTab } | undefined>).detail?.tab;
      if (tab) {
        setActiveTab(tab);
        setMobileOnRoot(false);
      }
    };
    window.addEventListener('openUserSettings', onOpenRequest);
    return () => window.removeEventListener('openUserSettings', onOpenRequest);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchUserSettings();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const settingsTab = params.get("settings") || params.get("openSettings");
      if (settingsTab === "connections") {
        setActiveTab("connections");
        setMobileOnRoot(false);
      }
    }
  }, [open]);

  useEffect(() => {
    if (!userSettings) return;
    applyUserSettingsPatch(userSettings);
  }, [userSettings, applyUserSettingsPatch]);

  // Initialize selected server when profile tab is opened or servers change
  useEffect(() => {
    if (servers.length > 0 && !selectedServerId) {
      setSelectedServerId(servers[0].id);
    }
  }, [servers, selectedServerId]);

  // Fetch server-specific profile whenever selectedServerId or profileTab changes
  useEffect(() => {
    const fetchServerProfile = async () => {
      if (profileTab !== "server" || !selectedServerId || !user?.id) return;
      setServerMemberLoading(true);
      try {
        const res = await fetch(`/api/servers/${selectedServerId}/members/${user.id}`);
        if (res.ok) {
          const member = await res.json();
          const nick = member.nickname || "";
          const av = member.avatarOverride || null;
          const ban = member.banner || null;

          setServerNickname(nick);
          setServerAvatar(av);
          setServerBanner(ban);

          setInitialServerNickname(nick);
          setInitialServerAvatar(av);
          setInitialServerBanner(ban);
        }
      } catch (err) {
        console.error("Failed to fetch server profile:", err);
      } finally {
        setServerMemberLoading(false);
      }
    };
    fetchServerProfile();
  }, [profileTab, selectedServerId, user?.id]);

  // Unsaved profile edits, derived during render (was an effect that set
  // state after every keystroke, rendering this whole dialog twice per key).
  const hasChanges = useMemo(() => {
    if (profileTab === "server") {
      return (
        serverNickname !== initialServerNickname ||
        serverAvatar !== initialServerAvatar ||
        serverBanner !== initialServerBanner
      );
    }
    if (!user) return false;
    return (
      displayName !== (user.displayName || "") ||
      bio !== (user.bio || "") ||
      pronouns !== (user.pronouns || "") ||
      timezone !== (user.timezone || "") ||
      showTimezone !== (user.showTimezone ?? false) ||
      customStatus !== (user.customStatus || "") ||
      status !== (user.status || "online") ||
      JSON.stringify(displayNameStyle) !== JSON.stringify(user.customization?.displayNameStyle || { font: 'default', effect: 'solid', color: '', gradient: [] }) ||
      profileColor !== (user.customization?.profileColor || "") ||
      JSON.stringify(profileGradient) !== JSON.stringify(user.customization?.profileGradient || []) ||
      JSON.stringify(nameplate) !== JSON.stringify(user.customization?.nameplate || { type: 'none' })
    );
  }, [
    displayName,
    bio,
    pronouns,
    timezone,
    showTimezone,
    customStatus,
    status,
    displayNameStyle,
    profileColor,
    profileGradient,
    nameplate,
    user,
    profileTab,
    serverNickname,
    initialServerNickname,
    serverAvatar,
    initialServerAvatar,
    serverBanner,
    initialServerBanner,
  ]);


  // Handle escape key. Capture phase so it fires even if a child stops
  // propagation, but yield to any nested dialog/menu/popover so Escape closes
  // that first (e.g. an open picker inside settings) before closing settings.
  // On phones a pushed page pops back to the settings list first (Discord
  // mobile), both for Escape and the Android back button.
  // Unsaved profile edits: leaving (close, Escape, another page) first shakes
  // the save bar like Discord; doing it again right away goes ahead anyway
  // (the edits stay in the form until reset), so nobody gets stuck.
  const [unsavedShake, shakeUnsaved] = useUnsavedShake();
  const lastShakeAtRef = useRef(0);
  const blockLeaveForUnsaved = useCallback(() => {
    if (!hasChanges) return false;
    // Phone settings list: the bar isn't on screen there, so don't block.
    if (mobileOnRoot && typeof window !== "undefined" && window.matchMedia?.(SETTINGS_PHONE_QUERY).matches) return false;
    const now = Date.now();
    if (now - lastShakeAtRef.current < 2500) return false;
    lastShakeAtRef.current = now;
    shakeUnsaved();
    return true;
  }, [hasChanges, shakeUnsaved, mobileOnRoot]);
  const requestClose = useCallback(() => {
    if (blockLeaveForUnsaved()) return;
    onOpenChange(false);
  }, [blockLeaveForUnsaved, onOpenChange]);
  const selectTab = useCallback((tab: SettingsTab) => {
    if (tab !== navTab && blockLeaveForUnsaved()) return;
    setActiveTab(tab);
  }, [navTab, blockLeaveForUnsaved]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in the sidebar search clears it before it closes anything.
      const target = e.target as HTMLElement | null;
      if (target?.dataset?.settingsSearch !== undefined && searchQuery) {
        e.preventDefault();
        setSearchQuery("");
        return;
      }
      const action = readSettingsBackAction(mobileOnRoot);
      if (action === "pass") return; // let the nested overlay handle Escape first
      e.preventDefault();
      if (blockLeaveForUnsaved()) return;
      if (action === "root") setMobileOnRoot(true);
      else onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true } as EventListenerOptions);
  }, [open, onOpenChange, mobileOnRoot, searchQuery, blockLeaveForUnsaved]);

  // Android back: without this the press fell through to route navigation and
  // changed the page under the still-open settings overlay.
  useBackHandler(open, () => {
    const action = readSettingsBackAction(mobileOnRoot);
    if (action === "pass") return false;
    if (blockLeaveForUnsaved()) return;
    if (action === "root") setMobileOnRoot(true);
    else onOpenChange(false);
  });

  // Unsaved-changes bar "Reset": back to the saved profile.
  const resetProfileDraft = () => {
    if (profileTab === "main") {
      if (user) {
        setDisplayName(user.displayName || "");
        setBio(user.bio || "");
        setPronouns(user.pronouns || "");
        setTimezone(user.timezone || "");
        setShowTimezone(user.showTimezone ?? false);
        setCustomStatus(user.customStatus || "");
        setStatus(user.status || "online");
        setDisplayNameStyle(user.customization?.displayNameStyle || { font: 'default', effect: 'solid', color: '', gradient: [] });
        setProfileColor(user.customization?.profileColor || "");
        setProfileGradient(user.customization?.profileGradient || []);
        setProfileGradientAngle(user.customization?.profileGradientAngle ?? 135);
        setProfileGradientType(user.customization?.profileGradientType || 'linear');
        setProfileGradientRadialPosition(user.customization?.profileGradientRadialPosition || 'center');
        setProfileCardEffect(user.customization?.profileCardEffect || 'normal');
        setProfileCardBlur(user.customization?.profileCardBlur ?? 8);
        setProfileCardOpacity(user.customization?.profileCardOpacity ?? 0.85);
        setProfileCardBorderColor(user.customization?.profileCardBorderColor || "");
        setProfileCardBorderGlow(user.customization?.profileCardBorderGlow ?? false);
        setProfileCardBorderWidth(user.customization?.profileCardBorderWidth ?? 1);
      }
    } else {
      setServerNickname(initialServerNickname);
      setServerAvatar(initialServerAvatar);
      setServerBanner(initialServerBanner);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (profileTab === "main") {
        const response = await fetch("/api/users/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            bio,
            pronouns,
            timezone: timezone || null,
            showTimezone,
            customStatus,
            // Invisible is "offline" in the UI but stored as "invisible".
            status: toServerStatus(status),
            customization: {
              displayNameStyle,
              profileColor,
              profileGradient,
              profileGradientAngle,
              profileGradientType,
              profileGradientRadialPosition,
              profileCardEffect,
              profileCardBlur,
              profileCardOpacity,
              profileCardBorderColor,
              profileCardBorderGlow,
              profileCardBorderWidth,
              nameplate,
            },
          }),
        });

        if (response.ok) {
          // Update local state immediately
          updateUser({
            displayName,
            bio,
            pronouns,
            timezone: timezone || undefined,
            showTimezone,
            customStatus,
            status: status as "online" | "idle" | "dnd" | "offline",
            customization: {
              ...(user?.customization || {}),
              displayNameStyle,
              profileColor,
              profileGradient,
              profileGradientAngle,
              profileGradientType,
              profileGradientRadialPosition,
              profileCardEffect,
              profileCardBlur,
              profileCardOpacity,
              profileCardBorderColor,
              profileCardBorderGlow,
              profileCardBorderWidth,
              nameplate,
            },
          });
          toast.success(gt("Profile saved!"));
          // Refresh to get full updated data
          await refresh();
        } else {
          toast.error(gt("Failed to save profile"));
        }
      } else {
        // Save server profile
        const response = await fetch(`/api/servers/${selectedServerId}/members/@me`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname: serverNickname || null,
            avatar: serverAvatar || null,
            banner: serverBanner || null,
          }),
        });

        if (response.ok) {
          setInitialServerNickname(serverNickname);
          setInitialServerAvatar(serverAvatar);
          setInitialServerBanner(serverBanner);
          toast.success(gt("Server profile saved!"));
          await refresh();
        } else {
          const data = await response.json();
          toast.error(data.error || gt("Failed to save server profile"));
        }
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(gt("Failed to save profile"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onOpenChange(false);
    toast.success(gt("Logged out"));
  };

  const buildInfo = useMemo(() => {
    const isTauri = typeof window !== "undefined" && !!window.__TAURI__;
    const hostname = typeof window !== "undefined" ? window.location.hostname : "";
    const isCanary = hostname.includes("canary.");
    const isProd = hostname === "serika.chat" || hostname === "www.serika.chat";
    const environment = isCanary ? "canary" : isProd ? "prod" : "dev";

    const lines: { label: string; value: string }[] = [];

    lines.push({ label: "Environment", value: environment });
    if (BUILD_TIME) lines.push({ label: "Built", value: BUILD_TIME.slice(0, 10) });
    lines.push({ label: "Build Override", value: "N/A" });

    if (isTauri) {
      // The desktop shell ships separately from the web app it loads, so its
      // version isn't APP_VERSION.
      lines.push({ label: "Runtime", value: "Tauri 2.x (SerikaCord Desktop)" });
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      if (ua.includes("Windows")) {
        lines.push({ label: "WebView", value: "WebView2 (Edge/Chromium)" });
      } else if (ua.includes("Mac")) {
        lines.push({ label: "WebView", value: "WKWebView (Safari/WebKit)" });
      } else if (ua.includes("Linux")) {
        lines.push({ label: "WebView", value: "WebKitGTK" });
      } else {
        lines.push({ label: "WebView", value: "Tauri WebView" });
      }
    } else {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      let browser = "Web Browser";
      if (ua.includes("Edg/")) browser = "Edge";
      else if (ua.includes("Chrome/")) browser = "Chrome";
      else if (ua.includes("Firefox/")) browser = "Firefox";
      else if (ua.includes("Safari/")) browser = "Safari";
      lines.push({ label: "Runtime", value: `${browser} (Web)` });
      lines.push({ label: "Host", value: hostname || "localhost" });
    }

    return { lines, isCanary, isProd, environment, isTauri };
  }, []);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropperImage(reader.result as string);
      setCropperType("avatar");
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  };

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    // GIFs bypass the cropper to preserve animation
    if (file.type === "image/gif") {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(gt("GIF must be less than 50MB"));
        return;
      }
      handleGifBannerUpload(file);
      if (bannerInputRef.current) {
        bannerInputRef.current.value = "";
      }
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropperImage(reader.result as string);
      setCropperType("banner");
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    if (bannerInputRef.current) {
      bannerInputRef.current.value = "";
    }
  };

  const handleGifBannerUpload = async (file: File) => {
    const isAvatar = false;
    let endpoint = "/api/upload/banner";
    if (profileTab === "server" && selectedServerId) {
      endpoint = `/api/upload/server/${selectedServerId}/member-banner`;
    }

    setIsUploadingBanner(true);
    const formData = new FormData();
    formData.append("file", file, file.name);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (profileTab === "main") {
          updateUser({ banner: data.url });
        } else {
          setServerBanner(data.url);
        }
        toast.success(gt("Banner updated!"));
        void refresh();
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to upload banner"));
      }
    } catch {
      toast.error(gt("Failed to upload banner"));
    } finally {
      setIsUploadingBanner(false);
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    const isAvatar = cropperType === "avatar";
    const setUploading = isAvatar ? setIsUploadingAvatar : setIsUploadingBanner;
    
    let endpoint = isAvatar ? "/api/upload/avatar" : "/api/upload/banner";
    if (profileTab === "server" && selectedServerId) {
      endpoint = isAvatar 
        ? `/api/upload/server/${selectedServerId}/avatar`
        : `/api/upload/server/${selectedServerId}/member-banner`;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", croppedBlob, `${cropperType}.png`);

    // Optimistically show the cropped image immediately from a local object URL
    // so the preview updates instantly instead of waiting on the network round
    // trip + image load. Swapped for the real URL on success, reverted on error.
    const localUrl = URL.createObjectURL(croppedBlob);
    const prevAvatar = user?.avatar;
    const prevBanner = user?.banner;
    const prevServerAvatar = serverAvatar;
    const prevServerBanner = serverBanner;
    if (profileTab === "main") {
      if (isAvatar) updateUser({ avatar: localUrl });
      else updateUser({ banner: localUrl });
    } else {
      if (isAvatar) setServerAvatar(localUrl);
      else setServerBanner(localUrl);
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (profileTab === "main") {
          if (isAvatar) {
            updateUser({ avatar: data.url });
          } else {
            updateUser({ banner: data.url });
          }
        } else {
          if (isAvatar) {
            setServerAvatar(data.url);
          } else {
            setServerBanner(data.url);
          }
        }
        URL.revokeObjectURL(localUrl);
        toast.success(gt("{type} updated!", { type: isAvatar ? gt("Avatar") : gt("Banner") }));
        // Fire-and-forget: the optimistic + confirmed URL already reflects the
        // change, so don't block the UI on a full profile refetch.
        void refresh();
      } else {
        // Revert the optimistic preview on failure.
        URL.revokeObjectURL(localUrl);
        if (profileTab === "main") {
          if (isAvatar) updateUser({ avatar: prevAvatar });
          else updateUser({ banner: prevBanner });
        } else {
          if (isAvatar) setServerAvatar(prevServerAvatar);
          else setServerBanner(prevServerBanner);
        }
        const data = await response.json();
        toast.error(data.error || gt("Failed to upload {type}", { type: cropperType }));
      }
    } catch (error) {
      URL.revokeObjectURL(localUrl);
      if (profileTab === "main") {
        if (isAvatar) updateUser({ avatar: prevAvatar });
        else updateUser({ banner: prevBanner });
      } else {
        if (isAvatar) setServerAvatar(prevServerAvatar);
        else setServerBanner(prevServerBanner);
      }
      toast.error(gt("Failed to upload {type}", { type: cropperType }));
    } finally {
      setUploading(false);
    }
  };

  // Admin handlers
  const searchAdminUsers = async () => {
    if (!adminUserSearch.trim()) return;
    setIsLoadingAdmin(true);
    try {
      const response = await fetch(`/api/admin/users/search?q=${encodeURIComponent(adminUserSearch)}`);
      if (response.ok) {
        const data = await response.json();
        setAdminUsers(data.users);
        setSelectedUser((prev) => {
          if (!prev) return null;
          return data.users.find((u: { id: string }) => u.id === prev.id) || null;
        });
      } else {
        toast.error(gt("Failed to search users"));
      }
    } catch (error) {
      toast.error(gt("Failed to search users"));
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const selectUserDetail = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedUser(data);
      }
    } catch {
      // Keep whatever partial data we already have
    }
  };

  const searchAdminServers = async () => {
    if (!adminServerSearch.trim()) return;
    setIsLoadingAdmin(true);
    try {
      const response = await fetch(`/api/admin/servers/search?q=${encodeURIComponent(adminServerSearch)}`);
      if (response.ok) {
        const data = await response.json();
        setAdminServers(data.servers);
        setSelectedServer((prev) => {
          if (!prev) return null;
          return data.servers.find((s: { id: string }) => s.id === prev.id) || null;
        });
      } else {
        toast.error(gt("Failed to search servers"));
      }
    } catch (error) {
      toast.error(gt("Failed to search servers"));
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const fetchAdminStats = async () => {
    setIsLoadingAdminStats(true);
    try {
      const response = await fetch("/api/admin/stats");
      if (response.ok) {
        const data = await response.json();
        setAdminStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch admin stats:", error);
    } finally {
      setIsLoadingAdminStats(false);
    }
  };

  const safeParseJSON = async (response: Response) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error(response.ok ? `Invalid JSON response: ${text.slice(0, 120)}` : `${response.status} ${response.statusText}`);
    }
  };

  const fetchPlatformSettings = async () => {
    try {
      const response = await fetch("/api/admin/settings");
      const data = await safeParseJSON(response);
      if (response.ok && data) {
        setPlatformSettings(data);
        setAnnouncementText(data.globalAnnouncement || "");
      } else if (!response.ok) {
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : gt("Failed to fetch platform settings");
      console.error("Failed to fetch platform settings:", error);
      toast.error(message);
    }
  };

  const fetchAdminLogs = async (filter?: string, page?: number) => {
    setIsLoadingAdminLogs(true);
    try {
      const pageNum = page || adminLogPage;
      const params = new URLSearchParams();
      if (filter && filter !== "all") params.set("type", filter);
      params.set("page", String(pageNum));
      params.set("limit", "50");
      const url = `/api/admin/logs?${params.toString()}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAdminLogs(data.logs);
        setAdminLogPagination(data.pagination || null);
      }
    } catch (error) {
      console.error("Failed to fetch admin logs:", error);
    } finally {
      setIsLoadingAdminLogs(false);
    }
  };

  const handleBanUser = async (userId: string, reason?: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        toast.success(gt("User banned"));
        searchAdminUsers();
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to ban user"));
      }
    } catch (error) {
      toast.error(gt("Failed to ban user"));
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/unban`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success(gt("User unbanned"));
        searchAdminUsers();
      } else {
        toast.error(gt("Failed to unban user"));
      }
    } catch (error) {
      toast.error(gt("Failed to unban user"));
    }
  };

  const handleUpdatePlatformSettings = async (updates: { maintenanceMode?: boolean; allowRegistration?: boolean; connectionsEnabled?: boolean; disabledProviders?: string[]; oembedWhitelist?: string[]; allowedFileTypes?: { type: string; safe: boolean }[]; warnOnUnknownFileTypes?: boolean }) => {
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await safeParseJSON(response);
      if (response.ok && data) {
        setPlatformSettings(data);
        toast.success(gt("Settings updated"));
      } else {
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : gt("Failed to update settings");
      toast.error(message);
      console.error("Failed to update platform settings:", error);
    }
  };

  const handlePublishAnnouncement = async () => {
    // Strip only leading/trailing blank lines, preserve internal structure
    const cleanedAnnouncement = announcementText
      .split("\n")
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
    if (!cleanedAnnouncement) return;
    try {
      // Banner and direct-message broadcasts are independently delegated.
      if (can("settings.manage")) {
        const settingsResponse = await fetch("/api/admin/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ globalAnnouncement: cleanedAnnouncement }),
        });
        if (!settingsResponse.ok) {
          toast.error(gt("Failed to publish announcement"));
          return;
        }
        const settingsData = await settingsResponse.json().catch(() => null);
        if (settingsData) setPlatformSettings(settingsData);
      }
      if (!can("broadcast.send")) {
        toast.success(gt("Announcement published"));
        return;
      }

      // Also broadcast as DMs from Serika system user
      const broadcastResponse = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cleanedAnnouncement, sendDMs: true }),
      });
      if (broadcastResponse.ok) {
        const broadcastData = await broadcastResponse.json().catch(() => null);
        const dmCount = broadcastData?.dmsSent ?? 0;
        if (dmCount === -1) {
          toast.success(gt("Announcement published — DMs are being sent in the background"));
        } else {
          toast.success(dmCount > 0 ? gt("Announcement published ({count} DMs sent)", { count: dmCount }) : gt("Announcement published"));
        }
      } else {
        toast.error(can("settings.manage") ? gt("Announcement saved but broadcast failed") : gt("Broadcast failed"));
      }
    } catch (error) {
      toast.error(gt("Failed to publish announcement"));
    }
  };

  const handleTogglePartner = async (serverId: string) => {
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/partner`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success(gt("Partner status toggled"));
        searchAdminServers();
      } else {
        toast.error(gt("Failed to toggle partner status"));
      }
    } catch (error) {
      toast.error(gt("Failed to toggle partner status"));
    }
  };

  const handleToggleDiscovery = async (serverId: string) => {
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/discovery`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success(gt("Discovery status toggled"));
        searchAdminServers();
      } else {
        toast.error(gt("Failed to toggle discovery status"));
      }
    } catch (error) {
      toast.error(gt("Failed to toggle discovery status"));
    }
  };

  const handleDeleteServer = async (serverId: string, reason?: string) => {
    if (!(await confirmDialog({ title: gt("Are you sure you want to delete this server? This action cannot be undone."), confirmLabel: gt("Delete") }))) return;
    try {
      const response = await fetch(`/api/admin/servers/${serverId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        toast.success(gt("Server deleted"));
        searchAdminServers();
      } else {
        toast.error(gt("Failed to delete server"));
      }
    } catch (error) {
      toast.error(gt("Failed to delete server"));
    }
  };

  const handleToggleBadge = async (badgeId: string) => {
    if (!selectedUser) return;
    const currentBadges = selectedUser.badges || [];
    const newBadges = currentBadges.includes(badgeId)
      ? currentBadges.filter((b) => b !== badgeId)
      : [...currentBadges, badgeId];

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}/badges`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badges: newBadges }),
      });
      if (response.ok) {
        // The server drops/re-adds automatic badges, so prefer its result.
        const data = await response.json().catch(() => null);
        const updatedBadges: string[] = Array.isArray(data?.badges) ? data.badges : newBadges;
        setSelectedUser({ ...selectedUser, badges: updatedBadges });
        setAdminUsers((prev) =>
          prev.map((u) => (u.id === selectedUser.id ? { ...u, badges: updatedBadges } : u))
        );
        toast.success(gt("Badges updated"));
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to update badges"));
      }
    } catch {
      toast.error(gt("Failed to update badges"));
    }
  };

  const handleTransferOwnership = async () => {
    if (!selectedServer) {
      toast.info(gt("Select a server first"));
      return;
    }

    const newOwnerId = prompt(gt("Enter the new owner user ID"));
    if (!newOwnerId) return;

    const reason = prompt(gt("Reason for transfer (optional)")) || undefined;

    try {
      const response = await fetch(`/api/admin/servers/${selectedServer.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId, reason }),
      });
      if (response.ok) {
        toast.success(gt("Ownership transferred"));
        void searchAdminServers();
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to transfer ownership"));
      }
    } catch {
      toast.error(gt("Failed to transfer ownership"));
    }
  };

  const staffAccess = useStaffAccess(open);
  const { can } = staffAccess;
  const isStaff = staffAccess.permissions.length > 0;
  const canOpenAdminTab = useCallback((tab: string) =>
    (ADMIN_TAB_PERMISSIONS[tab] || []).some(can), [can]);
  const openChangelog = () => {
    onOpenChange(false);
    window.dispatchEvent(new Event("serika:open-changelog"));
  };

  // Load only the staff resources granted to the current account.
  useEffect(() => {
    // Admin-only tab data fetches
    if (isStaff) {
      if (activeTab === "admin-settings" && can("settings.manage") && !platformSettings) {
        fetchPlatformSettings();
        if (can("stats.view")) fetchAdminStats();
      } else if (activeTab === "admin-announcements" && can("settings.manage") && !platformSettings) {
        fetchPlatformSettings();
      } else if (activeTab === "admin-logs" && can("logs.view") && adminLogs.length === 0) {
        fetchAdminLogs();
      } else if (activeTab === "admin-stats" && can("stats.view")) {
        fetchAdminStats();
      }
    }
    // Connections tab — public endpoint, available to all users
    if (activeTab === "connections") {
      fetch("/api/admin/settings/connections")
        .then((r) => r.json())
        .then((d) => {
          if (typeof d.connectionsEnabled === "boolean") setConnectionsEnabled(d.connectionsEnabled);
          if (Array.isArray(d.disabledProviders)) setDisabledProviders(d.disabledProviders);
        })
        .catch(() => {});
    }
  }, [activeTab, isStaff, can]);

  // Settings → Encryption shows once E2EE is on (server flag) or this device has keys.
  const e2eeState = useE2ee();
  const e2eeVisible = e2eeState.enabled || e2eeState.phase === "ready" || e2eeState.phase === "needs-restore";

  // Build the (translated) menu once per locale/staff change instead of on
  // every keystroke — this array runs ~35 gt() lookups, which is a big chunk
  // of the per-render cost while typing in any settings field.
  const menuSections = useMemo(() => {
    const sections = [
      {
        title: gt("User Settings"),
        items: [
          { id: "account" as SettingsTab, label: gt("My Account"), icon: UserCog, keywords: gt("email, username, password, passkeys, delete account") },
          { id: "profiles" as SettingsTab, label: gt("Profiles"), icon: User, keywords: gt("avatar, banner, display name, bio, pronouns, status, nameplate, server profile") },
          { id: "content-social" as SettingsTab, label: gt("Content & Social"), icon: MessageSquare, keywords: gt("direct messages, DMs, message requests, privacy") },
          { id: "friend-requests" as SettingsTab, label: gt("Friend Requests"), icon: UserPlus },
          { id: "activity-privacy" as SettingsTab, label: gt("Activity Privacy"), icon: Activity },
          { id: "data-privacy" as SettingsTab, label: gt("Data & Privacy"), icon: Lock, keywords: gt("analytics, crash reports, activity history, personalization") },
          { id: "account-standing" as SettingsTab, label: gt("Account Standing"), icon: ShieldCheck },
          { id: "authorized-apps" as SettingsTab, label: gt("Authorized Apps"), icon: Plug },
          { id: "devices" as SettingsTab, label: gt("Devices"), icon: Smartphone, keywords: gt("sessions, log out, passkeys, security") },
          ...(e2eeVisible ? [{ id: "encryption" as SettingsTab, label: gt("Encryption"), icon: E2eeKeyIcon }] : []),
          { id: "connections" as SettingsTab, label: gt("Connections"), icon: Link2, keywords: gt("accounts, link, domain, Spotify, Steam, GitHub, Twitch") },
          { id: "bug-reports" as SettingsTab, label: gt("Feedback & Bugs"), icon: MessageSquareHeart },
        ],
      },
      {
        title: gt("Billing Settings"),
        items: [
          { id: "premium" as SettingsTab, label: gt("Serika+"), icon: Crown },
        ],
      },
      {
        title: gt("App Settings"),
        items: [
          { id: "appearance" as SettingsTab, label: gt("Appearance"), icon: Palette, keywords: gt("theme, dark mode, light mode, colors, font, compact, zoom, background") },
          { id: "accessibility" as SettingsTab, label: gt("Accessibility"), icon: Accessibility, keywords: gt("reduced motion, animations, contrast, dyslexic, spacing, saturation") },
          { id: "voice-video" as SettingsTab, label: gt("Voice & Video"), icon: Mic, keywords: gt("microphone, speaker, camera, push to talk, noise suppression, echo, TTS") },
          { id: "text-images" as SettingsTab, label: gt("Text & Images"), icon: Image, keywords: gt("embeds, GIFs, autoplay, emoji, stickers, media") },
          { id: "notifications" as SettingsTab, label: gt("Notifications"), icon: Bell, keywords: gt("sounds, do not disturb, DND, focus, ringtone, desktop notifications, mentions") },
          { id: "keybinds" as SettingsTab, label: gt("Keybinds"), icon: Keyboard, keywords: gt("shortcuts, hotkeys, keyboard") },
          { id: "language" as SettingsTab, label: gt("Language"), icon: Languages, keywords: gt("locale, translation") },
          // Only inside the desktop app (tray, start on login, global keys...).
          ...(isDesktopShell() ? [{ id: "desktop" as SettingsTab, label: gt("Desktop"), icon: Monitor }] : []),
          { id: "streamer-mode" as SettingsTab, label: gt("Streamer Mode"), icon: MonitorSmartphone },
          { id: "advanced" as SettingsTab, label: gt("Advanced"), icon: Settings, keywords: gt("developer mode, copy ID") },
        ],
      },
    ];

    if (isStaff) {
      sections.push({
        title: gt("Admin — Users"),
        items: [
          { id: "admin-users" as SettingsTab, label: gt("User Management"), icon: Users },
          { id: "admin-staff" as SettingsTab, label: gt("Staff Roles"), icon: ShieldCheck },
          { id: "admin-badges" as SettingsTab, label: gt("Badge Management"), icon: Award },
          { id: "admin-trust-safety" as SettingsTab, label: gt("Trust & Safety"), icon: Gavel },
        ],
      });
      sections.push({
        title: gt("Admin — Platform"),
        items: [
          { id: "admin-stats" as SettingsTab, label: gt("Statistics"), icon: BarChart3 },
          { id: "admin-servers" as SettingsTab, label: gt("Server Management"), icon: Database },
          { id: "admin-apps" as SettingsTab, label: gt("Apps & Bots"), icon: Bot },
          { id: "admin-announcements" as SettingsTab, label: gt("Announcements"), icon: Megaphone },
          { id: "admin-changelogs" as SettingsTab, label: gt("Changelog Popups"), icon: FileText },
          { id: "admin-settings" as SettingsTab, label: gt("Platform Settings"), icon: Settings },
        ],
      });
      sections.push({
        title: gt("Admin — System"),
        items: [
          { id: "admin-logs" as SettingsTab, label: gt("Activity Logs"), icon: Activity },
          { id: "admin-experiments" as SettingsTab, label: gt("Experiments"), icon: FlaskConical },
          { id: "admin-tts-sounds" as SettingsTab, label: gt("TTS Sounds"), icon: Volume2 },
          { id: "admin-tts-voices" as SettingsTab, label: gt("TTS Voices"), icon: Mic2 },
          { id: "admin-translations" as SettingsTab, label: gt("Translations"), icon: Languages },
          { id: "admin-bug-reports" as SettingsTab, label: gt("Bug Reports"), icon: ShieldAlert },
        ],
      });
    }
    return sections.map((section) => ({ ...section,
      items: section.items.filter((item) => !item.id.startsWith("admin-") || canOpenAdminTab(item.id)),
    })).filter((section) => section.items.length > 0);
  }, [gt, isStaff, canOpenAdminTab, e2eeVisible]);

  // Filter menu items based on search (labels, keywords, section titles) —
  // only recompute when the query or the (memoized) menu actually changes.
  const filteredSections = useMemo(() => filterSettingsSections(menuSections, searchQuery), [menuSections, searchQuery]);

  // Desktop-only pages are left out of the phone list (no physical keyboard /
  // desktop shell there).
  const mobileSections = useMemo(
    () =>
      filteredSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => item.id !== "keybinds" && item.id !== "desktop"),
        }))
        .filter((section) => section.items.length > 0),
    [filteredSections],
  );
  const activeTabLabel = useMemo(
    () => menuSections.flatMap((section) => section.items).find((item) => item.id === activeTab)?.label ?? gt("Settings"),
    [menuSections, activeTab, gt],
  );
  // ~400 <option>s, built once instead of on every Profiles keystroke.
  const timezoneOptions = useMemo(
    () => allTimeZones().map((tz) => <option key={tz} value={tz}>{tz}</option>),
    [],
  );
  const openProfiles = useCallback(() => selectTab("profiles"), [selectTab]);
  const openDevices = useCallback(() => selectTab("devices"), [selectTab]);

  if (!open) return null;

  // Row pages show this in their header instead of inserting a line into the
  // card on every toggle (which made the rows jump).
  const savingIndicator = (
    <span
      aria-live="polite"
      className={cn(
        "text-xs font-medium text-[var(--text-muted)] transition-opacity duration-(--motion-fast)",
        isSavingSettings ? "opacity-100" : "opacity-0",
      )}
    >
      {gt("Saving")}…
    </span>
  );

  return (
    <div className="theme-backdrop fixed inset-0 z-50 bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="h-full flex flex-col md:flex-row">
        {/* Phone: grouped settings list (root page) */}
        {mobileOnRoot && (
          <MobileSettingsHome
            user={user}
            sections={mobileSections}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelect={openMobileTab}
            onEditProfile={() => openMobileTab("profiles")}
            onLogout={handleLogout}
            onClose={requestClose}
            footer={
              <div className="space-y-1 select-text text-xs text-[var(--text-muted)]">
                <p className="font-medium text-[var(--text-secondary)]">SerikaCord {VERSION_LABEL}</p>
                <button type="button" onClick={openChangelog} className="inline-flex min-h-11 items-center text-[var(--app-accent)]">
                  {gt("What's new")}
                </button>
                {buildInfo.lines.map((line, i) => (
                  <p key={i}>{line.label} {line.value}</p>
                ))}
                <div className="flex gap-4">
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-2">
                    {gt("Terms of Service")}
                  </a>
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-2">
                    {gt("Privacy Policy")}
                  </a>
                </div>
              </div>
            }
          />
        )}

        {/* Phone: pushed page header with back button */}
        {!mobileOnRoot && (
          <MobileSettingsHeader title={activeTabLabel} onBack={() => setMobileOnRoot(true)} />
        )}

        {/* Sidebar */}
        <SettingsNav
          sections={menuSections}
          activeId={navTab}
          onSelect={selectTab}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          ariaLabel={gt("User Settings")}
          header={
            <div className="flex items-center gap-3 rounded-xl px-1.5 py-1">
              <Avatar className="w-10 h-10">
                <AvatarImage src={cdnImage(user?.avatar)} />
                <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                  {user?.displayName?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[var(--text-primary)] truncate text-sm">
                  {user?.displayName || user?.username}
                </h3>
                <button
                  type="button"
                  onClick={() => selectTab("profiles")}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--app-accent)] flex items-center gap-1 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  {gt("Edit Profiles")}
                </button>
              </div>
            </div>
          }
          footer={
            <>
              <div className="h-px bg-[var(--border-subtle)] mx-2.5 mb-2" />

              {/* Logout */}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 h-8 px-2.5 rounded-md text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {gt("Log Out")}
              </button>

              {/* Version / build info */}
              <div className="mt-3 px-2.5 space-y-0.5 select-text">
                <p className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">
                  {BUILD_COMMIT_URL ? (
                    <>
                      SerikaCord v{APP_VERSION}{" "}
                      <a
                        href={BUILD_COMMIT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono hover:text-[var(--text-primary)] hover:underline underline-offset-2"
                      >
                        ({BUILD_SHA})
                      </a>
                    </>
                  ) : (
                    <>SerikaCord {VERSION_LABEL}</>
                  )}
                </p>
                <button
                  type="button"
                  onClick={openChangelog}
                  className="inline-block text-[11px] text-[var(--app-accent)] hover:underline underline-offset-2 pb-0.5"
                >
                  {gt("What's new")}
                </button>
                {buildInfo.lines.map((line, i) => (
                  <p key={i} className="text-[11px] text-[var(--text-muted)] leading-tight">
                    {line.label} {line.value}
                  </p>
                ))}
                <div className="flex gap-2 pt-1">
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline underline-offset-2"
                  >
                    {gt("Terms of Service")}
                  </a>
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline underline-offset-2"
                  >
                    {gt("Privacy Policy")}
                  </a>
                </div>
              </div>
            </>
          }
        />

        {/* Content (on phones: the pushed page, hidden while the list shows) */}
        <SettingsContent
          pageKey={activeTab}
          title={activeTabLabel}
          width={(activeTab.startsWith("admin-") || activeTab === "profiles") ? "wide" : "narrow"}
          onClose={requestClose}
          closeLabel={gt("Close settings")}
          highlightQuery={searchQuery}
          className={cn(
            "max-md:animate-in max-md:fade-in-0 max-md:slide-in-from-right-8 max-md:duration-200",
            mobileOnRoot && "max-md:hidden",
          )}
          // Phone: the back header already names the page, so the tab's own
          // big title is hidden; keep wide rows from scrolling the page sideways.
          innerClassName="max-md:pt-4 max-md:pb-[calc(7rem+var(--safe-area-bottom))] max-md:overflow-x-hidden max-md:[&>div>div>h2.text-xl:first-child]:hidden"
          footer={
            <UnsavedChangesBar
              visible={hasChanges}
              isSaving={isSaving}
              onSave={handleSave}
              onDiscard={resetProfileDraft}
              shakeSignal={unsavedShake}
              className="mt-0 max-w-none"
            />
          }
        >
              {/* My Account */}
              {activeTab === "account" && (
                <MyAccountPage user={user} onEditProfile={openProfiles} onOpenDevices={openDevices} />
              )}

              {/* Profiles: editor on the left, sticky live preview on the right */}
              {activeTab === "profiles" && (
                <div className="space-y-6">
                  <SettingsPageHeader title={gt("Profiles")} description={gt("Customize how others see you across SerikaCord")} />

                  <SettingsSubTabs
                    ariaLabel={gt("Profiles")}
                    value={profileTab}
                    onChange={(tab) => {
                      if (tab === profileTab) return;
                      if (!hasChanges) setProfileTab(tab);
                      else toast.error(gt("Please save or reset your changes first."));
                    }}
                    tabs={[
                      { id: "main", label: gt("Main Profile") },
                      { id: "server", label: gt("Per-server Profiles") },
                    ]}
                  />

                  <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div key={profileTab} className="settings-page-enter min-w-0 space-y-8">
                      {profileTab === "main" ? (
                        <>
                          <SettingsSection title={gt("Avatar & Banner")}>
                            <div className={FORM_CARD}>
                              <div className="flex items-start gap-4 max-sm:flex-col">
                                <div className="flex flex-col items-center gap-2">
                                  <MediaPickTile
                                    shape="avatar"
                                    src={user?.avatar}
                                    alt={gt("Avatar")}
                                    uploading={isUploadingAvatar}
                                    onPick={() => avatarInputRef.current?.click()}
                                  />
                                  <SettingsButton size="sm" onClick={() => avatarInputRef.current?.click()}>{gt("Change Avatar")}</SettingsButton>
                                </div>
                                <div className="flex min-w-0 flex-1 flex-col gap-2 max-sm:w-full">
                                  <MediaPickTile
                                    shape="banner"
                                    src={user?.banner}
                                    alt={gt("Banner")}
                                    uploading={isUploadingBanner}
                                    onPick={() => bannerInputRef.current?.click()}
                                  />
                                  <div>
                                    <SettingsButton variant="secondary" size="sm" onClick={() => bannerInputRef.current?.click()}>{gt("Change Banner")}</SettingsButton>
                                  </div>
                                </div>
                              </div>
                              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerSelect} />
                            </div>
                          </SettingsSection>

                          <SettingsSection title={gt("Basic Info")}>
                            <div className={FORM_CARD}>
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                  <span className={FIELD_LABEL} data-settings-label={gt("Display Name")}>{gt("Display Name")}</span>
                                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={FIELD_INPUT} />
                                </label>
                                <label className="block">
                                  <span className={FIELD_LABEL}>{gt("Pronouns")}</span>
                                  <Input value={pronouns} onChange={(e) => setPronouns(e.target.value)} className={FIELD_INPUT} placeholder={gt("Add your pronouns")} />
                                </label>
                              </div>
                              <label className="block">
                                <span className={FIELD_LABEL}>{gt("Timezone")}</span>
                                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={SELECT_CLASS}>
                                  <option value="">{gt("Select your timezone")}</option>
                                  {timezoneOptions}
                                </select>
                              </label>
                              <label className="flex cursor-pointer items-center justify-between gap-4">
                                <span className="text-sm text-[var(--text-primary)]">{gt("Display my current time on my profile")}</span>
                                <ToggleSwitch size="sm" checked={showTimezone} onCheckedChange={setShowTimezone} aria-label={gt("Display my current time on my profile")} />
                              </label>
                            </div>
                          </SettingsSection>

                          <SettingsSection title={gt("About & Status")}>
                            <div className={FORM_CARD}>
                              <label className="block">
                                <span className={FIELD_LABEL}>{gt("About Me")}</span>
                                <Textarea
                                  value={bio}
                                  onChange={(e) => setBio(e.target.value)}
                                  className="min-h-[100px] resize-y border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                                  maxLength={1000}
                                />
                                <span className="mt-1 block text-right text-xs tabular-nums text-[var(--text-muted)]">{bio.length}/1000</span>
                              </label>
                              <label className="block">
                                <span className={FIELD_LABEL}>{gt("Custom Status")}</span>
                                <Input
                                  value={customStatus}
                                  onChange={(e) => setCustomStatus(e.target.value)}
                                  className={FIELD_INPUT}
                                  placeholder={gt("What's on your mind?")}
                                  maxLength={128}
                                />
                              </label>
                            </div>
                          </SettingsSection>

                          <SettingsSection title={gt("Display Name Style")}>
                            <div className={FORM_CARD}>
                              <DisplayNameStyleEditor value={displayNameStyle} onChange={setDisplayNameStyle} />
                            </div>
                          </SettingsSection>

                          {/* Server tag (CORD-53) */}
                          <ServerTagPicker />

                          <SettingsSection
                            title={gt("Nameplate")}
                            description={gt("A decorative plate shown behind your name in the member list, DMs, and your sidebar panel.")}
                          >
                            <div className={FORM_CARD}>
                              <NameplateEditor
                                nameplate={nameplate}
                                onChange={setNameplate}
                                displayName={displayName || user?.username || ""}
                                displayNameStyle={displayNameStyle}
                                avatar={user?.avatar}
                              />
                            </div>
                          </SettingsSection>

                          <SettingsSection title={gt("Profile Colour")}>
                            <div className={FORM_CARD}>
                              <ProfileColourEditor
                                profileColor={profileColor}
                                setProfileColor={setProfileColor}
                                profileGradient={profileGradient}
                                setProfileGradient={setProfileGradient}
                              />
                            </div>
                          </SettingsSection>

                          {/* Profile widgets from other Serika apps (saved instantly) */}
                          <SerikaWishlistSettingsCard />
                        </>
                      ) : (
                        <>
                          <SettingsSection
                            title={gt("Select Server")}
                            action={hasChanges ? (
                              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{gt("Save changes before switching servers")}</span>
                            ) : undefined}
                          >
                            <select
                              value={selectedServerId}
                              onChange={(e) => setSelectedServerId(e.target.value)}
                              disabled={hasChanges}
                              aria-label={gt("Select Server")}
                              className={cn(SELECT_CLASS, "font-medium disabled:cursor-not-allowed disabled:opacity-50")}
                            >
                              {servers.map((srv) => (
                                <option key={srv.id} value={srv.id}>{srv.name}</option>
                              ))}
                            </select>
                          </SettingsSection>

                          {serverMemberLoading ? (
                            <SettingsSkeleton variant="rows" count={3} />
                          ) : (
                            <>
                              <SettingsSection title={gt("Server Identity")}>
                                <div className={FORM_CARD}>
                                  <label className="block">
                                    <span className={FIELD_LABEL}>{gt("Server Nickname")}</span>
                                    <Input
                                      value={serverNickname}
                                      onChange={(e) => setServerNickname(e.target.value)}
                                      className={FIELD_INPUT}
                                      placeholder={displayName || user?.username || ""}
                                      maxLength={32}
                                    />
                                  </label>
                                  <div>
                                    <span className={FIELD_LABEL}>{gt("Server Avatar Override")}</span>
                                    <div className="flex items-center gap-4">
                                      <MediaPickTile
                                        shape="avatar"
                                        src={serverAvatar || user?.avatar}
                                        alt={gt("Avatar")}
                                        uploading={isUploadingAvatar}
                                        onPick={() => avatarInputRef.current?.click()}
                                      />
                                      <SettingsButton size="sm" onClick={() => avatarInputRef.current?.click()}>{gt("Change Avatar")}</SettingsButton>
                                      {serverAvatar && (
                                        <SettingsButton variant="ghost" size="sm" onClick={() => setServerAvatar(null)} className="text-red-500 hover:text-red-500">
                                          {gt("Reset to Global")}
                                        </SettingsButton>
                                      )}
                                    </div>
                                    <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                                  </div>
                                </div>
                              </SettingsSection>

                              <SettingsSection title={gt("Server Banner Override")}>
                                <div className={FORM_CARD}>
                                  <MediaPickTile
                                    shape="banner"
                                    src={serverBanner || user?.banner}
                                    alt={gt("Banner")}
                                    uploading={isUploadingBanner}
                                    onPick={() => bannerInputRef.current?.click()}
                                  />
                                  <div className="flex flex-wrap gap-2">
                                    <SettingsButton variant="secondary" size="sm" onClick={() => bannerInputRef.current?.click()}>{gt("Change Banner")}</SettingsButton>
                                    {serverBanner && (
                                      <SettingsButton variant="ghost" size="sm" onClick={() => setServerBanner(null)} className="text-red-500 hover:text-red-500">
                                        {gt("Reset to Global")}
                                      </SettingsButton>
                                    )}
                                  </div>
                                  <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerSelect} />
                                </div>
                              </SettingsSection>

                              <div className="space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                                <p className="font-semibold text-[var(--text-primary)]">{gt("About Server Profiles")}</p>
                                <p>{gt("Custom nickname, avatar overrides, and banners apply only to the selected server.")}</p>
                                <p>{gt("Global attributes (about me, custom status, and name styles) will fall back to your main profile settings.")}</p>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Live preview */}
                    <aside className="min-w-0 self-start lg:sticky lg:top-20">
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{gt("Preview")}</p>
                      <ProfileCard user={previewUser} isCurrentUser={true} />
                    </aside>
                  </div>
                </div>
              )}

              {/* Serika+ */}
              {activeTab === "premium" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Serika+")} />
                  {user?.isPremium ? (
                    <>
                      <div className="flex items-center gap-4 rounded-xl border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_12%,var(--bg-app))] p-5">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-accent)] text-white">
                          <Crown className="h-7 w-7" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-lg font-bold text-[var(--text-primary)]">{gt("You have Serika+!")}</h3>
                          <p className="text-sm text-[var(--text-secondary)]">
                            {gt("Member since")}{" "}
                            {user.premiumSince ? new Date(user.premiumSince).toLocaleDateString(locale) : gt("Unknown")}
                          </p>
                        </div>
                      </div>
                      <SettingsSection title={gt("Your perks")}>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {[gt("Custom profile themes"), gt("Animated avatars"), gt("Extended file uploads"), gt("Exclusive badge")].map((perk) => (
                            <div key={perk} className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3">
                              <Check className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{perk}</span>
                            </div>
                          ))}
                        </div>
                      </SettingsSection>
                    </>
                  ) : (
                    <div className="flex flex-col items-center rounded-xl border border-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,var(--bg-app))] px-6 py-10 text-center">
                      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--app-accent)] text-white">
                        <Crown className="h-8 w-8" />
                      </span>
                      <h3 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">{gt("Upgrade to Serika+")}</h3>
                      <p className="mx-auto mb-6 max-w-md text-sm text-[var(--text-secondary)]">
                        {gt("Get exclusive features like animated avatars, custom themes, enhanced upload limits, and more.")}
                      </p>
                      <a
                        href="https://accounts.serika.dev"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={settingsButtonClass("primary", "md")}
                      >
                        {gt("Subscribe to Serika+")}
                        <ExternalLink aria-hidden />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "appearance" && (
                <AppearancePage
                  userSettings={userSettings}
                  themeSettings={themeSettings}
                  profileBanner={user?.banner}
                  saveAppearancePatch={stableSaveAppearancePatch}
                />
              )}

              {activeTab === "voice-video" && (
                <VoiceVideoPage
                  userSettings={userSettings}
                  saveSettingsPatch={stableSaveSettingsPatch}
                  saveSettingsPatchDebounced={stableSaveSettingsPatchDebounced}
                />
              )}

              {activeTab === "notifications" && (
                <NotificationsPage
                  userSettings={userSettings}
                  saveSettingsPatch={stableSaveSettingsPatch}
                  saveSettingsPatchDebounced={stableSaveSettingsPatchDebounced}
                />
              )}

              {activeTab === "connections" && streamerHidesPersonal && (
                <div className="space-y-6">
                  <SettingsPageHeader title={gt("Connections")} />
                  <SettingsEmptyState icon={MonitorSmartphone} title={gt("Your connections are hidden while Streamer Mode is on.")} />
                </div>
              )}
              {activeTab === "connections" && !streamerHidesPersonal && (
                <ConnectionsPage
                  userConnections={userConnections}
                  setUserConnections={setUserConnections}
                  connectionsEnabled={connectionsEnabled}
                  disabledProviders={disabledProviders}
                  loaded={userSettings !== null}
                />
              )}

              {activeTab === "authorized-apps" && (
                <AuthorizedAppsPage apps={authorizedApps} setApps={setAuthorizedApps} loaded={userSettings !== null} />
              )}

              {activeTab === "devices" && (
                <DevicesPage devices={deviceSessions} setDevices={setDeviceSessions} loaded={userSettings !== null} />
              )}

              {activeTab === "encryption" && (
                <div className="space-y-6">
                  <SettingsPageHeader title={gt("Encryption")} />
                  <E2eeSettingsPanel />
                </div>
              )}

              {/* Social & privacy: toggle-row pages */}
              {activeTab === "content-social" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Content & Social")} description={gt("Control who can reach you and what others see.")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={4} />
                  ) : (
                    <SettingsSection title={gt("Social Permissions")}>
                      <SettingsCard>
                        <SettingsToggleRow
                          label={gt("Allow DMs from non-friends")}
                          description={gt("When off, only friends can start a new direct message with you.")}
                          checked={userSettings.privacy?.directMessages === "everyone" && userSettings.friendRequests?.allowServerMembers !== false}
                          onCheckedChange={(checked) => saveSettingsPatch({ privacy: { directMessages: checked ? "everyone" : "friends" }, friendRequests: { allowServerMembers: checked } }, "content-social")}
                        />
                        <MessageRequestSettings settings={userSettings} save={(patch) => saveSettingsPatch(patch, "content-social")} />
                        <SettingsToggleRow
                          label={gt("Allow friend requests")}
                          description={gt("When off, nobody can send you a friend request.")}
                          checked={userSettings.privacy?.friendRequests !== "none" && userSettings.friendRequests?.allowEveryone !== false}
                          onCheckedChange={(checked) => saveSettingsPatch({ privacy: { friendRequests: checked ? "everyone" : "none", friendRequestSources: { everyone: checked, friendsOfFriends: checked, serverMembers: checked } }, friendRequests: { allowEveryone: checked } }, "content-social")}
                        />
                        <SettingsToggleRow
                          label={gt("Share activity status")}
                          description={gt("Show what you're playing or watching to others.")}
                          checked={userSettings.privacy?.showActivity !== false}
                          onCheckedChange={(checked) => saveSettingsPatch({ privacy: { showActivity: checked } }, "content-social")}
                        />
                      </SettingsCard>
                    </SettingsSection>
                  )}
                </div>
              )}

              {activeTab === "friend-requests" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Friend Requests")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={3} />
                  ) : (
                    <SettingsCard>
                      <FriendRequestSettings settings={userSettings} save={(patch) => saveSettingsPatch(patch, "friend-requests")} />
                    </SettingsCard>
                  )}
                </div>
              )}

              {activeTab === "activity-privacy" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Activity Privacy")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={2} />
                  ) : (
                    <SettingsCard>
                      <ActivityPrivacySettings settings={userSettings} save={(patch) => saveSettingsPatch(patch, "activity-privacy")} />
                    </SettingsCard>
                  )}
                </div>
              )}

              {activeTab === "data-privacy" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Data & Privacy")} description={gt("Decide how your data is used.")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={5} />
                  ) : (
                    <>
                      <SettingsSection title={gt("Discord Bridge")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Allow data processing by Discord")}
                            description={gt("Required for your messages to sync to bridged Discord servers. When off, your messages are never sent to Discord and your data is not shared with it.")}
                            checked={Boolean(userSettings.dataPrivacy?.discordBridgeOutbound)}
                            onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), discordBridgeOutbound: checked, discordBridgePrompted: true } }, "data-privacy")}
                          />
                        </SettingsCard>
                      </SettingsSection>
                      <SettingsSection title={gt("How we use your data")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Allow data personalization")}
                            checked={Boolean(userSettings.dataPrivacy?.allowPersonalization)}
                            onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), allowPersonalization: checked } }, "data-privacy")}
                          />
                          <SettingsToggleRow
                            label={gt("Allow crash reports")}
                            checked={Boolean(userSettings.dataPrivacy?.allowCrashReports)}
                            onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), allowCrashReports: checked } }, "data-privacy")}
                          />
                          <SettingsToggleRow
                            label={gt("Allow analytics")}
                            checked={Boolean(userSettings.dataPrivacy?.allowAnalytics)}
                            onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), allowAnalytics: checked } }, "data-privacy")}
                          />
                          <SettingsToggleRow
                            label={gt("Store recent activity")}
                            description={gt("Keep a private history of games and apps the desktop app detects. Turn off to stop recording.")}
                            checked={userSettings.privacy?.storeActivityHistory ?? true}
                            onCheckedChange={(checked) => saveSettingsPatch({ privacy: { ...(userSettings.privacy || {}), storeActivityHistory: checked } }, "data-privacy")}
                          >
                            <SettingsButton
                              variant="secondary"
                              size="sm"
                              onClick={async () => {
                                try {
                                  await fetch("/api/users/me/activity-history", { method: "DELETE", credentials: "include" });
                                } catch { /* ignore */ }
                              }}
                            >
                              {gt("Clear activity history")}
                            </SettingsButton>
                          </SettingsToggleRow>
                        </SettingsCard>
                      </SettingsSection>
                    </>
                  )}
                </div>
              )}

              {activeTab === "accessibility" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Accessibility")} description={gt("Make SerikaCord easier to see, read and use.")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={4} />
                  ) : (
                    <>
                      <SettingsSection title={gt("Motion & Contrast")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Reduced motion")}
                            description={gt("Minimise animations and transitions")}
                            checked={Boolean(userSettings.accessibility?.reducedMotion)}
                            onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), reducedMotion: checked } }, "accessibility")}
                          />
                          <SettingsToggleRow
                            label={gt("High contrast")}
                            description={gt("Increase text and border contrast for readability")}
                            checked={Boolean(userSettings.accessibility?.highContrast)}
                            onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), highContrast: checked } }, "accessibility")}
                          />
                        </SettingsCard>
                      </SettingsSection>
                      <SettingsSection title={gt("Text")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Dyslexic font")}
                            description={gt("Use a dyslexia-friendly font in chat")}
                            checked={Boolean(userSettings.accessibility?.dyslexicFont)}
                            onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), dyslexicFont: checked } }, "accessibility")}
                          />
                          <SettingsRow
                            label={gt("Message spacing")}
                            control={
                              <div role="group" aria-label={gt("Message spacing")} className="flex gap-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5">
                                {(["cozy", "compact"] as const).map((spacing) => {
                                  const selected = spacing === "compact"
                                    ? userSettings.accessibility?.messageSpacing === "compact"
                                    : userSettings.accessibility?.messageSpacing !== "compact";
                                  return (
                                    <button
                                      key={spacing}
                                      type="button"
                                      aria-pressed={selected}
                                      onClick={() => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), messageSpacing: spacing } }, "accessibility")}
                                      className={cn(
                                        "h-7 rounded-md px-3 text-xs font-semibold transition-colors duration-(--motion-fast)",
                                        selected
                                          ? "bg-[var(--app-accent)] text-white shadow-sm"
                                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                                      )}
                                    >
                                      {spacing === "compact" ? gt("Compact") : gt("Cozy")}
                                    </button>
                                  );
                                })}
                              </div>
                            }
                          />
                        </SettingsCard>
                      </SettingsSection>
                    </>
                  )}
                </div>
              )}

              {activeTab === "text-images" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Text & Images")} description={gt("How media, embeds and emoji show up in chat.")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={5} />
                  ) : (
                    <>
                      <SettingsSection title={gt("Images, Videos and Embeds")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Inline media")}
                            description={gt("Display images and videos inline in chat")}
                            checked={Boolean(userSettings.textImages?.inlineMedia)}
                            onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), inlineMedia: checked } }, "text-images")}
                          />
                          <SettingsToggleRow
                            label={gt("Inline embeds")}
                            description={gt("Show rich link previews and embeds")}
                            checked={Boolean(userSettings.textImages?.inlineEmbeds)}
                            onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), inlineEmbeds: checked } }, "text-images")}
                          />
                          {/* The only switch for this: Appearance used to have a second "Animated Emojis" toggle for the same setting (CORD-39). */}
                          <SettingsToggleRow
                            label={gt("Autoplay GIFs and animated emoji")}
                            description={gt("Play animated GIFs and emoji automatically")}
                            checked={Boolean(userSettings.textImages?.gifAutoplay)}
                            onCheckedChange={(checked) => {
                              updateSettings({ animatedEmojis: checked });
                              void saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), gifAutoplay: checked } }, "text-images");
                            }}
                          />
                        </SettingsCard>
                      </SettingsSection>
                      <SettingsSection title={gt("Emoji & Stickers")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Emoji picker")}
                            description={gt("Show the emoji picker button in the message bar")}
                            checked={Boolean(userSettings.textImages?.emojiPicker)}
                            onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), emojiPicker: checked } }, "text-images")}
                          />
                          <SettingsToggleRow
                            label={gt("Sticker suggestions")}
                            description={gt("Show sticker suggestions while typing")}
                            checked={Boolean(userSettings.textImages?.stickerSuggestions)}
                            onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), stickerSuggestions: checked } }, "text-images")}
                          />
                        </SettingsCard>
                      </SettingsSection>
                    </>
                  )}
                </div>
              )}

              {activeTab === "keybinds" && (
                <div className="space-y-6">
                  <SettingsPageHeader title={gt("Keybinds")} description={gt("Keyboard shortcuts for moving around and talking. Changes save automatically.")} />
                  <KeybindSettingsPanel />
                </div>
              )}

              {activeTab === "desktop" && (
                <div className="space-y-6">
                  <SettingsPageHeader title={gt("Desktop")} description={gt("Settings for the SerikaCord desktop app on this computer.")} />
                  <DesktopSettingsPanel />
                </div>
              )}

              {activeTab === "language" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Language")} description={gt("Choose the language SerikaCord uses.")} />
                  <SettingsSection title={gt("Select a language")}>
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
                      <LocaleSelector />
                    </div>
                  </SettingsSection>
                </div>
              )}

              {activeTab === "streamer-mode" && (
                <div className="space-y-6">
                  <SettingsPageHeader title={gt("Streamer Mode")} />
                  <StreamerModeSettings />
                </div>
              )}

              {activeTab === "advanced" && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Advanced")} actions={savingIndicator} />
                  {!userSettings ? (
                    <SettingsSkeleton variant="rows" count={2} />
                  ) : (
                    <>
                      <SettingsCard>
                        <SettingsToggleRow
                          label={gt("Developer Mode")}
                          description={gt("Enables extra technical information, such as copying IDs from context menus.")}
                          checked={Boolean(userSettings.advanced?.developerMode)}
                          onCheckedChange={(checked) => saveSettingsPatch({ advanced: { ...(userSettings.advanced || {}), developerMode: checked } }, "advanced")}
                        />
                      </SettingsCard>
                      <SettingsSection title={gt("Developer Tools")}>
                        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
                          <SettingsButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const token = localStorage.getItem("serika-token") || localStorage.getItem("auth-token") || "";
                              if (token) {
                                navigator.clipboard?.writeText(token);
                                toast.success(gt("Session token copied to clipboard"));
                              } else {
                                toast.error(gt("No session token found"));
                              }
                            }}
                          >
                            <Activity />
                            {gt("Copy Session Token")}
                          </SettingsButton>
                          <SettingsButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const keys = Object.keys(localStorage).filter((k) => k.startsWith("serika") || k.startsWith("sc:"));
                              keys.forEach((k) => localStorage.removeItem(k));
                              toast.success(gt("Cleared {count} cache entries", { count: keys.length }));
                              setTimeout(() => window.location.reload(), 500);
                            }}
                          >
                            <RefreshCw />
                            {gt("Clear App Cache")}
                          </SettingsButton>
                          <SettingsButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const info = {
                                userAgent: navigator.userAgent,
                                platform: navigator.platform,
                                language: navigator.language,
                                screenResolution: `${screen.width}x${screen.height}`,
                                windowSize: `${window.innerWidth}x${window.innerHeight}`,
                                isTauri: Boolean(window.__TAURI__),
                                localStorage: Object.keys(localStorage).length,
                                timestamp: new Date().toISOString(),
                              };
                              navigator.clipboard?.writeText(JSON.stringify(info, null, 2));
                              toast.success(gt("Debug info copied to clipboard"));
                            }}
                          >
                            <Database />
                            {gt("Copy Debug Info")}
                          </SettingsButton>
                          <SettingsButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (typeof window !== "undefined" && window.__TAURI__) {
                                toast.info(gt("Tauri devtools available via F12 or Ctrl+Shift+I"));
                              } else {
                                toast.info(gt("Browser devtools: F12 or Ctrl+Shift+I"));
                              }
                            }}
                          >
                            <Zap />
                            {gt("Open DevTools")}
                          </SettingsButton>
                        </div>
                      </SettingsSection>
                    </>
                  )}
                </div>
              )}

              {/* Account Standing - strikes, restrictions, appeals */}
              <MountWhenOpened open={activeTab === "account-standing"}>
                {activeTab === "account-standing" && (
                  <div className="space-y-6">
                    <SettingsPageHeader title={gt("Account Standing")} />
                    <AccountStanding key={user?.id} />
                  </div>
                )}
              </MountWhenOpened>

              {/* Feedback & bugs */}
              {activeTab === "bug-reports" && <BugReportPanel />}

              <MountWhenOpened open={activeTab === "admin-staff" && can("staff.manage")}>
                {activeTab === "admin-staff" && can("staff.manage") && <AdminStaffPanel key={user?.id} access={staffAccess} />}
              </MountWhenOpened>
              <MountWhenOpened open={activeTab === "admin-changelogs" && canOpenAdminTab(activeTab)}>
                {activeTab === "admin-changelogs" && canOpenAdminTab(activeTab) && <AdminChangelogsPanel key={user?.id} canManage={can("changelog.manage")} canPublish={can("changelog.publish")} />}
              </MountWhenOpened>
              {activeTab.startsWith("admin-") && !canOpenAdminTab(activeTab) && (
                <SettingsEmptyState icon={Lock} title={gt("You do not have access to this staff tool.")} />
              )}

              {/* Admin — User Management */}
              {activeTab === "admin-users" && canOpenAdminTab(activeTab) && (
                <div className="space-y-4">
                  <SettingsPageHeader
                    title={gt("User Management")}
                    description={gt("Search for users to view their profile, edit badges, or take moderation actions.")}
                  />
                  <SettingsToolbar>
                    <SettingsSearchInput
                      value={adminUserSearch}
                      onValueChange={setAdminUserSearch}
                      onKeyDown={(e) => e.key === "Enter" && searchAdminUsers()}
                      placeholder={gt("Search users by email or username...")}
                      clearLabel={gt("Clear")}
                      className="flex-1"
                    />
                    <SettingsButton onClick={searchAdminUsers} disabled={isLoadingAdmin}>
                      {isLoadingAdmin ? <RefreshCw className="animate-spin" /> : <Search />}
                      {gt("Search")}
                    </SettingsButton>
                  </SettingsToolbar>

                  {adminUsers.length > 0 ? (
                    <div className="flex h-[600px] gap-4 max-md:h-auto max-md:flex-col">
                      {/* Results */}
                      <div className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] max-md:h-[320px] max-md:w-full">
                        <p className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                          {gt("Results ({count})", { count: adminUsers.length })}
                        </p>
                        <ScrollArea className="min-h-0 flex-1">
                          <div className="divide-y divide-[var(--border-subtle)]">
                            {adminUsers.map((u) => (
                              <SettingsListItem
                                key={u.id}
                                selected={selectedUser?.id === u.id}
                                onClick={() => {
                                  setSelectedUser(u);
                                  void selectUserDetail(u.id);
                                }}
                                leading={
                                  <Avatar className="h-9 w-9">
                                    <AvatarImage src={cdnImage(u.avatar)} />
                                    <AvatarFallback className="bg-[var(--app-accent)] text-xs text-white">
                                      {u.displayName?.charAt(0) || u.username.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                }
                                title={u.displayName || u.username}
                                subtitle={`@${u.username}`}
                                actions={
                                  u.isBanned || u.isStaff ? (
                                    <div className="flex flex-col items-end gap-1">
                                      {u.isBanned && <SettingsStatusPill tone="danger">{gt("Banned")}</SettingsStatusPill>}
                                      {u.isStaff && <SettingsStatusPill tone="accent">{gt("Staff")}</SettingsStatusPill>}
                                    </div>
                                  ) : undefined
                                }
                              />
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      {/* Detail */}
                      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
                        {selectedUser ? (
                          <ScrollArea className="min-h-0 flex-1">
                            <div className="space-y-6 p-5">
                              <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] pb-4">
                                <Avatar className="h-12 w-12">
                                  <AvatarImage src={cdnImage(selectedUser.avatar)} />
                                  <AvatarFallback className="bg-[var(--app-accent)] text-white">
                                    {selectedUser.displayName?.charAt(0) || selectedUser.username.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-[var(--text-primary)]">{selectedUser.displayName || selectedUser.username}</p>
                                  <p className="truncate text-sm text-[var(--text-muted)]">@{selectedUser.username} • {selectedUser.email}</p>
                                </div>
                              </div>

                              {selectedUser.stats && (
                                <div className="grid grid-cols-2 gap-2">
                                  <SettingsStatCard label={gt("Servers")} value={selectedUser.stats.servers} />
                                  <SettingsStatCard label={gt("Messages")} value={selectedUser.stats.messages} />
                                </div>
                              )}

                              <SettingsSection title={gt("Account")}>
                                <SettingsCard>
                                  <SettingsRow
                                    label={gt("Verified")}
                                    control={<SettingsStatusPill tone={selectedUser.isVerified ? "success" : "neutral"}>{selectedUser.isVerified ? gt("Yes") : gt("No")}</SettingsStatusPill>}
                                  />
                                  <SettingsRow
                                    label={gt("Staff")}
                                    control={<SettingsStatusPill tone={selectedUser.isStaff ? "accent" : "neutral"}>{selectedUser.isStaff ? selectedUser.staffRole || gt("Yes") : gt("No")}</SettingsStatusPill>}
                                  />
                                  <SettingsRow
                                    label={gt("Premium")}
                                    control={<SettingsStatusPill tone={selectedUser.isPremium ? "accent" : "neutral"}>{selectedUser.isPremium ? gt("Yes") : gt("No")}</SettingsStatusPill>}
                                  />
                                  {selectedUser.createdAt && (
                                    <SettingsRow
                                      label={gt("Joined")}
                                      control={<span className="text-sm text-[var(--text-primary)]">{new Date(selectedUser.createdAt).toLocaleDateString(locale)}</span>}
                                    />
                                  )}
                                </SettingsCard>
                              </SettingsSection>

                              <SettingsSection title={gt("Moderation")}>
                                <SettingsCard>
                                  <SettingsToggleRow
                                    label={gt("Banned")}
                                    description={gt("Prevent user from accessing the platform")}
                                    checked={selectedUser.isBanned}
                                    disabled={!can("users.moderate") || selectedUser.isStaff}
                                    onCheckedChange={() => {
                                      if (selectedUser.isBanned) void handleUnbanUser(selectedUser.id);
                                      else void handleBanUser(selectedUser.id, "Administrative action");
                                    }}
                                  />
                                </SettingsCard>
                              </SettingsSection>

                              <SettingsSection title={gt("Badges ({count})", { count: (selectedUser.badges || []).length })}>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {badgeDefinitions.map((badge) => {
                                    const isAssigned = (selectedUser.badges || []).includes(badge.id);
                                    const labels = badgeLabel(badge, gt);
                                    return (
                                      <button
                                        key={badge.id}
                                        type="button"
                                        aria-pressed={isAssigned}
                                        disabled={!can("badges.manage") || (!staffAccess.isSuperAdmin && ["staff", "admin", "moderator", "serikacord_developer"].includes(badge.id))}
                                        onClick={() => void handleToggleBadge(badge.id)}
                                        className={cn(
                                          "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors duration-(--motion-fast) disabled:cursor-not-allowed",
                                          isAssigned
                                            ? "border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]"
                                            : "border-[var(--border-subtle)] opacity-60 hover:bg-[var(--bg-hover)] hover:opacity-100",
                                        )}
                                      >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${badge.color}20` }}>
                                          <BadgeIcon badge={badge} className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{labels.name}</span>
                                          <span className="block truncate text-xs text-[var(--text-muted)]">{labels.description}</span>
                                        </span>
                                        <span
                                          aria-hidden
                                          className={cn(
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                                            isAssigned ? "border-[var(--app-accent)] bg-[var(--app-accent)]" : "border-[var(--text-muted)]",
                                          )}
                                        >
                                          {isAssigned && <Check className="h-2.5 w-2.5 text-white" />}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </SettingsSection>

                              <SettingsSection title={gt("Actions")}>
                                <SettingsCard>
                                  <SettingsRow
                                    label={gt("View Reports")}
                                    description={gt("Open filtered admin logs")}
                                    control={
                                      <SettingsButton
                                        variant="secondary"
                                        size="sm"
                                        disabled={!can("logs.view")}
                                        onClick={() => {
                                          if (!can("logs.view")) return;
                                          setActiveTab("admin-logs");
                                          setAdminLogFilter("reports");
                                          void fetchAdminLogs("reports");
                                        }}
                                      >
                                        {gt("Open")}
                                      </SettingsButton>
                                    }
                                  />
                                  <SettingsRow
                                    label={gt("Open DM")}
                                    description={gt("Jump to direct message")}
                                    control={
                                      <SettingsButton variant="secondary" size="sm" onClick={() => { window.location.href = `/dm/${selectedUser.id}`; }}>
                                        {gt("Open")}
                                      </SettingsButton>
                                    }
                                  />
                                </SettingsCard>
                              </SettingsSection>
                            </div>
                          </ScrollArea>
                        ) : (
                          <div className="flex h-full items-center justify-center p-8">
                            <SettingsEmptyState icon={Users} title={gt("Select a user from the list to view details and manage badges")} className="border-none" />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : isLoadingAdmin ? (
                    <SettingsSkeleton variant="list" count={5} />
                  ) : (
                    <SettingsEmptyState icon={Users} title={gt("Search for users to view their profile, edit badges, or take moderation actions.")} />
                  )}
                </div>
              )}

              {/* Admin — Server Management */}
              {activeTab === "admin-servers" && canOpenAdminTab(activeTab) && (
                <div className="space-y-4">
                  <SettingsPageHeader
                    title={gt("Server Management")}
                    description={gt("Search for servers to view details, toggle partner/discovery status, or take moderation actions.")}
                  />
                  <SettingsToolbar>
                    <SettingsSearchInput
                      value={adminServerSearch}
                      onValueChange={setAdminServerSearch}
                      onKeyDown={(e) => e.key === "Enter" && searchAdminServers()}
                      placeholder={gt("Search servers by name or ID...")}
                      clearLabel={gt("Clear")}
                      className="flex-1"
                    />
                    <SettingsButton onClick={searchAdminServers} disabled={isLoadingAdmin}>
                      {isLoadingAdmin ? <RefreshCw className="animate-spin" /> : <Search />}
                      {gt("Search")}
                    </SettingsButton>
                  </SettingsToolbar>

                  {adminServers.length > 0 ? (
                    <div className="flex h-[600px] gap-4 max-md:h-auto max-md:flex-col">
                      <div className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] max-md:h-[320px] max-md:w-full">
                        <p className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                          {gt("Results ({count})", { count: adminServers.length })}
                        </p>
                        <ScrollArea className="min-h-0 flex-1">
                          <div className="divide-y divide-[var(--border-subtle)]">
                            {adminServers.map((s) => (
                              <SettingsListItem
                                key={s.id}
                                selected={selectedServer?.id === s.id}
                                onClick={() => setSelectedServer(s)}
                                leading={
                                  <Avatar className="h-9 w-9 rounded-lg">
                                    <AvatarImage src={cdnImage(s.icon)} />
                                    <AvatarFallback className="rounded-lg bg-[var(--app-accent)] text-xs text-white">{s.name.charAt(0)}</AvatarFallback>
                                  </Avatar>
                                }
                                title={s.name}
                                subtitle={gt("{count} members", { count: s.memberCount })}
                                actions={
                                  s.isPartnered || s.isDiscoverable ? (
                                    <div className="flex flex-col items-end gap-1">
                                      {s.isPartnered && <SettingsStatusPill tone="accent">{gt("Partner")}</SettingsStatusPill>}
                                      {s.isDiscoverable && <SettingsStatusPill tone="success">{gt("Visible")}</SettingsStatusPill>}
                                    </div>
                                  ) : undefined
                                }
                              />
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
                        {selectedServer ? (
                          <ScrollArea className="min-h-0 flex-1">
                            <div className="space-y-6 p-5">
                              <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] pb-4">
                                <Avatar className="h-12 w-12 rounded-xl">
                                  <AvatarImage src={cdnImage(selectedServer.icon || undefined)} />
                                  <AvatarFallback className="rounded-xl bg-[var(--app-accent)] text-white">{selectedServer.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-lg font-semibold text-[var(--text-primary)]">{selectedServer.name}</p>
                                  <p className="truncate text-sm text-[var(--text-muted)]">
                                    {gt("Owner: {name}", { name: selectedServer.owner?.displayName || selectedServer.owner?.username || gt("Unknown") })}
                                  </p>
                                </div>
                              </div>

                              <SettingsSection title={gt("Info")}>
                                <SettingsCard>
                                  <SettingsRow
                                    label={gt("Server ID")}
                                    control={<span className="select-all font-mono text-sm text-[var(--text-primary)]">{selectedServer.id}</span>}
                                    stackOnMobile
                                  />
                                  <SettingsRow
                                    label={gt("Created")}
                                    control={<span className="text-sm text-[var(--text-primary)]">{new Date(selectedServer.createdAt).toLocaleDateString(locale)}</span>}
                                  />
                                  {selectedServer.description && (
                                    <SettingsRow label={gt("Description")} description={selectedServer.description} />
                                  )}
                                </SettingsCard>
                              </SettingsSection>

                              <SettingsSection title={gt("Server Status")}>
                                <SettingsCard>
                                  <SettingsToggleRow
                                    label={gt("Partnered")}
                                    description={gt("Grant partner badge and perks")}
                                    checked={selectedServer.isPartnered}
                                    disabled={!can("servers.manage")}
                                    onCheckedChange={() => void handleTogglePartner(selectedServer.id)}
                                  />
                                  <SettingsToggleRow
                                    label={gt("Discoverable")}
                                    description={gt("Show in server discovery page")}
                                    checked={selectedServer.isDiscoverable}
                                    disabled={!can("servers.manage")}
                                    onCheckedChange={() => void handleToggleDiscovery(selectedServer.id)}
                                  />
                                </SettingsCard>
                              </SettingsSection>

                              <SettingsDangerZone title={gt("Danger Zone")}>
                                <SettingsRow
                                  label={gt("Transfer Ownership")}
                                  description={gt("Change the server owner")}
                                  control={
                                    <SettingsButton variant="danger" size="sm" disabled={!can("servers.manage")} onClick={handleTransferOwnership}>
                                      {gt("Transfer Ownership")}
                                    </SettingsButton>
                                  }
                                />
                                <SettingsRow
                                  label={gt("Delete Server")}
                                  description={gt("Permanently remove this server")}
                                  danger
                                  control={
                                    <SettingsButton variant="dangerFilled" size="sm" disabled={!can("servers.manage")} onClick={() => void handleDeleteServer(selectedServer.id)}>
                                      {gt("Delete Server")}
                                    </SettingsButton>
                                  }
                                />
                              </SettingsDangerZone>
                            </div>
                          </ScrollArea>
                        ) : (
                          <div className="flex h-full items-center justify-center p-8">
                            <SettingsEmptyState icon={Database} title={gt("Select a server from the list to view details and manage settings")} className="border-none" />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : isLoadingAdmin ? (
                    <SettingsSkeleton variant="list" count={5} />
                  ) : (
                    <SettingsEmptyState icon={Database} title={gt("Search for servers to view details, toggle partner/discovery status, or take moderation actions.")} />
                  )}
                </div>
              )}

              {/* Admin — Statistics (keeps the last numbers on screen while refreshing) */}
              {activeTab === "admin-stats" && canOpenAdminTab(activeTab) && (
                <div className="space-y-6">
                  <SettingsPageHeader
                    title={gt("Platform Statistics")}
                    actions={
                      <SettingsButton variant="secondary" size="sm" onClick={() => fetchAdminStats()} disabled={isLoadingAdminStats}>
                        <RefreshCw className={cn(isLoadingAdminStats && "animate-spin")} />
                        {gt("Refresh")}
                      </SettingsButton>
                    }
                  />
                  {adminStats ? (
                    <div className={cn("space-y-3 transition-opacity", isLoadingAdminStats && "opacity-70")}>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <SettingsStatCard icon={Users} label={gt("Total Users")} value={adminStats.users.toLocaleString(locale)} hint={`+${adminStats.newUsersToday} ${gt("today")}`} hintTone="positive" />
                        <SettingsStatCard icon={Server} label={gt("Total Servers")} value={adminStats.servers.toLocaleString(locale)} hint={`${adminStats.activeServers} ${gt("new (30d)")}`} />
                        <SettingsStatCard icon={MessageSquare} label={gt("Total Messages")} value={adminStats.messages.toLocaleString(locale)} hint={`${adminStats.messagesToday.toLocaleString(locale)} ${gt("today")}`} hintTone="positive" />
                        <SettingsStatCard
                          icon={Activity}
                          label={gt("Online Now")}
                          value={adminStats.onlineUsers.toLocaleString(locale)}
                          valueTone="positive"
                          hint={`${((adminStats.onlineUsers / Math.max(adminStats.users, 1)) * 100).toFixed(1)}% ${gt("of users")}`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <SettingsStatCard icon={Calendar} label={gt("New This Week")} value={adminStats.newUsersThisWeek.toLocaleString(locale)} />
                        <SettingsStatCard icon={Ban} label={gt("Banned Users")} value={adminStats.banned.toLocaleString(locale)} valueTone="danger" />
                        <SettingsStatCard icon={Bot} label={gt("Bot Accounts")} value={adminStats.bots.toLocaleString(locale)} valueTone="accent" />
                        <SettingsStatCard icon={Users} label={gt("Server Memberships")} value={adminStats.totalMemberships.toLocaleString(locale)} hint={gt("across all servers")} />
                      </div>
                    </div>
                  ) : isLoadingAdminStats ? (
                    <SettingsSkeleton variant="stats" count={8} />
                  ) : (
                    <SettingsEmptyState icon={BarChart3} title={gt("Failed to load statistics")} action={<SettingsButton variant="secondary" size="sm" onClick={() => fetchAdminStats()}>{gt("Refresh")}</SettingsButton>} />
                  )}
                </div>
              )}

              {/* Admin — Platform Settings */}
              {activeTab === "admin-settings" && canOpenAdminTab(activeTab) && (
                <div className="space-y-8">
                  <SettingsPageHeader title={gt("Platform Settings")} />

                  {adminStats && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <SettingsStatCard label={gt("Total Users")} value={adminStats.users.toLocaleString(locale)} />
                      <SettingsStatCard label={gt("Total Servers")} value={adminStats.servers.toLocaleString(locale)} />
                      <SettingsStatCard label={gt("Total Messages")} value={adminStats.messages.toLocaleString(locale)} />
                      <SettingsStatCard label={gt("New Today")} value={`+${adminStats.newUsersToday}`} valueTone="positive" />
                    </div>
                  )}

                  {!platformSettings ? (
                    <SettingsSkeleton variant="rows" count={4} />
                  ) : (
                    <>
                      <SettingsSection title={gt("Access")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Enable Maintenance Mode")}
                            description={gt("Restrict access to staff only")}
                            checked={platformSettings.maintenanceMode || false}
                            onCheckedChange={(checked) => handleUpdatePlatformSettings({ maintenanceMode: checked })}
                          />
                          <SettingsToggleRow
                            label={gt("Allow New Registrations")}
                            description={gt("Enable new user sign-ups")}
                            checked={platformSettings.allowRegistration !== false}
                            onCheckedChange={(checked) => handleUpdatePlatformSettings({ allowRegistration: checked })}
                          />
                        </SettingsCard>
                      </SettingsSection>

                      <SettingsSection title={gt("Connections")}>
                        <SettingsCard>
                          <SettingsToggleRow
                            label={gt("Enable Account Connections")}
                            description={gt("Allow users to link external accounts (Last.fm, Spotify, GitHub, etc.)")}
                            checked={platformSettings.connectionsEnabled !== false}
                            onCheckedChange={(checked) => handleUpdatePlatformSettings({ connectionsEnabled: checked })}
                          >
                            {platformSettings.connectionsEnabled !== false && (
                              <div className="space-y-2 pt-1">
                                <p className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{gt("Allowed Providers")}</p>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {/* Domains (DNS-verified websites) aren't an OAuth provider but share the toggle list. */}
                                  {[...CONNECTION_PROVIDERS, { id: "website", label: gt("Domains"), color: "var(--app-accent)", bg: "color-mix(in srgb, var(--app-accent) 14%, transparent)" }].map((prov) => {
                                    const isDisabled = platformSettings.disabledProviders?.includes(prov.id) || false;
                                    const ProvIcon = getConnectionIcon(prov.id);
                                    return (
                                      <div
                                        key={prov.id}
                                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-2"
                                      >
                                        <span className="flex min-w-0 items-center gap-2">
                                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded" style={{ backgroundColor: prov.bg }}>
                                            <ProvIcon size={12} style={{ color: prov.color }} />
                                          </span>
                                          <span className="truncate text-sm text-[var(--text-primary)]">{prov.label}</span>
                                        </span>
                                        <ToggleSwitch
                                          size="sm"
                                          checked={!isDisabled}
                                          aria-label={prov.label}
                                          onCheckedChange={(checked) => {
                                            const current = platformSettings.disabledProviders || [];
                                            const next = checked ? current.filter((id: string) => id !== prov.id) : [...current, prov.id];
                                            handleUpdatePlatformSettings({ disabledProviders: next });
                                          }}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </SettingsToggleRow>
                        </SettingsCard>
                      </SettingsSection>

                      <SettingsSection title={gt("OEmbed Whitelist")} description={gt("Domains allowed for rich link embeds (Spotify, YouTube, etc.)")}>
                        <SettingsCard>
                          <form
                            className="flex gap-2 px-4 py-3"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!oembedDomainInput.trim()) return;
                              const domain = oembedDomainInput.trim().toLowerCase();
                              const current = platformSettings.oembedWhitelist || [];
                              if (!current.includes(domain)) void handleUpdatePlatformSettings({ oembedWhitelist: [...current, domain] });
                              setOembedDomainInput("");
                            }}
                          >
                            <Input
                              value={oembedDomainInput}
                              onChange={(e) => setOembedDomainInput(e.target.value)}
                              placeholder="example.com"
                              className="h-9 flex-1 border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                            />
                            <SettingsButton type="submit" size="sm" className="h-9">{gt("Add")}</SettingsButton>
                          </form>
                          {(platformSettings.oembedWhitelist || []).length === 0 ? (
                            <p className="px-4 py-3 text-sm italic text-[var(--text-muted)]">{gt("No custom domains. Using defaults.")}</p>
                          ) : (
                            <div className="max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto">
                              {(platformSettings.oembedWhitelist || []).map((domain) => (
                                <div key={domain} className="group flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-[var(--bg-hover)]/50">
                                  <span className="truncate font-mono text-[var(--text-primary)]">{domain}</span>
                                  <SettingsButton
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-red-500 hover:text-red-500"
                                    onClick={() => {
                                      const current = platformSettings.oembedWhitelist || [];
                                      void handleUpdatePlatformSettings({ oembedWhitelist: current.filter((d) => d !== domain) });
                                    }}
                                  >
                                    {gt("Remove")}
                                  </SettingsButton>
                                </div>
                              ))}
                            </div>
                          )}
                        </SettingsCard>
                      </SettingsSection>

                      <SettingsSection
                        title={gt("File Type Whitelist")}
                        description={gt("Only whitelisted file types can be uploaded. Add a MIME type (application/zip), a family (video/*), a file ending (.7z.001 or .001, for files without a type) or * for everything. Tag each as safe or bad — bad types are allowed but users get a warning.")}
                      >
                        <SettingsCard>
                          <form
                            className="flex gap-2 px-4 py-3"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!fileTypeInput.trim()) return;
                              const type = fileTypeInput.trim().toLowerCase();
                              const current = platformSettings.allowedFileTypes || [];
                              if (!current.some((f) => f.type === type)) void handleUpdatePlatformSettings({ allowedFileTypes: [...current, { type, safe: true }] });
                              setFileTypeInput("");
                            }}
                          >
                            <Input
                              value={fileTypeInput}
                              onChange={(e) => setFileTypeInput(e.target.value)}
                              placeholder="application/zip, video/*, .7z.001"
                              className="h-9 flex-1 border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                            />
                            <SettingsButton type="submit" size="sm" className="h-9">{gt("Add")}</SettingsButton>
                          </form>
                          {(platformSettings.allowedFileTypes || []).length === 0 ? (
                            <p className="px-4 py-3 text-sm italic text-[var(--text-muted)]">
                              {gt("No custom whitelist. Using defaults: image/jpeg, image/png, image/gif, image/webp, audio/mpeg, audio/ogg, audio/wav, video/mp4, video/webm, application/pdf, text/plain")}
                            </p>
                          ) : (
                            <div className="max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto">
                              {(platformSettings.allowedFileTypes || []).map((entry) => (
                                <div key={entry.type} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-[var(--bg-hover)]/50">
                                  <span className="truncate font-mono text-[var(--text-primary)]">{entry.type}</span>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <button
                                      type="button"
                                      title={gt("Toggle")}
                                      onClick={() => {
                                        const current = platformSettings.allowedFileTypes || [];
                                        void handleUpdatePlatformSettings({ allowedFileTypes: current.map((f) => (f.type === entry.type ? { ...f, safe: !f.safe } : f)) });
                                      }}
                                    >
                                      <SettingsStatusPill tone={entry.safe ? "success" : "warning"} dot>{entry.safe ? gt("Safe") : gt("Bad")}</SettingsStatusPill>
                                    </button>
                                    <SettingsButton
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-red-500 hover:text-red-500"
                                      onClick={() => {
                                        const current = platformSettings.allowedFileTypes || [];
                                        void handleUpdatePlatformSettings({ allowedFileTypes: current.filter((f) => f.type !== entry.type) });
                                      }}
                                    >
                                      {gt("Remove")}
                                    </SettingsButton>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <SettingsToggleRow
                            label={gt("Warn on unknown file types")}
                            description={gt("Show a warning to users when they upload a file type not in the whitelist")}
                            checked={platformSettings.warnOnUnknownFileTypes !== false}
                            onCheckedChange={(checked) => handleUpdatePlatformSettings({ warnOnUnknownFileTypes: checked })}
                          />
                        </SettingsCard>
                      </SettingsSection>
                    </>
                  )}

                  <SettingsSection title={gt("Font Testing")} description={gt("Preview how different fonts look across the app.")}>
                    <SettingsCard>
                      <div className="px-4 py-3">
                        <Input
                          value={fontTestText}
                          onChange={(e) => setFontTestText(e.target.value)}
                          className="h-9 border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                          placeholder={gt("Type text to preview...")}
                        />
                      </div>
                      {[
                        { name: gt("Inter (Default)"), className: "font-sans" },
                        { name: gt("Mono"), className: "font-mono" },
                        { name: gt("Serif"), className: "font-serif" },
                      ].map((font) => (
                        <div key={font.name} className="px-4 py-3">
                          <p className="mb-1 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{font.name}</p>
                          <p className={cn("text-base text-[var(--text-primary)]", font.className)}>{fontTestText}</p>
                        </div>
                      ))}
                    </SettingsCard>
                  </SettingsSection>
                </div>
              )}

              {/* Admin — Activity Logs (old entries stay while a page/filter loads) */}
              {activeTab === "admin-logs" && canOpenAdminTab(activeTab) && (
                <div className="space-y-4">
                  <SettingsPageHeader title={gt("Activity Logs")} description={gt("Admin actions will appear here")} />
                  <SettingsToolbar>
                    <div role="tablist" aria-label={gt("Activity Logs")} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-0.5">
                      {(["all", "bans", "reports", "admin"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          role="tab"
                          aria-selected={adminLogFilter === f}
                          onClick={() => {
                            setAdminLogFilter(f);
                            setAdminLogPage(1);
                            fetchAdminLogs(f, 1);
                          }}
                          className={cn(
                            "h-7 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors duration-(--motion-fast)",
                            adminLogFilter === f
                              ? "bg-[var(--app-accent)] text-white shadow-sm"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                          )}
                        >
                          {f === "all" ? gt("All") : f === "bans" ? gt("Bans") : f === "reports" ? gt("Reports") : gt("Admin Actions")}
                        </button>
                      ))}
                    </div>
                    {isLoadingAdminLogs && adminLogs.length > 0 && <RefreshCw className="h-4 w-4 animate-spin text-[var(--text-muted)]" aria-hidden />}
                  </SettingsToolbar>

                  {adminLogs.length === 0 ? (
                    isLoadingAdminLogs ? (
                      <SettingsSkeleton variant="list" count={6} />
                    ) : (
                      <SettingsEmptyState icon={FileText} title={gt("No activity logs yet")} description={gt("Admin actions will appear here")} />
                    )
                  ) : (
                    <div className={cn("overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] divide-y divide-[var(--border-subtle)] transition-opacity", isLoadingAdminLogs && "opacity-60")}>
                      {adminLogs.map((log) => {
                        const isExpanded = expandedLogId === log.id;
                        const actionStyle = adminLogActionStyle(log.action);
                        const ActionIcon = actionStyle.icon;
                        const TargetIcon = log.targetType === "user" ? UserCog : log.targetType === "server" ? Server : log.targetType === "message" ? MessageSquare : Globe;
                        return (
                          <div key={log.id}>
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]/60"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${actionStyle.color}1f` }}>
                                  <ActionIcon className="h-4 w-4" style={{ color: actionStyle.color }} />
                                </span>
                                <Avatar className="h-6 w-6 shrink-0">
                                  <AvatarImage src={cdnImage(log.admin?.avatar)} />
                                  <AvatarFallback className="bg-[var(--app-accent)] text-xs text-white">
                                    {log.admin?.displayName?.charAt(0) || log.admin?.username?.charAt(0) || "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                                      {log.admin?.displayName || log.admin?.username || gt("Unknown")}
                                    </span>
                                    <span
                                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                                      style={{ backgroundColor: `${actionStyle.color}24`, color: actionStyle.color }}
                                    >
                                      {log.action.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                                    <TargetIcon className="h-3 w-3" />
                                    <span>{log.targetType}</span>
                                    <span className="font-mono opacity-70">{log.targetId.slice(0, 8)}…</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <time dateTime={log.createdAt} className="hidden text-xs text-[var(--text-muted)] sm:inline">
                                  {formatRelativeTime(log.createdAt, locale)}
                                </time>
                                <ChevronDown className={cn("h-4 w-4 text-[var(--text-muted)] transition-transform", isExpanded && "rotate-180")} />
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="space-y-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/40 px-4 py-3">
                                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                  <Clock className="h-3 w-3" />
                                  <span>{new Date(log.createdAt).toLocaleString(locale)}</span>
                                </div>
                                {log.reason && (
                                  <div className="flex items-start gap-2 text-sm">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                    <div>
                                      <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{gt("Reason")}</span>
                                      <p className="text-[var(--text-secondary)]">{log.reason}</p>
                                    </div>
                                  </div>
                                )}
                                <div className="flex items-center gap-2 text-xs">
                                  <TargetIcon className="h-3 w-3 text-[var(--text-muted)]" />
                                  <span className="font-semibold uppercase text-[var(--text-muted)]">{gt("Target")}:</span>
                                  <span className="select-all font-mono text-[var(--text-secondary)]">{log.targetId}</span>
                                </div>
                                {log.admin?.id && (
                                  <div className="flex items-center gap-2 text-xs">
                                    <UserCog className="h-3 w-3 text-[var(--text-muted)]" />
                                    <span className="font-semibold uppercase text-[var(--text-muted)]">{gt("Admin ID")}:</span>
                                    <span className="select-all font-mono text-[var(--text-secondary)]">{log.admin.id}</span>
                                  </div>
                                )}
                                {log.details && Object.keys(log.details).length > 0 && (
                                  <div>
                                    <p className="mb-1 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">{gt("Details")}</p>
                                    <pre className="max-h-60 overflow-x-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2.5 text-xs text-[var(--text-secondary)]">
                                      {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {adminLogPagination && adminLogPagination.pages > 1 && (
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-[var(--text-muted)]">
                        {gt("Page {page} of {pages}", { page: adminLogPagination.page, pages: adminLogPagination.pages })}
                        {" · "}
                        {adminLogPagination.total} {gt("total")}
                      </span>
                      <div className="flex gap-2">
                        <SettingsButton
                          variant="secondary"
                          size="sm"
                          disabled={adminLogPage <= 1 || isLoadingAdminLogs}
                          onClick={() => {
                            const prev = Math.max(1, adminLogPage - 1);
                            setAdminLogPage(prev);
                            fetchAdminLogs(adminLogFilter, prev);
                          }}
                        >
                          {gt("Previous")}
                        </SettingsButton>
                        <SettingsButton
                          variant="secondary"
                          size="sm"
                          disabled={adminLogPage >= adminLogPagination.pages || isLoadingAdminLogs}
                          onClick={() => {
                            const next = Math.min(adminLogPagination.pages, adminLogPage + 1);
                            setAdminLogPage(next);
                            fetchAdminLogs(adminLogFilter, next);
                          }}
                        >
                          {gt("Next")}
                        </SettingsButton>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Admin — Badge Management (create/define badges) */}
              {activeTab === "admin-badges" && canOpenAdminTab(activeTab) && (
                <div className="space-y-6">
                  <SettingsPageHeader
                    title={gt("Badge Management")}
                    description={gt("Create, edit, and manage the platform's badge definitions. To assign badges to a user, use the User Management tab.")}
                  />
                  <AdminBadgesPanel />
                </div>
              )}

              {/* Admin — Announcements */}
              {activeTab === "admin-announcements" && canOpenAdminTab(activeTab) && (
                <div className="space-y-8">
                  <SettingsPageHeader
                    title={gt("Announcements")}
                    description={can("settings.manage") && can("broadcast.send") ? gt("Publish a global banner and send it to users by direct message. Blank lines are preserved.") : can("settings.manage") ? gt("Publish a global banner announcement visible to all users. Blank lines are preserved.") : gt("Send a platform announcement to users by direct message.")}
                  />
                  {can("settings.manage") && platformSettings?.globalAnnouncement && (
                    <SettingsSection
                      title={gt("Current Live Announcement")}
                      action={
                        <SettingsButton
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            setAnnouncementText("");
                            try {
                              const res = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ globalAnnouncement: "" }) });
                              if (res.ok) { const data = await res.json(); setPlatformSettings(data); toast.success(gt("Announcement cleared")); }
                            } catch { toast.error(gt("Failed to clear announcement")); }
                          }}
                        >
                          {gt("Clear Live")}
                        </SettingsButton>
                      }
                    >
                      <div className="rounded-xl border border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,var(--bg-app))] p-4 text-sm text-[var(--text-primary)]">
                        {platformSettings.globalAnnouncement.split("\n").map((line: string, i: number, arr: string[]) => (
                          <span key={i}>{line || " "}{i < arr.length - 1 && <br />}</span>
                        ))}
                      </div>
                    </SettingsSection>
                  )}
                  <SettingsSection title={gt("New Announcement")}>
                    <div className={FORM_CARD}>
                      <Textarea
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        placeholder={gt("Enter announcement text… Blank lines will be preserved as visual breaks.")}
                        className="resize-none overflow-y-auto border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                        rows={8}
                        style={{ maxHeight: "240px" }}
                      />
                      <div className="flex justify-end">
                        <SettingsButton onClick={handlePublishAnnouncement}>
                          <Megaphone />
                          {gt("Publish")}
                        </SettingsButton>
                      </div>
                    </div>
                  </SettingsSection>
                </div>
              )}

              {activeTab === "admin-experiments" && canOpenAdminTab(activeTab) && <AdminExperimentsPanel />}
              {activeTab === "admin-tts-sounds" && canOpenAdminTab(activeTab) && <AdminTtsSoundsPanel />}
              {activeTab === "admin-tts-voices" && canOpenAdminTab(activeTab) && <AdminTtsVoicesPanel />}
              {activeTab === "admin-translations" && canOpenAdminTab(activeTab) && <AdminTranslationsPanel />}
              {activeTab === "admin-bug-reports" && canOpenAdminTab(activeTab) && <AdminBugReportsPanel />}

              {/* Admin — Trust & Safety */}
              <MountWhenOpened open={activeTab === "admin-trust-safety" && canOpenAdminTab(activeTab)}>
                {activeTab === "admin-trust-safety" && canOpenAdminTab(activeTab) && <AdminTrustSafetyPanel key={user?.id} />}
              </MountWhenOpened>

              {/* Admin — Apps & Bots (verification queue, App Directory moderation) */}
              <MountWhenOpened open={activeTab === "admin-apps" && canOpenAdminTab(activeTab)}>
                {activeTab === "admin-apps" && canOpenAdminTab(activeTab) && <AdminAppsPanel key={user?.id} />}
              </MountWhenOpened>
        </SettingsContent>
      </div>

      {/* Image Cropper */}
      <ImageCropper
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        imageUrl={cropperImage}
        aspectRatio={cropperType === "avatar" ? 1 : 3}
        onCropComplete={handleCropComplete}
        title={cropperType === "avatar" ? gt("Crop Avatar") : gt("Crop Banner")}
        description={
          cropperType === "avatar"
            ? gt("Adjust the crop area to select the portion of the image for your avatar.")
            : gt("Adjust the crop area to select the portion of the image for your profile banner.")
        }
        circular={cropperType === "avatar"}
      />
    </div>
  );
}
