"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Copy, Check,  Save } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

export default function InformationPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading, saving, saveApp } = useApplication(appId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (app) {
      setName(app.name || "");
      setDescription(app.description || "");
      setTags(app.tags || []);
    }
  }, [app]);

  const handleSave = async () => {
    const ok = await saveApp({ name, description, tags });
    if (ok) toast.success(gt("Changes saved"));
  };

  const copyId = () => {
    navigator.clipboard.writeText(appId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addTag = () => {
    const t = newTag.trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 5) {
      setTags([...tags, t]);
      setNewTag("");
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
      <h1 className="text-xl font-bold mb-6">{gt("General Information")}</h1>

      {/* Application ID */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Application ID")}
        </label>
        <div className="flex items-center gap-2 bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5">
          <code className="text-sm text-[#ccc] flex-1 truncate">{appId}</code>
          <button
            onClick={copyId}
            className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
          >
            {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
          </button>
        </div>
        <p className="text-xs text-[#666] mt-1.5">
          {gt("Use this ID for API requests and OAuth2 flows.")}
        </p>
      </div>

      {/* Name */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Name")} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50"
        />
        <p className="text-xs text-[#666] mt-1.5">{name.length}/32</p>
      </div>

      {/* Description */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Description")}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={400}
          rows={4}
          className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50 resize-none"
          placeholder={gt("Describe what your application does...")}
        />
        <p className="text-xs text-[#666] mt-1.5">{description.length}/400</p>
      </div>

      {/* Tags */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Tags")}
        </label>
        <p className="text-xs text-[#666] mb-2">
          {gt("Help users discover your app. Max 5 tags.")}
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1.5 bg-[#8B5CF6]/20 text-[#a78bfa] text-xs px-2.5 py-1 rounded-md"
            >
              {tag}
              <button
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                className="hover:text-white"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {tags.length < 5 && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              placeholder={gt("Add a tag...")}
              maxLength={20}
              className="flex-1 bg-[#1a1a1a] border border-white/[0.08] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50"
            />
            <button
              onClick={addTag}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-sm rounded-md transition-colors"
            >
              {gt("Add")}
            </button>
          </div>
        )}
      </div>

      {/* Verification Status */}
      <div className="mb-6 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
        <h3 className="text-sm font-semibold mb-2">{gt("Verification Status")}</h3>
        {app?.verified ? (
          <p className="text-sm text-green-400">
            {gt("✓ This application is verified and can be in 100+ servers.")}
          </p>
        ) : (
          <>
            <p className="text-sm text-[#888] mb-2">
              {gt("Your bot must be in 100 or more servers to be eligible for verification.")}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#8B5CF6] rounded-full transition-all"
                  style={{ width: `${Math.min((app?.serverCount || 0) / 100, 1) * 100}%` }}
                />
              </div>
              <span className="text-xs text-[#888]">
                {gt("{count}/100 servers", { count: app?.serverCount || 0 })}
              </span>
            </div>
            {(app?.serverCount || 0) >= 100 ? (
              <button className="mt-3 px-4 py-2 bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium rounded-md transition-colors">
                {gt("Apply for Verification")}
              </button>
            ) : (
              <p className="text-xs text-[#555] mt-3">
                {gt("Reach 100 servers to unlock the verification application.")}
              </p>
            )}
          </>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-md transition-colors"
        >
          {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
          {gt("Save Changes")}
        </button>
      </div>
    </div>
  );
}
