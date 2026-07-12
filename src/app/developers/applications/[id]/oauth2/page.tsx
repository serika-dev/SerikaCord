"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Copy, Check, Plus, Trash2, Save, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

export default function OAuth2Page() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading, saving, saveApp, refetch } = useApplication(appId);
  const [redirectUris, setRedirectUris] = useState<string[]>([]);
  const [newUri, setNewUri] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (app) {
      setRedirectUris(app.redirectUris || []);
      setSecret(app.clientSecret || "");
    }
  }, [app]);

  const addUri = () => {
    const uri = newUri.trim();
    if (uri && !redirectUris.includes(uri)) {
      setRedirectUris([...redirectUris, uri]);
      setNewUri("");
    }
  };

  const removeUri = (uri: string) => {
    setRedirectUris(redirectUris.filter((u) => u !== uri));
  };

  const handleSave = async () => {
    const ok = await saveApp({ redirectUris });
    if (ok) toast.success(gt("OAuth2 settings saved"));
  };

  const copySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResetSecret = async () => {
    if (!confirm(gt("Are you sure? Resetting the client secret will invalidate the old one. Any apps using it will stop working."))) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/oauth2/reset-secret`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setSecret(data.secret || "");
        toast.success(gt("Secret reset! Copy the new secret now."));
        refetch();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to reset secret"));
      }
    } catch {
      toast.error(gt("Failed to reset secret"));
    } finally {
      setResetting(false);
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
      <h1 className="text-xl font-bold mb-6">{gt("OAuth2")}</h1>

      {/* Client ID */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Client ID")}
        </label>
        <div className="flex items-center gap-2 bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-4 py-2.5">
          <code className="text-sm text-[#ccc] flex-1 truncate font-mono">{app?.clientId || appId}</code>
        </div>
      </div>

      {/* Client Secret */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Client Secret")}
        </label>
        <div className="flex items-center gap-2 bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-4 py-2.5">
          <code className="text-sm text-[#ccc] flex-1 truncate font-mono">
            {secret ? (showSecret ? secret : "••••••••••••••••") : gt("No secret set")}
          </code>
          {secret && (
            <>
              <button
                onClick={() => setShowSecret(!showSecret)}
                className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button
                onClick={copySecret}
                className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
              >
                {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-[#666] mt-1.5">{gt("Keep your client secret safe.")}</p>
        <button
          onClick={handleResetSecret}
          disabled={resetting}
          className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition-colors"
        >
          {resetting ? <Loader size={24} className="size-4" /> : <RefreshCw className="size-4" />}
          {gt("Reset Secret")}
        </button>
      </div>

      {/* Redirect URIs */}
      <div className="mb-8">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Redirect URIs")}
        </label>
        <p className="text-xs text-[#666] mb-3">
          {gt("URIs that SerikaCord will redirect to after authorization.")}
        </p>
        <div className="space-y-2 mb-3">
          {redirectUris.map((uri) => (
            <div
              key={uri}
              className="flex items-center gap-2 bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-4 py-2"
            >
              <code className="text-sm text-[#ccc] flex-1 truncate font-mono">{uri}</code>
              <button
                onClick={() => removeUri(uri)}
                className="p-1 rounded hover:bg-red-500/10 text-[#888] hover:text-red-400 transition-colors"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newUri}
            onChange={(e) => setNewUri(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUri()}
            placeholder="https://your-site.com/callback"
            className="flex-1 bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50"
          />
          <button
            onClick={addUri}
            className="flex items-center gap-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-sm rounded-lg transition-colors"
          >
            <Plus className="size-4" /> {gt("Add")}
          </button>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
          {gt("Save Changes")}
        </button>
      </div>
    </div>
  );
}
