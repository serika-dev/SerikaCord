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
import { toast } from "sonner";

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
      toast.success("Channel created!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
      toast.error(err instanceof Error ? err.message : "Failed to create channel");
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
      <DialogContent className="bg-[#0a0a0a] border border-[#1a1a1a] text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create Channel</DialogTitle>
          <DialogDescription className="text-[#888888]">
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
            <Label className="text-xs font-bold uppercase text-[#888888]">
              Channel Type
            </Label>
            <div className="space-y-2">
              <button
                onClick={() => setChannelType("text")}
                className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors border ${
                  channelType === "text"
                    ? "bg-[#8B5CF6]/10 border-[#8B5CF6]"
                    : "bg-[#111111] border-[#222222] hover:border-[#333333]"
                }`}
              >
                <Hash className="w-6 h-6 text-[#666666]" />
                <div className="text-left">
                  <div className="font-medium">Text</div>
                  <div className="text-xs text-[#666666]">
                    Send messages, images, GIFs, emoji, and more
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "text"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]"
                      : "border-[#666666]"
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
                    : "bg-[#111111] border-[#222222] hover:border-[#333333]"
                }`}
              >
                <Volume2 className="w-6 h-6 text-[#666666]" />
                <div className="text-left">
                  <div className="font-medium">Voice</div>
                  <div className="text-xs text-[#666666]">
                    Hang out together with voice and video
                  </div>
                </div>
                <div
                  className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    channelType === "voice"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]"
                      : "border-[#666666]"
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
            <Label htmlFor="channelName" className="text-xs font-bold uppercase text-[#888888]">
              Channel Name
            </Label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666]">
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
                className="pl-10 bg-[#111111] border-[#222222] text-white placeholder:text-[#555555] focus-visible:ring-[#8B5CF6] focus-visible:ring-offset-0"
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
            className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
          >
            {isLoading ? "Creating..." : "Create Channel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
