"use client";

import { useState, useEffect, useMemo } from "react";
import { useServer } from "@/contexts/ServerContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hash, Volume2, Folder, MessagesSquare, Ticket, Lock } from "lucide-react";
import { toast } from "sonner";
import { T, useGT } from "gt-next";
import { useServerMembersOptional } from "@/contexts/ServerContext";
import { usePermissions } from "@/hooks/usePermissions";
import { normalizeOverwrites, setPrivateChannel } from "@/lib/permissions/overwriteEditor";

type CreatableChannelType = "text" | "voice" | "category" | "forum";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultParentId?: string;
  defaultType?: CreatableChannelType;
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  defaultParentId,
  defaultType,
}: CreateChannelDialogProps) {
  const { currentServer, fetchChannels, channels } = useServer();
  const rawMembers = useServerMembersOptional()?.members;
  const { can } = usePermissions(currentServer?.id);
  const canManageRoles = can("MANAGE_ROLES");
  const gt = useGT();
  const [isPrivate, setIsPrivate] = useState(false);
  const [step, setStep] = useState<"details" | "access">("details");
  const [accessRoles, setAccessRoles] = useState<Array<{ id: string; name: string; color?: string; isDefault?: boolean; position?: number }>>([]);
  const [granted, setGranted] = useState<Array<{ id: string; type: "role" | "member" }>>([]);
  const [accessQuery, setAccessQuery] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState<CreatableChannelType>("text");
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [nsfw, setNsfw] = useState(false);
  const [forumTickets, setForumTickets] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const categories = useMemo(
    () => channels.filter((c) => c.type === "category"),
    [channels]
  );

  useEffect(() => {
    if (open) {
      setChannelType(defaultType || "text");
      setParentId(defaultParentId);
      setNsfw(false);
      setForumTickets(false);
      setChannelName("");
      setError("");
      setIsPrivate(false);
      setStep("details");
      setGranted([]);
      setAccessQuery("");
    }
  }, [open, defaultType, defaultParentId]);

  const goToAccessStep = () => {
    if (!currentServer) return;
    setStep("access");
    fetch(`/api/servers/${currentServer.id}/roles`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAccessRoles(Array.isArray(data?.roles) ? data.roles : []))
      .catch(() => setAccessRoles([]));
  };

  const toggleGrant = (t: { id: string; type: "role" | "member" }) =>
    setGranted((prev) =>
      prev.some((g) => g.id === t.id && g.type === t.type) ? prev.filter((g) => !(g.id === t.id && g.type === t.type)) : [...prev, t],
    );

  const accessQ = accessQuery.trim().toLowerCase();
  const accessRoleRows = accessRoles
    .filter((r) => !r.isDefault && (!accessQ || r.name.toLowerCase().includes(accessQ)))
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  const accessMemberRows = ((rawMembers || []) as Array<{ id: string; username: string; displayName?: string; avatar?: string | null }>)
    .filter((mem) => !accessQ || mem.username.toLowerCase().includes(accessQ) || (mem.displayName || "").toLowerCase().includes(accessQ))
    .slice(0, 50);

  /** The overwrites a private channel starts with: the category's, @everyone denied, picks allowed. */
  const privateOverwrites = () => {
    const everyone = accessRoles.find((r) => r.isDefault);
    if (!everyone) return undefined;
    const parent = channelType !== "category" && parentId ? channels.find((c) => c.id === parentId) : null;
    return setPrivateChannel(normalizeOverwrites(parent?.permissionOverwrites), everyone.id, true, {
      voice: channelType === "voice",
      grantTo: granted,
    });
  };

  // Text & forum channels use lowercase-hyphenated names
  const isSlugType = channelType === "text" || channelType === "forum";

  const handleCreate = async () => {
    if (!channelName.trim() || !currentServer) return;
    if (isPrivate && !privateOverwrites()) {
      setError(gt("Roles are still loading. Try again in a moment."));
      return;
    }

    setIsLoading(true);
    setError("");

    const formattedName = isSlugType
      ? channelName.toLowerCase().replace(/\s+/g, "-")
      : channelName.trim();

    try {
      const response = await fetch(`/api/servers/${currentServer.id}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formattedName,
          type: channelType,
          parentId: channelType !== "category" ? parentId || null : undefined,
          nsfw: channelType !== "category" ? nsfw : undefined,
          forumMode: channelType === "forum" ? (forumTickets ? "tickets" : "posts") : undefined,
          permissionOverwrites: isPrivate ? privateOverwrites() : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create channel");
      }

      await fetchChannels(currentServer.id);
      onOpenChange(false);
      resetForm();
      toast.success(gt("Channel created!"));
    } catch (err) {
      setError(err instanceof Error ? err.message : gt("Failed to create channel"));
      toast.error(err instanceof Error ? err.message : gt("Failed to create channel"));
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setChannelName("");
    setChannelType("text");
    setParentId(undefined);
    setNsfw(false);
    setError("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold"><T>Create Channel</T></DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("in")} {currentServer?.name}
          </DialogDescription>
        </DialogHeader>

        {step === "access" ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Lock className="w-4 h-4" />
                {gt("Add members or roles")}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {gt("Only the members and roles you pick (plus administrators) will see #{name}.", { name: channelName || gt("new-channel") })}
              </p>
            </div>
            {error && <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
            <Input
              value={accessQuery}
              onChange={(e) => setAccessQuery(e.target.value)}
              placeholder={gt("Search members and roles")}
              aria-label={gt("Search members and roles")}
              className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]"
            />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] py-1">
              {accessRoleRows.length > 0 && (
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Roles")}</p>
              )}
              {accessRoleRows.map((r) => {
                const checked = granted.some((g) => g.type === "role" && g.id === r.id);
                return (
                  <label key={r.id} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)]">
                    <input type="checkbox" checked={checked} onChange={() => toggleGrant({ id: r.id, type: "role" })} className="accent-[var(--app-accent)]" />
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color || "var(--text-muted)" }} />
                    <span className="truncate text-sm">{r.name}</span>
                  </label>
                );
              })}
              {accessMemberRows.length > 0 && (
                <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Members")}</p>
              )}
              {accessMemberRows.map((mem) => {
                const checked = granted.some((g) => g.type === "member" && g.id === mem.id);
                return (
                  <label key={mem.id} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)]">
                    <input type="checkbox" checked={checked} onChange={() => toggleGrant({ id: mem.id, type: "member" })} className="accent-[var(--app-accent)]" />
                    <span className="truncate text-sm">{mem.displayName || mem.username}</span>
                    <span className="truncate text-xs text-[var(--text-muted)]">{mem.username}</span>
                  </label>
                );
              })}
              {accessRoleRows.length === 0 && accessMemberRows.length === 0 && (
                <p className="px-3 py-3 text-xs text-center text-[var(--text-muted)]">{gt("No roles or members found")}</p>
              )}
            </div>
            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={() => setStep("details")} className="text-[var(--text-primary)] hover:bg-transparent hover:underline">
                {gt("Back")}
              </Button>
              <div className="flex gap-2">
                {granted.length === 0 && (
                  <Button variant="ghost" onClick={handleCreate} disabled={isLoading} className="text-[var(--text-primary)] hover:bg-transparent hover:underline">
                    {gt("Skip")}
                  </Button>
                )}
                <Button onClick={handleCreate} disabled={isLoading || granted.length === 0} className="bg-[var(--app-accent)] hover:opacity-90 text-white">
                  {isLoading ? gt("Creating...") : channelType === "category" ? gt("Create Category") : gt("Create Channel")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
        <>
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Channel Type */}
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase text-[var(--text-secondary)]">
              {gt("Channel Type")}
            </Label>
            <div className="space-y-2">
              <button
                onClick={() => setChannelType("text")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors border ${
                  channelType === "text"
                    ? "bg-[#8B5CF6]/10 border-[#8B5CF6]"
                    : "bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                }`}
              >
                <Hash className="w-6 h-6 text-[var(--text-muted)]" />
                <div className="text-left">
                  <div className="font-medium"><T>Text</T></div>
                  <div className="text-xs text-[var(--text-muted)]">
                    <T>Send messages, images, GIFs, emoji, and more</T>
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "text"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]"
                      : "border-[var(--text-muted)]"
                  }`}
                >
                  {channelType === "text" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </button>

              <button
                onClick={() => setChannelType("voice")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors border ${
                  channelType === "voice"
                    ? "bg-[#8B5CF6]/10 border-[#8B5CF6]"
                    : "bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                }`}
              >
                <Volume2 className="w-6 h-6 text-[var(--text-muted)]" />
                <div className="text-left">
                  <div className="font-medium"><T>Voice</T></div>
                  <div className="text-xs text-[var(--text-muted)]">
                    <T>Hang out together with voice and video</T>
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "voice"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]"
                      : "border-[var(--text-muted)]"
                  }`}
                >
                  {channelType === "voice" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </button>

              <button
                onClick={() => setChannelType("forum")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors border ${
                  channelType === "forum"
                    ? "bg-[#8B5CF6]/10 border-[#8B5CF6]"
                    : "bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                }`}
              >
                <MessagesSquare className="w-6 h-6 text-[var(--text-muted)]" />
                <div className="text-left">
                  <div className="font-medium"><T>Forum</T></div>
                  <div className="text-xs text-[var(--text-muted)]">
                    <T>Organize discussion into posts, or run a ticket system</T>
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "forum"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]"
                      : "border-[var(--text-muted)]"
                  }`}
                >
                  {channelType === "forum" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </button>

              <button
                onClick={() => setChannelType("category")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors border ${
                  channelType === "category"
                    ? "bg-[#8B5CF6]/10 border-[#8B5CF6]"
                    : "bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                }`}
              >
                <Folder className="w-6 h-6 text-[var(--text-muted)]" />
                <div className="text-left">
                  <div className="font-medium"><T>Category</T></div>
                  <div className="text-xs text-[var(--text-muted)]">
                    <T>Group channels together under a category</T>
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "category"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]"
                      : "border-[var(--text-muted)]"
                  }`}
                >
                  {channelType === "category" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </button>
            </div>
          </div>

          {/* Channel Name */}
          <div className="space-y-2">
            <Label htmlFor="channelName" className="text-xs font-bold uppercase text-[var(--text-secondary)]">
              {gt("Channel Name")}
            </Label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                {channelType === "text" ? (
                  <Hash className="w-5 h-5" />
                ) : channelType === "voice" ? (
                  <Volume2 className="w-5 h-5" />
                ) : channelType === "forum" ? (
                  <MessagesSquare className="w-5 h-5" />
                ) : (
                  <Folder className="w-5 h-5" />
                )}
              </div>
              <Input
                id="channelName"
                value={channelName}
                onChange={(e) => {
                  const val = e.target.value;
                  if (isSlugType) {
                    setChannelName(val.toLowerCase().replace(/\s+/g, "-"));
                  } else {
                    setChannelName(val);
                  }
                }}
                placeholder={
                  channelType === "text"
                    ? "new-channel"
                    : channelType === "voice"
                    ? gt("New Voice Channel")
                    : channelType === "forum"
                    ? "new-forum"
                    : gt("New Category")
                }
                className="pl-10 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-[#8B5CF6] focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {/* Category Dropdown (if channel is not category) */}
          {channelType !== "category" && categories.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase text-[var(--text-secondary)]">
                {gt("Category")}
              </Label>
              <Select
                value={parentId || "none"}
                onValueChange={(val) => setParentId(val === "none" ? undefined : val)}
              >
                <SelectTrigger className="w-full bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue placeholder={gt("No Category")} />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectItem value="none">{gt("No Category")}</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* NSFW Checkbox (if channel is not category) */}
          {channelType !== "category" && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="space-y-0.5">
                <Label htmlFor="nsfw-toggle" className="font-medium cursor-pointer text-sm">
                  <T>Age-Restricted Channel (NSFW)</T>
                </Label>
                <div className="text-xs text-[var(--text-muted)] max-w-[280px]">
                  <T>Users will need to confirm they are of legal age to view this channel.</T>
                </div>
              </div>
              <ToggleSwitch
                checked={nsfw}
                onCheckedChange={setNsfw}
                aria-label="Age-restricted channel"
              />
            </div>
          )}

          {/* Private channel / category (Discord): @everyone loses View
              Channel; the next step picks who keeps access. */}
          {canManageRoles && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="space-y-0.5">
                <Label className="font-medium text-sm flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-[var(--text-muted)]" />
                  {channelType === "category" ? gt("Private Category") : gt("Private Channel")}
                </Label>
                <div className="text-xs text-[var(--text-muted)] max-w-[280px]">
                  {channelType === "category"
                    ? gt("Only selected members and roles will be able to view this category.")
                    : gt("Only selected members and roles will be able to view this channel.")}
                </div>
              </div>
              <ToggleSwitch
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
                aria-label={channelType === "category" ? gt("Private Category") : gt("Private Channel")}
              />
            </div>
          )}

          {/* Ticket mode (forum only) */}
          {channelType === "forum" && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="space-y-0.5">
                <Label htmlFor="ticket-toggle" className="font-medium cursor-pointer text-sm flex items-center gap-1.5">
                  <Ticket className="w-4 h-4 text-[#8B5CF6]" /> <T>Ticket System</T>
                </Label>
                <div className="text-xs text-[var(--text-muted)] max-w-[280px]">
                  <T>Each new post becomes a private ticket, visible only to its creator and your configured support roles.</T>
                </div>
              </div>
              <ToggleSwitch
                checked={forumTickets}
                onCheckedChange={setForumTickets}
                aria-label="Ticket system"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-[var(--text-primary)] hover:bg-transparent hover:underline"
          >
            <T>Cancel</T>
          </Button>
          {isPrivate ? (
            <Button
              onClick={goToAccessStep}
              disabled={!channelName.trim()}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
            >
              {gt("Next")}
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              disabled={!channelName.trim() || isLoading}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
            >
              {isLoading ? gt("Creating...") : gt("Create Channel")}
            </Button>
          )}
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
