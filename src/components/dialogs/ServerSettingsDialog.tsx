"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageCropper } from "@/components/ui/image-cropper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  X,
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
  Check,
  Trash2,
  Plus,
  Copy,
  ExternalLink,
  Crown,
  Volume2,
  MoreHorizontal,
  AlertTriangle,
  GripVertical,
  Search,
  Play,
  Lock,
  Mail,
  Globe,
  ClipboardList,
  Pencil,
  Bot,
  Sparkles,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
import { hasPermissionBit, setPermissionBit } from "@/lib/roles/bitfield";
import { useSettingsDraft, type SettingsDraft } from "@/hooks/useSettingsDraft";
import { UnsavedChangesBar } from "@/components/ui/unsaved-changes-bar";
import { AudioTrimmerDialog } from "@/components/dialogs/AudioTrimmerDialog";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

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

const ColorInput = memo(function ColorInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [localColor, setLocalColor] = useState(value);
  useEffect(() => { setLocalColor(value); }, [value]);
  return (
    <input
      type="color"
      value={localColor}
      onChange={(e) => setLocalColor(e.target.value)}
      onBlur={() => onChange(localColor)}
      disabled={disabled}
      className="w-10 h-10 p-1 rounded bg-[#0a0a0a] border border-[#222222] disabled:opacity-60 cursor-pointer"
    />
  );
});

interface ServerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  | "integrations"
  | "moderation"
  | "safety"
  | "members"
  | "channels"
  | "access"
  | "applications"
  | "app_discovery";

/** Tabs whose content is a multi-column / table layout and needs full width. */
const WIDE_SETTINGS_TABS = new Set<SettingsTab>([
  "roles",
  "members",
  "bans",
  "audit-log",
  "channels",
  "emoji",
  "stickers",
  "soundboard",
]);

interface Role {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  isDefault: boolean;
  memberCount?: number;
}

interface Invite {
  code: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdBy: {
    id: string;
    username: string;
    avatar?: string;
  };
  channel: {
    id: string;
    name: string;
  };
  createdAt: string;
}

interface BannedUser {
  id: string;
  username: string;
  avatar?: string;
  reason?: string;
  bannedAt: string;
  bannedBy: {
    id: string;
    username: string;
  };
}

interface ServerMember {
  id: string;
  membershipId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string | null;
  isPremium?: boolean;
  roles: Role[];
  highestRole?: Role | null;
  highestHoistedRole?: Role | null;
  joinedAt: string;
}

interface ServerEmoji {
  id: string;
  name: string;
  imageUrl: string;
  animated: boolean;
}

interface ServerChannel {
  id: string;
  name: string;
  type: string;
}

interface ServerSticker {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  tags?: string[];
}

interface AuditLogEntry {
  id: string;
  action: string;
  reason?: string;
  createdAt: string;
  admin?: {
    id?: string;
    username: string;
    avatar?: string;
  };
}

interface ServerApplication {
  id: string;
  user: {
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
    createdAt: string;
  };
  status: "pending" | "approved" | "rejected" | "interviewed";
  answers: { question: string; answer: string }[];
  createdAt: string;
  processedAt?: string;
  rejectionReason?: string;
}

