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
import { Upload, Users, ArrowRight, Hash, ImagePlus } from "lucide-react";

interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateServerDialog({ open, onOpenChange }: CreateServerDialogProps) {
  const router = useRouter();
  const { createServer, joinServer } = useServer();
  const [mode, setMode] = useState<"select" | "create" | "join">("select");
  const [serverName, setServerName] = useState("My Server");
  const [inviteCode, setInviteCode] = useState("");
  const [serverIcon, setServerIcon] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

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
      onOpenChange(false);
      resetForm();
      router.push(`/channels/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join server");
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
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="bg-[#313338] border-none text-white max-w-md p-0 gap-0">
        {mode === "select" && (
          <>
            <DialogHeader className="p-4 text-center">
              <DialogTitle className="text-2xl font-bold">Create a server</DialogTitle>
              <DialogDescription className="text-[#b5bac1]">
                Your server is where you and your friends hang out. Make yours and start talking.
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 space-y-2">
              <button
                onClick={() => setMode("create")}
                className="w-full p-3 rounded-lg bg-[#2b2d31] hover:bg-[#35373c] transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#5865F2] flex items-center justify-center">
                    <Hash className="w-6 h-6 text-white" />
                  </div>
                  <span className="font-medium">Create My Own</span>
                </div>
                <ArrowRight className="w-5 h-5 text-[#949ba4] group-hover:text-white transition-colors" />
              </button>

              <div className="py-3">
                <div className="text-center text-xs font-semibold uppercase text-[#949ba4] mb-3">
                  Have an invite already?
                </div>
                <button
                  onClick={() => setMode("join")}
                  className="w-full p-3 rounded-lg bg-[#2b2d31] hover:bg-[#35373c] transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-[#23a55a] flex items-center justify-center">
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <span className="font-medium">Join a Server</span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-[#949ba4] group-hover:text-white transition-colors" />
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "create" && (
          <>
            <DialogHeader className="p-4 text-center">
              <DialogTitle className="text-2xl font-bold">Customize your server</DialogTitle>
              <DialogDescription className="text-[#b5bac1]">
                Give your new server a personality with a name and an icon. You can always change it later.
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
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-dashed border-[#5865F2] hover:border-[#7983f5] transition-colors">
                      <img src={iconPreview} alt="Server icon" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-full border-2 border-dashed border-[#949ba4] hover:border-white transition-colors flex flex-col items-center justify-center gap-1">
                      <ImagePlus className="w-6 h-6 text-[#949ba4]" />
                      <span className="text-xs text-[#949ba4] font-semibold">UPLOAD</span>
                    </div>
                  )}
                </label>
              </div>

              {/* Server Name */}
              <div className="space-y-2">
                <Label htmlFor="serverName" className="text-xs font-bold uppercase text-[#b5bac1]">
                  Server Name
                </Label>
                <Input
                  id="serverName"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="bg-[#1e1f22] border-none text-white focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
                />
              </div>

              <p className="text-xs text-[#949ba4]">
                By creating a server, you agree to SerikaCord&apos;s{" "}
                <span className="text-[#00a8fc] hover:underline cursor-pointer">Community Guidelines</span>.
              </p>
            </div>
            <div className="p-4 bg-[#2b2d31] flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setMode("select")}
                className="text-white hover:bg-transparent hover:underline"
              >
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!serverName.trim() || isLoading}
                className="bg-[#5865F2] hover:bg-[#4752c4] text-white"
              >
                {isLoading ? "Creating..." : "Create"}
              </Button>
            </div>
          </>
        )}

        {mode === "join" && (
          <>
            <DialogHeader className="p-4 text-center">
              <DialogTitle className="text-2xl font-bold">Join a Server</DialogTitle>
              <DialogDescription className="text-[#b5bac1]">
                Enter an invite below to join an existing server
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 space-y-4">
              {error && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="inviteCode" className="text-xs font-bold uppercase text-[#b5bac1]">
                  Invite Link <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="https://serikacord.app/invite/coolserver"
                  className="bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold uppercase text-[#b5bac1]">
                  Invites should look like
                </div>
                <div className="text-sm text-[#949ba4] space-y-1">
                  <div>hTKzmak</div>
                  <div>https://serikacord.app/invite/hTKzmak</div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-[#2b2d31] flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setMode("select")}
                className="text-white hover:bg-transparent hover:underline"
              >
                Back
              </Button>
              <Button
                onClick={handleJoin}
                disabled={!inviteCode.trim() || isLoading}
                className="bg-[#5865F2] hover:bg-[#4752c4] text-white"
              >
                {isLoading ? "Joining..." : "Join Server"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
