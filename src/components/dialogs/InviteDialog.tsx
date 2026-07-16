"use client";

import { useState, useEffect, useRef } from "react";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  X,
  Copy,
  Check,
  Link2,
  Clock,
  Users,
  ChevronDown,
  Settings, 
  Share2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: string;
  serverId?: string | null;
}

const EXPIRE_OPTIONS = [
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 21600, label: "6 hours" },
  { value: 43200, label: "12 hours" },
  { value: 86400, label: "1 day" },
  { value: 604800, label: "7 days" },
  { value: 0, label: "Never" },
];

const MAX_USES_OPTIONS = [
  { value: 0, label: "No limit" },
  { value: 1, label: "1 use" },
  { value: 5, label: "5 uses" },
  { value: 10, label: "10 uses" },
  { value: 25, label: "25 uses" },
  { value: 50, label: "50 uses" },
  { value: 100, label: "100 uses" },
];

export function InviteDialog({ open, onOpenChange, channelId, serverId }: InviteDialogProps) {
  const { currentServer, channels: contextChannels, servers } = useServer();
  // When serverId is provided (e.g. right-click on a different server in the rail),
  // use that server instead of the currentServer from context.
  const activeServer = serverId
    ? servers.find((s) => s.id === serverId) || currentServer
    : currentServer;
  const gt = useGT();
  const [inviteCode, setInviteCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [maxAge, setMaxAge] = useState(604800); // 7 days
  const [maxUses, setMaxUses] = useState(0); // Unlimited
  const [selectedChannel, setSelectedChannel] = useState(channelId || "");
  const [vanityInfo, setVanityInfo] = useState<{ code: string | null; lockToVanity: boolean } | null>(null);
  const [localChannels, setLocalChannels] = useState<typeof contextChannels>([]);

  // When serverId targets a different server, fetch its channels locally
  // so we don't clobber the context channel list.
  const channels = serverId && serverId !== currentServer?.id ? localChannels : contextChannels;

  useEffect(() => {
    if (!open || !serverId || serverId === currentServer?.id) return;
    let active = true;
    fetch(`/api/servers/${serverId}/channels`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && Array.isArray(data?.channels)) {
          setLocalChannels(data.channels);
          const firstText = data.channels.find((c: any) => c.type === "text");
          if (firstText) setSelectedChannel(firstText.id);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [open, serverId, currentServer?.id]);

  // Generate invite on open
  useEffect(() => {
    if (open && activeServer) {
      // Fetch vanity info first; only create a real invite when the server
      // isn't locked to its custom (vanity) link.
      (async () => {
        const locked = await fetchVanityInfo();
        if (!locked) {
          generateInvite();
        }
      })();
    }
  }, [open, activeServer]);

  const fetchVanityInfo = async (): Promise<boolean> => {
    if (!activeServer) return false;
    try {
      const res = await fetch(`/api/servers/${activeServer.id}/vanity-url`);
      if (res.ok) {
        const data = await res.json();
        const code = data.code ?? null;
        const lockToVanity = Boolean(data.lockToVanity);
        setVanityInfo({ code, lockToVanity });
        return lockToVanity && Boolean(code);
      }
    } catch {
      // ignore — vanity info is optional
    }
    return false;
  };

  // Set initial channel
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      const textChannel = channels.find(c => c.type === "text");
      if (textChannel) {
        setSelectedChannel(textChannel.id);
      }
    }
  }, [channels, selectedChannel]);

  const generateInvite = async () => {
    if (!activeServer) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/servers/${activeServer.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannel || channels[0]?.id,
          maxAge,
          maxUses,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setInviteCode(data.invite?.code || data.code || "");
      } else {
        const data = await response.json().catch(() => null);
        const errMsg = data?.error || "";
        if (errMsg.toLowerCase().includes("custom invite link")) {
          await fetchVanityInfo();
        } else {
          setInviteCode("");
          toast.error(errMsg || gt("Failed to create invite link"));
        }
      }
    } catch (error) {
      console.error("Failed to create invite:", error);
      setInviteCode("");
      toast.error(gt("Failed to create invite link. Check your connection and try again."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    const inviteUrl = `https://serika.cc/${effectiveCode}`;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success(gt("Invite link copied!"));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const inviteUrl = `https://serika.cc/${effectiveCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: gt("Join {server} on SerikaCord", { server: activeServer?.name || "" }),
          text: gt("Come chat with us on SerikaCord!"),
          url: inviteUrl,
        });
        toast.success(gt("Shared!"));
      } catch {
        // User cancelled or share failed
      }
    } else {
      handleCopy();
    }
  };

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

  // Focus management: move focus into the dialog on open, restore on close
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // Focus the dialog container so screen readers announce it
      requestAnimationFrame(() => dialogRef.current?.focus());
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  if (!open || !activeServer) return null;

  const isLockedToVanity = vanityInfo?.lockToVanity && vanityInfo?.code;
  const effectiveCode = isLockedToVanity ? vanityInfo!.code : inviteCode;
  const inviteUrl = `serika.cc/${effectiveCode}`;
  const textChannels = channels.filter(c => c.type === "text");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Invite friends to ${activeServer.name}`}
        tabIndex={-1}
        className="relative w-full max-w-md mx-4 bg-[#111111] rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-200 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#222222]">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              <AvatarImage src={(activeServer as { icon?: string }).icon} />
              <AvatarFallback className="bg-[#8B5CF6] text-white">
                {activeServer.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-white font-semibold">{gt("Invite friends to")} {activeServer.name}</h2>
              <p className="text-xs text-[#888888]"><T>Share this link to invite others</T></p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-2 rounded-full hover:bg-[#1a1a1a] text-[#888888] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Channel Selector */}
          {!isLockedToVanity && (
          <div>
            <label className="block text-xs font-semibold uppercase text-[#888888] mb-2">
              {gt("INVITE TO CHANNEL")}
            </label>
            <div className="relative">
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] border border-[#222222] text-white appearance-none cursor-pointer"
              >
                {textChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    # {channel.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888] pointer-events-none" />
            </div>
          </div>
          )}

          {/* Invite Link */}
          <div>
            <label className="block text-xs font-semibold uppercase text-[#888888] mb-2">
              {gt("INVITE LINK")}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  value={isLoading ? gt("Generating...") : effectiveCode ? inviteUrl : gt("Could not create invite")}
                  readOnly
                  className="bg-[#0a0a0a] border-[#222222] text-white pr-10 font-mono text-sm"
                />
                {isLoading && (
                  <Loader size={16} className="absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              <button
                onClick={handleCopy}
                disabled={isLoading || !effectiveCode}
                className={cn(
                  "px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2",
                  copied
                    ? "bg-[#23A559] text-white"
                    : "bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                )}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    {gt("Copied")}
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    {gt("Copy")}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Share Button (Mobile) */}
          {"share" in navigator && (
            <button
              onClick={handleShare}
              className="w-full py-2.5 rounded-md bg-[#1a1a1a] hover:bg-[#222222] text-white font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              {gt("Share Invite Link")}
            </button>
          )}

          {/* Settings Toggle */}
          {!isLockedToVanity && (
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 text-sm text-[#888888] hover:text-white transition-colors"
          >
            <Settings className="w-4 h-4" />
            {gt("Edit invite link")}
            <ChevronDown className={cn(
              "w-4 h-4 transition-transform",
              showSettings && "rotate-180"
            )} />
          </button>
          )}

          {/* Settings Panel */}
          {showSettings && !isLockedToVanity && (
            <div className="space-y-4 p-4 rounded-lg bg-[#0a0a0a] border border-[#222222]">
              {/* Expire After */}
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#888888] mb-2">
                  <Clock className="w-3 h-3" />
                  {gt("EXPIRE AFTER")}
                </label>
                <select
                  value={maxAge}
                  onChange={(e) => setMaxAge(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
                >
                  {EXPIRE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max Uses */}
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#888888] mb-2">
                  <Users className="w-3 h-3" />
                  {gt("MAX NUMBER OF USES")}
                </label>
                <select
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-md bg-[#111111] border border-[#222222] text-white"
                >
                  {MAX_USES_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Generate New Link */}
              <button
                onClick={generateInvite}
                disabled={isLoading}
                className="w-full py-2 rounded-md bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                {gt("Generate New Link")}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#222222] bg-[#0a0a0a] rounded-b-lg">
          {isLockedToVanity ? (
            <p className="text-xs text-[#666666] text-center">
              <T>This server only allows invites through its custom invite link.</T>
            </p>
          ) : (
            <p className="text-xs text-[#666666] text-center">
              {gt("Your invite link expires in")} {EXPIRE_OPTIONS.find(o => o.value === maxAge)?.label || gt("7 days")}.
              {maxUses > 0 && ` ${gt("Limited to")} ${maxUses} ${gt("uses")}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
