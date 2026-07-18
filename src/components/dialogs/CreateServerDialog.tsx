"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Users, ArrowRight, Hash, ImagePlus, Lock, Globe, Mail, Check, Rocket } from "lucide-react";
import { toast } from "sonner";
import { T, useGT } from "gt-next";

interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateServerDialog({ open, onOpenChange }: CreateServerDialogProps) {
  const router = useRouter();
  const { createServer, joinServer } = useServer();
  const gt = useGT();
  const [mode, setMode] = useState<"select" | "create" | "join" | "onboard">("select");
  const [serverName, setServerName] = useState("My Server");
  const [inviteCode, setInviteCode] = useState("");
  const [serverIcon, setServerIcon] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [createdServerId, setCreatedServerId] = useState<string | null>(null);
  const [onboardStep, setOnboardStep] = useState(0);
  const [onboardDesc, setOnboardDesc] = useState("");
  const [onboardJoinMode, setOnboardJoinMode] = useState<"invite_only" | "apply_to_join" | "discoverable">("invite_only");

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setServerIcon(file);
      const reader = new FileReader();
      reader.onload = () => setIconPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleCreate = async () => {
    if (!serverName.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      const server = await createServer(serverName, serverIcon || undefined);
      setCreatedServerId(server.id);
      setMode("onboard");
      setOnboardStep(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : gt("Failed to create server"));
      toast.error(err instanceof Error ? err.message : gt("Failed to create server"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      await joinServer(inviteCode);
      onOpenChange(false);
      resetForm();
      toast.success(gt("Joined server!"));
    } catch (err) {
      setError(err instanceof Error ? err.message : gt("Failed to join server"));
      toast.error(err instanceof Error ? err.message : gt("Failed to join server"));
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setMode("select");
    setServerName("My Server");
    setInviteCode("");
    setServerIcon(null);
    setIconPreview(null);
    setError("");
    setCreatedServerId(null);
    setOnboardStep(0);
    setOnboardDesc("");
    setOnboardJoinMode("invite_only");
  };

  const handleOnboardFinish = async () => {
    if (!createdServerId) return;
    setIsLoading(true);
    try {
      await fetch(`/api/servers/${createdServerId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            access: { joinMode: onboardJoinMode },
            discoveryDescription: onboardDesc,
          },
        }),
      });
      toast.success(gt("Server created!"));
      onOpenChange(false);
      router.push(`/channels/${createdServerId}`);
      resetForm();
    } catch {
      toast.success(gt("Server created!"));
      onOpenChange(false);
      router.push(`/channels/${createdServerId}`);
      resetForm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="bg-[#0a0a0a] border border-[#1a1a1a] text-white max-w-md p-0 gap-0">
        {mode === "select" && (
          <>
            <DialogHeader className="p-4 text-center">
              <DialogTitle className="text-2xl font-bold"><T>Create a server</T></DialogTitle>
              <DialogDescription className="text-[#888888]">
                <T>Your server is where you and your friends hang out. Make yours and start talking.</T>
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 space-y-2">
              <button
                onClick={() => setMode("create")}
                className="w-full p-3 rounded-lg bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#8B5CF6] flex items-center justify-center">
                    <Hash className="w-6 h-6 text-white" />
                  </div>
                  <span className="font-medium"><T>Create My Own</T></span>
                </div>
                <ArrowRight className="w-5 h-5 text-[#666666] group-hover:text-white transition-colors" />
              </button>

              <div className="py-3">
                <div className="text-center text-xs font-semibold uppercase text-[#666666] mb-3">
                  <T>Have an invite already?</T>
                </div>
                <button
                  onClick={() => setMode("join")}
                  className="w-full p-3 rounded-lg bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-[#7C3AED] flex items-center justify-center">
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <span className="font-medium"><T>Join a Server</T></span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-[#666666] group-hover:text-white transition-colors" />
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "create" && (
          <>
            <DialogHeader className="p-4 text-center">
              <DialogTitle className="text-2xl font-bold"><T>Customize your server</T></DialogTitle>
              <DialogDescription className="text-[#888888]">
                <T>Give your new server a personality with a name and an icon. You can always change it later.</T>
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 space-y-4">
              {error && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Icon Upload */}
              <div className="flex justify-center">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleIconChange}
                    className="hidden"
                  />
                  {iconPreview ? (
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-dashed border-[#8B5CF6] hover:border-[#A78BFA] transition-colors">
                      <img src={iconPreview} alt="Server icon" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-full border-2 border-dashed border-[#666666] hover:border-white transition-colors flex flex-col items-center justify-center gap-1">
                      <ImagePlus className="w-6 h-6 text-[#666666]" />
                      <span className="text-xs text-[#666666] font-semibold"><T>UPLOAD</T></span>
                    </div>
                  )}
                </label>
              </div>

              {/* Server Name */}
              <div className="space-y-2">
                <Label htmlFor="serverName" className="text-xs font-bold uppercase text-[#888888]">
                  {gt("Server Name")}
                </Label>
                <Input
                  id="serverName"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="bg-[#111111] border-[#222222] text-white focus-visible:ring-[#8B5CF6] focus-visible:ring-offset-0"
                />
              </div>

              <p className="text-xs text-[#666666]">
                <T>By creating a server, you agree to SerikaCord&apos;s</T>{" "}
                <span className="text-[#8B5CF6] hover:underline cursor-pointer"><T>Community Guidelines</T></span>.
              </p>
            </div>
            <div className="p-4 bg-[#111111] border-t border-[#1a1a1a] flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setMode("select")}
                className="text-white hover:bg-transparent hover:underline"
              >
                <T>Back</T>
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!serverName.trim() || isLoading}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
              >
                {isLoading ? gt("Creating...") : gt("Create")}
              </Button>
            </div>
          </>
        )}

        {mode === "join" && (
          <>
            <DialogHeader className="p-4 text-center">
              <DialogTitle className="text-2xl font-bold"><T>Join a Server</T></DialogTitle>
              <DialogDescription className="text-[#888888]">
                <T>Enter an invite below to join an existing server</T>
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 space-y-4">
              {error && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="inviteCode" className="text-xs font-bold uppercase text-[#888888]">
                  {gt("Invite Link")} <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="https://serikacord.app/invite/coolserver"
                  className="bg-[#111111] border-[#222222] text-white placeholder:text-[#555555] focus-visible:ring-[#8B5CF6] focus-visible:ring-offset-0"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold uppercase text-[#888888]">
                  <T>Invites should look like</T>
                </div>
                <div className="text-sm text-[#666666] space-y-1">
                  <div>hTKzmak</div>
                  <div>https://serikacord.app/invite/hTKzmak</div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-[#111111] border-t border-[#1a1a1a] flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setMode("select")}
                className="text-white hover:bg-transparent hover:underline"
              >
                <T>Back</T>
              </Button>
              <Button
                onClick={handleJoin}
                disabled={!inviteCode.trim() || isLoading}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
              >
                {isLoading ? gt("Joining...") : gt("Join Server")}
              </Button>
            </div>
          </>
        )}

        {mode === "onboard" && (
          <>
            <DialogHeader className="p-4 text-center">
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center">
                  <Rocket className="w-7 h-7 text-[#8B5CF6]" />
                </div>
              </div>
              <DialogTitle className="text-2xl font-bold"><T>Set up your server</T></DialogTitle>
              <DialogDescription className="text-[#888888]">
                {onboardStep === 0
                  ? gt("Tell people what your server is about.")
                  : gt("Choose how people can join your server.")}
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 space-y-4">
              {onboardStep === 0 && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-[#888888]">
                      {gt("Server Description")}
                    </Label>
                    <textarea
                      value={onboardDesc}
                      onChange={(e) => setOnboardDesc(e.target.value)}
                      placeholder={gt("A brief description of your server...")}
                      rows={3}
                      maxLength={500}
                      className="w-full p-3 rounded-lg bg-[#111111] border border-[#222222] text-white placeholder:text-[#555555] focus:outline-none focus:border-[#8B5CF6] resize-none text-sm"
                    />
                    <p className="text-xs text-[#666666] text-right">{onboardDesc.length}/500</p>
                  </div>
                </>
              )}

              {onboardStep === 1 && (
                <div className="space-y-3">
                  {([
                    { key: "invite_only", icon: Lock, title: gt("Invite Only"), desc: gt("People need an invite link to join") },
                    { key: "apply_to_join", icon: Mail, title: gt("Apply to Join"), desc: gt("People must apply and be approved") },
                    { key: "discoverable", icon: Globe, title: gt("Discoverable"), desc: gt("Anyone can find and join your server") },
                  ] as const).map((opt) => {
                    const Icon = opt.icon;
                    const selected = onboardJoinMode === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setOnboardJoinMode(opt.key)}
                        className={`w-full p-3 rounded-lg border transition-colors flex items-center gap-3 text-left ${selected ? "bg-[#8B5CF6]/10 border-[#8B5CF6]/50" : "bg-[#111111] border-[#222222] hover:border-[#333333]"}`}
                      >
                        <div className={`p-2 rounded-full ${selected ? "text-[#8B5CF6]" : "text-[#888888]"}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <span className={`font-medium text-sm block ${selected ? "text-white" : "text-[#aaa]"}`}>{opt.title}</span>
                          <span className="text-xs text-[#888888]">{opt.desc}</span>
                        </div>
                        {selected && <Check className="w-4 h-4 text-[#8B5CF6]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-4 bg-[#111111] border-t border-[#1a1a1a] flex justify-between">
              <Button
                variant="ghost"
                onClick={() => {
                  if (onboardStep === 0) {
                    setMode("create");
                  } else {
                    setOnboardStep(0);
                  }
                }}
                className="text-white hover:bg-transparent hover:underline"
              >
                {onboardStep === 0 ? gt("Back") : gt("Back")}
              </Button>
              {onboardStep === 0 ? (
                <Button
                  onClick={() => setOnboardStep(1)}
                  className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                >
                  {gt("Next")}
                </Button>
              ) : (
                <Button
                  onClick={handleOnboardFinish}
                  disabled={isLoading}
                  className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                >
                  {isLoading ? gt("Finishing...") : gt("Finish Setup")}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