export function ServerSettingsDialog({ open, onOpenChange }: ServerSettingsDialogProps) {
  const { currentServer, fetchServers, channels } = useServer();
  const gt = useGT();
  const { user } = useAuth();
  const { can, isAdmin, loading: permsLoading } = usePermissions(currentServer?.id);
  const canManageServer = can("MANAGE_SERVER") || isAdmin;
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");
  const [isSaving, setIsSaving] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);

  // Image cropper state
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string>("");
  const [cropperType, setCropperType] = useState<"icon" | "banner">("icon");

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
  const [roleDraft, setRoleDraft] = useState<{
    name: string;
    color: string;
    permissions: string;
    hoist: boolean;
    mentionable: boolean;
  } | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isReorderingRoles, setIsReorderingRoles] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  // Vanity URL (partnered servers)
  const [vanityInfo, setVanityInfo] = useState<{ code: string | null; uses: number; isPartnered: boolean; lockToVanity: boolean } | null>(null);
  const [vanityDraft, setVanityDraft] = useState("");
  const [isSavingVanity, setIsSavingVanity] = useState(false);
  const [vanityError, setVanityError] = useState<string | null>(null);
  const [isTogglingLock, setIsTogglingLock] = useState(false);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [stickers, setStickers] = useState<ServerSticker[]>([]);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [stickerSearch, setStickerSearch] = useState("");
  const [renamingEmojiId, setRenamingEmojiId] = useState<string | null>(null);
  const [emojiRenameValue, setEmojiRenameValue] = useState("");
  const [renamingStickerId, setRenamingStickerId] = useState<string | null>(null);
  const [stickerRenameValue, setStickerRenameValue] = useState("");
  const [soundboardSounds, setSoundboardSounds] = useState<{ _id: string; name: string; url: string; emoji: string }[]>([]);
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const [trimmerOpen, setTrimmerOpen] = useState(false);
  const [trimmerFile, setTrimmerFile] = useState<File | null>(null);
  const soundInputRef = useRef<HTMLInputElement>(null);
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [textChannels, setTextChannels] = useState<ServerChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAppCount, setPendingAppCount] = useState(0);
  const [applications, setApplications] = useState<ServerApplication[]>([]);
  const [applicationFilter, setApplicationFilter] = useState<"all" | "pending" | "approved" | "rejected" | "interviewed">("all");
  const [discoverableApps, setDiscoverableApps] = useState<any[]>([]);
  const [appSearch, setAppSearch] = useState("");

  const [isSyncingDiscord, setIsSyncingDiscord] = useState(false);
  const [isTriggeringTwitch, setIsTriggeringTwitch] = useState(false);
  const [isTriggeringYoutube, setIsTriggeringYoutube] = useState(false);
  const [isTriggeringDiscord, setIsTriggeringDiscord] = useState(false);

  const handleDiscordSync = async () => {
    if (!currentServer) return;
    setIsSyncingDiscord(true);
    try {
      const mode = draftString("integrations.discordMode", "add");
      const res = await fetch(`/api/servers/${currentServer.id}/integrations/discord/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Synced Discord channels successfully! ${gt("Mode")}: ${data.details.mode}. ${gt("Created")}: ${data.details.created}, ${gt("Linked")}: ${data.details.linked}, ${gt("Deleted")}: ${data.details.deleted}.`);
        await fetchServers();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || gt("Failed to sync Discord channels"));
      }
    } catch {
      toast.error(gt("Failed to sync Discord channels"));
    } finally {
      setIsSyncingDiscord(false);
    }
  };

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

  // Emoji upload refs
  const emojiInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingEmoji, setIsUploadingEmoji] = useState(false);
  const stickerInputRef = useRef<HTMLInputElement>(null);
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
    const load = async () => {
      const base: SettingsDraft = {
        name: currentServer.name,
        description: server.description || "",
        systemChannelId: server.systemChannelId || null,
        rulesChannelId: server.rulesChannelId || null,
        afkChannelId: server.afkChannelId || null,
        afkTimeout: server.afkTimeout || 300,
        "widget.enabled": true,
        "widget.channelId": null,
        "moderation.verificationLevel": "none",
        "moderation.explicitContentFilter": "disabled",
        "moderation.require2FA": false,
        "safety.raidProtection": false,
        "safety.antiSpam": true,
        "safety.mentionSpamLimit": 5,
        "integrations.discord": false,
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
      };
      try {
        const res = await fetch(`/api/servers/${currentServer.id}/settings`);
        if (res.ok) {
          const data = await res.json();
          const s = data.settings || {};
          base["widget.enabled"] = s.widget?.enabled ?? true;
          base["widget.channelId"] = s.widget?.channelId || null;
          base["moderation.verificationLevel"] = s.moderation?.verificationLevel || "none";
          base["moderation.explicitContentFilter"] = s.moderation?.explicitContentFilter || "disabled";
          base["moderation.require2FA"] = Boolean(s.moderation?.require2FA);
          base["safety.raidProtection"] = Boolean(s.safety?.raidProtection);
          base["safety.antiSpam"] = s.safety?.antiSpam ?? true;
          base["safety.mentionSpamLimit"] = s.safety?.mentionSpamLimit ?? 5;
          base["integrations.discord"] = Boolean(s.integrations?.discord);
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

  // Extract text channels from channels context
  useEffect(() => {
    if (channels) {
      const textChs = channels
        .filter((ch) => ch.type === "text")
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type,
        }));
      setTextChannels(textChs);
    }
  }, [channels]);

  const fetchRolesData = useCallback(async () => {
    if (!currentServer) return;
    const rolesRes = await fetch(`/api/servers/${currentServer.id}/roles`);
    if (!rolesRes.ok) return;
    const data = await rolesRes.json();
    const nextRoles = (data.roles || []) as Role[];
    setRoles(nextRoles);
  }, [currentServer]);

  const fetchMembersData = useCallback(async () => {
    if (!currentServer) return;
    const membersRes = await fetch(`/api/servers/${currentServer.id}/members?limit=1000`);
    if (!membersRes.ok) return;
    const data = await membersRes.json();
    setMembers((data.members || []) as ServerMember[]);
  }, [currentServer]);

  // Fetch data based on active tab
  useEffect(() => {
    if (!open || !currentServer) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        switch (activeTab) {
          case "roles":
            await fetchRolesData();
            break;
          case "invites": {
            const [invitesRes, vanityRes] = await Promise.all([
              fetch(`/api/servers/${currentServer.id}/invites`),
              fetch(`/api/servers/${currentServer.id}/vanity-url`),
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
              setVanityDraft(data.code ?? "");
              setVanityError(null);
            }
            break;
          }
          case "bans":
            const bansRes = await fetch(`/api/servers/${currentServer.id}/bans`);
            if (bansRes.ok) {
              const data = await bansRes.json();
              setBans(data.bans || []);
            }
            break;
          case "members":
            await Promise.all([fetchMembersData(), fetchRolesData()]);
            break;
          case "emoji":
            const emojisRes = await fetch(`/api/servers/${currentServer.id}/emojis`);
            if (emojisRes.ok) {
              const data = await emojisRes.json();
              setEmojis((data.emojis || []).map((e: any) => ({ id: e.id || e._id, name: e.name, imageUrl: e.imageUrl || e.url, animated: e.animated })));
            }
            break;
          case "stickers":
            const stickersRes = await fetch(`/api/servers/${currentServer.id}/stickers`);
            if (stickersRes.ok) {
              const data = await stickersRes.json();
              setStickers((data.stickers || []).map((s: any) => ({ id: s.id || s._id, name: s.name, description: s.description, imageUrl: s.imageUrl || s.url, tags: s.tags })));
            }
            break;
          case "audit-log":
            const auditRes = await fetch(`/api/servers/${currentServer.id}/audit-log`);
            if (auditRes.ok) {
              const data = await auditRes.json();
              setAuditLogs(data.logs || []);
            }
            break;
          case "soundboard": {
            // Settings themselves live in the shared draft (loaded on open);
            // only the sound list needs fetching per visit.
            const soundsRes = await fetch(`/api/servers/${currentServer.id}/soundboard`);
            if (soundsRes.ok) {
              const soundsData = await soundsRes.json();
              setSoundboardSounds(soundsData.sounds || []);
            }
            break;
          }
          case "applications": {
            const appsRes = await fetch(`/api/servers/${currentServer.id}/applications?status=${applicationFilter}`);
            if (appsRes.ok) {
              const appsData = await appsRes.json();
              setApplications(appsData.applications || []);
            }
            break;
          }
          case "app_discovery": {
            const discoverRes = await fetch(`/api/developers/discoverable-apps${appSearch ? `?search=${encodeURIComponent(appSearch)}` : ""}`);
            if (discoverRes.ok) {
              const discoverData = await discoverRes.json();
              setDiscoverableApps(discoverData.apps || []);
            }
            break;
          }
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeTab, open, currentServer, fetchMembersData, fetchRolesData, applicationFilter]);

  // Reset role draft init ref when dialog closes (so opening again starts fresh)
  useEffect(() => {
    if (!open) {
      roleDraftInitIdRef.current = null;
      return;
    }
    if (!currentServer) return;

    const fetchAppCount = async () => {
      try {
        const res = await fetch(`/api/servers/${currentServer.id}/applications/count`);
        if (res.ok) {
          const data = await res.json();
          setPendingAppCount(data.count ?? 0);
        }
      } catch {
        setPendingAppCount(0);
      }
    };
    void fetchAppCount();
  }, [open, currentServer]);

  // Track the last role ID we initialized the draft for, so updates to the
  // roles list (e.g. after a member role assignment) don't wipe unsaved edits.
  const roleDraftInitIdRef = useRef<string | null>(null);

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
      setRoleDraft({
        name: targetRole.name,
        color: targetRole.color || "#99AAB5",
        permissions: targetRole.permissions || "0",
        hoist: Boolean(targetRole.hoist),
        mentionable: Boolean(targetRole.mentionable),
      });
    }
  }, [roles, selectedRoleId]);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    // Validate file size (8MB max)
    if (file.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    // Open cropper with the selected image
    const reader = new FileReader();
    reader.onload = () => {
      setCropperImage(reader.result as string);
      setCropperType("icon");
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    // Clear input so the same file can be selected again
    if (iconInputRef.current) {
      iconInputRef.current.value = "";
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

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
      setIsUploadingBanner(true);
      const formData = new FormData();
      formData.append("file", file, file.name);
      try {
        const response = await fetch(`/api/upload/server/${currentServer.id}/banner`, {
          method: "POST",
          body: formData,
        });
        if (response.ok) {
          const data = await response.json();
          setServerBanner(data.url);
          toast.success(gt("Server banner updated!"));
          await fetchServers();
        } else {
          const data = await response.json();
          toast.error(data.error || gt("Failed to upload banner"));
        }
      } catch {
        toast.error(gt("Failed to upload banner"));
      } finally {
        setIsUploadingBanner(false);
      }
      if (bannerInputRef.current) {
        bannerInputRef.current.value = "";
      }
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    // Open cropper with the selected image
    const reader = new FileReader();
    reader.onload = () => {
      setCropperImage(reader.result as string);
      setCropperType("banner");
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    // Clear input
    if (bannerInputRef.current) {
      bannerInputRef.current.value = "";
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (!currentServer) return;

    const isIcon = cropperType === "icon";
    const setUploading = isIcon ? setIsUploadingIcon : setIsUploadingBanner;
    const setImage = isIcon ? setServerIcon : setServerBanner;
    const endpoint = isIcon
      ? `/api/upload/server/${currentServer.id}/icon`
      : `/api/upload/server/${currentServer.id}/banner`;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", croppedBlob, `${cropperType}.png`);

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
    "widget.channelId": gt("Widget invite channel"),
    "moderation.verificationLevel": gt("Verification level"),
    "moderation.explicitContentFilter": gt("Content filter"),
    "moderation.require2FA": gt("2FA requirement"),
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
    isAgeGated: gt("Age-restricted server"),
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
        body: JSON.stringify({ changes: settingsDraft.dirtyPatch }),
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

  // Closing with unsaved changes requires an explicit choice
  const handleRequestClose = useCallback(() => {
    if (settingsDraft.isDirty) {
      const discard = window.confirm(gt("You have unsaved changes. Discard them and close?"));
      if (!discard) return;
      settingsDraft.reset();
      setFieldErrors({});
    }
    onOpenChange(false);
  }, [settingsDraft, onOpenChange]);

  // Handle escape key (respects the unsaved-changes guard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        handleRequestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleRequestClose]);

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
        setSelectedRoleId(createdRole.id);
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
      roleDraft.mentionable !== Boolean(selectedRole.mentionable)
    );
  })();

  const handleRoleDrop = async (targetRoleId: string) => {
    if (!draggingRoleId || !currentServer || draggingRoleId === targetRoleId) return;

    const reorderable = roles.filter((role) => !role.isDefault);
    const fromIndex = reorderable.findIndex((role) => role.id === draggingRoleId);
    const toIndex = reorderable.findIndex((role) => role.id === targetRoleId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...reorderable];
    const [movedRole] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedRole);

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
      setDraggingRoleId(null);
    }
  };

  const handleRolePermissionToggle = (bit: bigint, enabled: boolean) => {
    setRoleDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        permissions: setPermissionBit(prev.permissions, bit, enabled),
      };
    });
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

    // Validate file size (256KB max for emoji)
    if (file.size > 256 * 1024) {
      toast.error(gt("Emoji must be less than 256KB"));
      return;
    }

    // Get emoji name from filename
    const emojiName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 32);

    setIsUploadingEmoji(true);
    const formData = new FormData();
    formData.append("file", file);

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
      if (emojiInputRef.current) {
        emojiInputRef.current.value = "";
      }
    }
  };

  const handleDeleteEmoji = async (emojiId: string) => {
    if (!currentServer) return;
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

  const handleRenameEmoji = async (emojiId: string) => {
    if (!currentServer || !emojiRenameValue.trim()) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/emojis/${emojiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: emojiRenameValue.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setEmojis(prev => prev.map(e => e.id === emojiId ? { ...e, name: data.emoji.name } : e));
        toast.success(gt("Emoji renamed"));
        setRenamingEmojiId(null);
        setEmojiRenameValue("");
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to rename emoji"));
      }
    } catch {
      toast.error(gt("Failed to rename emoji"));
    }
  };

  const handleRenameSticker = async (stickerId: string) => {
    if (!currentServer || !stickerRenameValue.trim()) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/stickers/${stickerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: stickerRenameValue.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setStickers(prev => prev.map(s => s.id === stickerId ? { ...s, name: data.sticker.name } : s));
        toast.success(gt("Sticker renamed"));
        setRenamingStickerId(null);
        setStickerRenameValue("");
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to rename sticker"));
      }
    } catch {
      toast.error(gt("Failed to rename sticker"));
    }
  };

  const handleStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    if (file.size > 512 * 1024) {
      toast.error(gt("Sticker must be less than 512KB"));
      return;
    }

    const stickerName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_ ]/g, "").trim().slice(0, 30) || "sticker";
    const formData = new FormData();
    formData.append("file", file);
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
      if (stickerInputRef.current) {
        stickerInputRef.current.value = "";
      }
    }
  };

  const handleDeleteSticker = async (stickerId: string) => {
    if (!currentServer) return;
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
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/soundboard/${soundId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setSoundboardSounds((prev) => prev.filter((s) => s._id !== soundId));
        toast.success(gt("Sound deleted"));
      } else {
        toast.error(gt("Failed to delete sound"));
      }
    } catch {
      toast.error(gt("Failed to delete sound"));
    }
  };

  const playSound = (sound: { _id: string; url: string }) => {
    const audio = new Audio(sound.url);
    // Audio.volume caps at 1.0; values above 100% previously threw IndexSizeError
    audio.volume = Math.min(Math.max(draftNumber("soundboard.volume", 100), 0) / 100, 1);
    audio.play().catch(() => toast.error(gt("Failed to play sound")));
    setPlayingSoundId(sound._id);
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
      await fetch(`/api/servers/${currentServer.id}/invites/${code}`, {
        method: "DELETE",
      });
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
      await fetch(`/api/servers/${currentServer.id}/bans/${userId}`, {
        method: "DELETE",
      });
      setBans(prev => prev.filter(b => b.id !== userId));
      toast.success(gt("User unbanned"));
    } catch (error) {
      console.error("Failed to unban user:", error);
      toast.error(gt("Failed to unban user"));
    }
  };

  const handleDeleteServer = async () => {
    if (!currentServer) return;
    const confirmed = window.confirm(
      gt("Are you sure you want to delete \"{name}\"? This action cannot be undone.", { name: currentServer.name })
    );
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
    rejectionReason?: string
  ) => {
    if (!currentServer) return;
    try {
      const response = await fetch(`/api/servers/${currentServer.id}/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to update application"));
        return;
      }

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
        toast.success(gt("Application rejected."));
      } else {
        toast.success(gt("Application marked for interview."));
      }
    } catch (error) {
      console.error("Failed to review application:", error);
      toast.error(gt("Failed to update application"));
    }
  };

  if (!open || !currentServer) return null;

  // Permission guard: non-admin users cannot access server settings UI
  if (!permsLoading && !canManageServer) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Access denied"
        className="fixed inset-0 z-50 bg-[#0a0a0a] flex items-center justify-center"
      >
        <div className="text-center p-8">
          <p className="text-lg font-semibold text-white mb-2"><T>Access Denied</T></p>
          <p className="text-sm text-[#888] mb-4"><T>You don&apos;t have permission to view server settings.</T></p>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg bg-[var(--app-accent)] text-white text-sm hover:brightness-110 transition"
          >
            <T>Close</T>
          </button>
        </div>
      </div>
    );
  }

  const isOwner = currentServer.ownerId === user?.id;

  const menuSections = [
    {
      title: currentServer.name,
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
      ],
    },
  ];

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1"><T>Server Overview</T></h2>
        <p className="text-sm text-[#888888]"><T>Customize your server&apos;s identity</T></p>
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={iconInputRef}
        onChange={handleIconUpload}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={bannerInputRef}
        onChange={handleBannerUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Server Icon & Banner */}
      <div className="flex gap-6">
        {/* Icon */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative group">
            <Avatar className="w-24 h-24 rounded-2xl">
              <AvatarImage src={cdnImage(serverIcon || undefined)} />
              <AvatarFallback className="bg-[#8B5CF6] text-white text-3xl rounded-2xl">
                {(draftString("name") || currentServer?.name || "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => iconInputRef.current?.click()}
              disabled={isUploadingIcon}
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl disabled:cursor-not-allowed"
            >
              {isUploadingIcon ? (
                <Loader size={32} />
              ) : (
                <Camera className="w-8 h-8 text-white" />
              )}
            </button>
          </div>
          <span className="text-xs text-[#666666]"><T>Server Icon</T></span>
        </div>

        {/* Banner */}
        <div className="flex-1">
          <div className="relative group aspect-[2/1] max-h-40 rounded-lg overflow-hidden bg-gradient-to-r from-[#8B5CF6] to-[#6366F1]">
            {serverBanner && (
              <img src={cdnImage(serverBanner)} alt="Banner" className="w-full h-full object-cover" />
            )}
            <button
              onClick={() => bannerInputRef.current?.click()}
              disabled={isUploadingBanner}
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
            >
              {isUploadingBanner ? (
                <Loader size={32} />
              ) : (
                <Camera className="w-8 h-8 text-white" />
              )}
            </button>
          </div>
          <span className="text-xs text-[#666666] mt-1 block"><T>Server Banner</T></span>
        </div>
      </div>

      {/* Server Name */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          <T>SERVER NAME</T>
        </label>
        <Input
          value={draftString("name")}
          onChange={(e) => settingsDraft.update("name", e.target.value)}
          aria-invalid={Boolean(fieldErrors.name)}
          className={cn(
            "bg-[#111111] border-[#222222] text-white",
            fieldErrors.name && "border-red-500 focus-visible:ring-red-500"
          )}
          placeholder={gt("Enter server name")}
        />
        {fieldErrors.name && <p className="text-xs text-red-400 mt-1">{fieldErrors.name}</p>}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          <T>SERVER DESCRIPTION</T>
        </label>
        <Textarea
          value={draftString("description")}
          onChange={(e) => settingsDraft.update("description", e.target.value)}
          aria-invalid={Boolean(fieldErrors.description)}
          className={cn(
            "bg-[#111111] border-[#222222] text-white min-h-[100px]",
            fieldErrors.description && "border-red-500 focus-visible:ring-red-500"
          )}
          placeholder={gt("Describe what your server is about")}
        />
        {fieldErrors.description && <p className="text-xs text-red-400 mt-1">{fieldErrors.description}</p>}
      </div>

      {/* System Messages Channel */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          <T>SYSTEM MESSAGES CHANNEL</T>
        </label>
        <select
          value={draftString("systemChannelId", "") || ""}
          onChange={(e) => settingsDraft.update("systemChannelId", e.target.value || null)}
          aria-label="System messages channel"
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">{gt("No system messages")}</option>
          {textChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#666666] mt-1">
          <T>Where system messages like welcome messages are sent</T>
        </p>
      </div>

      {/* Rules Channel */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          <T>RULES CHANNEL</T>
        </label>
        <select
          value={draftString("rulesChannelId", "") || ""}
          onChange={(e) => settingsDraft.update("rulesChannelId", e.target.value || null)}
          aria-label="Rules channel"
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">{gt("No rules channel")}</option>
          {textChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#666666] mt-1">
          <T>Display your server rules in Community servers</T>
        </p>
      </div>

      {/* Danger Zone */}
      {isOwner && (
        <div className="pt-6 border-t border-[#222222]">
          <h3 className="text-lg font-semibold text-red-500 mb-4"><T>Danger Zone</T></h3>
          <button
            onClick={handleDeleteServer}
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 rounded-md flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <T>Delete Server</T>
          </button>
        </div>
      )}
    </div>
  );

  const renderRoles = () => {
    const filteredRoles = roleSearch.trim()
      ? roles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
      : roles;
    const permNeedle = permissionSearch.trim().toLowerCase();
    const filteredCategories = permNeedle
      ? ROLE_PERMISSION_CATEGORIES.map((cat) => {
          const perms = cat.permissions.filter(
            (p) =>
              p.label.toLowerCase().includes(permNeedle) ||
              p.description.toLowerCase().includes(permNeedle),
          );
          return { ...cat, permissions: perms };
        }).filter((cat) => cat.permissions.length > 0)
      : ROLE_PERMISSION_CATEGORIES;
    return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>Roles</T></h2>
          <p className="text-sm text-[#888888]"><T>Manage role order, display, and permissions</T></p>
        </div>
        <button
          onClick={handleCreateRole}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <T>Create Role</T>
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Role list sidebar */}
          <div className="space-y-2">
            {roles.length > 0 && (
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
                <input
                  type="text"
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  placeholder={gt("Search roles...")}
                  className="w-full pl-9 pr-3 py-2 bg-[#111111] border border-[#222222] rounded-md text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            )}
            {filteredRoles
              .slice()
              .sort((a, b) => b.position - a.position)
              .map((role) => {
                const isSelected = role.id === selectedRoleId;
                const canDrag = !role.isDefault && !role.managed;
                return (
                  <div
                    key={role.id}
                    draggable={canDrag}
                    onDragStart={() => setDraggingRoleId(role.id)}
                    onDragEnd={() => setDraggingRoleId(null)}
                    onDragOver={(event) => {
                      if (!canDrag) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleRoleDrop(role.id);
                    }}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer",
                      isSelected
                        ? "bg-[#1d1630] border-[#8B5CF6] shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                        : "bg-[#111111] border-[#222222] hover:bg-[#1a1a1a] hover:border-[#333333]",
                      canDrag && "cursor-move",
                      draggingRoleId === role.id && "opacity-50"
                    )}
                  >
                    <GripVertical className={cn("w-4 h-4 flex-shrink-0", canDrag ? "text-[#777777]" : "text-[#333333]")} />
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: role.color || "#888888" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{role.name}</p>
                      <p className="text-[11px] text-[#777777]">
                        {role.memberCount ?? 0} members{role.isDefault ? " • default" : role.managed ? " • managed" : ""}
                      </p>
                    </div>
                    {!role.isDefault && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteRole(role.id);
                        }}
                        className="p-1 hover:bg-red-500/10 rounded text-[#666666] hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            {isReorderingRoles && (
              <p className="text-xs text-[#888888] flex items-center gap-1.5">
                <Loader size={undefined} />
                <T>Saving role order...</T>
              </p>
            )}
          </div>

          {/* Role editor panel */}
          <div className="rounded-lg bg-[#111111] border border-[#222222] flex flex-col max-h-[calc(100vh-220px)]">
            {!selectedRole || !roleDraft ? (
              <div className="flex items-center justify-center py-16 text-sm text-[#888888]">
                <T>Select a role to edit.</T>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-[#222222] flex-shrink-0">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: roleDraft.color || "#888888" }} />
                  <h3 className="text-lg text-white font-semibold">{selectedRole.name}</h3>
                  {selectedRole.isDefault && (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#1f1f1f] text-[#9b9b9b]"><T>Default</T></span>
                  )}
                  {selectedRole.managed && (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#1f1f1f] text-[#9b9b9b]"><T>Managed</T></span>
                  )}
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* Name + Colour */}
                  <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-xs text-[#888888] mb-1.5"><T>Role Name</T></label>
                      <Input
                        value={roleDraft.name}
                        onChange={(event) => setRoleDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                        disabled={selectedRole.isDefault || selectedRole.managed}
                        className="bg-[#0a0a0a] border-[#222222] text-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#888888] mb-1.5"><T>Colour</T></label>
                      <div className="flex items-center gap-2">
                        <ColorInput
                          value={roleDraft.color}
                          onChange={(color) =>
                            setRoleDraft((prev) => (prev ? { ...prev, color } : prev))
                          }
                          disabled={selectedRole.managed}
                        />
                        <span className="text-sm text-[#888888] font-mono">{roleDraft.color}</span>
                      </div>
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] border border-[#222222] cursor-pointer hover:border-[#333333] transition-colors">
                      <div>
                        <span className="text-sm text-white"><T>Display separately</T></span>
                        <p className="text-xs text-[#666666] mt-0.5"><T>Show members with this role separately</T></p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={roleDraft.hoist}
                        disabled={selectedRole.managed}
                        aria-label="Display role members separately"
                        onCheckedChange={(checked) =>
                          setRoleDraft((prev) => (prev ? { ...prev, hoist: checked } : prev))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] border border-[#222222] cursor-pointer hover:border-[#333333] transition-colors">
                      <div>
                        <span className="text-sm text-white"><T>Allow mention</T></span>
                        <p className="text-xs text-[#666666] mt-0.5"><T>Anyone can mention this role</T></p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={roleDraft.mentionable}
                        disabled={selectedRole.managed}
                        aria-label="Allow anyone to mention this role"
                        onCheckedChange={(checked) =>
                          setRoleDraft((prev) => (prev ? { ...prev, mentionable: checked } : prev))
                        }
                      />
                    </label>
                  </div>

                  {/* Permissions */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-white"><T>Permissions</T></h4>
                      <div className="relative flex-1 max-w-[240px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#666666]" />
                        <input
                          type="text"
                          value={permissionSearch}
                          onChange={(e) => setPermissionSearch(e.target.value)}
                          placeholder={gt("Filter permissions...")}
                          className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-md text-xs text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
                        />
                      </div>
                    </div>
                    {filteredCategories.length === 0 ? (
                      <p className="text-sm text-[#666666] text-center py-4"><T>No permissions match your search.</T></p>
                    ) : (
                      filteredCategories.map((category) => (
                        <div key={category.id} className="rounded-lg border border-[#222222] bg-[#0a0a0a] p-3 space-y-2">
                          <p className="text-xs uppercase tracking-wide text-[#8e8e8e] font-semibold">{category.label}</p>
                          {category.permissions.map((permission) => {
                            const checked = hasPermissionBit(roleDraft.permissions, permission.bit);
                            return (
                              <label key={permission.key} className="flex items-start justify-between gap-3 py-1.5 cursor-pointer hover:bg-[#141414] -mx-2 px-2 rounded transition-colors">
                                <div>
                                  <p className={cn("text-sm", checked ? "text-white" : "text-[#aaa]")}>{permission.label}</p>
                                  <p className="text-xs text-[#666666]">{permission.description}</p>
                                </div>
                                <ToggleSwitch
                                  size="sm"
                                  checked={checked}
                                  disabled={selectedRole.managed}
                                  aria-label={permission.label}
                                  onCheckedChange={(next) => handleRolePermissionToggle(permission.bit, next)}
                                  className="mt-1"
                                />
                              </label>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Sticky save bar */}
                <div className="flex items-center justify-between p-3 border-t border-[#222222] flex-shrink-0 bg-[#0d0d0d] rounded-b-lg">
                  <p className="text-xs text-[#666666]">
                    {hasUnsavedRoleChanges ? gt("You have unsaved changes") : gt("All changes saved")}
                  </p>
                  <button
                    onClick={() => void handleSaveRole()}
                    disabled={isSavingRole || selectedRole.managed || !hasUnsavedRoleChanges}
                    className={cn(
                      "px-4 py-2 rounded-md flex items-center gap-2 transition-all",
                      hasUnsavedRoleChanges
                        ? "bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                        : "bg-[#222222] text-[#666666]"
                    )}
                  >
                    {isSavingRole && <Loader size={16} />}
                    {hasUnsavedRoleChanges ? gt("Save Changes") : gt("Saved")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    );
  };

  const handleSaveVanity = async () => {
    if (!currentServer) return;
    setIsSavingVanity(true);
    setVanityError(null);
    try {
      const trimmed = vanityDraft.trim().toLowerCase();
      const res = await fetch(`/api/servers/${currentServer.id}/vanity-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVanityError(data.error || gt("Failed to update custom invite"));
        return;
      }
      setVanityInfo((prev) => ({
        code: data.code ?? null,
        uses: data.uses ?? 0,
        isPartnered: prev?.isPartnered ?? true,
        lockToVanity: data.lockToVanity ?? prev?.lockToVanity ?? false,
      }));
      setVanityDraft(data.code ?? "");
      toast.success(data.code ? gt("Custom invite link updated!") : gt("Custom invite link removed"));
    } catch {
      setVanityError(gt("Something went wrong. Please try again."));
    } finally {
      setIsSavingVanity(false);
    }
  };

  const handleToggleLockVanity = async () => {
    if (!currentServer || !vanityInfo) return;
    const next = !vanityInfo.lockToVanity;
    setIsTogglingLock(true);
    try {
      const res = await fetch(`/api/servers/${currentServer.id}/vanity-url/lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || gt("Failed to update invite lock"));
        return;
      }
      setVanityInfo((prev) => prev ? { ...prev, lockToVanity: next } : prev);
      toast.success(next ? gt("Server invites locked to custom link") : gt("Server invites unlocked"));
    } catch {
      toast.error(gt("Something went wrong. Please try again."));
    } finally {
      setIsTogglingLock(false);
    }
  };

  const renderVanitySection = () => {
    if (!vanityInfo?.isPartnered) return null;
    const vanityDirty = vanityDraft.trim().toLowerCase() !== (vanityInfo.code ?? "");
    return (
      <div className="p-4 rounded-lg bg-[#111111] border border-[#222222] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Crown className="w-4 h-4 text-[#F0B232]" />
              <T>Custom Invite Link</T>
            </h3>
            <p className="text-xs text-[#888888] mt-0.5">
              <T>As a partnered server, you can claim a personalized invite link.</T>
            </p>
          </div>
          {vanityInfo.code && (
            <span className="text-xs text-[#888888]">{vanityInfo.uses} {gt('uses')}</span>
          )}
        </div>
        <div className="flex gap-2">
          <div className="flex items-center flex-1 rounded-md bg-[#0a0a0a] border border-[#222222] focus-within:border-[#8B5CF6] transition-colors overflow-hidden">
            <span className="pl-3 text-sm text-[#666666] font-mono select-none">serika.cc/</span>
            <input
              value={vanityDraft}
              onChange={(e) => {
                setVanityDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                setVanityError(null);
              }}
              placeholder="your-server"
              maxLength={32}
              aria-label="Custom invite link code"
              className="flex-1 h-10 bg-transparent text-white font-mono text-sm outline-none pr-3 min-w-0"
            />
          </div>
          <button
            onClick={handleSaveVanity}
            disabled={isSavingVanity || !vanityDirty}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-2 text-sm font-medium transition-colors"
          >
            {isSavingVanity ? <Loader size={16} /> : <Check className="w-4 h-4" />}
            <T>Save</T>
          </button>
          {vanityInfo.code && (
            <button
              onClick={() => copyToClipboard(`https://serika.cc/${vanityInfo.code}`)}
              aria-label="Copy custom invite link"
              className="p-2 hover:bg-[#1a1a1a] rounded-md text-[#888888] hover:text-white transition-colors"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
        </div>
        {vanityError ? (
          <p className="text-xs text-red-400">{vanityError}</p>
        ) : (
          <p className="text-xs text-[#666666]">
            <T>3-32 characters. Lowercase letters, numbers, and hyphens only. Leave empty and save to remove.</T>
          </p>
        )}
        {vanityInfo.code && (
          <div className="flex items-center justify-between pt-3 border-t border-[#222222]">
            <div>
              <span className="text-sm text-white"><T>Lock to Custom Invite</T></span>
              <p className="text-xs text-[#666666] mt-0.5"><T>Only allow joins through this custom invite link. Hides all other invite links.</T></p>
            </div>
            <ToggleSwitch
              checked={vanityInfo.lockToVanity}
              onCheckedChange={handleToggleLockVanity}
              disabled={isTogglingLock}
              aria-label="Lock invites to custom link"
            />
          </div>
        )}
      </div>
    );
  };

  const renderInvites = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>Server Invites</T></h2>
          <p className="text-sm text-[#888888]"><T>Create and manage invite links</T></p>
        </div>
        <button
          onClick={handleCreateInvite}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <T>Create Invite</T>
        </button>
      </div>

      {renderVanitySection()}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : invites.length === 0 ? (
        <div className="text-center py-12">
          <Link2 className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2"><T>No invites yet</T></h3>
          <p className="text-[#888888] text-sm"><T>Create an invite link to share with others</T></p>
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map((invite) => (
            <div
              key={invite.code}
              className="flex items-center gap-4 p-4 rounded-lg bg-[#111111] border border-[#222222]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-[#8B5CF6] font-mono">
                    serika.cc/{invite.code}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`https://serika.cc/${invite.code}`)}
                    aria-label="Copy invite link"
                    className="p-1 hover:bg-[#1a1a1a] rounded transition-colors"
                  >
                    <Copy className="w-4 h-4 text-[#888888]" />
                  </button>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-[#666666]">
                  <span>#{invite.channel?.name || gt('deleted-channel')}</span>
                  <span>{invite.uses} {gt('uses')}</span>
                  {invite.expiresAt && (
                    <span>{gt('Expires')} {new Date(invite.expiresAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <Avatar className="w-8 h-8">
                <AvatarImage src={cdnImage(invite.createdBy?.avatar)} />
                <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                  {invite.createdBy?.username?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => handleDeleteInvite(invite.code)}
                className="p-2 hover:bg-red-500/10 rounded-md text-[#888888] hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderBans = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1"><T>Server Bans</T></h2>
        <p className="text-sm text-[#888888]"><T>View and manage banned users</T></p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : bans.length === 0 ? (
        <div className="text-center py-12">
          <Ban className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2"><T>No bans</T></h3>
          <p className="text-[#888888] text-sm"><T>There are no banned users in this server</T></p>
        </div>
      ) : (
        <div className="space-y-2">
          {bans.map((ban) => (
            <div
              key={ban.id}
              className="flex items-center gap-4 p-4 rounded-lg bg-[#111111] border border-[#222222]"
            >
              <Avatar className="w-10 h-10">
                <AvatarImage src={cdnImage(ban.avatar)} />
                <AvatarFallback className="bg-[#8B5CF6] text-white">
                  {ban.username.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium">{ban.username}</p>
                {ban.reason && (
                  <p className="text-sm text-[#888888] truncate">{ban.reason}</p>
                )}
              </div>
              <button
                onClick={() => handleUnban(ban.id)}
                className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222222] text-white text-sm rounded-md transition-colors"
              >
                <T>Revoke Ban</T>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderMembers = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>Server Members</T></h2>
          <p className="text-sm text-[#888888]">{members.length} {gt('members')}</p>
        </div>
        <Input
          placeholder={gt("Search members...")}
          value={memberSearch}
          onChange={(event) => setMemberSearch(event.target.value)}
          className="w-64 bg-[#111111] border-[#222222] text-white"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : (
        <div className="space-y-1">
          {members
            .filter((member) => {
              const needle = memberSearch.trim().toLowerCase();
              if (!needle) return true;
              const name = (member.displayName || member.username || "").toLowerCase();
              const username = member.username.toLowerCase();
              return name.includes(needle) || username.includes(needle);
            })
            .map((member, index) => (
              <div
                key={member.id || `member-${index}`}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#111111] transition-colors border border-transparent hover:border-[#222222]"
              >
                <Avatar className="w-10 h-10">
                  <AvatarImage src={cdnImage(member.avatar || undefined)} />
                  <AvatarFallback className="bg-[#8B5CF6] text-white">
                    {(member.displayName || member.username || '?').charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">
                      {member.displayName || member.username}
                    </span>
                    {currentServer.ownerId === member.id && (
                      <Crown className="w-4 h-4 text-[#F59E0B]" />
                    )}
                  </div>
                  <span className="text-sm text-[#888888]">@{member.username}</span>
                  <div className="flex flex-wrap gap-1 mt-1 items-center">
                    {member.roles
                      .filter(r => !r.isDefault)
                      .slice(0, 3)
                      .map((role) => (
                        <span
                          key={`${member.id}-${role.id}`}
                          className="px-2 py-0.5 rounded text-[11px]"
                          style={{ backgroundColor: `${role.color}22`, color: role.color }}
                        >
                          {role.name}
                        </span>
                      ))}
                    {member.roles.filter(r => !r.isDefault).length > 3 && (
                      <span className="px-2 py-0.5 rounded text-[11px] bg-[#1a1a1a] text-[#777777]">
                        +{member.roles.filter(r => !r.isDefault).length - 3}
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-0.5 text-[#888888] hover:text-[#8B5CF6] transition-colors" title={gt("Assign roles")}>
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56 bg-[#111111] border-[#222222] text-[#888888]">
                        <DropdownMenuLabel className="text-xs font-bold text-[#666666] uppercase">
                          <T>Manage Roles</T>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-[#222222]" />
                        <ScrollArea className="h-[200px]">
                          {roles
                            .filter(r => !r.isDefault && !r.managed)
                            .sort((a, b) => b.position - a.position)
                            .map((role) => {
                              const hasRole = member.roles.some(r => r.id === role.id);
                              return (
                                <DropdownMenuCheckboxItem
                                  key={role.id}
                                  checked={hasRole}
                                  onCheckedChange={(checked) =>
                                    handleToggleMemberRole(member, role.id, checked)
                                  }
                                  className="focus:bg-[#8B5CF6] focus:text-white"
                                >
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-2 h-2 rounded-full"
                                      style={{ backgroundColor: role.color }}
                                    />
                                    <span className={hasRole ? "text-white" : ""}>{role.name}</span>
                                  </div>
                                </DropdownMenuCheckboxItem>
                              );
                            })}
                        </ScrollArea>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <details className="relative">
                  <summary className="list-none p-2 hover:bg-[#1a1a1a] rounded-md text-[#888888] transition-colors cursor-pointer">
                    <MoreHorizontal className="w-4 h-4" />
                  </summary>
                  <div className="absolute right-0 mt-2 z-20 w-64 rounded-lg bg-[#0c0c0c] border border-[#222222] p-3 shadow-xl">
                    <p className="text-xs uppercase tracking-wide text-[#888888] mb-2"><T>Assign Roles</T></p>
                    <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                      {roles
                        .slice()
                        .sort((a, b) => b.position - a.position)
                        .map((role) => {
                          const checked = member.roles.some((entry) => entry.id === role.id);
                          const isDisabled = role.isDefault;
                          return (
                            <label key={`${member.id}-${role.id}`} className="flex items-center justify-between gap-2 py-1">
                              <span className="text-sm" style={{ color: role.color || "#ffffff" }}>
                                {role.name}
                              </span>
                              <ToggleSwitch
                                size="sm"
                                checked={checked}
                                disabled={isDisabled}
                                aria-label={`Toggle role ${role.name}`}
                                onCheckedChange={(next) => void handleToggleMemberRole(member, role.id, next)}
                              />
                            </label>
                          );
                        })}
                    </div>
                  </div>
                </details>
              </div>
            ))}
        </div>
      )}
    </div>
  );

  const renderEmoji = () => {
    const filteredEmojis = emojiSearch.trim()
      ? emojis.filter((e) => e.name.toLowerCase().includes(emojiSearch.toLowerCase()))
      : emojis;
    return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>Server Emoji</T></h2>
          <p className="text-sm text-[#888888]"><T>Upload custom emoji for your server</T> ({emojis.length}/500)</p>
        </div>
        <button
          onClick={() => emojiInputRef.current?.click()}
          disabled={isUploadingEmoji}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
        >
          {isUploadingEmoji ? (
            <Loader size={16} />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <T>Upload Emoji</T>
        </button>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={emojiInputRef}
        onChange={handleEmojiUpload}
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
      />

      {/* Search */}
      {emojis.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
          <input
            type="text"
            value={emojiSearch}
            onChange={(e) => setEmojiSearch(e.target.value)}
            placeholder={gt("Search emoji by name...")}
            className="w-full pl-9 pr-3 py-2 bg-[#111111] border border-[#222222] rounded-md text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : emojis.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-[#222222] rounded-lg">
          <Smile className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2"><T>No custom emoji yet</T></h3>
          <p className="text-[#888888] text-sm mb-4"><T>Upload emoji to use in your server</T></p>
          <button
            onClick={() => emojiInputRef.current?.click()}
            disabled={isUploadingEmoji}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md disabled:opacity-50"
          >
            <T>Upload Emoji</T>
          </button>
        </div>
      ) : filteredEmojis.length === 0 ? (
        <div className="text-center py-8 text-[#888888] text-sm">
          {gt("No emoji matching")} "{emojiSearch}"
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {filteredEmojis.map((emoji) => (
            <div
              key={emoji.id}
              className="relative group aspect-square bg-[#111111] border border-[#222222] rounded-lg p-2 flex flex-col items-center justify-center hover:border-[#8B5CF6]/50 transition-colors"
              title={`:${emoji.name}:`}
            >
              <img
                src={cdnImage(emoji.imageUrl)}
                alt={`:${emoji.name}:`}
                className="w-8 h-8 object-contain"
              />
              {emoji.animated && (
                <span className="absolute top-1 left-1 px-1 py-0.5 text-[8px] font-bold bg-[#8B5CF6] text-white rounded">GIF</span>
              )}
              <button
                onClick={() => handleDeleteEmoji(emoji.id)}
                className="absolute top-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              <button
                onClick={() => {
                  setRenamingEmojiId(emoji.id);
                  setEmojiRenameValue(emoji.name);
                }}
                className="absolute top-1 right-7 p-1 bg-[#8B5CF6]/80 hover:bg-[#8B5CF6] rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Pencil className="w-3 h-3 text-white" />
              </button>
              {renamingEmojiId === emoji.id ? (
                <div className="absolute inset-0 bg-[#111111] flex flex-col items-center justify-center gap-1 p-2 z-10">
                  <input
                    type="text"
                    value={emojiRenameValue}
                    onChange={(e) => setEmojiRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameEmoji(emoji.id);
                      if (e.key === "Escape") { setRenamingEmojiId(null); setEmojiRenameValue(""); }
                    }}
                    autoFocus
                    maxLength={32}
                    className="w-full text-xs bg-[#222222] text-white rounded px-1.5 py-1 text-center border border-[#8B5CF6]/50 focus:outline-none focus:border-[#8B5CF6]"
                    placeholder="Name"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRenameEmoji(emoji.id)}
                      className="p-1 bg-[#8B5CF6] hover:bg-[#7C3AED] rounded"
                    >
                      <Check className="w-3 h-3 text-white" />
                    </button>
                    <button
                      onClick={() => { setRenamingEmojiId(null); setEmojiRenameValue(""); }}
                      className="p-1 bg-[#333333] hover:bg-[#444444] rounded"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                </div>
              ) : (
                <span className="absolute bottom-0 left-0 right-0 text-xs text-center text-[#888888] truncate px-1">
                  :{emoji.name}:
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    );
  };

  const renderStickers = () => {
    const filteredStickers = stickerSearch.trim()
      ? stickers.filter((s) => s.name.toLowerCase().includes(stickerSearch.toLowerCase()))
      : stickers;
    return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>Server Stickers</T></h2>
          <p className="text-sm text-[#888888]"><T>Upload custom stickers for your server</T> ({stickers.length}/500)</p>
        </div>
        <button
          onClick={() => stickerInputRef.current?.click()}
          disabled={isUploadingSticker}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
        >
          {isUploadingSticker ? <Loader size={16} /> : <Plus className="w-4 h-4" />}
          {isUploadingSticker ? gt("Uploading...") : gt("Upload Sticker")}
        </button>
      </div>

      <input
        type="file"
        ref={stickerInputRef}
        onChange={handleStickerUpload}
        accept="image/png,image/apng,image/gif,image/webp"
        className="hidden"
      />

      {/* Search */}
      {stickers.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
          <input
            type="text"
            value={stickerSearch ?? ""}
            onChange={(e) => setStickerSearch(e.target.value)}
            placeholder={gt("Search stickers by name...")}
            className="w-full pl-9 pr-3 py-2 bg-[#111111] border border-[#222222] rounded-md text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : stickers.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-[#222222] rounded-lg">
          <Sticker className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2"><T>No stickers yet</T></h3>
          <p className="text-[#888888] text-sm mb-4"><T>Upload stickers to use in messages</T></p>
          <button
            onClick={() => stickerInputRef.current?.click()}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
          >
            <T>Upload First Sticker</T>
          </button>
        </div>
      ) : filteredStickers.length === 0 ? (
        <div className="text-center py-8 text-[#888888] text-sm">
          {gt("No stickers matching")} "{stickerSearch}"
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {filteredStickers.map((sticker) => (
            <div
              key={sticker.id}
              className="relative group rounded-lg bg-[#111111] border border-[#222222] p-2 hover:border-[#8B5CF6]/50 transition-colors"
              title={sticker.name}
            >
              <img
                src={cdnImage(sticker.imageUrl)}
                alt={sticker.name}
                className="w-full aspect-square object-contain rounded"
              />
              <button
                onClick={() => handleDeleteSticker(sticker.id)}
                className="absolute top-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              <button
                onClick={() => {
                  setRenamingStickerId(sticker.id);
                  setStickerRenameValue(sticker.name);
                }}
                className="absolute top-1 right-7 p-1 bg-[#8B5CF6]/80 hover:bg-[#8B5CF6] rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Pencil className="w-3 h-3 text-white" />
              </button>
              {renamingStickerId === sticker.id ? (
                <div className="mt-2 flex flex-col gap-1">
                  <input
                    type="text"
                    value={stickerRenameValue}
                    onChange={(e) => setStickerRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSticker(sticker.id);
                      if (e.key === "Escape") { setRenamingStickerId(null); setStickerRenameValue(""); }
                    }}
                    autoFocus
                    maxLength={30}
                    className="w-full text-xs bg-[#222222] text-white rounded px-1.5 py-1 text-center border border-[#8B5CF6]/50 focus:outline-none focus:border-[#8B5CF6]"
                    placeholder="Name"
                  />
                  <div className="flex gap-1 justify-center">
                    <button
                      onClick={() => handleRenameSticker(sticker.id)}
                      className="p-1 bg-[#8B5CF6] hover:bg-[#7C3AED] rounded"
                    >
                      <Check className="w-3 h-3 text-white" />
                    </button>
                    <button
                      onClick={() => { setRenamingStickerId(null); setStickerRenameValue(""); }}
                      className="p-1 bg-[#333333] hover:bg-[#444444] rounded"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-center text-[#888888] mt-1 truncate">{sticker.name}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    );
  };

  const renderAccess = () => {
    const joinMode = draftString("access.joinMode", "invite_only");
    const options = [
      {
        key: "invite_only",
        icon: Lock,
        title: gt("Invite Only"),
        description: gt("People can join your server directly with an invite"),
      },
      {
        key: "apply_to_join",
        icon: Mail,
        title: gt("Apply to Join"),
        description: gt("People must submit an application and be approved to join"),
      },
      {
        key: "discoverable",
        icon: Globe,
        title: gt("Discoverable"),
        description: gt("Anyone can join your server directly through Server Discovery"),
      },
    ] as const;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>Access</T></h2>
          <p className="text-sm text-[#888888]"><T>Control how people join your server</T></p>
        </div>

        <div className="space-y-3">
          <h3 className="text-white font-medium"><T>How can people join your server?</T></h3>
          <p className="text-sm text-[#888888]">
            <T>Keep your server private, or open it up for more people to join.</T>{" "}
            <a
              href="https://support.discord.com/hc/en-us/articles/29729107418519-Server-Member-Applications"
              target="_blank"
              rel="noreferrer"
              className="text-[#8B5CF6] hover:underline"
            >
              <T>Learn More</T>
            </a>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {options.map((option) => {
              const Icon = option.icon;
              const selected = joinMode === option.key;
              return (
                <button
                  key={option.key}
                  onClick={() => settingsDraft.update("access.joinMode", option.key)}
                  className={cn(
                    "flex flex-col items-center text-center p-4 rounded-xl border transition-colors",
                    selected
                      ? "bg-[#8B5CF6]/10 border-[#8B5CF6]/50"
                      : "bg-[#111111] border-[#222222] hover:border-[#333333]"
                  )}
                >
                  <div className={cn("p-2 rounded-full mb-2", selected ? "text-[#8B5CF6]" : "text-[#888888]")}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className={cn("font-medium", selected ? "text-white" : "text-[#aaaaaa]")}>
                    {option.title}
                  </span>
                  <span className="text-xs text-[#888888] mt-1">{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        {joinMode === "discoverable" && (
          <div className="space-y-4 p-4 rounded-lg bg-[#111111] border border-[#222222] animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-2">
              <label className="text-white font-medium text-sm"><T>Discovery Description</T></label>
              <Textarea
                placeholder={gt("A brief description of your server shown in Server Discovery...")}
                value={draftString("discoveryDescription")}
                onChange={(e) => settingsDraft.update("discoveryDescription", e.target.value)}
                maxLength={1024}
                className="bg-[#0a0d15] border-[#222222] text-white placeholder-[#555555] focus:border-[#8B5CF6] min-h-[80px]"
              />
              <p className="text-xs text-[#888888] text-right">
                {draftString("discoveryDescription").length}/1024
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-white font-medium text-sm"><T>Discovery Categories</T></label>
              <p className="text-xs text-[#888888]"><T>Select up to 3 categories that best describe your server</T></p>
              <div className="flex flex-wrap gap-2 pt-1">
                {[
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
                ].map((cat) => {
                  const selectedCats = (settingsDraft.draft.discoveryCategories as string[]) || [];
                  const isSelected = selectedCats.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
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
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95",
                        isSelected
                          ? "bg-[#8B5CF6] border-[#8B5CF6] text-white shadow-md shadow-[#8B5CF6]/20"
                          : "bg-[#0a0d15] border-[#222222] text-[#888888] hover:border-[#333333] hover:text-[#d5d9e8]"
                      )}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-medium"><T>Age-Restricted Server</T></span>
              <p className="text-sm text-[#888888] mt-1">
                <T>Users will need to confirm they are over the legal age to view the content in this server.</T>{" "}
                <a
                  href="https://support.discord.com/hc/en-us/articles/115000084051"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#8B5CF6] hover:underline"
                >
                  <T>Learn more</T>
                </a>
              </p>
            </div>
            <ToggleSwitch
              checked={draftBool("isAgeGated")}
              onCheckedChange={(checked) => {
                settingsDraft.update("isAgeGated", checked);
                if (checked) {
                  settingsDraft.update("access.joinMode", "invite_only");
                }
              }}
              aria-label="Age-restricted server"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderApplications = () => {
    const filtered = applicationFilter === "all"
      ? applications
      : applications.filter((app) => app.status === applicationFilter);

    const statusBadge = (status: ServerApplication["status"]) => {
      const styles = {
        pending: "bg-yellow-500/10 text-yellow-500",
        approved: "bg-green-500/10 text-green-500",
        rejected: "bg-red-500/10 text-red-500",
        interviewed: "bg-blue-500/10 text-blue-500",
      };
      return (
        <span className={cn("px-2 py-0.5 rounded text-xs font-medium", styles[status])}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      );
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-1"><T>Member Applications</T></h2>
            <p className="text-sm text-[#888888]"><T>Review and manage server member applications</T></p>
          </div>
          <select
            value={applicationFilter}
            onChange={(e) => setApplicationFilter(e.target.value as typeof applicationFilter)}
            className="h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white text-sm"
          >
            <option value="all">{gt("All Types")}</option>
            <option value="pending">{gt("Pending")}</option>
            <option value="approved">{gt("Approved")}</option>
            <option value="rejected">{gt("Rejected")}</option>
            <option value="interviewed">{gt("Interviewed")}</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader size={32} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <ClipboardList className="w-12 h-12 text-[#666666] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2"><T>No applications</T></h3>
            <p className="text-[#888888] text-sm">
              {applicationFilter === "all"
                ? gt("There are no member applications to review")
                : gt("No {filter} applications", { filter: applicationFilter })}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((app) => (
              <div
                key={app.id}
                className="p-4 rounded-lg bg-[#111111] border border-[#222222] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={cdnImage(app.user.avatar)} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white">
                        {(app.user.displayName || app.user.username || "?").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-white font-medium">
                        {app.user.displayName || app.user.username}
                      </p>
                      <p className="text-xs text-[#888888]">@{app.user.username}</p>
                    </div>
                  </div>
                  {statusBadge(app.status)}
                </div>

                <div className="space-y-2">
                  {app.answers.map((answer, index) => (
                    <div key={index}>
                      <p className="text-xs text-[#888888] uppercase">{answer.question}</p>
                      <p className="text-sm text-white">{answer.answer}</p>
                    </div>
                  ))}
                </div>

                {app.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={() => handleReviewApplication(app.id, "approved")}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md"
                    >
                      <T>Approve</T>
                    </button>
                    <button
                      onClick={() => handleReviewApplication(app.id, "interviewed")}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md"
                    >
                      <T>Interview</T>
                    </button>
                    <button
                      onClick={() => {
                        const reason = window.prompt(gt("Rejection reason (optional):"));
                        if (reason === null) return;
                        void handleReviewApplication(app.id, "rejected", reason || undefined);
                      }}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md"
                    >
                      <T>Reject</T>
                    </button>
                  </div>
                )}

                {app.rejectionReason && (
                  <p className="text-xs text-red-400">{gt("Reason")}: {app.rejectionReason}</p>
                )}

                <p className="text-xs text-[#666666]">
                  {gt("Submitted")} {new Date(app.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderAppDiscovery = () => {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1"><T>App Discovery</T></h2>
          <p className="text-sm text-[#888888]"><T>Browse and add public bots to your server</T></p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
          <Input
            value={appSearch}
            onChange={(e) => setAppSearch(e.target.value)}
            placeholder={gt("Search bots and apps...")}
            className="pl-10 bg-[#111111] border-[#222222] text-white placeholder:text-[#555555] focus-visible:ring-[#8B5CF6]"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-10 text-sm text-[#888888]"><Loader size={20} className="mx-auto" /></div>
        ) : discoverableApps.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[#222222] rounded-xl bg-[#111111]">
            <Bot className="w-10 h-10 text-[#666666] mx-auto mb-3 opacity-50" />
            <p className="text-sm text-[#888888]">
              {appSearch ? gt("No bots found matching your search") : gt("No public bots available yet")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {discoverableApps.map((app) => (
              <div
                key={app.id}
                className="flex items-start gap-3 p-4 rounded-xl border border-[#222222] bg-[#111111] hover:border-[#333333] transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {app.icon ? (
                    <img src={cdnImage(app.icon)} alt={app.name} className="w-full h-full object-cover" />
                  ) : (
                    <Bot className="w-6 h-6 text-[#8B5CF6]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-white truncate">{app.name}</span>
                    {app.botId && <Sparkles className="w-3 h-3 text-[#8B5CF6] shrink-0" />}
                  </div>
                  <p className="text-xs text-[#888888] line-clamp-2 mt-0.5">
                    {app.description || gt("No description")}
                  </p>
                  {app.tags && Array.isArray(app.tags) && app.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {app.tags.slice(0, 3).map((tag: string) => (
                        <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-[#8B5CF6]/10 text-[#8B5CF6] font-medium">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <a
                  href={`/api/developers/applications/${app.id}/add?server_id=${currentServer?.id}`}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
                >
                  {gt("Add")}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderWidget = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1"><T>Server Widget</T></h2>
        <p className="text-sm text-[#888888]"><T>Embed your server on your website</T></p>
      </div>

      <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white font-medium"><T>Enable Server Widget</T></span>
          <button
            onClick={() => settingsDraft.update("widget.enabled", !draftBool("widget.enabled", true))}
            role="switch"
            aria-checked={draftBool("widget.enabled", true)}
            aria-label="Enable server widget"
            className={cn("w-12 h-6 rounded-full relative transition-colors", draftBool("widget.enabled", true) ? "bg-[#8B5CF6]" : "bg-[#222222]")}
          >
            <div className={cn(
              "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
              draftBool("widget.enabled", true) ? "translate-x-6 left-0.5" : "left-0.5"
            )} />
          </button>
        </div>
        <p className="text-sm text-[#888888]">
          <T>Allow people to embed your server info on their websites</T>
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          <T>INVITE CHANNEL</T>
        </label>
        <select
          value={draftString("widget.channelId", "") || ""}
          onChange={(e) => settingsDraft.update("widget.channelId", e.target.value || null)}
          aria-label="Widget invite channel"
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">{gt("Select a channel")}</option>
          {textChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>#{channel.name}</option>
          ))}
        </select>
        {fieldErrors["widget.channelId"] && (
          <p className="text-xs text-red-400 mt-1">{fieldErrors["widget.channelId"]}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          <T>WIDGET CODE</T>
        </label>
        <div className="p-3 rounded-md bg-[#111111] border border-[#222222] font-mono text-sm text-[#888888]">
          {`<iframe src="https://serika.chat/widget/${currentServer.id}" width="350" height="500" />`}
        </div>
        <button
          onClick={() => copyToClipboard(`<iframe src=\"https://serika.chat/widget/${currentServer.id}\" width=\"350\" height=\"500\" />`)}
          className="mt-2 text-sm text-[#8B5CF6] hover:underline flex items-center gap-1"
        >
          <Copy className="w-4 h-4" />
          <T>Copy Code</T>
        </button>
      </div>
    </div>
  );

  const renderAuditLog = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1"><T>Audit Log</T></h2>
        <p className="text-sm text-[#888888]"><T>View a record of all changes made to your server</T></p>
      </div>

      <div className="flex gap-4 mb-4">
        <select className="h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white">
          <option value="">{gt("All users")}</option>
        </select>
        <select className="h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white">
          <option value="">{gt("All actions")}</option>
          <option value="channel_create">{gt("Channel Created")}</option>
          <option value="channel_delete">{gt("Channel Deleted")}</option>
          <option value="role_create">{gt("Role Created")}</option>
          <option value="role_delete">{gt("Role Deleted")}</option>
          <option value="member_ban">{gt("Member Banned")}</option>
          <option value="member_kick">{gt("Member Kicked")}</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : auditLogs.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2"><T>No audit log entries</T></h3>
          <p className="text-[#888888] text-sm"><T>Actions taken in your server will appear here</T></p>
        </div>
      ) : (
        <div className="space-y-2">
          {auditLogs.map((log) => (
            <div key={log.id} className="p-3 rounded-lg bg-[#111111] border border-[#222222]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={cdnImage(log.admin?.avatar)} />
                    <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                      {(log.admin?.username || "?").charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-white font-medium">{log.admin?.username || gt("System")}</span>
                  <span className="text-xs text-[#888888] uppercase">{log.action.replace(/_/g, " ")}</span>
                </div>
                <span className="text-xs text-[#666666]">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
              {log.reason && <p className="text-xs text-[#888888] mt-1">{gt("Reason")}: {log.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderModeration = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1"><T>Moderation</T></h2>
        <p className="text-sm text-[#888888]"><T>Configure moderation settings for your server</T></p>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium"><T>Verification Level</T></span>
          </div>
          <select
            value={draftString("moderation.verificationLevel", "none")}
            onChange={(e) => settingsDraft.update("moderation.verificationLevel", e.target.value)}
            aria-label="Verification level"
            className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
          >
            <option value="none">{gt("None - Unrestricted")}</option>
            <option value="low">{gt("Low - Must have verified email")}</option>
            <option value="medium">{gt("Medium - Registered for 5+ minutes")}</option>
            <option value="high">{gt("High - Member for 10+ minutes")}</option>
            <option value="very_high">{gt("Highest - Must have verified phone")}</option>
          </select>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium"><T>Explicit Media Content Filter</T></span>
          </div>
          <select
            value={draftString("moderation.explicitContentFilter", "disabled")}
            onChange={(e) => settingsDraft.update("moderation.explicitContentFilter", e.target.value)}
            aria-label="Explicit media content filter"
            className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
          >
            <option value="disabled">{gt("Don&apos;t scan any media content")}</option>
            <option value="members_without_roles">{gt("Scan content from members without roles")}</option>
            <option value="all_members">{gt("Scan content from all members")}</option>
          </select>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-medium"><T>2FA Requirement</T></span>
              <p className="text-sm text-[#888888] mt-1">
                <T>Require moderators to have 2FA enabled</T>
              </p>
            </div>
            <button
              onClick={() => settingsDraft.update("moderation.require2FA", !draftBool("moderation.require2FA"))}
              role="switch"
              aria-checked={draftBool("moderation.require2FA")}
              aria-label="Require 2FA for moderators"
              className={cn("w-12 h-6 rounded-full relative transition-colors", draftBool("moderation.require2FA") ? "bg-[#8B5CF6]" : "bg-[#222222]")}
            >
              <div className={cn(
                "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
                draftBool("moderation.require2FA") ? "translate-x-6 left-0.5" : "left-0.5"
              )} />
            </button>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-medium"><T>Raid Protection</T></span>
              <p className="text-sm text-[#888888] mt-1"><T>Auto-enable stricter checks during suspicious joins</T></p>
            </div>
            <button
              onClick={() => settingsDraft.update("safety.raidProtection", !draftBool("safety.raidProtection"))}
              role="switch"
              aria-checked={draftBool("safety.raidProtection")}
              aria-label="Raid protection"
              className={cn("w-12 h-6 rounded-full relative transition-colors", draftBool("safety.raidProtection") ? "bg-[#8B5CF6]" : "bg-[#222222]")}
            >
              <div className={cn(
                "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
                draftBool("safety.raidProtection") ? "translate-x-6 left-0.5" : "left-0.5"
              )} />
            </button>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium"><T>Mention Spam Limit</T></span>
            <span className="text-sm text-[#888888]">{draftNumber("safety.mentionSpamLimit", 5)}</span>
          </div>
          <input
            type="range"
            min={2}
            max={20}
            value={draftNumber("safety.mentionSpamLimit", 5)}
            onChange={(e) => settingsDraft.update("safety.mentionSpamLimit", Number(e.target.value))}
            aria-label="Mention spam limit"
            className="w-full accent-[#8B5CF6]"
          />
          <label className="mt-3 flex items-center justify-between cursor-pointer">
            <span className="text-sm text-[#888888]"><T>Enable anti-spam checks</T></span>
            <ToggleSwitch size="sm" checked={draftBool("safety.antiSpam", true)} onCheckedChange={(checked) => settingsDraft.update("safety.antiSpam", checked)} />
          </label>
        </div>
      </div>
    </div>
  );

  const renderSoundboard = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1"><T>Soundboard</T></h2>
        <p className="text-sm text-[#888888]"><T>Configure soundboard availability</T></p>
      </div>

      <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
        <div className="flex items-center justify-between">
          <span className="text-white font-medium"><T>Enable Soundboard</T></span>
          <ToggleSwitch
            checked={draftBool("soundboard.enabled", true)}
            onCheckedChange={(checked) => settingsDraft.update("soundboard.enabled", checked)}
            aria-label="Enable soundboard"
          />
        </div>
        <p className="text-xs text-[#666666] mt-2"><T>Playback volume is now a personal preference in User Settings → Voice &amp; Video.</T></p>
      </div>

      {/* Sound list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white"><T>Sounds</T> ({soundboardSounds.length}/500)</h3>
            <p className="text-xs text-[#888888]"><T>Upload audio files (max 20MB, 30s, mp3/wav/ogg)</T></p>
          </div>
          <button
            onClick={() => soundInputRef.current?.click()}
            disabled={isUploadingSound}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
          >
            {isUploadingSound ? <Loader size={16} /> : <Plus className="w-4 h-4" />}
            <T>Upload Sound</T>
          </button>
        </div>

        <input
          type="file"
          ref={soundInputRef}
          onChange={handleSoundUpload}
          accept="audio/mpeg,audio/wav,audio/ogg,audio/mp3,audio/x-wav"
          className="hidden"
        />

        {soundboardSounds.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-[#222222] rounded-lg">
            <Volume2 className="w-12 h-12 text-[#666666] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2"><T>No sounds yet</T></h3>
            <p className="text-[#888888] text-sm mb-4"><T>Upload audio files to use in voice channels</T></p>
            <button
              onClick={() => soundInputRef.current?.click()}
              className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
            >
              <T>Upload First Sound</T>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {soundboardSounds.map((sound) => (
              <div
                key={sound._id}
                className="relative group flex items-center gap-3 p-3 bg-[#111111] border border-[#222222] rounded-lg hover:border-[#8B5CF6]/50 transition-colors"
              >
                <button
                  onClick={() => playSound(sound)}
                  className="flex-shrink-0 w-10 h-10 rounded-full bg-[#8B5CF6] hover:bg-[#7C3AED] flex items-center justify-center transition-colors"
                >
                  {playingSoundId === sound._id ? (
                    <Loader size={20} />
                  ) : (
                    <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{sound.name}</p>
                  <p className="text-xs text-[#666666]">{sound.emoji}</p>
                </div>
                <button
                  onClick={() => handleDeleteSound(sound._id)}
                  className="flex-shrink-0 p-1 bg-red-500/80 hover:bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );

  const renderIntegrations = () => {
    const isDiscordEnabled = draftBool("integrations.discord");
    const isTwitchEnabled = draftBool("integrations.twitch");
    const isYoutubeEnabled = draftBool("integrations.youtube");
    const isWebhooksEnabled = draftBool("integrations.webhooks");

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Integrations</h2>
          <p className="text-sm text-[#888888]">Enable or disable external integrations for your server</p>
        </div>

        <div className="space-y-4">
          {/* Discord Card */}
          <div className="p-4 rounded-lg bg-[#111111] border border-[#222222] space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#5865F2]/15 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#5865F2]" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.872-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-semibold flex items-center gap-2">
                    <T>Discord Bridge</T>
                  </p>
                  <p className="text-sm text-[#888888]"><T>Sync channels, roles, and messages bidirectionally with Discord</T></p>
                </div>
              </div>
              <ToggleSwitch
                checked={isDiscordEnabled}
                onCheckedChange={(checked) => settingsDraft.update("integrations.discord", checked)}
                aria-label="Discord Bridge"
              />
            </div>

            {isDiscordEnabled && (
              <div className="pt-4 border-t border-[#222222] space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Bot Status & Invite */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0d0d0d] border border-[#1e1e1e]">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white"><T>SerikaCord Bot</T></p>
                    <p className="text-[11px] text-[#888888]"><T>Online and listening for messages via Gateway</T></p>
                  </div>
                  <a
                    href="https://discord.com/oauth2/authorize?client_id=1524469730256355421&permissions=8&scope=bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-white font-semibold bg-[#5865F2] hover:bg-[#4752c4] rounded-md h-8 px-3 transition-colors shrink-0"
                  >
                    <T>Invite Bot</T> <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Guild ID Input */}
                <div>
                  <label className="block text-xs font-semibold text-[#888888] mb-2"><T>DISCORD SERVER (GUILD) ID</T></label>
                  <Input
                    type="text"
                    placeholder={gt("e.g. 1161608848428236902")}
                    value={draftString("integrations.discordGuildId", "")}
                    onChange={(e) => settingsDraft.update("integrations.discordGuildId", e.target.value)}
                    className="bg-[#0a0a0a] border-[#222222] text-white font-mono text-sm"
                  />
                  <p className="text-[11px] text-[#666666] mt-1.5">
                    <T>Right-click your Discord server &gt; Copy Server ID (enable Developer Mode in Discord settings)</T>
                  </p>
                </div>

                {/* Advanced Sync Controls */}
                <div className="bg-[#181818] p-4 rounded-md border border-[#2c2c2c] space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white"><T>Channel &amp; Role Sync</T></p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#888888] mb-2"><T>SYNC MODE</T></label>
                    <select
                      value={draftString("integrations.discordMode", "add")}
                      onChange={(e) => settingsDraft.update("integrations.discordMode", e.target.value)}
                      className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
                    >
                      <option value="add">{gt("Keep existing channels, add Discord channels alongside")}</option>
                      <option value="delete">{gt("Replace all channels with Discord channels (destructive)")}</option>
                    </select>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleDiscordSync}
                      disabled={isSyncingDiscord}
                      className="px-4 h-9 bg-[#5865F2] hover:bg-[#4752c4] disabled:bg-[#5865F2]/50 text-white text-xs font-semibold rounded-md flex items-center gap-2 transition-colors"
                    >
                      {isSyncingDiscord ? (
                        <>
                          <Loader size={undefined} />
                          <T>Syncing...</T>
                        </>
                      ) : (
                        gt("Sync Channels & Roles")
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMockTrigger("discord")}
                      disabled={isTriggeringDiscord}
                      className="px-4 h-9 bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 text-white text-xs font-semibold rounded-md flex items-center gap-2 transition-colors"
                    >
                      {isTriggeringDiscord ? (
                        <>
                          <Loader size={undefined} />
                          <T>Testing...</T>
                        </>
                      ) : (
                        gt("Send Test Message")
                      )}
                    </button>
                  </div>
                </div>

                {/* Info Banner */}
                <div className="flex items-start gap-2 p-3 rounded-md bg-[#5865F2]/8 border border-[#5865F2]/20">
                  <Check className="w-3.5 h-3.5 text-[#5865F2] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#a8b1ff] leading-relaxed">
                    <T>Messages from Discord appear in SerikaCord with the author&apos;s Discord username and tag. Messages sent in SerikaCord are relayed back to Discord via the bot. Webhooks are auto-provisioned during sync.</T>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Twitch Card */}
          <div className="p-4 rounded-lg bg-[#111111] border border-[#222222] space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white font-medium flex items-center gap-2">
                  <span className="text-[#a970ff] font-semibold"><T>Twitch Integration</T></span>
                </p>
                <p className="text-sm text-[#888888]"><T>Post stream notifications automatically</T></p>
              </div>
              <ToggleSwitch
                checked={isTwitchEnabled}
                onCheckedChange={(checked) => settingsDraft.update("integrations.twitch", checked)}
                aria-label="Twitch"
              />
            </div>

            {isTwitchEnabled && (
              <div className="pt-4 border-t border-[#222222] space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#888888] mb-2"><T>TWITCH CHANNEL NAME</T></label>
                    <Input
                      type="text"
                      placeholder={gt("e.g. shroud")}
                      value={draftString("integrations.twitchChannel", "")}
                      onChange={(e) => settingsDraft.update("integrations.twitchChannel", e.target.value)}
                      className="bg-[#0a0a0a] border-[#222222] text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#888888] mb-2"><T>NOTIFICATION CHANNEL</T></label>
                    <select
                      value={draftString("integrations.twitchNotificationChannelId", "")}
                      onChange={(e) => settingsDraft.update("integrations.twitchNotificationChannelId", e.target.value)}
                      className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
                    >
                      <option value="">{gt("Select a channel")}</option>
                      {textChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>#{channel.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleMockTrigger("twitch")}
                    disabled={isTriggeringTwitch}
                    className="px-4 h-9 bg-[#a970ff] hover:bg-[#b88cff] disabled:bg-[#7e55bf] text-white text-xs font-semibold rounded-md flex items-center gap-2 transition-colors"
                  >
                    {isTriggeringTwitch ? (
                      <>
                        <Loader size={undefined} />
                        <T>Triggering...</T>
                      </>
                    ) : (
                      gt("Trigger Mock Stream Live Alert")
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* YouTube Card */}
          <div className="p-4 rounded-lg bg-[#111111] border border-[#222222] space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white font-medium flex items-center gap-2">
                  <span className="text-[#FF0000] font-semibold"><T>YouTube Integration</T></span>
                </p>
                <p className="text-sm text-[#888888]"><T>Post notifications for new uploads and videos</T></p>
              </div>
              <ToggleSwitch
                checked={isYoutubeEnabled}
                onCheckedChange={(checked) => settingsDraft.update("integrations.youtube", checked)}
                aria-label="YouTube"
              />
            </div>

            {isYoutubeEnabled && (
              <div className="pt-4 border-t border-[#222222] space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#888888] mb-2"><T>YOUTUBE CHANNEL ID OR NAME</T></label>
                    <Input
                      type="text"
                      placeholder={gt("e.g. MrBeast")}
                      value={draftString("integrations.youtubeChannel", "")}
                      onChange={(e) => settingsDraft.update("integrations.youtubeChannel", e.target.value)}
                      className="bg-[#0a0a0a] border-[#222222] text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#888888] mb-2"><T>NOTIFICATION CHANNEL</T></label>
                    <select
                      value={draftString("integrations.youtubeNotificationChannelId", "")}
                      onChange={(e) => settingsDraft.update("integrations.youtubeNotificationChannelId", e.target.value)}
                      className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
                    >
                      <option value="">{gt("Select a channel")}</option>
                      {textChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>#{channel.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleMockTrigger("youtube")}
                    disabled={isTriggeringYoutube}
                    className="px-4 h-9 bg-[#FF0000] hover:bg-[#ff3333] disabled:bg-[#cc0000] text-white text-xs font-semibold rounded-md flex items-center gap-2 transition-colors"
                  >
                    {isTriggeringYoutube ? (
                      <>
                        <Loader size={undefined} />
                        <T>Triggering...</T>
                      </>
                    ) : (
                      gt("Trigger Mock Video Upload Alert")
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Webhooks Card */}
          <div className="p-4 rounded-lg bg-[#111111] border border-[#222222] flex items-center justify-between gap-4">
            <div>
              <p className="text-white font-medium"><T>Custom Webhooks</T></p>
              <p className="text-sm text-[#888888]"><T>Allow inbound/outbound webhook automations</T></p>
            </div>
            <ToggleSwitch
              checked={isWebhooksEnabled}
              onCheckedChange={(checked) => settingsDraft.update("integrations.webhooks", checked)}
              aria-label="Custom Webhooks"
            />
          </div>
        </div>
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
        return renderInvites();
      case "bans":
        return renderBans();
      case "members":
        return renderMembers();
      case "emoji":
        return renderEmoji();
      case "stickers":
        return renderStickers();
      case "widget":
        return renderWidget();
      case "audit-log":
        return renderAuditLog();
      case "soundboard":
        return renderSoundboard();
      case "moderation":
      case "safety":
        return renderModeration();
      case "integrations":
        return renderIntegrations();
      case "access":
        return renderAccess();
      case "applications":
        return renderApplications();
      case "app_discovery":
        return renderAppDiscovery();
      default:
        return renderOverview();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={gt("Server settings for {name}", { name: currentServer.name })}
      className="fixed inset-0 z-50 bg-[#0a0a0a] flex"
    >
      {/* Sidebar */}
      <div className="w-56 md:w-64 bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col">
        <ScrollArea className="flex-1 py-4">
          <div className="space-y-6 px-2">
            {menuSections.map((section) => (
              <div key={section.title}>
                <h3 className="px-3 mb-1 text-xs font-semibold uppercase text-[#666666] truncate">
                  {section.title}
                </h3>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const showBadge = pendingAppCount > 0 && (item.id === "applications" || item.id === "members");
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                          activeTab === item.id
                            ? "bg-[#8B5CF6]/10 text-white"
                            : "text-[#888888] hover:bg-[#111111] hover:text-white"
                        )}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate flex-1 text-left">{item.label}</span>
                        {showBadge && (
                          <span className="ml-auto px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] text-center">
                            {pendingAppCount > 99 ? "99+" : pendingAppCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 flex items-center justify-end px-4 border-b border-[#1a1a1a]">
          <button
            onClick={handleRequestClose}
            aria-label={gt("Close server settings")}
            className="p-2 rounded-full hover:bg-[#1a1a1a] text-[#888888] hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-[#8B5CF6]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content — wide tabs (roles, members, bans) use the full container;
            form-style tabs stay comfortably readable at a narrower width. */}
        <ScrollArea className="flex-1">
          <div
            className={cn(
              "mx-auto p-6 md:p-8 pb-24",
              WIDE_SETTINGS_TABS.has(activeTab) ? "max-w-6xl" : "max-w-2xl"
            )}
          >
            {renderContent()}
          </div>
        </ScrollArea>

        {/* Sticky transactional save bar (covers every settings tab) */}
        <div className="px-4">
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
            className="mb-4"
          />
        </div>
      </div>

      {/* Image Cropper */}
      <ImageCropper
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        imageUrl={cropperImage}
        aspectRatio={cropperType === "icon" ? 1 : 2}
        onCropComplete={handleCropComplete}
        title={cropperType === "icon" ? gt("Crop Server Icon") : gt("Crop Server Banner")}
        description={
          cropperType === "icon"
            ? gt("Adjust the crop area to select the portion of the image for your server icon.")
            : gt("Adjust the crop area to select the portion of the image for your server banner.")
        }
        circular={cropperType === "icon"}
      />

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
    </div>
  );
}
