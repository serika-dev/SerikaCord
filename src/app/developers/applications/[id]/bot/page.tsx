"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Copy, Check, RefreshCw, Eye, EyeOff, AlertTriangle, Bot as BotIcon, Upload, KeyRound, Settings, Zap } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

const INTENTS = [
  { name: "Presence Intent", desc: "Receive presence updates for users.", bit: 1 << 8 },
  { name: "Server Members Intent", desc: "Receive server member events.", bit: 1 << 1 },
  { name: "Message Content Intent", desc: "Access the content of messages.", bit: 1 << 15 },
];

type GTFunc = ReturnType<typeof useGT>;

function intentLabel(bit: number, gt: GTFunc): { name: string; desc: string } {
  switch (bit) {
    case 1 << 8: return { name: gt('Presence Intent'), desc: gt('Receive presence updates for users.') };
    case 1 << 1: return { name: gt('Server Members Intent'), desc: gt('Receive server member events.') };
    case 1 << 15: return { name: gt('Message Content Intent'), desc: gt('Access the content of messages.') };
    default: return { name: '', desc: '' };
  }
}

export default function BotPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading, saving, saveApp, refetch } = useApplication(appId);
  const [botPublic, setBotPublic] = useState(false);
  const [botRequireCodeGrant, setBotRequireCodeGrant] = useState(false);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [intents, setIntents] = useState(0);
  const [interactionsUrl, setInteractionsUrl] = useState("");
  const [savingInteractions, setSavingInteractions] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Bot profile (username / display name / avatar / banner).
  const [botUsername, setBotUsername] = useState("");
  const [botDisplayName, setBotDisplayName] = useState("");
  const [botAvatar, setBotAvatar] = useState<string | null>(null);
  const [botBanner, setBotBanner] = useState<string | null>(null);
  const [savedUsername, setSavedUsername] = useState("");
  const [savedDisplayName, setSavedDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const hasBotUser = !!app?.botId;

  useEffect(() => {
    if (!hasBotUser) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/developers/applications/${appId}/bot`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const bot = data.bot;
        if (!bot || cancelled) return;
        setBotUsername(bot.username || "");
        setSavedUsername(bot.username || "");
        setBotDisplayName(bot.displayName || "");
        setSavedDisplayName(bot.displayName || "");
        setBotAvatar(bot.avatar || null);
        setBotBanner(bot.banner || null);
      } catch {
        /* profile is optional; ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [appId, hasBotUser]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/bot`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: botUsername.trim(), displayName: botDisplayName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBotUsername(data.bot?.username ?? botUsername);
        setSavedUsername(data.bot?.username ?? botUsername);
        setBotDisplayName(data.bot?.displayName ?? botDisplayName);
        setSavedDisplayName(data.bot?.displayName ?? botDisplayName);
        toast.success(gt("Bot profile updated"));
      } else {
        toast.error(data.error || gt("Failed to update bot profile"));
      }
    } catch {
      toast.error(gt("Failed to update bot profile"));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleImageUpload = async (kind: "avatar" | "banner", file: File) => {
    const setUploading = kind === "avatar" ? setUploadingAvatar : setUploadingBanner;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/developers/applications/${appId}/bot/${kind}`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        if (kind === "avatar") setBotAvatar(data.url);
        else setBotBanner(data.url);
        toast.success(kind === "avatar" ? gt("Bot avatar updated") : gt("Bot banner updated"));
      } else {
        toast.error(data.error || gt("Failed to upload image"));
      }
    } catch {
      toast.error(gt("Failed to upload image"));
    } finally {
      setUploading(false);
    }
  };

  const profileDirty = botUsername.trim() !== savedUsername || botDisplayName.trim() !== savedDisplayName;

  useEffect(() => {
    if (app) {
      setBotPublic(app.botPublic ?? false);
      setBotRequireCodeGrant(app.botRequireCodeGrant ?? false);
      setToken(app.botToken || "");
      setIntents(app.gatewayIntents || 0);
      setInteractionsUrl(app.interactionsEndpointUrl || "");
    }
  }, [app]);

  const handleSaveInteractions = async () => {
    setSavingInteractions(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/bot/interactions-endpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: interactionsUrl.trim() || null }),
      });
      if (res.ok) {
        toast.success(interactionsUrl.trim() ? gt("Interactions endpoint verified & saved") : gt("Interactions endpoint cleared"));
        refetch();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to verify endpoint"));
      }
    } catch {
      toast.error(gt("Failed to verify endpoint"));
    } finally {
      setSavingInteractions(false);
    }
  };

  const handleTogglePublic = async (value: boolean) => {
    setBotPublic(value);
    const ok = await saveApp({ botPublic: value });
    if (ok) toast.success(gt("Public bot {state}", { state: value ? gt("enabled") : gt("disabled") }));
  };

  const handleToggleCodeGrant = async (value: boolean) => {
    setBotRequireCodeGrant(value);
    const ok = await saveApp({ botRequireCodeGrant: value });
    if (ok) toast.success(gt("OAuth2 code grant {state}", { state: value ? gt("enabled") : gt("disabled") }));
  };

  const handleToggleIntent = async (bit: number, enabled: boolean) => {
    const newIntents = enabled ? intents & ~bit : intents | bit;
    setIntents(newIntents);
    const ok = await saveApp({ gatewayIntents: newIntents });
    if (ok) toast.success(gt("Intent setting updated"));
  };

  const handleEnableBot = async () => {
    setEnabling(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/bot`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.application?.botToken || "");
        toast.success(gt("Bot enabled! Copy your token now."));
        refetch();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to enable bot"));
      }
    } catch {
      toast.error(gt("Failed to enable bot"));
    } finally {
      setEnabling(false);
    }
  };

  const handleResetToken = async () => {
    if (!confirm(gt("Are you sure? Resetting the token will invalidate the old one. Any bots using it will stop working."))) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/bot/reset-token`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        toast.success(gt("Token reset! Copy the new token now."));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || gt("Failed to reset token"));
      }
    } catch {
      toast.error(gt("Failed to reset token"));
    } finally {
      setResetting(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="size-6" />
      </div>
    );
  }

  const hasBot = !!token || !!app?.botToken;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold">{gt("Bot")}</h1>
        <p className="text-xs text-[#888] mt-1">{gt("Manage your bot user, token, gateway intents, and interactions endpoint.")}</p>
      </div>

      {/* Enable Bot */}
      {!hasBot && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#6366f1]/20 border border-white/[0.08] flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(139,92,246,0.1)]">
            <BotIcon className="size-8 text-[#8B5CF6]" />
          </div>
          <h3 className="text-sm font-semibold mb-1.5">{gt("No bot user yet")}</h3>
          <p className="text-sm text-[#777] mb-5 max-w-sm mx-auto leading-relaxed">
            {gt("Enable a bot user for this application to get a bot token and connect to the SerikaCord gateway.")}
          </p>
          <button
            onClick={handleEnableBot}
            disabled={enabling}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#6D28D9] disabled:opacity-40 text-white text-sm font-semibold rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.2)] transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            {enabling ? <Loader size={24} className="size-4" /> : <BotIcon className="size-4" />}
            {gt("Enable Bot")}
          </button>
        </div>
      )}

      {/* Bot Token Card */}
      {hasBot && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="p-5 border-b border-white/[0.04]">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <KeyRound className="size-4 text-[#8B5CF6]" />
              {gt("Token")}
            </h2>
            <p className="text-[11px] text-[#666] mt-1">{gt("Keep your token secret. Do not commit it to public repositories.")}</p>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5">
              <code className="text-sm text-[#ccc] flex-1 truncate font-mono">
                {token ? (showToken ? token : "••••••••••••••••••••••••••") : gt("No token set")}
              </code>
              {token && (
                <>
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                  <button
                    onClick={copyToken}
                    className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
                  >
                    {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={handleResetToken}
              disabled={resetting}
              className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition-colors"
            >
              {resetting ? <Loader size={24} className="size-4" /> : <RefreshCw className="size-4" />}
              {gt("Reset Token")}
            </button>
          </div>
        </div>
      )}

      {/* Bot Profile Card */}
      {hasBot && hasBotUser && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="p-5 border-b border-white/[0.04]">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <BotIcon className="size-4 text-[#8B5CF6]" />
              {gt("Bot Profile")}
            </h2>
            <p className="text-[11px] text-[#666] mt-1">
              {gt("Customize how your bot appears across SerikaCord — its username, display name, avatar, and banner.")}
            </p>
          </div>

          <div className="overflow-hidden">
            {/* Banner + avatar */}
            <div className="relative">
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                className="group relative block w-full h-28 bg-gradient-to-br from-[#8B5CF6]/30 to-[#6366f1]/30 overflow-hidden"
                aria-label={gt("Upload banner")}
              >
                {botBanner && <img src={botBanner} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors opacity-0 group-hover:opacity-100 text-white text-xs font-medium gap-1.5">
                  {uploadingBanner ? <Loader size={24} className="size-4" /> : <Upload className="size-4" />}
                  {gt("Change banner")}
                </span>
              </button>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload("banner", f); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="group absolute -bottom-8 left-5 size-16 rounded-full border-4 border-[#0d0d0d] bg-[#1a1a1a] overflow-hidden"
                aria-label={gt("Upload avatar")}
              >
                {botAvatar
                  ? <img src={botAvatar} alt="" className="w-full h-full object-cover" />
                  : <span className="flex items-center justify-center w-full h-full"><BotIcon className="size-6 text-[#8B5CF6]" /></span>}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 transition-colors opacity-0 group-hover:opacity-100 text-white">
                  {uploadingAvatar ? <Loader size={24} className="size-4" /> : <Upload className="size-4" />}
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload("avatar", f); e.target.value = ""; }}
              />
            </div>

            {/* Fields */}
            <div className="pt-11 px-5 pb-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-1.5">{gt("Username")}</label>
                <div className="flex items-center bg-[#111] border border-white/[0.08] rounded-lg px-3 focus-within:border-[#8B5CF6]/50 transition-colors">
                  <span className="text-sm text-[#666]">@</span>
                  <input
                    type="text"
                    value={botUsername}
                    onChange={(e) => setBotUsername(e.target.value)}
                    placeholder="my_bot"
                    maxLength={32}
                    className="flex-1 bg-transparent px-1.5 py-2.5 text-sm text-[#ccc] font-mono outline-none"
                  />
                </div>
                <p className="text-[11px] text-[#666] mt-1">{gt("2-32 characters. Letters, numbers, underscores and periods.")}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-1.5">{gt("Display Name")}</label>
                <input
                  type="text"
                  value={botDisplayName}
                  onChange={(e) => setBotDisplayName(e.target.value)}
                  placeholder={gt("My Bot")}
                  maxLength={32}
                  className="w-full bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-[#ccc] outline-none focus:border-[#8B5CF6]/50 transition-colors"
                />
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile || !profileDirty}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {savingProfile ? <Loader size={24} className="size-4" /> : null}
                {gt("Save Profile")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bot Settings Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Settings className="size-4 text-[#8B5CF6]" />
            {gt("Settings")}
          </h2>
        </div>
        <div className="divide-y divide-white/[0.04]">
          <div className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{gt("Public Bot")}</h3>
                <p className="text-xs text-[#888] mt-1">
                  {gt("Allow others to invite your bot to their servers via OAuth2.")}
                </p>
              </div>
              <button
                onClick={() => handleTogglePublic(!botPublic)}
                disabled={saving}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  botPublic ? "bg-[#8B5CF6]" : "bg-[#333]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 bg-white rounded-full transition-transform ${
                    botPublic ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{gt("Require OAuth2 Code Grant")}</h3>
                <p className="text-xs text-[#888] mt-1">
                  {gt("Requires users to complete the OAuth2 code grant flow when adding your bot.")}
                </p>
              </div>
              <button
                onClick={() => handleToggleCodeGrant(!botRequireCodeGrant)}
                disabled={saving}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  botRequireCodeGrant ? "bg-[#8B5CF6]" : "bg-[#333]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 bg-white rounded-full transition-transform ${
                    botRequireCodeGrant ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Privileged Gateway Intents Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="size-4 text-[#8B5CF6]" />
            {gt("Privileged Gateway Intents")}
          </h2>
          <p className="text-[11px] text-[#666] mt-1">
            {gt("Some intents require verification if your bot is in 100+ servers.")}
          </p>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {INTENTS.map((intent) => {
            const enabled = (intents & intent.bit) === intent.bit;
            return (
              <div key={intent.name} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold">{intentLabel(intent.bit, gt).name}</h4>
                    <p className="text-xs text-[#888] mt-1">{intentLabel(intent.bit, gt).desc}</p>
                    {app?.verified === false && (app?.serverCount || 0) >= 100 && (
                      <p className="text-xs text-yellow-500 mt-2 flex items-center gap-1">
                        <AlertTriangle className="size-3" /> {gt("Requires verification for bots in 100+ servers.")}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleIntent(intent.bit, enabled)}
                    disabled={saving}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                      enabled ? "bg-[#8B5CF6]" : "bg-[#333]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-5 bg-white rounded-full transition-transform ${
                        enabled ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Public Key Card */}
      {hasBot && app?.publicKey && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="p-5 border-b border-white/[0.04]">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <KeyRound className="size-4 text-[#8B5CF6]" />
              {gt("Public Key")}
            </h2>
            <p className="text-[11px] text-[#666] mt-1">
              {gt("Used to verify the signatures on interaction requests we send to your endpoint.")}
            </p>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5">
              <code className="text-sm text-[#ccc] flex-1 truncate font-mono">{app.publicKey}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(app.publicKey!);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
                className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
              >
                {copiedKey ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactions Endpoint Card */}
      {hasBot && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="p-5 border-b border-white/[0.04]">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Zap className="size-4 text-[#8B5CF6]" />
              {gt("Interactions Endpoint URL")}
            </h2>
            <p className="text-[11px] text-[#666] mt-1">
              {gt("Optional. If set, we POST interaction (slash command) events here with an Ed25519 signature instead of only delivering them over the gateway. We verify the URL with a PING before saving.")}
            </p>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={interactionsUrl}
                onChange={(e) => setInteractionsUrl(e.target.value)}
                placeholder="https://example.com/interactions"
                className="flex-1 bg-[#111] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-[#ccc] font-mono outline-none focus:border-[#8B5CF6]/50 transition-colors"
              />
              <button
                onClick={handleSaveInteractions}
                disabled={savingInteractions}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
              >
                {savingInteractions ? <Loader size={24} className="size-4" /> : null}
                {gt("Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
