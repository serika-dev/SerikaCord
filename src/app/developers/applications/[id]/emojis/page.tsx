"use client";

import { useState, useEffect } from "react";
import { cdnImage } from "@/lib/utils";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Plus, Trash2, Upload, Smile } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface Emoji {
  id: string;
  name: string;
  image?: string;
  animated?: boolean;
}

export default function EmojisPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading } = useApplication(appId);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchEmojis();
  }, [appId]);

  const fetchEmojis = async () => {
    try {
      const res = await fetch(`/api/developers/applications/${appId}/emojis`);
      if (res.ok) {
        const data = await res.json();
        setEmojis(data.emojis || []);
      }
    } catch {
      // ignore
    }
  };

  const handleUpload = async (file: File) => {
    if (!newName.trim()) {
      toast.error(gt("Enter an emoji name first"));
      return;
    }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const animated = file.type === "image/gif";
        const res = await fetch(`/api/developers/applications/${appId}/emojis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), image: base64, animated }),
        });
        if (res.ok) {
          const data = await res.json();
          setEmojis([...emojis, data.emoji]);
          setNewName("");
          setShowAdd(false);
          toast.success(gt("Emoji uploaded!"));
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || gt("Failed to upload emoji"));
        }
        setUploading(false);
      };
      reader.onerror = () => {
        toast.error(gt("Failed to read file"));
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error(gt("Failed to upload emoji"));
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(gt("Delete this emoji?"))) return;
    try {
      const res = await fetch(`/api/developers/applications/${appId}/emojis/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setEmojis(emojis.filter((e) => e.id !== id));
        toast.success(gt("Emoji deleted"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to delete emoji"));
      }
    } catch {
      toast.error(gt("Failed to delete emoji"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="size-6" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">{gt("Emoji")}</h1>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-md transition-colors"
        >
          <Plus className="size-4" /> {gt("Add Emoji")}
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="emoji_name"
              maxLength={32}
              className="flex-1 bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50"
            />
            <label className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-sm rounded-md cursor-pointer transition-colors">
              {uploading ? <Loader size={24} className="size-4" /> : <Upload className="size-4" />}
              {gt("Upload")}
              <input
                type="file"
                accept="image/png,image/gif,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
            </label>
          </div>
          <p className="text-xs text-[#666] mt-2">
            {gt("PNG, GIF, or JPEG. Max 256KB. Names must be unique.")}
          </p>
        </div>
      )}

      {emojis.length === 0 ? (
        <div className="text-center py-20">
          <Smile className="size-12 text-[#333] mx-auto mb-4" />
          <p className="text-[#888] text-sm">{gt("No emojis yet. Add one to get started.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
          {emojis.map((emoji) => (
            <div
              key={emoji.id}
              className="group relative rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 flex flex-col items-center gap-2"
            >
              {emoji.image ? (
                <img src={cdnImage(emoji.image)} alt={emoji.name} className="size-12 object-contain" />
              ) : (
                <div className="size-12 bg-[#1a1a1a] rounded flex items-center justify-center">
                  <Smile className="size-6 text-[#444]" />
                </div>
              )}
              <span className="text-xs text-[#ccc] truncate w-full text-center">:{emoji.name}:</span>
              <button
                onClick={() => handleDelete(emoji.id)}
                className="absolute top-1 right-1 p-1 rounded bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
