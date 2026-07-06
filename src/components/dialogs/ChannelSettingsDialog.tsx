"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useServer } from "@/contexts/ServerContext";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hash, Volume2, X, Settings, Trash2, Shield, Clock, Plus, Check, Minus, Smile, Bold, Italic, Underline, Strikethrough, Eye, Lock, ChevronRight, ChevronDown, Link, Radio, Info, Search, MessageSquare, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { CHANNEL_PERMISSIONS } from "@/lib/constants/channels";
import { parsePermissionBitfield, stringifyPermissionBitfield } from "@/lib/roles/bitfield";

interface ServerRole {
  id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
}

interface PermissionOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

interface ChannelSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

export function ChannelSettingsDialog({
  open,
  onOpenChange,
  channelId,
}: ChannelSettingsDialogProps) {
  const { channels, updateChannel, deleteChannel, currentServer } = useServer();

  const channel = useMemo(
    () => channels.find((c) => c.id === channelId),
    [channels, channelId]
  );

  const categories = useMemo(
    () => channels.filter((c) => c.type === "category"),
    [channels]
  );

  const [activeTab, setActiveTab] = useState<"overview" | "permissions" | "integrations" | "invites" | "delete">("overview");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [nsfw, setNsfw] = useState(false);
  const [announcement, setAnnouncement] = useState(false);
  const [hideAfterInactivity, setHideAfterInactivity] = useState("3600");
  const [parentId, setParentId] = useState<string | null>(null);
  const [slowmode, setSlowmode] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [roles, setRoles] = useState<ServerRole[]>([]);
  const [overwrites, setOverwrites] = useState<PermissionOverwrite[]>([]);
  const [hasPermChanges, setHasPermChanges] = useState(false);
  const [showAddRoleMenu, setShowAddRoleMenu] = useState(false);

  // New States for Advanced Channel Settings UI
  const [isPreviewTopic, setIsPreviewTopic] = useState(false);
  const [showAdvancedPerms, setShowAdvancedPerms] = useState(false);
  const [selectedOverwriteId, setSelectedOverwriteId] = useState<string | null>(null);
  const [invites, setInvites] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);

  // Populate form when channel data loads
  useEffect(() => {
    if (channel && open) {
      setName(channel.name);
      setTopic(channel.topic || "");
      setNsfw(channel.isNsfw || false);
      setAnnouncement(channel.type === "announcement");
      setHideAfterInactivity("3600");
      setParentId(channel.parentId || null);
      setSlowmode(channel.rateLimitPerUser || 0);
      setActiveTab("overview");
      setHasChanges(false);
      setDeleteConfirmText("");
      setOverwrites((channel.permissionOverwrites || []).map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow || "0",
        deny: o.deny || "0",
      })));
      setHasPermChanges(false);
      setShowAddRoleMenu(false);
      setIsPreviewTopic(false);
      setShowAdvancedPerms(false);
      setSelectedOverwriteId(null);
    }
  }, [channel, open]);

  // Fetch server roles when dialog opens
  useEffect(() => {
    if (!open || !currentServer) return;
    let active = true;
    fetch(`/api/servers/${currentServer.id}/roles`)
      .then(r => r.json())
      .then(data => {
        if (!active) return;
        const nextRoles = (data.roles || []).map((r: any) => ({
          id: r._id || r.id,
          name: r.name,
          color: r.color,
          isDefault: r.isDefault,
        }));
        setRoles(nextRoles);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [open, currentServer]);

  // Track overview changes
  useEffect(() => {
    if (!channel) return;
    const changed =
      name !== channel.name ||
      topic !== (channel.topic || "") ||
      nsfw !== (channel.isNsfw || false) ||
      announcement !== (channel.type === "announcement") ||
      parentId !== (channel.parentId || null) ||
      slowmode !== (channel.rateLimitPerUser || 0);
    setHasChanges(changed);
  }, [name, topic, nsfw, announcement, parentId, slowmode, channel]);

  // Track permission changes
  useEffect(() => {
    if (!channel) return;
    const original = JSON.stringify(
      (channel.permissionOverwrites || []).map(o => ({ id: o.id, type: o.type, allow: o.allow || "0", deny: o.deny || "0" }))
    );
    const current = JSON.stringify(overwrites);
    setHasPermChanges(original !== current);
  }, [overwrites, channel]);

  const getRoleName = useCallback((roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    return role?.name || "Unknown";
  }, [roles]);

  const getRoleColor = useCallback((roleId: string) => {
    const role = roles.find(r => r.id === roleId);
    return role?.color || null;
  }, [roles]);

  const addRoleOverwrite = useCallback((roleId: string) => {
    if (overwrites.some(o => o.id === roleId)) return;
    setOverwrites(prev => [...prev, { id: roleId, type: 'role', allow: '0', deny: '0' }]);
    setShowAddRoleMenu(false);
  }, [overwrites]);

  const removeOverwrite = useCallback((id: string) => {
    setOverwrites(prev => prev.filter(o => o.id !== id));
  }, []);

  const cyclePermission = useCallback((overwriteId: string, permKey: keyof typeof CHANNEL_PERMISSIONS) => {
    const flag = BigInt(CHANNEL_PERMISSIONS[permKey].flag);
    setOverwrites(prev => prev.map(o => {
      if (o.id !== overwriteId) return o;
      const allowBits = parsePermissionBitfield(o.allow);
      const denyBits = parsePermissionBitfield(o.deny);
      const isAllowed = (allowBits & flag) === flag;
      const isDenied = (denyBits & flag) === flag;
      if (isAllowed) {
        // allowed -> denied
        return {
          ...o,
          allow: stringifyPermissionBitfield(allowBits & ~flag),
          deny: stringifyPermissionBitfield(denyBits | flag),
        };
      } else if (isDenied) {
        // denied -> neutral
        return {
          ...o,
          deny: stringifyPermissionBitfield(denyBits & ~flag),
        };
      } else {
        // neutral -> allowed
        return {
          ...o,
          allow: stringifyPermissionBitfield(allowBits | flag),
        };
      }
    }));
  }, []);

  const getPermState = useCallback((overwrite: PermissionOverwrite, permKey: keyof typeof CHANNEL_PERMISSIONS): 'allow' | 'deny' | 'neutral' => {
    const flag = BigInt(CHANNEL_PERMISSIONS[permKey].flag);
    const allowBits = parsePermissionBitfield(overwrite.allow);
    const denyBits = parsePermissionBitfield(overwrite.deny);
    if ((allowBits & flag) === flag) return 'allow';
    if ((denyBits & flag) === flag) return 'deny';
    return 'neutral';
  }, []);

  const fetchInvites = useCallback(async () => {
    if (!currentServer || !channel) return;
    setIsLoadingInvites(true);
    try {
      const res = await fetch(`/api/servers/${currentServer.id}/invites`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setInvites(data.filter((inv: any) => inv.channelId === channel.id));
      }
    } catch (err) {
      console.error("Failed to fetch invites", err);
    } finally {
      setIsLoadingInvites(false);
    }
  }, [currentServer, channel]);

  const handleDeleteInvite = async (code: string) => {
    if (!currentServer) return;
    try {
      const res = await fetch(`/api/servers/${currentServer.id}/invites/${code}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Invite revoked successfully");
        fetchInvites();
      } else {
        toast.error(data.error || "Failed to revoke invite");
      }
    } catch (err) {
      toast.error("Failed to revoke invite");
    }
  };

  const fetchWebhooks = useCallback(async () => {
    if (!channel) return;
    setIsLoadingWebhooks(true);
    try {
      const res = await fetch(`/api/v10/channels/${channel.id}/webhooks`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setWebhooks(data);
      }
    } catch (err) {
      console.error("Failed to fetch webhooks", err);
    } finally {
      setIsLoadingWebhooks(false);
    }
  }, [channel]);

  const handleCreateWebhook = async () => {
    if (!channel) return;
    try {
      const res = await fetch(`/api/v10/channels/${channel.id}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spidey Bot" }),
      });
      if (res.ok) {
        toast.success("Webhook created successfully");
        fetchWebhooks();
      } else {
        toast.error("Failed to create webhook");
      }
    } catch (err) {
      toast.error("Failed to create webhook");
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    try {
      const res = await fetch(`/api/v10/webhooks/${webhookId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Webhook deleted");
        fetchWebhooks();
      } else {
        toast.error("Failed to delete webhook");
      }
    } catch (err) {
      toast.error("Failed to delete webhook");
    }
  };

  // Run fetches depending on the activeTab
  useEffect(() => {
    if (open && channel) {
      if (activeTab === "invites") {
        fetchInvites();
      } else if (activeTab === "integrations") {
        fetchWebhooks();
      }
    }
  }, [open, channel, activeTab, fetchInvites, fetchWebhooks]);

  const syncWithCategory = () => {
    if (!channel || !channel.parentId) return;
    const parent = channels.find(c => c.id === channel.parentId);
    if (parent) {
      setOverwrites((parent.permissionOverwrites || []).map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow || "0",
        deny: o.deny || "0",
      })));
      toast.success("Synced permissions with category");
    }
  };

  const defaultRole = roles.find(r => r.isDefault);
  const everyoneOverwrite = defaultRole ? overwrites.find(o => o.id === defaultRole.id) : null;
  const isPrivate = everyoneOverwrite
    ? (parsePermissionBitfield(everyoneOverwrite.deny) & BigInt(CHANNEL_PERMISSIONS.VIEW_CHANNEL.flag)) === BigInt(CHANNEL_PERMISSIONS.VIEW_CHANNEL.flag)
    : false;

  const handleTogglePrivate = (checked: boolean) => {
    if (!defaultRole) return;
    const flag = BigInt(CHANNEL_PERMISSIONS.VIEW_CHANNEL.flag);
    
    setOverwrites(prev => {
      const existing = prev.find(o => o.id === defaultRole.id);
      if (existing) {
        const allowBits = parsePermissionBitfield(existing.allow);
        const denyBits = parsePermissionBitfield(existing.deny);
        
        if (checked) {
          // make private: remove from allow, add to deny
          return prev.map(o => o.id === defaultRole.id ? {
            ...o,
            allow: stringifyPermissionBitfield(allowBits & ~flag),
            deny: stringifyPermissionBitfield(denyBits | flag),
          } : o);
        } else {
          // make public: remove from deny
          return prev.map(o => o.id === defaultRole.id ? {
            ...o,
            deny: stringifyPermissionBitfield(denyBits & ~flag),
          } : o);
        }
      } else {
        if (checked) {
          // add new overwrite denying VIEW_CHANNEL
          return [...prev, { id: defaultRole.id, type: 'role', allow: '0', deny: stringifyPermissionBitfield(flag) }];
        }
        return prev;
      }
    });
  };

  const topicRef = useRef<HTMLTextAreaElement>(null);
  const insertFormatting = (syntax: string) => {
    const el = topicRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const selected = text.substring(start, end);
    const replacement = syntax + selected + syntax;
    setTopic(text.substring(0, start) + replacement + text.substring(end));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + syntax.length, start + syntax.length + selected.length);
    }, 0);
  };

  const handleSavePermissions = async () => {
    if (!channel || !hasPermChanges) return;
    setIsSaving(true);
    try {
      await updateChannel(channel.id, { permissionOverwrites: overwrites } as any);
      toast.success("Channel permissions saved");
      setHasPermChanges(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save permissions");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!channel || !hasChanges) return;
    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (name !== channel.name) updates.name = name.trim();
      if (topic !== (channel.topic || "")) updates.topic = topic;
      if (nsfw !== (channel.isNsfw || false)) updates.nsfw = nsfw;
      if (announcement !== (channel.type === "announcement")) {
        updates.type = announcement ? "announcement" : "text";
      }
      if (parentId !== (channel.parentId || null)) updates.parentId = parentId;
      if (slowmode !== (channel.rateLimitPerUser || 0)) updates.rateLimitPerUser = slowmode;

      await updateChannel(channel.id, updates as any);
      toast.success("Channel settings saved");
      setHasChanges(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!channel || deleteConfirmText !== channel.name) return;
    try {
      await deleteChannel(channel.id);
      toast.success(`Channel #${channel.name} deleted`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete channel");
    }
  };

  if (!channel) return null;

  const isVoice = channel.type === "voice";
  const isCategory = channel.type === "category";

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: Settings },
    ...(isCategory ? [] : [
      { id: "permissions" as const, label: "Permissions", icon: Shield },
      { id: "integrations" as const, label: "Integrations", icon: Radio },
      { id: "invites" as const, label: "Invites", icon: Link }
    ]),
  ];

  const slowmodeOptions = [
    { value: 0, label: "Off" },
    { value: 5, label: "5s" },
    { value: 10, label: "10s" },
    { value: 15, label: "15s" },
    { value: 30, label: "30s" },
    { value: 60, label: "1m" },
    { value: 120, label: "2m" },
    { value: 300, label: "5m" },
    { value: 600, label: "10m" },
    { value: 900, label: "15m" },
    { value: 1800, label: "30m" },
    { value: 3600, label: "1h" },
    { value: 7200, label: "2h" },
    { value: 21600, label: "6h" },
  ];

  const activeOverwriteId = selectedOverwriteId || overwrites[0]?.id || null;
  const activeOverwrite = overwrites.find(o => o.id === activeOverwriteId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-none !w-screen !h-screen !rounded-none p-0 bg-[var(--bg-app)] border-none overflow-hidden flex !translate-x-[-50%] !translate-y-[-50%] relative"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* ESC close hint button in top right */}
        <div className="absolute top-[60px] right-[60px] z-50 flex flex-col items-center gap-1.5 cursor-pointer select-none group" onClick={() => onOpenChange(false)}>
          <div className="w-9 h-9 rounded-full border-2 border-[var(--text-muted)] group-hover:border-[var(--text-primary)] flex items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-all">
            <X className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">ESC</span>
        </div>

        {/* Sidebar Navigation */}
        <div className="w-[240px] shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col justify-between py-6">
          <div className="space-y-4">
            <div className="px-4">
              <h2 className="text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-widest mb-1.5">
                {isVoice ? "Voice" : isCategory ? "Category" : "Text"} Channel
              </h2>
              <p className="text-sm text-[var(--text-primary)] font-semibold truncate flex items-center gap-1.5">
                {isVoice ? <Volume2 className="w-4 h-4 text-[var(--text-secondary)]" /> : !isCategory ? <Hash className="w-4 h-4 text-[var(--text-secondary)]" /> : null}
                {channel.name}
              </p>
            </div>

            <nav className="px-2 space-y-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2.5 transition-colors ${
                    activeTab === tab.id
                      ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="px-2">
            <button
              onClick={() => setActiveTab("delete")}
              className={`w-full px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2.5 transition-colors ${
                activeTab === "delete"
                  ? "bg-red-500/20 text-red-400"
                  : "text-red-400 hover:bg-red-500/10 hover:text-red-300"
              }`}
            >
              <Trash2 className="w-4 h-4" />
              Delete Channel
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[var(--bg-card)]">
          {/* Header */}
          <div className="flex items-center justify-between px-10 py-6 border-b border-[var(--border-subtle)]">
            <h1 className="text-xl font-bold text-[var(--text-primary)] capitalize">
              {activeTab === "delete" ? "Delete Channel" : activeTab}
            </h1>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto px-10 py-8 space-y-8">
            {activeTab === "overview" && (
              <div className="max-w-[680px]">
                {/* General section */}
                <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-6 space-y-6">
                  {/* Channel Name */}
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">
                      Channel Name
                    </Label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-[var(--text-muted)]">
                        {isVoice ? <Volume2 className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
                      </span>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                        className="pl-9 pr-9 bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--app-accent)] h-10"
                      />
                      <button className="absolute right-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        <Smile className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Channel Topic (not for voice or category) */}
                  {!isVoice && !isCategory && (
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">
                        Channel Topic
                      </Label>
                      <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)]">
                        {/* Formatting Toolbar */}
                        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-sidebar)] border-b border-[var(--border-subtle)]">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => insertFormatting("**")}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all"
                              title="Bold"
                            >
                              <Bold className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => insertFormatting("*")}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all"
                              title="Italic"
                            >
                              <Italic className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => insertFormatting("__")}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all"
                              title="Underline"
                            >
                              <Underline className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => insertFormatting("~~")}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all"
                              title="Strikethrough"
                            >
                              <Strikethrough className="w-3.5 h-3.5" />
                            </button>
                            <div className="h-4 w-[1px] bg-[var(--border-subtle)] mx-1" />
                            <button
                              type="button"
                              onClick={() => setIsPreviewTopic(!isPreviewTopic)}
                              className={`p-1 rounded transition-all ${
                                isPreviewTopic
                                  ? "bg-[var(--app-accent)] text-white"
                                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)]"
                              }`}
                              title="Toggle Preview"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <button className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all">
                            <Smile className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Editor / Preview text content */}
                        {isPreviewTopic ? (
                          <div className="p-3 min-h-[80px] text-sm text-[var(--text-secondary)] bg-[var(--bg-sidebar-elevated)] prose prose-invert max-w-none">
                            {topic ? (
                              <p className="whitespace-pre-wrap leading-relaxed">{topic}</p>
                            ) : (
                              <span className="italic text-[var(--text-muted)]">Nothing to preview. Write some topic description.</span>
                            )}
                          </div>
                        ) : (
                          <Textarea
                            ref={topicRef}
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            maxLength={1024}
                            placeholder="Set a topic to let everyone know what this channel is about"
                            className="border-none bg-transparent text-[var(--text-primary)] focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[80px] resize-none rounded-none p-3 h-auto"
                          />
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] text-right font-medium">
                        {topic.length}/1024
                      </p>
                    </div>
                  )}

                  {/* Category */}
                  {!isCategory && (
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">
                        Category
                      </Label>
                      <Select value={parentId || "__none__"} onValueChange={(v) => setParentId(v === "__none__" ? null : v)}>
                        <SelectTrigger className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)]">
                          <SelectItem value="__none__" className="text-[var(--text-secondary)]">
                            No Category
                          </SelectItem>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id} className="text-[var(--text-secondary)]">
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Slowmode (text only) */}
                {!isVoice && !isCategory && (
                  <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-6 space-y-4 mt-6">
                    <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                      Slowmode
                    </Label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min={0}
                        max={slowmodeOptions.length - 1}
                        value={slowmodeOptions.findIndex((o) => o.value === slowmode)}
                        onChange={(e) => setSlowmode(slowmodeOptions[parseInt(e.target.value)].value)}
                        className="flex-1 accent-[var(--app-accent)] h-1 bg-[var(--bg-sidebar-elevated)] rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-xs text-[var(--text-primary)] font-semibold bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] rounded px-2.5 py-1 min-w-[50px] text-center">
                        {slowmodeOptions.find((o) => o.value === slowmode)?.label || "Off"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                      Members will be restricted to sending one message per slowmode interval unless they have Manage Messages or Manage Channel overrides.
                    </p>
                  </div>
                )}

                {/* Additional Toggles */}
                {!isCategory && (
                  <div className="space-y-4 mt-6">
                    {/* NSFW Toggle */}
                    <div className="flex items-center justify-between p-6 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                      <div className="space-y-1">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          Age-Restricted Channel
                        </span>
                        <p className="text-xs text-[var(--text-muted)] max-w-lg leading-relaxed">
                          Users must verify their age to view content in this channel. This channel will be marked with an age-restricted badge in lists.
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={nsfw}
                        onCheckedChange={setNsfw}
                        aria-label="Toggle NSFW"
                      />
                    </div>

                    {/* Announcement toggle */}
                    <div className="p-6 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            Announcement Channel
                          </span>
                          <p className="text-xs text-[var(--text-muted)] max-w-lg leading-relaxed">
                            Publish updates from this channel directly to other servers so members can stay up to date.
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={announcement}
                          onCheckedChange={setAnnouncement}
                          aria-label="Toggle Announcement"
                        />
                      </div>
                      {announcement && (
                        <div className="flex gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 leading-relaxed">
                          <Info className="w-4 h-4 shrink-0 text-blue-400" />
                          <div>
                            <span className="font-semibold text-blue-300 block mb-0.5">Announcement Channel</span>
                            By creating an announcement channel, your server profile will be visible, and people can follow updates from this channel directly to their own servers.
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Hide After Inactivity */}
                    <div className="space-y-3 p-6 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl">
                      <div className="space-y-1">
                        <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">
                          Hide After Inactivity
                        </Label>
                        <p className="text-xs text-[var(--text-muted)] max-w-lg leading-relaxed">
                          New threads in this channel will be hidden from the channel list after this period of inactivity.
                        </p>
                      </div>
                      <Select value={hideAfterInactivity} onValueChange={setHideAfterInactivity}>
                        <SelectTrigger className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-10 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)]">
                          <SelectItem value="3600" className="text-[var(--text-secondary)]">1 Hour</SelectItem>
                          <SelectItem value="86400" className="text-[var(--text-secondary)]">24 Hours</SelectItem>
                          <SelectItem value="259200" className="text-[var(--text-secondary)]">3 Days</SelectItem>
                          <SelectItem value="604800" className="text-[var(--text-secondary)]">1 Week</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "permissions" && (
              <div className="max-w-[720px] space-y-6">
                {/* Category Sync Notice */}
                {channel.parentId && (
                  <div className="flex items-center justify-between p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 leading-normal">
                    <div className="flex items-center gap-2.5">
                      <AlertCircle className="w-4.5 h-4.5 text-amber-400 shrink-0" />
                      <span>
                        Permissions not synced with category: <strong>{categories.find(c => c.id === channel.parentId)?.name || "Category"}</strong>
                      </span>
                    </div>
                    <button
                      onClick={syncWithCategory}
                      className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white rounded text-xs font-medium transition-colors"
                    >
                      Sync Now
                    </button>
                  </div>
                )}

                {/* Private Channel card */}
                <div className="p-5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <div className="p-2 rounded bg-red-500/10 text-red-400 shrink-0">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        Private Channel
                      </span>
                      <p className="text-xs text-[var(--text-muted)] max-w-md leading-relaxed">
                        By making a channel private, only selected members and roles will be able to view this channel.
                      </p>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={isPrivate}
                    onCheckedChange={handleTogglePrivate}
                    aria-label="Toggle Private Channel"
                  />
                </div>

                {/* Collapsible Advanced section */}
                <div className="mt-6 border-t border-[var(--border-subtle)] pt-6">
                  <button
                    onClick={() => setShowAdvancedPerms(!showAdvancedPerms)}
                    className="flex items-center justify-between w-full py-2 text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <span>Advanced Permissions</span>
                    {showAdvancedPerms ? <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />}
                  </button>

                  {showAdvancedPerms && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-[200px,1fr] gap-6 min-h-[300px] border border-[var(--border-subtle)] rounded-xl p-5 bg-[var(--bg-app)]">
                      {/* Left list of added Overwrites */}
                      <div className="border-r border-[var(--border-subtle)] pr-4 flex flex-col gap-1.5 justify-start min-h-[250px]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Roles/Members</span>
                          <div className="relative">
                            <button
                              onClick={() => setShowAddRoleMenu(!showAddRoleMenu)}
                              className="p-1 rounded bg-[var(--bg-sidebar)] hover:bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            {showAddRoleMenu && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowAddRoleMenu(false)} />
                                <div className="absolute left-0 mt-1 z-50 w-56 max-h-64 overflow-y-auto bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1">
                                  {roles
                                    .filter(r => !overwrites.some(o => o.id === r.id))
                                    .map(role => (
                                      <button
                                        key={role.id}
                                        onClick={() => addRoleOverwrite(role.id)}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] transition-colors text-left"
                                      >
                                        <div
                                          className="w-3 h-3 rounded-full shrink-0"
                                          style={{ backgroundColor: role.color || "#888" }}
                                        />
                                        <span className="truncate">{role.name}</span>
                                      </button>
                                    ))}
                                  {roles.filter(r => !overwrites.some(o => o.id === r.id)).length === 0 && (
                                    <div className="px-3 py-2 text-xs text-[var(--text-muted)] text-center">
                                      All roles already added
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {overwrites.map(o => {
                          const roleName = getRoleName(o.id);
                          const roleColor = getRoleColor(o.id);
                          const isActive = o.id === activeOverwriteId;
                          return (
                            <button
                              key={o.id}
                              onClick={() => setSelectedOverwriteId(o.id)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                isActive
                                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                                  : "text-[var(--text-muted)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-secondary)]"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: roleColor || "#888" }} />
                                <span className="truncate">{roleName}</span>
                              </div>
                              {o.id !== defaultRole?.id && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeOverwrite(o.id);
                                    if (activeOverwriteId === o.id) setSelectedOverwriteId(null);
                                  }}
                                  className="p-0.5 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Right Grid of Cycle Permission switches */}
                      <div className="pl-4 overflow-y-auto max-h-[380px] pr-2">
                        {activeOverwrite ? (
                          <div className="space-y-4">
                            <div className="pb-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
                              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                                Permissions Override: <strong className="text-[var(--text-primary)]">{getRoleName(activeOverwrite.id)}</strong>
                              </span>
                            </div>
                            <div className="space-y-3">
                              {(isVoice
                                ? (['VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'STREAM', 'USE_VOICE_ACTIVITY', 'PRIORITY_SPEAKER', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS', 'MANAGE_CHANNELS', 'MANAGE_PERMISSIONS'] as const)
                                : (['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'ADD_REACTIONS', 'ATTACH_FILES', 'EMBED_LINKS', 'USE_EXTERNAL_EMOJI', 'MENTION_EVERYONE', 'MANAGE_MESSAGES', 'MANAGE_CHANNELS', 'MANAGE_PERMISSIONS'] as const)
                              ).map(permKey => {
                                const state = getPermState(activeOverwrite, permKey);
                                return (
                                  <div key={permKey} className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]/30 last:border-0">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                                      {CHANNEL_PERMISSIONS[permKey].name}
                                    </span>

                                    <div className="flex items-center bg-[var(--bg-sidebar)] rounded p-0.5 border border-[var(--border-subtle)] shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const flag = BigInt(CHANNEL_PERMISSIONS[permKey].flag);
                                          setOverwrites(prev => prev.map(o => o.id === activeOverwrite.id ? {
                                            ...o,
                                            allow: stringifyPermissionBitfield(parsePermissionBitfield(o.allow) & ~flag),
                                            deny: stringifyPermissionBitfield(parsePermissionBitfield(o.deny) | flag),
                                          } : o));
                                        }}
                                        className={`w-7 h-6 rounded flex items-center justify-center text-xs font-bold transition-all ${
                                          state === 'deny'
                                            ? "bg-red-500 text-white shadow-sm"
                                            : "text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                                        }`}
                                        title="Deny"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const flag = BigInt(CHANNEL_PERMISSIONS[permKey].flag);
                                          setOverwrites(prev => prev.map(o => o.id === activeOverwrite.id ? {
                                            ...o,
                                            allow: stringifyPermissionBitfield(parsePermissionBitfield(o.allow) & ~flag),
                                            deny: stringifyPermissionBitfield(parsePermissionBitfield(o.deny) & ~flag),
                                          } : o));
                                        }}
                                        className={`w-7 h-6 rounded flex items-center justify-center text-xs font-bold transition-all ${
                                          state === 'neutral'
                                            ? "bg-[var(--bg-active)] text-[var(--text-primary)] shadow-sm"
                                            : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                                        }`}
                                        title="Inherit"
                                      >
                                        /
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const flag = BigInt(CHANNEL_PERMISSIONS[permKey].flag);
                                          setOverwrites(prev => prev.map(o => o.id === activeOverwrite.id ? {
                                            ...o,
                                            allow: stringifyPermissionBitfield(parsePermissionBitfield(o.allow) | flag),
                                            deny: stringifyPermissionBitfield(parsePermissionBitfield(o.deny) & ~flag),
                                          } : o));
                                        }}
                                        className={`w-7 h-6 rounded flex items-center justify-center text-xs font-bold transition-all ${
                                          state === 'allow'
                                            ? "bg-green-500 text-white shadow-sm"
                                            : "text-green-500/70 hover:text-green-500 hover:bg-green-500/10"
                                        }`}
                                        title="Allow"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full py-10 text-[var(--text-muted)] text-xs">
                            <Shield className="w-8 h-8 mb-2 opacity-50 text-[var(--text-muted)]" />
                            <span>Select a role or member on the left</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "integrations" && (
              <div className="max-w-[720px] space-y-6">
                <div className="flex items-center justify-between p-5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                  <div className="space-y-1">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      Webhooks Manager
                    </span>
                    <p className="text-xs text-[var(--text-muted)] max-w-md leading-relaxed">
                      Webhooks are an easy way to get data posted into this channel. Send alerts, build bots, or trigger hooks.
                    </p>
                  </div>
                  <Button
                    onClick={handleCreateWebhook}
                    className="bg-[var(--app-accent)] hover:opacity-90 text-[var(--text-on-accent)] text-sm px-4 h-9"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    New Webhook
                  </Button>
                </div>

                {isLoadingWebhooks ? (
                  <div className="text-center py-10 text-xs text-[var(--text-muted)]">Loading webhooks...</div>
                ) : webhooks.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm flex flex-col items-center gap-3">
                    <Radio className="w-10 h-10 opacity-40 text-[var(--text-muted)]" />
                    <span>No webhooks created for this channel yet</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {webhooks.map((w) => (
                      <div
                        key={w.id}
                        className="flex items-center justify-between p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] hover:bg-[var(--bg-sidebar-elevated)] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-[var(--bg-sidebar)] flex items-center justify-center border border-[var(--border-subtle)] shrink-0">
                            {w.avatar ? (
                              <img src={w.avatar} alt={w.name} className="w-full h-full rounded-full object-cover" />
                            ) : (
                              <Radio className="w-5 h-5 text-[var(--text-secondary)]" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-sm text-[var(--text-primary)] block truncate">
                              {w.name}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)] block truncate font-mono mt-0.5">
                              URL: {w.url}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteWebhook(w.id)}
                          className="p-2 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors shrink-0"
                          title="Delete Webhook"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "invites" && (
              <div className="max-w-[720px] space-y-6">
                <div className="p-5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                  <span className="text-sm font-semibold text-[var(--text-primary)] block mb-1">
                    Channel-Specific Invites
                  </span>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    A list of active invite links pointing directly to this channel. Revoking invite links deletes them immediately.
                  </p>
                </div>

                {isLoadingInvites ? (
                  <div className="text-center py-10 text-xs text-[var(--text-muted)]">Loading invites...</div>
                ) : invites.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] text-[var(--text-muted)] text-sm flex flex-col items-center gap-3">
                    <Link className="w-10 h-10 opacity-40 text-[var(--text-muted)]" />
                    <span>No active invites for this channel</span>
                  </div>
                ) : (
                  <div className="border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-app)] overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] text-[var(--text-muted)] uppercase tracking-wider font-bold">
                          <th className="p-3 pl-4">Code</th>
                          <th className="p-3">Uses</th>
                          <th className="p-3">Expires</th>
                          <th className="p-3 pr-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((inv) => (
                          <tr key={inv.code} className="border-b border-[var(--border-subtle)]/50 last:border-none text-[var(--text-secondary)] font-medium">
                            <td className="p-3 pl-4 font-mono text-[var(--text-primary)]">{inv.code}</td>
                            <td className="p-3">{inv.uses} {inv.maxUses > 0 ? `/ ${inv.maxUses}` : ""}</td>
                            <td className="p-3">
                              {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "Never"}
                            </td>
                            <td className="p-3 pr-4 text-right">
                              <button
                                onClick={() => handleDeleteInvite(inv.code)}
                                className="px-2.5 py-1 rounded bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white text-xs font-semibold transition-all"
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "delete" && (
              <div className="max-w-[520px] space-y-6">
                <div className="p-5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <h3 className="text-base font-semibold text-red-400 mb-2">
                    Delete #{channel.name}
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                    Are you sure you want to delete <span className="font-semibold text-[var(--text-primary)]">#{channel.name}</span>?
                    This action is irreversible. All messages, attachments, and data in this channel will be permanently lost.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">
                    Type <span className="text-[var(--text-primary)]">{channel.name}</span> to confirm
                  </Label>
                  <Input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={channel.name}
                    className="bg-[var(--bg-sidebar)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-red-500 h-10"
                  />
                </div>

                <Button
                  onClick={handleDelete}
                  disabled={deleteConfirmText !== channel.name}
                  className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600 text-white font-medium w-full h-10"
                >
                  Delete Channel
                </Button>
              </div>
            )}
          </div>

          {/* Unsaved Changes Bar */}
          {hasChanges && activeTab === "overview" && (
            <div className="shrink-0 px-8 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex items-center justify-between animate-in slide-in-from-bottom-2">
              <span className="text-sm text-[var(--text-secondary)]">
                Careful — you have unsaved changes!
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (channel) {
                      setName(channel.name);
                      setTopic(channel.topic || "");
                      setNsfw(channel.isNsfw || false);
                      setAnnouncement(channel.type === "announcement");
                      setParentId(channel.parentId || null);
                      setSlowmode(channel.rateLimitPerUser || 0);
                    }
                  }}
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline transition-colors"
                >
                  Reset
                </button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !name.trim()}
                  className="bg-[var(--app-accent)] hover:opacity-90 text-[var(--text-on-accent)] text-sm px-5 h-9"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}

          {hasPermChanges && activeTab === "permissions" && (
            <div className="shrink-0 px-8 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex items-center justify-between animate-in slide-in-from-bottom-2">
              <span className="text-sm text-[var(--text-secondary)]">
                You have unsaved permission changes!
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (channel) {
                      setOverwrites((channel.permissionOverwrites || []).map(o => ({
                        id: o.id,
                        type: o.type,
                        allow: o.allow || "0",
                        deny: o.deny || "0",
                      })));
                    }
                  }}
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline transition-colors"
                >
                  Reset
                </button>
                <Button
                  onClick={handleSavePermissions}
                  disabled={isSaving}
                  className="bg-[var(--app-accent)] hover:opacity-90 text-[var(--text-on-accent)] text-sm px-5 h-9"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
