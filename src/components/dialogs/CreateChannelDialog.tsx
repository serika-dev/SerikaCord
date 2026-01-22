"use client";

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hash, Volume2 } from "lucide-react";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChannelDialog({ open, onOpenChange }: CreateChannelDialogProps) {
  const { currentServer, fetchChannels } = useServer();
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState<"text" | "voice">("text");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!channelName.trim() || !currentServer) return;

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/servers/${currentServer.id}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: channelName.toLowerCase().replace(/\s+/g, "-"),
          type: channelType,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create channel");
      }

      await fetchChannels(currentServer.id);
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setChannelName("");
    setChannelType("text");
    setError("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="bg-[#313338] border-none text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create Channel</DialogTitle>
          <DialogDescription className="text-[#b5bac1]">
            in {currentServer?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Channel Type */}
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase text-[#b5bac1]">
              Channel Type
            </Label>
            <div className="space-y-2">
              <button
                onClick={() => setChannelType("text")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors ${
                  channelType === "text"
                    ? "bg-[#43444b]"
                    : "bg-[#2b2d31] hover:bg-[#35373c]"
                }`}
              >
                <Hash className="w-6 h-6 text-[#949ba4]" />
                <div className="text-left">
                  <div className="font-medium">Text</div>
                  <div className="text-xs text-[#949ba4]">
                    Send messages, images, GIFs, emoji, and more
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "text"
                      ? "border-[#5865F2] bg-[#5865F2]"
                      : "border-[#949ba4]"
                  }`}
                >
                  {channelType === "text" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </button>

              <button
                onClick={() => setChannelType("voice")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors ${
                  channelType === "voice"
                    ? "bg-[#43444b]"
                    : "bg-[#2b2d31] hover:bg-[#35373c]"
                }`}
              >
                <Volume2 className="w-6 h-6 text-[#949ba4]" />
                <div className="text-left">
                  <div className="font-medium">Voice</div>
                  <div className="text-xs text-[#949ba4]">
                    Hang out together with voice and video
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "voice"
                      ? "border-[#5865F2] bg-[#5865F2]"
                      : "border-[#949ba4]"
                  }`}
                >
                  {channelType === "voice" && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </button>
            </div>
          </div>

          {/* Channel Name */}
          <div className="space-y-2">
            <Label htmlFor="channelName" className="text-xs font-bold uppercase text-[#b5bac1]">
              Channel Name
            </Label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#949ba4]">
                {channelType === "text" ? (
                  <Hash className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </div>
              <Input
                id="channelName"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="new-channel"
                className="pl-10 bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-white hover:bg-transparent hover:underline"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!channelName.trim() || isLoading}
            className="bg-[#5865F2] hover:bg-[#4752c4] text-white"
          >
            {isLoading ? "Creating..." : "Create Channel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
