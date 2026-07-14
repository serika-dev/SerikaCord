"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Copy, Check, Save, Upload, Trash2, Hash, FileText, Tag, Shield } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

export default function InformationPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading, saving, saveApp, refetch } = useApplication(appId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [copied, setCopied] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

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

  const handleIconUpload = async (file: File) => {
    setUploadingIcon(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/developers/applications/${appId}/icon`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        toast.success(gt("Application icon updated"));
        refetch();
      } else {
        toast.error(data.error || gt("Failed to upload icon"));
      }
    } catch {
      toast.error(gt("Failed to upload icon"));
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleRemoveIcon = async () => {
    const ok = await saveApp({ icon: null });
    if (ok) toast.success(gt("Icon removed"));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="size-6" />
      </div>
    );
  }

  const displayIcon = app?.icon || app?.botAvatar || null;
  const dirty = name !== (app?.name || "") || description !== (app?.description || "") || JSON.stringify(tags) !== JSON.stringify(app?.tags || []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{gt("General Information")}</h1>
          <p className="text-xs text-[#888] mt-1">{gt("Configure your application's identity, appearance, and metadata.")}</p>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
            {gt("Save Changes")}
          </button>
        )}
      </div>

      {/* Identity Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Hash className="size-4 text-[#8B5CF6]" />
            {gt("Identity")}
          </h2>
        </div>
        <div className="p-5">
          <div className="flex items-start gap-5">
            {/* Icon uploader */}
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => iconInputRef.current?.click()}
                className="group relative size-20 rounded-2xl border-2 border-dashed border-white/[0.1] hover:border-[#8B5CF6]/50 bg-[#111] overflow-hidden transition-colors"
                aria-label={gt("Upload icon")}
              >
                {displayIcon ? (
                  <img src={displayIcon} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <Upload className="size-6 text-[#555] group-hover:text-[#8B5CF6] transition-colors" />
                  </div>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 transition-colors opacity-0 group-hover:opacity-100 text-white text-xs font-medium gap-1.5">
                  {uploadingIcon ? <Loader size={24} className="size-4" /> : <Upload className="size-4" />}
                  {gt("Change")}
                </span>
              </button>
              <input
                ref={iconInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleIconUpload(f); e.target.value = ""; }}
              />
              {displayIcon && (
                <button
                  onClick={handleRemoveIcon}
                  className="mt-2 w-full text-[10px] text-[#666] hover:text-red-400 flex items-center justify-center gap-1 transition-colors"
                >
                  <Trash2 className="size-3" /> {gt("Remove")}
                </button>
              )}
            </div>

            {/* Name + ID */}
            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
                  {gt("Name")} <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                  className="w-full bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50 transition-colors"
                />
                <p className="text-[11px] text-[#555] mt-1.5">{name.length}/32</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
                  {gt("Application ID")}
                </label>
                <div className="flex items-center gap-2 bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5">
                  <code className="text-sm text-[#ccc] flex-1 truncate font-mono">{appId}</code>
                  <button
                    onClick={copyId}
                    className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
                  >
                    {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-[#555] mt-1.5">{gt("Use this ID for API requests and OAuth2 flows.")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Description Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="size-4 text-[#8B5CF6]" />
            {gt("Description")}
          </h2>
        </div>
        <div className="p-5">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={400}
            rows={4}
            className="w-full bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50 resize-none transition-colors"
            placeholder={gt("Describe what your application does...")}
          />
          <p className="text-[11px] text-[#555] mt-1.5">{description.length}/400</p>
        </div>
      </div>

      {/* Tags Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Tag className="size-4 text-[#8B5CF6]" />
            {gt("Tags")}
          </h2>
          <p className="text-[11px] text-[#666] mt-1">{gt("Help users discover your app. Max 5 tags.")}</p>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1.5 bg-[#8B5CF6]/15 text-[#a78bfa] text-xs px-3 py-1.5 rounded-lg font-medium"
              >
                {tag}
                <button
                  onClick={() => setTags(tags.filter((t) => t !== tag))}
                  className="hover:text-white transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
            {tags.length === 0 && (
              <p className="text-xs text-[#555]">{gt("No tags added yet.")}</p>
            )}
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
                className="flex-1 bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50 transition-colors"
              />
              <button
                onClick={addTag}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-sm rounded-lg transition-colors"
              >
                {gt("Add")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Verification Status Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Shield className="size-4 text-[#8B5CF6]" />
            {gt("Verification Status")}
          </h2>
        </div>
        <div className="p-5">
          {app?.verified ? (
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                <Check className="size-4 text-green-400" />
              </div>
              <p className="text-sm text-green-400">
                {gt("This application is verified and can be in 100+ servers.")}
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#888] mb-3">
                {gt("Your bot must be in 100 or more servers to be eligible for verification.")}
              </p>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-2 bg-[#111] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#6366f1] rounded-full transition-all"
                    style={{ width: `${Math.min((app?.serverCount || 0) / 100, 1) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-[#888] tabular-nums">
                  {app?.serverCount || 0}/100
                </span>
              </div>
              {(app?.serverCount || 0) >= 100 ? (
                <button className="px-4 py-2 bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium rounded-lg transition-colors">
                  {gt("Apply for Verification")}
                </button>
              ) : (
                <p className="text-[11px] text-[#555]">
                  {gt("Reach 100 servers to unlock the verification application.")}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
          {gt("Save Changes")}
        </button>
      </div>
    </div>
  );
}
