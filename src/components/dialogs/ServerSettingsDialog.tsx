"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  DropdownMenuItem,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";
import { hasPermissionBit, setPermissionBit } from "@/lib/roles/bitfield";

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
  const [hasChanges, setHasChanges] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);

  // Image cropper state
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string>("");
  const [cropperType, setCropperType] = useState<"icon" | "banner">("icon");

  // Server settings state
  const [serverName, setServerName] = useState("");
  const [serverDescription, setServerDescription] = useState("");
  const [serverIcon, setServerIcon] = useState<string | null>(null);
  const [serverBanner, setServerBanner] = useState<string | null>(null);
  const [systemChannel, setSystemChannel] = useState<string | null>(null);
  const [rulesChannel, setRulesChannel] = useState<string | null>(null);
  const [afkChannel, setAfkChannel] = useState<string | null>(null);
  const [afkTimeout, setAfkTimeout] = useState(300);

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
  const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isReorderingRoles, setIsReorderingRoles] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleSavingId, setMemberRoleSavingId] = useState<string | null>(null);
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [stickers, setStickers] = useState<ServerSticker[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [textChannels, setTextChannels] = useState<ServerChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Emoji upload refs
  const emojiInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingEmoji, setIsUploadingEmoji] = useState(false);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingSticker, setIsUploadingSticker] = useState(false);

  // Advanced server settings
  const [widgetEnabled, setWidgetEnabled] = useState(true);
  const [widgetChannelId, setWidgetChannelId] = useState<string>("");
  const [verificationLevel, setVerificationLevel] = useState<'none' | 'low' | 'medium' | 'high' | 'very_high'>('none');
  const [explicitContentFilter, setExplicitContentFilter] = useState<'disabled' | 'members_without_roles' | 'all_members'>('disabled');
  const [require2FA, setRequire2FA] = useState(false);
  const [raidProtection, setRaidProtection] = useState(false);
  const [antiSpam, setAntiSpam] = useState(true);
  const [mentionSpamLimit, setMentionSpamLimit] = useState(5);
  const [integrationFlags, setIntegrationFlags] = useState({
    discord: false,
    twitch: false,
    youtube: false,
    webhooks: false,
  });
  const [soundboardEnabled, setSoundboardEnabled] = useState(true);
  const [soundboardVolume, setSoundboardVolume] = useState(100);

  // Initialize with server data
  useEffect(() => {
    if (currentServer) {
      const server = currentServer as typeof currentServer & {
        description?: string;
        banner?: string | null;
        systemChannelId?: string | null;
        rulesChannelId?: string | null;
        afkChannelId?: string | null;
        afkTimeout?: number;
      };
      setServerName(currentServer.name);
      setServerDescription(server.description || "");
      setServerIcon(server.icon || null);
      setServerBanner(server.banner || null);
      setSystemChannel(server.systemChannelId || null);
      setRulesChannel(server.rulesChannelId || null);
      setAfkChannel(server.afkChannelId || null);
      setAfkTimeout(server.afkTimeout || 300);
    }
  }, [currentServer]);

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
          case "invites":
            const invitesRes = await fetch(`/api/servers/${currentServer.id}/invites`);
            if (invitesRes.ok) {
              const data = await invitesRes.json();
              setInvites(data.invites || []);
            }
            break;
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
          case "widget":
          case "soundboard":
          case "moderation":
          case "safety":
          case "integrations":
            const settingsRes = await fetch(`/api/servers/${currentServer.id}/settings`);
            if (settingsRes.ok) {
              const data = await settingsRes.json();
              const serverSettings = data.settings || {};
              setWidgetEnabled(serverSettings.widget?.enabled ?? true);
              setWidgetChannelId(serverSettings.widget?.channelId || "");
              setVerificationLevel(serverSettings.moderation?.verificationLevel || "none");
              setExplicitContentFilter(serverSettings.moderation?.explicitContentFilter || "disabled");
              setRequire2FA(serverSettings.moderation?.require2FA || false);
              setRaidProtection(serverSettings.safety?.raidProtection || false);
              setAntiSpam(serverSettings.safety?.antiSpam ?? true);
              setMentionSpamLimit(serverSettings.safety?.mentionSpamLimit || 5);
              setIntegrationFlags({
                discord: serverSettings.integrations?.discord || false,
                twitch: serverSettings.integrations?.twitch || false,
                youtube: serverSettings.integrations?.youtube || false,
                webhooks: serverSettings.integrations?.webhooks || false,
              });
              setSoundboardEnabled(serverSettings.soundboard?.enabled ?? true);
              setSoundboardVolume(serverSettings.soundboard?.volume ?? 100);
            }
            break;
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeTab, open, currentServer, fetchMembersData, fetchRolesData]);

  useEffect(() => {
    if (!roles.length) {
      setSelectedRoleId(null);
      setRoleDraft(null);
      return;
    }

    const fallbackRole = roles.find((role) => !role.isDefault) || roles[0];
    const selectedRole = roles.find((role) => role.id === selectedRoleId) || fallbackRole;
    if (!selectedRole) return;

    if (selectedRoleId !== selectedRole.id) {
      setSelectedRoleId(selectedRole.id);
    }

    setRoleDraft({
      name: selectedRole.name,
      color: selectedRole.color || "#99AAB5",
      permissions: selectedRole.permissions || "0",
      hoist: Boolean(selectedRole.hoist),
      mentionable: Boolean(selectedRole.mentionable),
    });
  }, [roles, selectedRoleId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

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

  const handleSaveOverview = async () => {
    if (!currentServer) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/servers/${currentServer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: serverName,
          description: serverDescription,
          systemChannelId: systemChannel,
          rulesChannelId: rulesChannel,
          afkChannelId: afkChannel,
          afkTimeout: afkTimeout,
        }),
      });

      if (response.ok) {
        setHasChanges(false);
        toast.success("Server settings saved!");
        await fetchServers();
      } else {
        toast.error("Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

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
      toast.success("Role updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    } finally {
      setIsSavingRole(false);
    }
  };

  const handleToggleMemberRole = async (member: ServerMember, roleId: string, checked: boolean) => {
    if (!currentServer) return;

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

    setMemberRoleSavingId(member.id);
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

      const data = await response.json();
      const updatedMember = data.member as ServerMember;
      setMembers((prev) => prev.map((entry) => (entry.id === updatedMember.id ? updatedMember : entry)));
      await fetchRolesData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update member roles");
    } finally {
      setMemberRoleSavingId(null);
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

  const handleSaveAdvancedSettings = async (section: "widget" | "moderation" | "safety" | "integrations" | "soundboard") => {
    if (!currentServer) return;

    const payload = {
      widget: {
        enabled: widgetEnabled,
        channelId: widgetChannelId || null,
      },
      moderation: {
        verificationLevel,
        explicitContentFilter,
        require2FA,
      },
      safety: {
        raidProtection,
        antiSpam,
        mentionSpamLimit,
      },
      integrations: integrationFlags,
      soundboard: {
        enabled: soundboardEnabled,
        volume: soundboardVolume,
      },
    };

    try {
      const response = await fetch(`/api/servers/${currentServer.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            [section]: payload[section],
          },
        }),
      });
      if (response.ok) {
        toast.success("Settings saved");
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    }
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
                {serverName.charAt(0).toUpperCase()}
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
          <div className="relative group h-24 rounded-lg overflow-hidden bg-gradient-to-r from-[#8B5CF6] to-[#6366F1]">
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
          value={serverName}
          onChange={(e) => {
            setServerName(e.target.value);
            setHasChanges(true);
          }}
          className="bg-[#111111] border-[#222222] text-white"
          placeholder="Enter server name"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          SERVER DESCRIPTION
        </label>
        <Textarea
          value={serverDescription}
          onChange={(e) => {
            setServerDescription(e.target.value);
            setHasChanges(true);
          }}
          className="bg-[#111111] border-[#222222] text-white min-h-[100px]"
          placeholder="Describe what your server is about"
        />
      </div>

      {/* System Messages Channel */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-2">
          SYSTEM MESSAGES CHANNEL
        </label>
        <select
          value={systemChannel || ""}
          onChange={(e) => {
            setSystemChannel(e.target.value || null);
            setHasChanges(true);
          }}
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
          value={rulesChannel || ""}
          onChange={(e) => {
            setRulesChannel(e.target.value || null);
            setHasChanges(true);
          }}
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

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSaveOverview}
            disabled={isSaving}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      )}

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

  const renderRoles = () => (
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
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
          <div className="space-y-2">
            {roles
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
                      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                      isSelected
                        ? "bg-[#1d1630] border-[#8B5CF6]"
                        : "bg-[#111111] border-[#222222] hover:bg-[#1a1a1a]",
                      canDrag && "cursor-move",
                      draggingRoleId === role.id && "opacity-60"
                    )}
                  >
                    <GripVertical className={cn("w-4 h-4", canDrag ? "text-[#777777]" : "text-[#444444]")} />
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color || "#888888" }} />
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
              <p className="text-xs text-[#888888]">Saving role order...</p>
            )}
          </div>

          <div className="rounded-lg bg-[#111111] border border-[#222222] p-4 space-y-4">
            {!selectedRole || !roleDraft ? (
              <div className="text-sm text-[#888888]">Select a role to edit.</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg text-white font-semibold">{selectedRole.name}</h3>
                  {selectedRole.managed && (
                    <span className="text-xs px-2 py-1 rounded bg-[#1f1f1f] text-[#9b9b9b]">Managed role</span>
                  )}
                </div>

                <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <div>
                    <label className="block text-xs text-[#888888] mb-1">Role Name</label>
                    <Input
                      value={roleDraft.name}
                      onChange={(event) => setRoleDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                      disabled={selectedRole.isDefault || selectedRole.managed}
                      className="bg-[#0a0a0a] border-[#222222] text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#888888] mb-1">Color</label>
                    <input
                      type="color"
                      value={roleDraft.color}
                      onChange={(event) =>
                        setRoleDraft((prev) => (prev ? { ...prev, color: event.target.value } : prev))
                      }
                      disabled={selectedRole.managed}
                      className="w-12 h-10 p-1 rounded bg-[#0a0a0a] border border-[#222222] disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between p-3 rounded bg-[#0a0a0a] border border-[#222222]">
                    <span className="text-sm text-white">Display role separately</span>
                    <input
                      type="checkbox"
                      checked={roleDraft.hoist}
                      disabled={selectedRole.managed}
                      onChange={(event) =>
                        setRoleDraft((prev) => (prev ? { ...prev, hoist: event.target.checked } : prev))
                      }
                      className="w-4 h-4 accent-[#8B5CF6]"
                    />
                  </label>
                  <label className="flex items-center justify-between p-3 rounded bg-[#0a0a0a] border border-[#222222]">
                    <span className="text-sm text-white">Allow anyone to mention</span>
                    <input
                      type="checkbox"
                      checked={roleDraft.mentionable}
                      disabled={selectedRole.managed}
                      onChange={(event) =>
                        setRoleDraft((prev) => (prev ? { ...prev, mentionable: event.target.checked } : prev))
                      }
                      className="w-4 h-4 accent-[#8B5CF6]"
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-white">Permissions</h4>
                  {ROLE_PERMISSION_CATEGORIES.map((category) => (
                    <div key={category.id} className="rounded border border-[#222222] bg-[#0a0a0a] p-3 space-y-2">
                      <p className="text-xs uppercase tracking-wide text-[#8e8e8e]">{category.label}</p>
                      {category.permissions.map((permission) => {
                        const checked = hasPermissionBit(roleDraft.permissions, permission.bit);
                        return (
                          <label key={permission.key} className="flex items-start justify-between gap-3 py-1.5">
                            <div>
                              <p className="text-sm text-white">{permission.label}</p>
                              <p className="text-xs text-[#777777]">{permission.description}</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={selectedRole.managed}
                              onChange={(event) => handleRolePermissionToggle(permission.bit, event.target.checked)}
                              className="mt-1 w-4 h-4 accent-[#8B5CF6]"
                            />
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => void handleSaveRole()}
                    disabled={isSavingRole || selectedRole.managed}
                    className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSavingRole && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Role
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

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
                    serika.gg/{invite.code}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`https://serika.gg/${invite.code}`)}
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
                <AvatarImage src={invite.createdBy.avatar} />
                <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                  {invite.createdBy.username.charAt(0)}
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
                  {member.roles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {member.roles.slice(0, 3).map((role) => (
                        <span
                          key={`${member.id}-${role.id}`}
                          className="px-2 py-0.5 rounded text-[11px]"
                          style={{ backgroundColor: `${role.color}22`, color: role.color }}
                        >
                          {role.name}
                        </span>
                      ))}
                      {member.roles.length > 3 && (
                        <span className="px-2 py-0.5 rounded text-[11px] bg-[#1a1a1a] text-[#777777]">
                          +{member.roles.length - 3}
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-0.5 text-[#888888] hover:text-[#8B5CF6] transition-colors">
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
                  )}
                </div>
                <details className="relative">
                  <summary className="list-none p-2 hover:bg-[#1a1a1a] rounded-md text-[#888888] transition-colors cursor-pointer">
                    {memberRoleSavingId === member.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MoreHorizontal className="w-4 h-4" />
                    )}
                  </summary>
                  <div className="absolute right-0 mt-2 z-20 w-64 rounded-lg bg-[#0c0c0c] border border-[#222222] p-3 shadow-xl">
                    <p className="text-xs uppercase tracking-wide text-[#888888] mb-2">Assign Roles</p>
                    <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                      {roles
                        .slice()
                        .sort((a, b) => b.position - a.position)
                        .map((role) => {
                          const checked = member.roles.some((entry) => entry.id === role.id);
                          const isDisabled = role.isDefault || memberRoleSavingId === member.id;
                          return (
                            <label key={`${member.id}-${role.id}`} className="flex items-center justify-between gap-2 py-1">
                              <span className="text-sm" style={{ color: role.color || "#ffffff" }}>
                                {role.name}
                              </span>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isDisabled}
                                onChange={(event) => void handleToggleMemberRole(member, role.id, event.target.checked)}
                                className="w-4 h-4 accent-[#8B5CF6]"
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

  const renderEmoji = () => (
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
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {emojis.map((emoji) => (
            <div
              key={emoji._id}
              className="relative group aspect-square bg-[#111111] border border-[#222222] rounded-lg p-2 flex items-center justify-center"
            >
              <img
                src={emoji.imageUrl}
                alt={`:${emoji.name}:`}
                className="w-8 h-8 object-contain"
              />
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

  const renderStickers = () => (
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
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {stickers.map((sticker) => (
            <div
              key={sticker._id}
              className="relative group rounded-lg bg-[#111111] border border-[#222222] p-2"
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
            onClick={() => setWidgetEnabled((prev) => !prev)}
            className={cn("w-12 h-6 rounded-full relative transition-colors", widgetEnabled ? "bg-[#8B5CF6]" : "bg-[#222222]")}
          >
            <div className={cn(
              "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
              widgetEnabled ? "translate-x-6 left-0.5" : "left-0.5"
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
          value={widgetChannelId}
          onChange={(e) => setWidgetChannelId(e.target.value)}
          className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
        >
          <option value="">Select a channel</option>
          {textChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>#{channel.name}</option>
          ))}
        </select>
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
      <div className="flex justify-end">
        <button
          onClick={() => handleSaveAdvancedSettings("widget")}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
        >
          Save Widget Settings
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
            value={verificationLevel}
            onChange={(e) => setVerificationLevel(e.target.value as typeof verificationLevel)}
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
            value={explicitContentFilter}
            onChange={(e) => setExplicitContentFilter(e.target.value as typeof explicitContentFilter)}
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
              onClick={() => setRequire2FA((prev) => !prev)}
              className={cn("w-12 h-6 rounded-full relative transition-colors", require2FA ? "bg-[#8B5CF6]" : "bg-[#222222]")}
            >
              <div className={cn(
                "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
                require2FA ? "translate-x-6 left-0.5" : "left-0.5"
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
              onClick={() => setRaidProtection((prev) => !prev)}
              className={cn("w-12 h-6 rounded-full relative transition-colors", raidProtection ? "bg-[#8B5CF6]" : "bg-[#222222]")}
            >
              <div className={cn(
                "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
                raidProtection ? "translate-x-6 left-0.5" : "left-0.5"
              )} />
            </button>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[#111111] border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">Mention Spam Limit</span>
            <span className="text-sm text-[#888888]">{mentionSpamLimit}</span>
          </div>
          <input
            type="range"
            min={2}
            max={20}
            value={mentionSpamLimit}
            onChange={(e) => setMentionSpamLimit(Number(e.target.value))}
            className="w-full accent-[#8B5CF6]"
          />
          <label className="mt-3 flex items-center justify-between cursor-pointer">
            <span className="text-sm text-[#888888]">Enable anti-spam checks</span>
            <input
              type="checkbox"
              checked={antiSpam}
              onChange={(e) => setAntiSpam(e.target.checked)}
              className="w-4 h-4 accent-[#8B5CF6]"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => {
              handleSaveAdvancedSettings("moderation");
              handleSaveAdvancedSettings("safety");
            }}
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
          >
            Save Moderation Settings
          </button>
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
          <button
            onClick={() => setSoundboardEnabled((prev) => !prev)}
            className={cn("w-12 h-6 rounded-full relative transition-colors", soundboardEnabled ? "bg-[#8B5CF6]" : "bg-[#222222]")}
          >
            <div className={cn(
              "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
              soundboardEnabled ? "translate-x-6 left-0.5" : "left-0.5"
            )} />
          </button>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#888888]">Playback Volume</span>
            <span className="text-sm text-white">{soundboardVolume}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            value={soundboardVolume}
            onChange={(e) => setSoundboardVolume(Number(e.target.value))}
            className="w-full accent-[#8B5CF6]"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => handleSaveAdvancedSettings("soundboard")}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
        >
          Save Soundboard
        </button>
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
            <button
              onClick={() =>
                setIntegrationFlags((prev) => ({
                  ...prev,
                  [integration.key]: !prev[integration.key as keyof typeof prev],
                }))
              }
              className={cn(
                "w-12 h-6 rounded-full relative transition-colors",
                integrationFlags[integration.key as keyof typeof integrationFlags] ? "bg-[#8B5CF6]" : "bg-[#222222]"
              )}
            >
              <div
                className={cn(
                  "w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform",
                  integrationFlags[integration.key as keyof typeof integrationFlags] ? "translate-x-6 left-0.5" : "left-0.5"
                )}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => handleSaveAdvancedSettings("integrations")}
          className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md"
        >
          Save Integrations
        </button>
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
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex">
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
            onClick={() => onOpenChange(false)}
            className="p-2 rounded-full hover:bg-[#1a1a1a] text-[#888888] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="max-w-2xl mx-auto p-6 md:p-8">
            {renderContent()}
          </div>
        </ScrollArea>
      </div>

      {/* Image Cropper */}
      <ImageCropper
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        imageUrl={cropperImage}
        aspectRatio={cropperType === "icon" ? 1 : 2.5}
        onCropComplete={handleCropComplete}
        title={cropperType === "icon" ? "Crop Server Icon" : "Crop Server Banner"}
        description={
          cropperType === "icon"
            ? "Adjust the crop area to select the portion of the image for your server icon."
            : "Adjust the crop area to select the portion of the image for your server banner."
        }
        circular={cropperType === "icon"}
      />
    </div>
  );
}
