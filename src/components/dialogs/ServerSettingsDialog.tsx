"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
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
  Loader2,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
import { hasPermissionBit, setPermissionBit } from "@/lib/roles/bitfield";
import { useSettingsDraft, type SettingsDraft } from "@/hooks/useSettingsDraft";
import { UnsavedChangesBar } from "@/components/ui/unsaved-changes-bar";
import { AudioTrimmerDialog } from "@/components/dialogs/AudioTrimmerDialog";

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
  | "channels";

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
  _id: string;
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
  _id: string;
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

export function ServerSettingsDialog({ open, onOpenChange }: ServerSettingsDialogProps) {
  const { currentServer, fetchServers, channels } = useServer();
  const { user } = useAuth();
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
  const [vanityInfo, setVanityInfo] = useState<{ code: string | null; uses: number; isPartnered: boolean } | null>(null);
  const [vanityDraft, setVanityDraft] = useState("");
  const [isSavingVanity, setIsSavingVanity] = useState(false);
  const [vanityError, setVanityError] = useState<string | null>(null);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [stickers, setStickers] = useState<ServerSticker[]>([]);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [stickerSearch, setStickerSearch] = useState("");
  const [soundboardSounds, setSoundboardSounds] = useState<{ _id: string; name: string; url: string; emoji: string }[]>([]);
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const [trimmerOpen, setTrimmerOpen] = useState(false);
  const [trimmerFile, setTrimmerFile] = useState<File | null>(null);
  const soundInputRef = useRef<HTMLInputElement>(null);
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [textChannels, setTextChannels] = useState<ServerChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
        "integrations.twitch": false,
        "integrations.youtube": false,
        "integrations.webhooks": false,
        "soundboard.enabled": true,
        "soundboard.volume": 100,
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
          base["integrations.twitch"] = Boolean(s.integrations?.twitch);
          base["integrations.youtube"] = Boolean(s.integrations?.youtube);
          base["integrations.webhooks"] = Boolean(s.integrations?.webhooks);
          base["soundboard.enabled"] = s.soundboard?.enabled ?? true;
          base["soundboard.volume"] = s.soundboard?.volume ?? 100;
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
              setEmojis(data.emojis || []);
            }
            break;
          case "stickers":
            const stickersRes = await fetch(`/api/servers/${currentServer.id}/stickers`);
            if (stickersRes.ok) {
              const data = await stickersRes.json();
              setStickers(data.stickers || []);
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
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeTab, open, currentServer, fetchMembersData, fetchRolesData]);

  // Reset role draft init ref when dialog closes (so opening again starts fresh)
  useEffect(() => {
    if (!open) {
      roleDraftInitIdRef.current = null;
    }
  }, [open]);

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
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (8MB max)
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be less than 8MB");
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
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be less than 8MB");
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
        toast.success(`Server ${cropperType} updated!`);
        await fetchServers();
      } else {
        const data = await response.json();
        toast.error(data.error || `Failed to upload ${cropperType}`);
      }
    } catch {
      toast.error(`Failed to upload ${cropperType}`);
    } finally {
      setUploading(false);
    }
  };

  // Human-readable labels for server-side field errors
  const FIELD_LABELS: Record<string, string> = {
    name: "Server name",
    description: "Description",
    systemChannelId: "System messages channel",
    rulesChannelId: "Rules channel",
    afkChannelId: "AFK channel",
    afkTimeout: "AFK timeout",
    "widget.enabled": "Widget",
    "widget.channelId": "Widget invite channel",
    "moderation.verificationLevel": "Verification level",
    "moderation.explicitContentFilter": "Content filter",
    "moderation.require2FA": "2FA requirement",
    "safety.raidProtection": "Raid protection",
    "safety.antiSpam": "Anti-spam",
    "safety.mentionSpamLimit": "Mention spam limit",
    "integrations.discord": "Discord integration",
    "integrations.twitch": "Twitch integration",
    "integrations.youtube": "YouTube integration",
    "integrations.webhooks": "Webhooks integration",
    "soundboard.enabled": "Soundboard",
    "soundboard.volume": "Soundboard volume",
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
        toast.success("Settings saved");
        await fetchServers();
      } else if (response.status === 400 && data?.fieldErrors) {
        setFieldErrors(data.fieldErrors as Record<string, string>);
        const entries = Object.entries(data.fieldErrors as Record<string, string>);
        const [firstField, firstMessage] = entries[0];
        toast.error(`${FIELD_LABELS[firstField] || firstField}: ${firstMessage}`, {
          description: entries.length > 1 ? `${entries.length - 1} more field${entries.length > 2 ? "s" : ""} need attention` : undefined,
        });
      } else {
        toast.error(data?.error || "Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings. Check your connection and try again.");
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
      const discard = window.confirm("You have unsaved changes. Discard them and close?");
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
        toast.success("Role created!");
      } else {
        toast.error("Failed to create role");
      }
    } catch (error) {
      console.error("Failed to create role:", error);
      toast.error("Failed to create role");
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
        toast.success("Role deleted");
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to delete role");
      }
    } catch (error) {
      console.error("Failed to delete role:", error);
      toast.error("Failed to delete role");
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
        throw new Error(data?.error || "Failed to reorder roles");
      }

      const data = await response.json();
      setRoles((data.roles || []) as Role[]);
    } catch (error) {
      setRoles(previous);
      toast.error(error instanceof Error ? error.message : "Failed to reorder roles");
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
      toast.success("Role updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
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
      toast.error(error instanceof Error ? error.message : "Failed to update member roles");
    }
  };

  const handleEmojiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (256KB max for emoji)
    if (file.size > 256 * 1024) {
      toast.error("Emoji must be less than 256KB");
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
        setEmojis(prev => [...prev, data.emoji]);
        toast.success("Emoji uploaded!");
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to create emoji");
      }
    } catch (error) {
      console.error("Failed to upload emoji:", error);
      toast.error("Failed to upload emoji");
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
        setEmojis(prev => prev.filter(e => e._id !== emojiId));
        toast.success("Emoji deleted");
      } else {
        toast.error("Failed to delete emoji");
      }
    } catch (error) {
      console.error("Failed to delete emoji:", error);
      toast.error("Failed to delete emoji");
    }
  };

  const handleStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentServer) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 512 * 1024) {
      toast.error("Sticker must be less than 512KB");
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
        setStickers((prev) => [data.sticker, ...prev]);
        toast.success("Sticker uploaded");
      } else {
        const data = await createRes.json();
        toast.error(data.error || "Failed to save sticker");
      }
    } catch (error) {
      console.error("Failed to upload sticker:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload sticker");
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
        setStickers((prev) => prev.filter((sticker) => sticker._id !== stickerId));
        toast.success("Sticker deleted");
      } else {
        toast.error("Failed to delete sticker");
      }
    } catch (error) {
      console.error("Failed to delete sticker:", error);
      toast.error("Failed to delete sticker");
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
        toast.success("Sound added!");
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to add sound");
      }
    } catch (error) {
      console.error("Failed to upload sound:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload sound");
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
      toast.error("File must be an audio file");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error("Sound must be less than 20MB");
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
        toast.success("Sound deleted");
      } else {
        toast.error("Failed to delete sound");
      }
    } catch {
      toast.error("Failed to delete sound");
    }
  };

  const playSound = (sound: { _id: string; url: string }) => {
    const audio = new Audio(sound.url);
    // Audio.volume caps at 1.0; values above 100% previously threw IndexSizeError
    audio.volume = Math.min(Math.max(draftNumber("soundboard.volume", 100), 0) / 100, 1);
    audio.play().catch(() => toast.error("Failed to play sound"));
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
        toast.success("Invite created!");
      } else {
        toast.error("Failed to create invite");
      }
    } catch (error) {
      console.error("Failed to create invite:", error);
      toast.error("Failed to create invite");
    }
  };

  const handleDeleteInvite = async (code: string) => {
    if (!currentServer) return;
    try {
      await fetch(`/api/servers/${currentServer.id}/invites/${code}`, {
        method: "DELETE",
      });
      setInvites(prev => prev.filter(i => i.code !== code));
      toast.success("Invite deleted");
    } catch (error) {
      console.error("Failed to delete invite:", error);
      toast.error("Failed to delete invite");
    }
  };

  const handleUnban = async (userId: string) => {
    if (!currentServer) return;
    try {
      await fetch(`/api/servers/${currentServer.id}/bans/${userId}`, {
        method: "DELETE",
      });
      setBans(prev => prev.filter(b => b.id !== userId));
      toast.success("User unbanned");
    } catch (error) {
      console.error("Failed to unban user:", error);
      toast.error("Failed to unban user");
    }
  };

  const handleDeleteServer = async () => {
    if (!currentServer) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${currentServer.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/servers/${currentServer.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Server deleted");
        onOpenChange(false);
        window.location.href = "/channels/me";
      }
    } catch (error) {
      console.error("Failed to delete server:", error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  if (!open || !currentServer) return null;

  const isOwner = currentServer.ownerId === user?.id;

  const menuSections = [
    {
      title: currentServer.name,
      items: [
        { id: "overview" as SettingsTab, label: "Overview", icon: Settings },
        { id: "roles" as SettingsTab, label: "Roles", icon: Shield },
        { id: "emoji" as SettingsTab, label: "Emoji", icon: Smile },
        { id: "stickers" as SettingsTab, label: "Stickers", icon: Sticker },
        { id: "soundboard" as SettingsTab, label: "Soundboard", icon: Volume2 },
        { id: "widget" as SettingsTab, label: "Widget", icon: ExternalLink },
      ],
    },
    {
      title: "Moderation",
      items: [
        { id: "safety" as SettingsTab, label: "Safety Setup", icon: Shield },
        { id: "moderation" as SettingsTab, label: "Moderation", icon: AlertTriangle },
        { id: "audit-log" as SettingsTab, label: "Audit Log", icon: FileText },
        { id: "bans" as SettingsTab, label: "Bans", icon: Ban },
      ],
    },
    {
      title: "User Management",
      items: [
        { id: "members" as SettingsTab, label: "Members", icon: Users },
        { id: "invites" as SettingsTab, label: "Invites", icon: Link2 },
        { id: "integrations" as SettingsTab, label: "Integrations", icon: Folder },
      ],
    },
  ];

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Server Overview</h2>
        <p className="text-sm text-[#888888]">Customize your server&apos;s identity</p>
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
              <AvatarImage src={serverIcon || undefined} />
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
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : (
                <Camera className="w-8 h-8 text-white" />
              )}
            </button>
          </div>
          <span className="text-xs text-[#666666]">Server Icon</span>
        </div>

        {/* Banner */}
        <div className="flex-1">
          <div className="relative group aspect-[2/1] max-h-40 rounded-lg overflow-hidden bg-gradient-to-r from-[#8B5CF6] to-[#6366F1]">
            {serverBanner && (
              <img src={serverBanner} alt="Banner" className="w-full h-full object-cover" />
            )}
            <button
              onClick={() => bannerInputRef.current?.click()}
              disabled={isUploadingBanner}
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
            >
              {isUploadingBanner ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : (
                <Camera className="w-8 h-8 text-white" />
              )}
            </button>
          </div>
          <span className="text-xs text-[#666666] mt-1 block">Server Banner</span>
        </div>
      </div>

      {/* Server Name */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          SERVER NAME
        </label>
        <Input
          value={draftString("name")}
          onChange={(e) => settingsDraft.update("name", e.target.value)}
          aria-invalid={Boolean(fieldErrors.name)}
          className={cn(
            "bg-[#111111] border-[#222222] text-white",
            fieldErrors.name && "border-red-500 focus-visible:ring-red-500"
          )}
          placeholder="Enter server name"
        />
        {fieldErrors.name && <p className="text-xs text-red-400 mt-1">{fieldErrors.name}</p>}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          SERVER DESCRIPTION
        </label>
        <Textarea
          value={draftString("description")}
          onChange={(e) => settingsDraft.update("description", e.target.value)}
          aria-invalid={Boolean(fieldErrors.description)}
          className={cn(
            "bg-[#111111] border-[#222222] text-white min-h-[100px]",
            fieldErrors.description && "border-red-500 focus-visible:ring-red-500"
          )}
          placeholder="Describe what your server is about"
        />
        {fieldErrors.description && <p className="text-xs text-red-400 mt-1">{fieldErrors.description}</p>}
      </div>

      {/* System Messages Channel */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          SYSTEM MESSAGES CHANNEL
        </label>
        <select
          value={draftString("systemChannelId", "") || ""}
          onChange={(e) => settingsDraft.update("systemChannelId", e.target.value || null)}
          aria-label="System messages channel"
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">No system messages</option>
          {textChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#666666] mt-1">
          Where system messages like welcome messages are sent
        </p>
      </div>

      {/* Rules Channel */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          RULES CHANNEL
        </label>
        <select
          value={draftString("rulesChannelId", "") || ""}
          onChange={(e) => settingsDraft.update("rulesChannelId", e.target.value || null)}
          aria-label="Rules channel"
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">No rules channel</option>
          {textChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#666666] mt-1">
          Display your server rules in Community servers
        </p>
      </div>

      {/* Danger Zone */}
      {isOwner && (
        <div className="pt-6 border-t border-[#222222]">
          <h3 className="text-lg font-semibold text-red-500 mb-4">Danger Zone</h3>
          <button
            onClick={handleDeleteServer}
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 rounded-md flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Server
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
          <h2 className="text-xl font-bold text-white mb-1">Roles</h2>
          <p className="text-sm text-[#888888]">Manage role order, display, and permissions</p>
        </div>
        <button
          onClick={handleCreateRole}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Role
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
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
                  placeholder="Search roles..."
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
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving role order...
              </p>
            )}
          </div>

          {/* Role editor panel */}
          <div className="rounded-lg bg-[#111111] border border-[#222222] flex flex-col max-h-[calc(100vh-220px)]">
            {!selectedRole || !roleDraft ? (
              <div className="flex items-center justify-center py-16 text-sm text-[#888888]">
                Select a role to edit.
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-[#222222] flex-shrink-0">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: roleDraft.color || "#888888" }} />
                  <h3 className="text-lg text-white font-semibold">{selectedRole.name}</h3>
                  {selectedRole.isDefault && (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#1f1f1f] text-[#9b9b9b]">Default</span>
                  )}
                  {selectedRole.managed && (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#1f1f1f] text-[#9b9b9b]">Managed</span>
                  )}
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* Name + Color */}
                  <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-xs text-[#888888] mb-1.5">Role Name</label>
                      <Input
                        value={roleDraft.name}
                        onChange={(event) => setRoleDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                        disabled={selectedRole.isDefault || selectedRole.managed}
                        className="bg-[#0a0a0a] border-[#222222] text-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#888888] mb-1.5">Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={roleDraft.color}
                          onChange={(event) =>
                            setRoleDraft((prev) => (prev ? { ...prev, color: event.target.value } : prev))
                          }
                          disabled={selectedRole.managed}
                          className="w-10 h-10 p-1 rounded bg-[#0a0a0a] border border-[#222222] disabled:opacity-60 cursor-pointer"
                        />
                        <span className="text-sm text-[#888888] font-mono">{roleDraft.color}</span>
                      </div>
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] border border-[#222222] cursor-pointer hover:border-[#333333] transition-colors">
                      <div>
                        <span className="text-sm text-white">Display separately</span>
                        <p className="text-xs text-[#666666] mt-0.5">Show members with this role separately</p>
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
                        <span className="text-sm text-white">Allow mention</span>
                        <p className="text-xs text-[#666666] mt-0.5">Anyone can mention this role</p>
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
                      <h4 className="text-sm font-semibold text-white">Permissions</h4>
                      <div className="relative flex-1 max-w-[240px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#666666]" />
                        <input
                          type="text"
                          value={permissionSearch}
                          onChange={(e) => setPermissionSearch(e.target.value)}
                          placeholder="Filter permissions..."
                          className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-md text-xs text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
                        />
                      </div>
                    </div>
                    {filteredCategories.length === 0 ? (
                      <p className="text-sm text-[#666666] text-center py-4">No permissions match your search.</p>
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
                    {hasUnsavedRoleChanges ? "You have unsaved changes" : "All changes saved"}
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
                    {isSavingRole && <Loader2 className="w-4 h-4 animate-spin" />}
                    {hasUnsavedRoleChanges ? "Save Changes" : "Saved"}
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
        setVanityError(data.error || "Failed to update custom invite");
        return;
      }
      setVanityInfo((prev) => ({
        code: data.code ?? null,
        uses: data.uses ?? 0,
        isPartnered: prev?.isPartnered ?? true,
      }));
      setVanityDraft(data.code ?? "");
      toast.success(data.code ? "Custom invite link updated!" : "Custom invite link removed");
    } catch {
      setVanityError("Something went wrong. Please try again.");
    } finally {
      setIsSavingVanity(false);
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
              Custom Invite Link
            </h3>
            <p className="text-xs text-[#888888] mt-0.5">
              As a partnered server, you can claim a personalized invite link.
            </p>
          </div>
          {vanityInfo.code && (
            <span className="text-xs text-[#888888]">{vanityInfo.uses} uses</span>
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
            {isSavingVanity ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save
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
            3-32 characters. Lowercase letters, numbers, and hyphens only. Leave empty and save to remove.
          </p>
        )}
      </div>
    );
  };

  const renderInvites = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Server Invites</h2>
          <p className="text-sm text-[#888888]">Create and manage invite links</p>
        </div>
        <button
          onClick={handleCreateInvite}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Invite
        </button>
      </div>

      {renderVanitySection()}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
        </div>
      ) : invites.length === 0 ? (
        <div className="text-center py-12">
          <Link2 className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No invites yet</h3>
          <p className="text-[#888888] text-sm">Create an invite link to share with others</p>
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
                  <span>#{invite.channel?.name || 'deleted-channel'}</span>
                  <span>{invite.uses} uses</span>
                  {invite.expiresAt && (
                    <span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <Avatar className="w-8 h-8">
                <AvatarImage src={invite.createdBy?.avatar} />
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
        <h2 className="text-xl font-bold text-white mb-1">Server Bans</h2>
        <p className="text-sm text-[#888888]">View and manage banned users</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
        </div>
      ) : bans.length === 0 ? (
        <div className="text-center py-12">
          <Ban className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No bans</h3>
          <p className="text-[#888888] text-sm">There are no banned users in this server</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bans.map((ban) => (
            <div
              key={ban.id}
              className="flex items-center gap-4 p-4 rounded-lg bg-[#111111] border border-[#222222]"
            >
              <Avatar className="w-10 h-10">
                <AvatarImage src={ban.avatar} />
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
                Revoke Ban
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
          <h2 className="text-xl font-bold text-white mb-1">Server Members</h2>
          <p className="text-sm text-[#888888]">{members.length} members</p>
        </div>
        <Input
          placeholder="Search members..."
          value={memberSearch}
          onChange={(event) => setMemberSearch(event.target.value)}
          className="w-64 bg-[#111111] border-[#222222] text-white"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
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
                  <AvatarImage src={member.avatar || undefined} />
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
                        <button className="p-0.5 text-[#888888] hover:text-[#8B5CF6] transition-colors" title="Assign roles">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56 bg-[#111111] border-[#222222] text-[#888888]">
                        <DropdownMenuLabel className="text-xs font-bold text-[#666666] uppercase">
                          Manage Roles
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
                    <p className="text-xs uppercase tracking-wide text-[#888888] mb-2">Assign Roles</p>
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
          <h2 className="text-xl font-bold text-white mb-1">Server Emoji</h2>
          <p className="text-sm text-[#888888]">Upload custom emoji for your server ({emojis.length}/50)</p>
        </div>
        <button
          onClick={() => emojiInputRef.current?.click()}
          disabled={isUploadingEmoji}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
        >
          {isUploadingEmoji ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Upload Emoji
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
            placeholder="Search emoji by name..."
            className="w-full pl-9 pr-3 py-2 bg-[#111111] border border-[#222222] rounded-md text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
        </div>
      ) : emojis.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-[#222222] rounded-lg">
          <Smile className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No custom emoji yet</h3>
          <p className="text-[#888888] text-sm mb-4">Upload emoji to use in your server</p>
          <button
            onClick={() => emojiInputRef.current?.click()}
            disabled={isUploadingEmoji}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md disabled:opacity-50"
          >
            Upload Emoji
          </button>
        </div>
      ) : filteredEmojis.length === 0 ? (
        <div className="text-center py-8 text-[#888888] text-sm">
          No emoji matching &quot;{emojiSearch}&quot;
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {filteredEmojis.map((emoji) => (
            <div
              key={emoji._id}
              className="relative group aspect-square bg-[#111111] border border-[#222222] rounded-lg p-2 flex flex-col items-center justify-center hover:border-[#8B5CF6]/50 transition-colors"
              title={`:${emoji.name}:`}
            >
              <img
                src={emoji.imageUrl}
                alt={`:${emoji.name}:`}
                className="w-8 h-8 object-contain"
              />
              {emoji.animated && (
                <span className="absolute top-1 left-1 px-1 py-0.5 text-[8px] font-bold bg-[#8B5CF6] text-white rounded">GIF</span>
              )}
              <button
                onClick={() => handleDeleteEmoji(emoji._id)}
                className="absolute top-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              <span className="absolute bottom-0 left-0 right-0 text-xs text-center text-[#888888] truncate px-1">
                :{emoji.name}:
              </span>
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
          <h2 className="text-xl font-bold text-white mb-1">Server Stickers</h2>
          <p className="text-sm text-[#888888]">Upload custom stickers for your server ({stickers.length}/15)</p>
        </div>
        <button
          onClick={() => stickerInputRef.current?.click()}
          disabled={isUploadingSticker}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
        >
          {isUploadingSticker ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {isUploadingSticker ? "Uploading..." : "Upload Sticker"}
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
            placeholder="Search stickers by name..."
            className="w-full pl-9 pr-3 py-2 bg-[#111111] border border-[#222222] rounded-md text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
        </div>
      ) : stickers.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-[#222222] rounded-lg">
          <Sticker className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No stickers yet</h3>
          <p className="text-[#888888] text-sm mb-4">Upload stickers to use in messages</p>
          <button
            onClick={() => stickerInputRef.current?.click()}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
          >
            Upload First Sticker
          </button>
        </div>
      ) : filteredStickers.length === 0 ? (
        <div className="text-center py-8 text-[#888888] text-sm">
          No stickers matching &quot;{stickerSearch}&quot;
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {filteredStickers.map((sticker) => (
            <div
              key={sticker._id}
              className="relative group rounded-lg bg-[#111111] border border-[#222222] p-2 hover:border-[#8B5CF6]/50 transition-colors"
              title={sticker.name}
            >
              <img
                src={sticker.imageUrl}
                alt={sticker.name}
                className="w-full aspect-square object-contain rounded"
              />
              <button
                onClick={() => handleDeleteSticker(sticker._id)}
                className="absolute top-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              <p className="text-xs text-center text-[#888888] mt-1 truncate">{sticker.name}</p>
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
        <h2 className="text-xl font-bold text-white mb-1">Server Widget</h2>
        <p className="text-sm text-[#888888]">Embed your server on your website</p>
      </div>

      <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white font-medium">Enable Server Widget</span>
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
          Allow people to embed your server info on their websites
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          INVITE CHANNEL
        </label>
        <select
          value={draftString("widget.channelId", "") || ""}
          onChange={(e) => settingsDraft.update("widget.channelId", e.target.value || null)}
          aria-label="Widget invite channel"
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">Select a channel</option>
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
          WIDGET CODE
        </label>
        <div className="p-3 rounded-md bg-[#111111] border border-[#222222] font-mono text-sm text-[#888888]">
          {`<iframe src="https://serika.chat/widget/${currentServer.id}" width="350" height="500" />`}
        </div>
        <button
          onClick={() => copyToClipboard(`<iframe src=\"https://serika.chat/widget/${currentServer.id}\" width=\"350\" height=\"500\" />`)}
          className="mt-2 text-sm text-[#8B5CF6] hover:underline flex items-center gap-1"
        >
          <Copy className="w-4 h-4" />
          Copy Code
        </button>
      </div>
    </div>
  );

  const renderAuditLog = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Audit Log</h2>
        <p className="text-sm text-[#888888]">View a record of all changes made to your server</p>
      </div>

      <div className="flex gap-4 mb-4">
        <select className="h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white">
          <option value="">All users</option>
        </select>
        <select className="h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white">
          <option value="">All actions</option>
          <option value="channel_create">Channel Created</option>
          <option value="channel_delete">Channel Deleted</option>
          <option value="role_create">Role Created</option>
          <option value="role_delete">Role Deleted</option>
          <option value="member_ban">Member Banned</option>
          <option value="member_kick">Member Kicked</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
        </div>
      ) : auditLogs.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-[#666666] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No audit log entries</h3>
          <p className="text-[#888888] text-sm">Actions taken in your server will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {auditLogs.map((log) => (
            <div key={log.id} className="p-3 rounded-lg bg-[#111111] border border-[#222222]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={log.admin?.avatar} />
                    <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                      {(log.admin?.username || "?").charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-white font-medium">{log.admin?.username || "System"}</span>
                  <span className="text-xs text-[#888888] uppercase">{log.action.replace(/_/g, " ")}</span>
                </div>
                <span className="text-xs text-[#666666]">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
              {log.reason && <p className="text-xs text-[#888888] mt-1">Reason: {log.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderModeration = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Moderation</h2>
        <p className="text-sm text-[#888888]">Configure moderation settings for your server</p>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">Verification Level</span>
          </div>
          <select
            value={draftString("moderation.verificationLevel", "none")}
            onChange={(e) => settingsDraft.update("moderation.verificationLevel", e.target.value)}
            aria-label="Verification level"
            className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
          >
            <option value="none">None - Unrestricted</option>
            <option value="low">Low - Must have verified email</option>
            <option value="medium">Medium - Registered for 5+ minutes</option>
            <option value="high">High - Member for 10+ minutes</option>
            <option value="very_high">Highest - Must have verified phone</option>
          </select>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">Explicit Media Content Filter</span>
          </div>
          <select
            value={draftString("moderation.explicitContentFilter", "disabled")}
            onChange={(e) => settingsDraft.update("moderation.explicitContentFilter", e.target.value)}
            aria-label="Explicit media content filter"
            className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white"
          >
            <option value="disabled">Don&apos;t scan any media content</option>
            <option value="members_without_roles">Scan content from members without roles</option>
            <option value="all_members">Scan content from all members</option>
          </select>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-medium">2FA Requirement</span>
              <p className="text-sm text-[#888888] mt-1">
                Require moderators to have 2FA enabled
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
              <span className="text-white font-medium">Raid Protection</span>
              <p className="text-sm text-[#888888] mt-1">Auto-enable stricter checks during suspicious joins</p>
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
            <span className="text-white font-medium">Mention Spam Limit</span>
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
            <span className="text-sm text-[#888888]">Enable anti-spam checks</span>
            <ToggleSwitch size="sm" checked={draftBool("safety.antiSpam", true)} onCheckedChange={(checked) => settingsDraft.update("safety.antiSpam", checked)} />
          </label>
        </div>
      </div>
    </div>
  );

  const renderSoundboard = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Soundboard</h2>
        <p className="text-sm text-[#888888]">Configure soundboard availability and playback volume</p>
      </div>

      <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white font-medium">Enable Soundboard</span>
          <ToggleSwitch
            checked={draftBool("soundboard.enabled", true)}
            onCheckedChange={(checked) => settingsDraft.update("soundboard.enabled", checked)}
            aria-label="Enable soundboard"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#888888]">Playback Volume</span>
            <span className="text-sm text-white">{draftNumber("soundboard.volume", 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            value={draftNumber("soundboard.volume", 100)}
            onChange={(e) => settingsDraft.update("soundboard.volume", Number(e.target.value))}
            aria-label="Soundboard playback volume"
            className="w-full accent-[#8B5CF6]"
          />
        </div>
      </div>

      {/* Sound list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Sounds ({soundboardSounds.length}/20)</h3>
            <p className="text-xs text-[#888888]">Upload audio files (max 20MB, 30s, mp3/wav/ogg)</p>
          </div>
          <button
            onClick={() => soundInputRef.current?.click()}
            disabled={isUploadingSound}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
          >
            {isUploadingSound ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Upload Sound
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
            <h3 className="text-lg font-semibold text-white mb-2">No sounds yet</h3>
            <p className="text-[#888888] text-sm mb-4">Upload audio files to use in voice channels</p>
            <button
              onClick={() => soundInputRef.current?.click()}
              className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
            >
              Upload First Sound
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
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
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

  const renderIntegrations = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Integrations</h2>
        <p className="text-sm text-[#888888]">Enable or disable external integrations for your server</p>
      </div>

      <div className="space-y-3">
        {[
          { key: "discord", label: "Discord Bridge", description: "Sync webhook announcements from Discord channels" },
          { key: "twitch", label: "Twitch", description: "Announce stream go-live events in your server" },
          { key: "youtube", label: "YouTube", description: "Post new video notifications to announcement channels" },
          { key: "webhooks", label: "Custom Webhooks", description: "Allow inbound/outbound webhook automations" },
        ].map((integration) => (
          <div key={integration.key} className="p-4 rounded-lg bg-[#111111] border border-[#222222] flex items-center justify-between gap-4">
            <div>
              <p className="text-white font-medium">{integration.label}</p>
              <p className="text-sm text-[#888888]">{integration.description}</p>
            </div>
            <ToggleSwitch
              checked={draftBool(`integrations.${integration.key}`)}
              onCheckedChange={(checked) => settingsDraft.update(`integrations.${integration.key}`, checked)}
              aria-label={integration.label}
            />
          </div>
        ))}
      </div>

    </div>
  );

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
      default:
        return renderOverview();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Server settings for ${currentServer.name}`}
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
                  {section.items.map((item) => (
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
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
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
            aria-label="Close server settings"
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
        title={cropperType === "icon" ? "Crop Server Icon" : "Crop Server Banner"}
        description={
          cropperType === "icon"
            ? "Adjust the crop area to select the portion of the image for your server icon."
            : "Adjust the crop area to select the portion of the image for your server banner."
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
