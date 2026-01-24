"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageCropper } from "@/components/ui/image-cropper";
import {
  X,
  User,
  Shield,
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
  Loader2,
  ExternalLink,
  Pencil,
  Search,
  Link2,
  Smartphone,
  MessageSquare,
  Lock,
  Eye,
  Volume2,
  Image,
  Plug,
  ShieldCheck,
  Users,
  Settings,
  Database,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getBadgesByPriority, type BadgeId } from "@/lib/constants/badges";
import { toast } from "sonner";

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab =
  | "profiles"
  | "content-social"
  | "data-privacy"
  | "authorized-apps"
  | "devices"
  | "connections"
  | "friend-requests"
  | "notifications"
  | "appearance"
  | "accessibility"
  | "voice-video"
  | "text-images"
  | "keybinds"
  | "language"
  | "premium"
  | "admin-users"
  | "admin-servers"
  | "admin-settings"
  | "admin-logs";

const statusOptions = [
  { value: "online", label: "Online", color: "#8B5CF6" },
  { value: "idle", label: "Idle", color: "#A78BFA" },
  { value: "dnd", label: "Do Not Disturb", color: "#EF4444" },
  { value: "offline", label: "Invisible", color: "#555555" },
];

export function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  const { user, logout, updateUser, refresh } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profiles");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [customStatus, setCustomStatus] = useState("");
  const [status, setStatus] = useState("online");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
    isPartner: boolean;
    createdAt: string;
  }>>([]);
  const [adminLogs, setAdminLogs] = useState<Array<{
    id: string;
    admin: { username: string; displayName?: string; avatar?: string };
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
    newUsersToday: number;
  } | null>(null);
  const [platformSettings, setPlatformSettings] = useState<{
    maintenanceMode: boolean;
    allowRegistration: boolean;
    globalAnnouncement?: string;
  } | null>(null);
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    avatar?: string;
    badges: string[];
    isBanned: boolean;
    banReason?: string;
    stats?: { servers: number; messages: number };
  } | null>(null);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [adminLogFilter, setAdminLogFilter] = useState<string>("all");
  const [announcementText, setAnnouncementText] = useState("");

  // Initialize form with user data
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
      setBio(user.bio || "");
      setPronouns(user.pronouns || "");
      setCustomStatus(user.customStatus || "");
      setStatus(user.status || "online");
    }
  }, [user]);

  // Track changes
  useEffect(() => {
    if (user) {
      const changed =
        displayName !== (user.displayName || "") ||
        bio !== (user.bio || "") ||
        pronouns !== (user.pronouns || "") ||
        customStatus !== (user.customStatus || "") ||
        status !== (user.status || "online");
      setHasChanges(changed);
    }
  }, [displayName, bio, pronouns, customStatus, status, user]);

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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          bio,
          pronouns,
          customStatus,
          status,
        }),
      });

      if (response.ok) {
        // Update local state immediately
        updateUser({
          displayName,
          bio,
          pronouns,
          customStatus,
          status: status as "online" | "idle" | "dnd" | "offline",
        });
        setHasChanges(false);
        toast.success("Profile saved!");
        // Refresh to get full updated data
        await refresh();
      } else {
        toast.error("Failed to save profile");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onOpenChange(false);
    toast.success("Logged out");
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be less than 8MB");
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
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be less than 8MB");
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

  const handleCropComplete = async (croppedBlob: Blob) => {
    const isAvatar = cropperType === "avatar";
    const setUploading = isAvatar ? setIsUploadingAvatar : setIsUploadingBanner;
    const endpoint = isAvatar ? "/api/upload/avatar" : "/api/upload/banner";

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
        if (isAvatar) {
          updateUser({ avatar: data.url });
        } else {
          updateUser({ banner: data.url });
        }
        toast.success(`${isAvatar ? "Avatar" : "Banner"} updated!`);
        await refresh();
      } else {
        const data = await response.json();
        toast.error(data.error || `Failed to upload ${cropperType}`);
      }
    } catch (error) {
      toast.error(`Failed to upload ${cropperType}`);
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
      } else {
        toast.error("Failed to search users");
      }
    } catch (error) {
      toast.error("Failed to search users");
    } finally {
      setIsLoadingAdmin(false);
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
      } else {
        toast.error("Failed to search servers");
      }
    } catch (error) {
      toast.error("Failed to search servers");
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const fetchAdminStats = async () => {
    try {
      const response = await fetch("/api/admin/stats");
      if (response.ok) {
        const data = await response.json();
        setAdminStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch admin stats:", error);
    }
  };

  const fetchPlatformSettings = async () => {
    try {
      const response = await fetch("/api/admin/settings");
      if (response.ok) {
        const data = await response.json();
        setPlatformSettings(data);
        setAnnouncementText(data.globalAnnouncement || "");
      }
    } catch (error) {
      console.error("Failed to fetch platform settings:", error);
    }
  };

  const fetchAdminLogs = async (filter?: string) => {
    setIsLoadingAdmin(true);
    try {
      const url = filter && filter !== "all" ? `/api/admin/logs?type=${filter}` : "/api/admin/logs";
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAdminLogs(data.logs);
      }
    } catch (error) {
      console.error("Failed to fetch admin logs:", error);
    } finally {
      setIsLoadingAdmin(false);
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
        toast.success("User banned");
        searchAdminUsers();
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to ban user");
      }
    } catch (error) {
      toast.error("Failed to ban user");
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/unban`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success("User unbanned");
        searchAdminUsers();
      } else {
        toast.error("Failed to unban user");
      }
    } catch (error) {
      toast.error("Failed to unban user");
    }
  };

  const handleUpdatePlatformSettings = async (updates: { maintenanceMode?: boolean; allowRegistration?: boolean }) => {
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (response.ok) {
        const data = await response.json();
        setPlatformSettings(data);
        toast.success("Settings updated");
      } else {
        toast.error("Failed to update settings");
      }
    } catch (error) {
      toast.error("Failed to update settings");
    }
  };

  const handlePublishAnnouncement = async () => {
    if (!announcementText.trim()) return;
    try {
      const response = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: announcementText }),
      });
      if (response.ok) {
        toast.success("Announcement published");
        fetchPlatformSettings();
      } else {
        toast.error("Failed to publish announcement");
      }
    } catch (error) {
      toast.error("Failed to publish announcement");
    }
  };

  const handleTogglePartner = async (serverId: string) => {
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/partner`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success("Partner status toggled");
        searchAdminServers();
      } else {
        toast.error("Failed to toggle partner status");
      }
    } catch (error) {
      toast.error("Failed to toggle partner status");
    }
  };

  const handleToggleDiscovery = async (serverId: string) => {
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/discovery`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success("Discovery status toggled");
        searchAdminServers();
      } else {
        toast.error("Failed to toggle discovery status");
      }
    } catch (error) {
      toast.error("Failed to toggle discovery status");
    }
  };

  const handleDeleteServer = async (serverId: string, reason?: string) => {
    if (!confirm("Are you sure you want to delete this server? This action cannot be undone.")) return;
    try {
      const response = await fetch(`/api/admin/servers/${serverId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        toast.success("Server deleted");
        searchAdminServers();
      } else {
        toast.error("Failed to delete server");
      }
    } catch (error) {
      toast.error("Failed to delete server");
    }
  };

  // Load admin data when tabs are activated
  useEffect(() => {
    if (activeTab === "admin-settings" && !platformSettings) {
      fetchPlatformSettings();
      fetchAdminStats();
    } else if (activeTab === "admin-logs" && adminLogs.length === 0) {
      fetchAdminLogs();
    }
  }, [activeTab]);

  const renderBadges = () => {
    if (!user?.badges || user.badges.length === 0) return null;

    const badges = getBadgesByPriority(user.badges as BadgeId[]);

    return (
      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => {
          const IconComponent = badge.icon;
          return (
            <div
              key={badge.id}
              className="px-2 py-1 rounded-full flex items-center gap-1.5 text-xs"
              style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
              title={badge.description}
            >
              <IconComponent className="w-3.5 h-3.5" />
              <span>{badge.name}</span>
            </div>
          );
        })}
      </div>
    );
  };

  if (!open) return null;

  const menuSections = [
    {
      title: "User Settings",
      items: [
        { id: "profiles" as SettingsTab, label: "Profiles", icon: User },
        { id: "content-social" as SettingsTab, label: "Content & Social", icon: MessageSquare },
        { id: "data-privacy" as SettingsTab, label: "Data & Privacy", icon: Lock },
        { id: "authorized-apps" as SettingsTab, label: "Authorized Apps", icon: Plug },
        { id: "devices" as SettingsTab, label: "Devices", icon: Smartphone },
        { id: "connections" as SettingsTab, label: "Connections", icon: Link2 },
        { id: "friend-requests" as SettingsTab, label: "Friend Requests", icon: User },
      ],
    },
    {
      title: "Billing Settings",
      items: [
        { id: "premium" as SettingsTab, label: "Serika+", icon: Crown },
      ],
    },
    {
      title: "App Settings",
      items: [
        { id: "appearance" as SettingsTab, label: "Appearance", icon: Palette },
        { id: "accessibility" as SettingsTab, label: "Accessibility", icon: Accessibility },
        { id: "voice-video" as SettingsTab, label: "Voice & Video", icon: Mic },
        { id: "text-images" as SettingsTab, label: "Text & Images", icon: Image },
        { id: "notifications" as SettingsTab, label: "Notifications", icon: Bell },
        { id: "keybinds" as SettingsTab, label: "Keybinds", icon: Keyboard },
        { id: "language" as SettingsTab, label: "Language", icon: Languages },
      ],
    },
  ];

  // Add admin section if user has staff badge
  const isStaff = user?.badges?.some((badge: string) => 
    ['staff', 'admin', 'moderator', 'serikacord_developer'].includes(badge)
  );

  if (isStaff) {
    menuSections.push({
      title: "Admin",
      items: [
        { id: "admin-users" as SettingsTab, label: "User Management", icon: Users },
        { id: "admin-servers" as SettingsTab, label: "Server Management", icon: Database },
        { id: "admin-settings" as SettingsTab, label: "Platform Settings", icon: Settings },
        { id: "admin-logs" as SettingsTab, label: "Activity Logs", icon: Activity },
      ],
    });
  }

  // Filter menu items based on search
  const filteredSections = searchQuery
    ? menuSections.map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter(section => section.items.length > 0)
    : menuSections;

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a]">
      <div className="h-full flex flex-col md:flex-row">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-[#1a1a1a]">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-2 rounded-full hover:bg-[#1a1a1a] text-[#888888]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar */}
        <div className="hidden md:flex w-56 lg:w-64 bg-[#0a0a0a] flex-col border-r border-[#1a1a1a] h-full overflow-hidden">
          {/* User Header */}
          <div className="p-4 border-b border-[#1a1a1a] flex-shrink-0">
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={user?.avatar} />
                <AvatarFallback className="bg-[#8B5CF6] text-white">
                  {user?.displayName?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate text-sm">
                  {user?.displayName || user?.username}
                </h3>
                <button 
                  onClick={() => setActiveTab("profiles")}
                  className="text-xs text-[#888888] hover:text-[#8B5CF6] flex items-center gap-1 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit Profiles
                </button>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="p-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555555]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="pl-9 h-8 bg-[#111111] border-[#222222] text-white text-sm placeholder:text-[#555555]"
              />
            </div>
          </div>

          {/* Menu */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 pb-4">
              {filteredSections.map((section, i) => (
                <div key={i} className="mb-2">
                  <h3 className="text-[10px] font-semibold text-[#666666] uppercase px-2.5 py-2 tracking-wide">
                    {section.title}
                  </h3>
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2.5 py-1.5 rounded text-sm transition-colors mb-0.5",
                        activeTab === item.id
                          ? "bg-[#8B5CF6]/20 text-white"
                          : "text-[#b5bac1] hover:bg-[#1a1a1a] hover:text-white"
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}

              <div className="h-px bg-[#222222] my-2 mx-2" />

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-2.5 py-1.5 rounded text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Log Out
              </button>
            </div>
          </ScrollArea>
        </div>

        {/* Mobile Tab Navigation */}
        <div className="md:hidden overflow-x-auto border-b border-[#1a1a1a]">
          <div className="flex px-4 py-2 gap-2">
            {menuSections.flatMap(s => s.items).slice(0, 6).map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                  activeTab === item.id
                    ? "bg-[#8B5CF6] text-white"
                    : "bg-[#1a1a1a] text-[#888888]"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-[#111111] relative flex flex-col overflow-hidden">
          {/* Desktop Close Button */}
          <button
            onClick={() => onOpenChange(false)}
            className="hidden md:flex absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-[#1a1a1a] text-[#888888] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <ScrollArea className="flex-1 [&_[data-radix-scroll-area-viewport]]:!overflow-y-scroll [&_[data-radix-scroll-area-scrollbar]]:!flex">
            <div className="max-w-[740px] py-6 px-4 md:py-10 md:px-10 mx-auto pb-24">
              {/* Profiles Tab */}
              {activeTab === "profiles" && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5">Profiles</h2>
                  
                  {/* Tabs */}
                  <div className="flex gap-6 border-b border-[#1a1a1a] mb-6">
                    <button className="pb-3 text-white font-medium border-b-2 border-[#8B5CF6]">
                      Main Profile
                    </button>
                    <button className="pb-3 text-[#b5bac1] hover:text-white transition-colors">
                      Per-server Profiles
                    </button>
                  </div>

                  {/* Profile Preview Card */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
                    <div>
                      {/* Banner promo for premium */}
                      {!user?.isPremium && (
                        <div className="bg-gradient-to-r from-[#5865F2] to-[#8B5CF6] rounded-lg p-4 mb-6 relative overflow-hidden">
                          <div className="relative z-10">
                            <h3 className="text-white font-bold mb-1">Give your profile a fresh look</h3>
                            <p className="text-sm text-white/80 mb-3">
                              Check out the latest avatar decorations, profile effects, and nameplates.
                            </p>
                            <button className="px-4 py-2 bg-white text-[#5865F2] font-medium rounded hover:bg-gray-100 transition-colors">
                              Go to Shop
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Avatar & Banner Upload */}
                      <div className="space-y-4 mb-6">
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">
                              Avatar
                            </label>
                            <div
                              onClick={() => avatarInputRef.current?.click()}
                              className="relative w-20 h-20 rounded-full bg-[#0a0a0a] border-2 border-dashed border-[#333] hover:border-[#8B5CF6] cursor-pointer transition-colors group overflow-hidden"
                            >
                              {user?.avatar ? (
                                <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[#666]">
                                  <Camera className="w-6 h-6" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                {isUploadingAvatar ? (
                                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                                ) : (
                                  <Camera className="w-6 h-6 text-white" />
                                )}
                              </div>
                            </div>
                            <input
                              ref={avatarInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleAvatarSelect}
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">
                              Banner
                            </label>
                            <div
                              onClick={() => bannerInputRef.current?.click()}
                              className="relative w-full h-20 rounded-lg bg-[#0a0a0a] border-2 border-dashed border-[#333] hover:border-[#8B5CF6] cursor-pointer transition-colors group overflow-hidden"
                            >
                              {user?.banner ? (
                                <img src={user.banner} alt="Banner" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[#666]">
                                  <Image className="w-6 h-6" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                {isUploadingBanner ? (
                                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                                ) : (
                                  <Camera className="w-6 h-6 text-white" />
                                )}
                              </div>
                            </div>
                            <input
                              ref={bannerInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleBannerSelect}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">
                            Display Name
                          </label>
                          <Input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="bg-[#0a0a0a] border-none text-white h-10"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">
                            Pronouns
                          </label>
                          <Input
                            value={pronouns}
                            onChange={(e) => setPronouns(e.target.value)}
                            className="bg-[#0a0a0a] border-none text-white h-10"
                            placeholder="Add your pronouns"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-[#b5bac1] uppercase mb-2">
                            About Me
                          </label>
                          <Textarea
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            className="bg-[#0a0a0a] border-none text-white min-h-[100px] resize-none"
                            maxLength={190}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Preview */}
                    <div>
                      <h3 className="text-xs font-bold text-[#b5bac1] uppercase mb-3">Preview</h3>
                      <div className="bg-[#232428] rounded-lg overflow-hidden w-full max-w-[300px]">
                        <div
                          className="h-[60px]"
                          style={{
                            background: user?.banner
                              ? `url(${user.banner}) center/cover`
                              : `linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)`,
                          }}
                        />
                        <div className="p-3 pt-0 relative">
                          <div className="absolute -top-6 left-3">
                            <Avatar className="w-[72px] h-[72px] border-[5px] border-[#232428]">
                              <AvatarImage src={user?.avatar} />
                              <AvatarFallback className="bg-[#8B5CF6] text-white text-xl">
                                {user?.displayName?.charAt(0).toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                          </div>
                          <div className="pt-10 bg-[#111214] rounded-lg p-3 mt-2">
                            <h3 className="font-bold text-white">{displayName || user?.username}</h3>
                            <div className="flex items-center gap-1 text-sm text-[#b5bac1]">
                              <span>{user?.username}</span>
                              {pronouns && (
                                <>
                                  <span>•</span>
                                  <span>{pronouns}</span>
                                </>
                              )}
                            </div>
                            {bio && (
                              <>
                                <div className="h-px bg-[#2e2f34] my-3" />
                                <p className="text-sm text-[#dbdee1]">{bio}</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Premium Tab */}
              {activeTab === "premium" && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5">Serika+</h2>
                  {user?.isPremium ? (
                    <div className="bg-gradient-to-r from-[#8B5CF6]/20 to-[#6366F1]/20 rounded-lg p-6 border border-[#8B5CF6]/30">
                      <div className="flex items-center gap-3 mb-4">
                        <Crown className="w-10 h-10 text-[#8B5CF6]" />
                        <div>
                          <h3 className="text-lg font-bold text-white">You have Serika+!</h3>
                          <p className="text-sm text-[#b5bac1]">
                            Member since{" "}
                            {user.premiumSince
                              ? new Date(user.premiumSince).toLocaleDateString()
                              : "Unknown"}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-6">
                        <div className="bg-[#0a0a0a] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ Custom profile themes</p>
                        </div>
                        <div className="bg-[#0a0a0a] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ Animated avatars</p>
                        </div>
                        <div className="bg-[#0a0a0a] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ Extended file uploads</p>
                        </div>
                        <div className="bg-[#0a0a0a] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ Exclusive badge</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#0a0a0a] rounded-lg p-8 text-center">
                      <Crown className="w-16 h-16 text-[#8B5CF6] mx-auto mb-4" />
                      <h3 className="text-2xl font-bold text-white mb-2">Upgrade to Serika+</h3>
                      <p className="text-[#b5bac1] max-w-md mx-auto mb-6">
                        Get exclusive features like animated avatars, custom themes, enhanced upload
                        limits, and more.
                      </p>
                      <a
                        href="https://serika.dev/premium"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-md transition-colors"
                      >
                        Subscribe to Serika+
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === "appearance" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">Appearance</h2>
                  
                  {/* Theme Selection */}
                  <div className="bg-[#0a0a0a] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-4">Theme</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <button className="group p-3 bg-[#111111] border-2 border-[#8B5CF6] rounded-xl text-left transition-all hover:scale-[1.02]">
                        <div className="aspect-video bg-[#0a0a0a] rounded-lg mb-3 overflow-hidden relative">
                          <div className="absolute inset-0 flex">
                            <div className="w-3 bg-[#111111]" />
                            <div className="w-6 bg-[#0f0f0f]" />
                            <div className="flex-1 bg-[#0a0a0a]" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-white font-medium text-sm">Dark</span>
                          <Check className="w-4 h-4 text-[#8B5CF6]" />
                        </div>
                      </button>
                      <button className="group p-3 bg-[#111111] border border-[#222222] rounded-xl text-left opacity-50 cursor-not-allowed">
                        <div className="aspect-video bg-[#1a1a1a] rounded-lg mb-3 overflow-hidden relative">
                          <div className="absolute inset-0 flex">
                            <div className="w-3 bg-[#2a2a2a]" />
                            <div className="w-6 bg-[#222222]" />
                            <div className="flex-1 bg-[#1a1a1a]" />
                          </div>
                        </div>
                        <span className="text-[#888888] font-medium text-sm">Midnight</span>
                        <p className="text-xs text-[#555555]">Soon</p>
                      </button>
                      <button className="group p-3 bg-[#111111] border border-[#222222] rounded-xl text-left opacity-50 cursor-not-allowed">
                        <div className="aspect-video bg-[#ffffff] rounded-lg mb-3 overflow-hidden relative">
                          <div className="absolute inset-0 flex">
                            <div className="w-3 bg-[#e5e5e5]" />
                            <div className="w-6 bg-[#f0f0f0]" />
                            <div className="flex-1 bg-[#ffffff]" />
                          </div>
                        </div>
                        <span className="text-[#888888] font-medium text-sm">Light</span>
                        <p className="text-xs text-[#555555]">Soon</p>
                      </button>
                    </div>
                  </div>

                  {/* Accent Color */}
                  <div className="bg-[#0a0a0a] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-2">Accent Color</h3>
                    <p className="text-sm text-[#888888] mb-4">Choose your primary accent color</p>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { color: '#8B5CF6', name: 'Purple' },
                        { color: '#6366F1', name: 'Indigo' },
                        { color: '#3B82F6', name: 'Blue' },
                        { color: '#06B6D4', name: 'Cyan' },
                        { color: '#10B981', name: 'Emerald' },
                        { color: '#F59E0B', name: 'Amber' },
                        { color: '#EF4444', name: 'Red' },
                        { color: '#EC4899', name: 'Pink' },
                      ].map((c) => (
                        <button
                          key={c.color}
                          className={cn(
                            "w-10 h-10 rounded-full transition-all hover:scale-110 relative",
                            c.color === '#8B5CF6' && "ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0a]"
                          )}
                          style={{ backgroundColor: c.color }}
                          title={c.name}
                        >
                          {c.color === '#8B5CF6' && (
                            <Check className="w-5 h-5 text-white absolute inset-0 m-auto" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="bg-[#0a0a0a] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-2">Chat Font Size</h3>
                    <p className="text-sm text-[#888888] mb-4">Adjust the size of text in chat</p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#888888]">12px</span>
                      <input 
                        type="range" 
                        min="12" 
                        max="20" 
                        defaultValue="14"
                        className="flex-1 accent-[#8B5CF6] h-1 bg-[#222222] rounded-full appearance-none cursor-pointer"
                      />
                      <span className="text-xs text-[#888888]">20px</span>
                    </div>
                    <p className="text-sm text-[#dcddde] mt-3">Preview: This is how your chat will look.</p>
                  </div>

                  {/* Message Display */}
                  <div className="bg-[#0a0a0a] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-4">Message Display</h3>
                    <div className="space-y-4">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[#8B5CF6] transition-colors">Compact Mode</p>
                          <p className="text-sm text-[#888888]">Display messages in a compact format</p>
                        </div>
                        <div className="relative">
                          <input type="checkbox" className="sr-only peer" />
                          <div className="w-11 h-6 bg-[#222222] rounded-full peer peer-checked:bg-[#8B5CF6] transition-colors" />
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform" />
                        </div>
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[#8B5CF6] transition-colors">Show Timestamps</p>
                          <p className="text-sm text-[#888888]">Display message timestamps</p>
                        </div>
                        <div className="relative">
                          <input type="checkbox" className="sr-only peer" defaultChecked />
                          <div className="w-11 h-6 bg-[#222222] rounded-full peer peer-checked:bg-[#8B5CF6] transition-colors" />
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform" />
                        </div>
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[#8B5CF6] transition-colors">Show Role Colors</p>
                          <p className="text-sm text-[#888888]">Color usernames by their highest role</p>
                        </div>
                        <div className="relative">
                          <input type="checkbox" className="sr-only peer" defaultChecked />
                          <div className="w-11 h-6 bg-[#222222] rounded-full peer peer-checked:bg-[#8B5CF6] transition-colors" />
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform" />
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Animations */}
                  <div className="bg-[#0a0a0a] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-4">Animations</h3>
                    <div className="space-y-4">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[#8B5CF6] transition-colors">Enable Animations</p>
                          <p className="text-sm text-[#888888]">Show smooth transitions and animations</p>
                        </div>
                        <div className="relative">
                          <input type="checkbox" className="sr-only peer" defaultChecked />
                          <div className="w-11 h-6 bg-[#222222] rounded-full peer peer-checked:bg-[#8B5CF6] transition-colors" />
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform" />
                        </div>
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[#8B5CF6] transition-colors">Animated Emojis</p>
                          <p className="text-sm text-[#888888]">Play animated emojis automatically</p>
                        </div>
                        <div className="relative">
                          <input type="checkbox" className="sr-only peer" defaultChecked />
                          <div className="w-11 h-6 bg-[#222222] rounded-full peer peer-checked:bg-[#8B5CF6] transition-colors" />
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform" />
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Voice & Video Tab */}
              {activeTab === "voice-video" && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5">Voice & Video</h2>
                  <div className="bg-[#0a0a0a] rounded-lg p-4">
                    <div className="flex items-center gap-4 mb-4">
                      <Volume2 className="w-10 h-10 text-[#8B5CF6]" />
                      <div>
                        <h3 className="text-white font-bold">Voice Settings</h3>
                        <p className="text-sm text-[#b5bac1]">Configure microphone and audio output</p>
                      </div>
                    </div>
                    <p className="text-[#666666] text-sm">
                      Voice and video settings will be available once voice chat is implemented.
                    </p>
                  </div>
                </div>
              )}

              {/* Notifications Tab */}
              {activeTab === "notifications" && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5">Notifications</h2>
                  <div className="bg-[#0a0a0a] rounded-lg p-4">
                    <div className="space-y-4">
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white font-medium">Enable Desktop Notifications</p>
                          <p className="text-sm text-[#b5bac1]">Receive notifications on your desktop</p>
                        </div>
                        <input type="checkbox" className="w-5 h-5 accent-[#8B5CF6]" defaultChecked />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white font-medium">Message Sounds</p>
                          <p className="text-sm text-[#b5bac1]">Play a sound for new messages</p>
                        </div>
                        <input type="checkbox" className="w-5 h-5 accent-[#8B5CF6]" defaultChecked />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white font-medium">Mute @everyone and @here</p>
                          <p className="text-sm text-[#b5bac1]">Suppress notifications from @everyone and @here</p>
                        </div>
                        <input type="checkbox" className="w-5 h-5 accent-[#8B5CF6]" />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Default fallback for other tabs */}
              {!["profiles", "premium", "appearance", "voice-video", "notifications", "admin-users", "admin-servers", "admin-settings", "admin-logs"].includes(activeTab) && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 capitalize">
                    {activeTab.replace(/-/g, " ")}
                  </h2>
                  <div className="bg-[#0a0a0a] rounded-lg p-8 text-center">
                    <Eye className="w-12 h-12 text-[#555555] mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-white mb-2">Coming Soon</h3>
                    <p className="text-[#b5bac1] text-sm max-w-md mx-auto">
                      This settings page is under development.
                    </p>
                  </div>
                </div>
              )}

              {/* Admin Panel - User Management */}
              {activeTab === "admin-users" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-[#8B5CF6]" />
                    User Management
                  </h2>
                  <div className="bg-[#0a0a0a] rounded-lg p-4 mb-4">
                    <div className="flex gap-4 mb-4">
                      <Input
                        value={adminUserSearch}
                        onChange={(e) => setAdminUserSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchAdminUsers()}
                        placeholder="Search users by email or username..."
                        className="bg-[#111111] border-[#222222] text-white flex-1"
                      />
                      <button 
                        onClick={searchAdminUsers}
                        disabled={isLoadingAdmin}
                        className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded font-medium flex items-center gap-2"
                      >
                        {isLoadingAdmin && <Loader2 className="w-4 h-4 animate-spin" />}
                        Search
                      </button>
                    </div>
                    <p className="text-[#666666] text-sm">
                      Search for users to view their profile, edit badges, or take moderation actions.
                    </p>
                  </div>
                  
                  {/* Search Results */}
                  {adminUsers.length > 0 && (
                    <div className="bg-[#0a0a0a] rounded-lg p-4 mb-4">
                      <h3 className="text-white font-semibold mb-3">Search Results</h3>
                      <div className="space-y-2">
                        {adminUsers.map((u) => (
                          <div key={u.id} className="flex items-center justify-between p-3 bg-[#111111] rounded-lg">
                            <div className="flex items-center gap-3">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={u.avatar} />
                                <AvatarFallback className="bg-[#8B5CF6] text-white">
                                  {u.displayName?.charAt(0) || u.username.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-white font-medium">{u.displayName || u.username}</p>
                                <p className="text-sm text-[#666666]">@{u.username} • {u.email}</p>
                              </div>
                              {u.isBanned && (
                                <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">Banned</span>
                              )}
                              {u.isStaff && (
                                <span className="px-2 py-0.5 bg-[#8B5CF6]/20 text-[#8B5CF6] text-xs rounded">Staff</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {u.isBanned ? (
                                <button
                                  onClick={() => handleUnbanUser(u.id)}
                                  className="px-3 py-1.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded text-sm"
                                >
                                  Unban
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleBanUser(u.id, "Administrative action")}
                                  className="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-sm"
                                >
                                  Ban
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-[#0a0a0a] rounded-lg p-4">
                    <h3 className="text-white font-semibold mb-3">Quick Actions</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => toast.info("Select a user from search to ban")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Ban User</p>
                        <p className="text-sm text-[#666666]">Permanently ban a user</p>
                      </button>
                      <button 
                        onClick={() => toast.info("Badge editing coming soon")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Edit Badges</p>
                        <p className="text-sm text-[#666666]">Add or remove badges</p>
                      </button>
                      <button 
                        onClick={() => toast.info("Reports system coming soon")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">View Reports</p>
                        <p className="text-sm text-[#666666]">Review user reports</p>
                      </button>
                      <button 
                        onClick={() => toast.info("Impersonation not implemented for security")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Impersonate</p>
                        <p className="text-sm text-[#666666]">Debug user issues</p>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Admin Panel - Server Management */}
              {activeTab === "admin-servers" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <Database className="w-6 h-6 text-[#8B5CF6]" />
                    Server Management
                  </h2>
                  <div className="bg-[#0a0a0a] rounded-lg p-4 mb-4">
                    <div className="flex gap-4 mb-4">
                      <Input
                        value={adminServerSearch}
                        onChange={(e) => setAdminServerSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchAdminServers()}
                        placeholder="Search servers by name or ID..."
                        className="bg-[#111111] border-[#222222] text-white flex-1"
                      />
                      <button 
                        onClick={searchAdminServers}
                        disabled={isLoadingAdmin}
                        className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded font-medium flex items-center gap-2"
                      >
                        {isLoadingAdmin && <Loader2 className="w-4 h-4 animate-spin" />}
                        Search
                      </button>
                    </div>
                  </div>

                  {/* Search Results */}
                  {adminServers.length > 0 && (
                    <div className="bg-[#0a0a0a] rounded-lg p-4 mb-4">
                      <h3 className="text-white font-semibold mb-3">Search Results</h3>
                      <div className="space-y-2">
                        {adminServers.map((s) => (
                          <div key={s.id} className="flex items-center justify-between p-3 bg-[#111111] rounded-lg">
                            <div className="flex items-center gap-3">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={s.icon} />
                                <AvatarFallback className="bg-[#8B5CF6] text-white">
                                  {s.name.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-white font-medium">{s.name}</p>
                                <p className="text-sm text-[#666666]">
                                  {s.memberCount} members • Owner: {s.owner?.displayName || s.owner?.username}
                                </p>
                              </div>
                              {s.isPartner && (
                                <span className="px-2 py-0.5 bg-[#8B5CF6]/20 text-[#8B5CF6] text-xs rounded">Partner</span>
                              )}
                              {s.isDiscoverable && (
                                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Discoverable</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleTogglePartner(s.id)}
                                className="px-3 py-1.5 bg-[#8B5CF6]/20 text-[#8B5CF6] hover:bg-[#8B5CF6]/30 rounded text-sm"
                              >
                                {s.isPartner ? "Remove Partner" : "Make Partner"}
                              </button>
                              <button
                                onClick={() => handleToggleDiscovery(s.id)}
                                className="px-3 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded text-sm"
                              >
                                {s.isDiscoverable ? "Hide" : "Show"}
                              </button>
                              <button
                                onClick={() => handleDeleteServer(s.id)}
                                className="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-sm"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-[#0a0a0a] rounded-lg p-4">
                    <h3 className="text-white font-semibold mb-3">Server Actions</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => toast.info("Search for a server first")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Partner Server</p>
                        <p className="text-sm text-[#666666]">Grant partner status</p>
                      </button>
                      <button 
                        onClick={() => toast.info("Search for a server first")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Delete Server</p>
                        <p className="text-sm text-[#666666]">Remove server permanently</p>
                      </button>
                      <button 
                        onClick={() => toast.info("Search for a server first")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Toggle Discovery</p>
                        <p className="text-sm text-[#666666]">Enable/disable discoverability</p>
                      </button>
                      <button 
                        onClick={() => toast.info("Transfer feature coming soon")}
                        className="p-3 bg-[#111111] hover:bg-[#1a1a1a] rounded-lg text-left transition-colors"
                      >
                        <p className="text-white font-medium">Transfer Ownership</p>
                        <p className="text-sm text-[#666666]">Change server owner</p>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Admin Panel - Platform Settings */}
              {activeTab === "admin-settings" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <Settings className="w-6 h-6 text-[#8B5CF6]" />
                    Platform Settings
                  </h2>

                  {/* Stats Overview */}
                  {adminStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-[#0a0a0a] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-white">{adminStats.users.toLocaleString()}</p>
                        <p className="text-sm text-[#666666]">Total Users</p>
                      </div>
                      <div className="bg-[#0a0a0a] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-white">{adminStats.servers.toLocaleString()}</p>
                        <p className="text-sm text-[#666666]">Total Servers</p>
                      </div>
                      <div className="bg-[#0a0a0a] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-white">{adminStats.messages.toLocaleString()}</p>
                        <p className="text-sm text-[#666666]">Total Messages</p>
                      </div>
                      <div className="bg-[#0a0a0a] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-green-400">+{adminStats.newUsersToday}</p>
                        <p className="text-sm text-[#666666]">New Today</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="bg-[#0a0a0a] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">Maintenance Mode</h3>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white">Enable Maintenance Mode</p>
                          <p className="text-sm text-[#666666]">Restrict access to staff only</p>
                        </div>
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 accent-[#8B5CF6]" 
                          checked={platformSettings?.maintenanceMode || false}
                          onChange={(e) => handleUpdatePlatformSettings({ maintenanceMode: e.target.checked })}
                        />
                      </label>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">Registration</h3>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white">Allow New Registrations</p>
                          <p className="text-sm text-[#666666]">Enable new user sign-ups</p>
                        </div>
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 accent-[#8B5CF6]" 
                          checked={platformSettings?.allowRegistration !== false}
                          onChange={(e) => handleUpdatePlatformSettings({ allowRegistration: e.target.checked })}
                        />
                      </label>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">Global Announcement</h3>
                      <Textarea
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        placeholder="Enter a global announcement to display to all users..."
                        className="bg-[#111111] border-[#222222] text-white mb-3"
                        rows={3}
                      />
                      <button 
                        onClick={handlePublishAnnouncement}
                        className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] text-white rounded font-medium"
                      >
                        Publish Announcement
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Admin Panel - Activity Logs */}
              {activeTab === "admin-logs" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <Activity className="w-6 h-6 text-[#8B5CF6]" />
                    Activity Logs
                  </h2>
                  <div className="bg-[#0a0a0a] rounded-lg p-4">
                    <div className="flex gap-2 mb-4">
                      <button 
                        onClick={() => { setAdminLogFilter("all"); fetchAdminLogs("all"); }}
                        className={cn("px-3 py-1.5 rounded text-sm", adminLogFilter === "all" ? "bg-[#8B5CF6] text-white" : "bg-[#111111] text-white hover:bg-[#1a1a1a]")}
                      >
                        All
                      </button>
                      <button 
                        onClick={() => { setAdminLogFilter("bans"); fetchAdminLogs("bans"); }}
                        className={cn("px-3 py-1.5 rounded text-sm", adminLogFilter === "bans" ? "bg-[#8B5CF6] text-white" : "bg-[#111111] text-white hover:bg-[#1a1a1a]")}
                      >
                        Bans
                      </button>
                      <button 
                        onClick={() => { setAdminLogFilter("reports"); fetchAdminLogs("reports"); }}
                        className={cn("px-3 py-1.5 rounded text-sm", adminLogFilter === "reports" ? "bg-[#8B5CF6] text-white" : "bg-[#111111] text-white hover:bg-[#1a1a1a]")}
                      >
                        Reports
                      </button>
                      <button 
                        onClick={() => { setAdminLogFilter("admin"); fetchAdminLogs("admin"); }}
                        className={cn("px-3 py-1.5 rounded text-sm", adminLogFilter === "admin" ? "bg-[#8B5CF6] text-white" : "bg-[#111111] text-white hover:bg-[#1a1a1a]")}
                      >
                        Admin Actions
                      </button>
                    </div>
                    <div className="space-y-2">
                      {isLoadingAdmin ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-[#8B5CF6]" />
                        </div>
                      ) : adminLogs.length === 0 ? (
                        <div className="p-3 bg-[#111111] rounded-lg">
                          <p className="text-white text-sm">No activity logs yet</p>
                          <p className="text-[#666666] text-xs mt-1">Admin actions will appear here</p>
                        </div>
                      ) : (
                        adminLogs.map((log) => (
                          <div key={log.id} className="p-3 bg-[#111111] rounded-lg">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Avatar className="w-6 h-6">
                                  <AvatarImage src={log.admin?.avatar} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                                    {log.admin?.displayName?.charAt(0) || log.admin?.username?.charAt(0) || "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-white text-sm font-medium">
                                  {log.admin?.displayName || log.admin?.username}
                                </span>
                                <span className="text-[#666666] text-sm">
                                  {log.action.replace(/_/g, " ")}
                                </span>
                              </div>
                              <span className="text-[#666666] text-xs">
                                {new Date(log.createdAt).toLocaleString()}
                              </span>
                            </div>
                            {log.reason && (
                              <p className="text-[#888888] text-sm mt-1">Reason: {log.reason}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Close Button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-[#b5bac1] hover:text-white border border-[#3f4147] rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* ESC hint */}
          <div className="absolute top-5 right-16 text-xs text-[#72767d]">
            ESC
          </div>

          {/* Save bar */}
          {hasChanges && (
            <div className="absolute bottom-0 left-0 right-0 bg-[#111111] border-t border-[#1a1a1a] p-3 flex items-center justify-between animate-in slide-in-from-bottom">
              <span className="text-white text-sm">Careful — you have unsaved changes!</span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (user) {
                      setDisplayName(user.displayName || "");
                      setBio(user.bio || "");
                      setPronouns(user.pronouns || "");
                      setCustomStatus(user.customStatus || "");
                      setStatus(user.status || "online");
                    }
                  }}
                  className="px-4 py-1.5 text-sm text-white hover:underline"
                >
                  Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-1.5 bg-[#248046] hover:bg-[#1a6334] disabled:opacity-50 text-white text-sm font-medium rounded transition-colors flex items-center gap-2"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Image Cropper */}
      <ImageCropper
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        imageUrl={cropperImage}
        aspectRatio={cropperType === "avatar" ? 1 : 3}
        onCropComplete={handleCropComplete}
        title={cropperType === "avatar" ? "Crop Avatar" : "Crop Banner"}
        description={
          cropperType === "avatar"
            ? "Adjust the crop area to select the portion of the image for your avatar."
            : "Adjust the crop area to select the portion of the image for your profile banner."
        }
        circular={cropperType === "avatar"}
      />
    </div>
  );
}
