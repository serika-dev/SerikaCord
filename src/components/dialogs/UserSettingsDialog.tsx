"use client";

import { useState, useEffect, useRef, useMemo, type Dispatch, type SetStateAction } from "react";
import { getConnectionIcon, getConnectionColor } from "@/components/user/ConnectionIcon";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageCropper } from "@/components/ui/image-cropper";
import { ProfileCard } from "@/components/user/ProfileCard";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  User,
  Shield,
  Bell,
  Palette,
  Mic,
  Keyboard,
  Languages,
  Accessibility,
  Crown,
  LogOut,
  Camera,
  Check, 
  ExternalLink,
  Pencil,
  Search,
  Link2,
  Smartphone,
  MessageSquare,
  Lock,
  Volume2,
  Image,
  Plug,
  ShieldCheck,
  Users,
  Settings,
  Database,
  Activity,
  FlaskConical,
  RotateCcw,
  Clock,
  BellRing,
  MonitorSmartphone,
  Target,
  MinusCircle,
  Award,
  Megaphone,
  Mic2,
  ChevronDown,
  Ban,
  FileText,
  Server,
  Globe,
  UserCog,
  AlertTriangle,
  Zap,
  BarChart3,
  Calendar,
  Bot,
  RefreshCw,
  Bug,
  ShieldAlert,
  MessageSquareHeart,
} from "lucide-react";
import { requestNotificationPermission } from "@/lib/services/notificationService";
import { setUserNotificationSettings } from "@/lib/services/notificationUX";
import { voiceService } from "@/lib/services/voiceService";
import { cn, cdnImage } from "@/lib/utils";
import { getBadgesByPriority, BADGES, type BadgeId } from "@/lib/constants/badges";
import { NAMEPLATE_PRESETS, getNameplateBackground } from "@/lib/constants/nameplates";
import { AdminExperimentsPanel } from "@/components/settings/AdminExperimentsPanel";
import { KeybindSettingsPanel } from "@/components/settings/KeybindSettingsPanel";
import { AdminTtsSoundsPanel, AdminTtsVoicesPanel } from "@/components/settings/AdminTtsPanel";
import { AdminTranslationsPanel } from "@/components/settings/AdminTranslationsPanel";
import { BugReportPanel } from "@/components/settings/BugReportPanel";
import { AdminBugReportsPanel } from "@/components/settings/AdminBugReportsPanel";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import { toast } from "sonner";
import { T, useGT } from "gt-next";
import { LocaleSelector } from "@/components/ui/LocaleSelector";
import { Loader } from "@/components/ui/Loader";

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab =
  | "profiles"
  | "content-social"
  | "data-privacy"
  | "authorized-apps"
  | "devices"
  | "connections"
  | "notifications"
  | "appearance"
  | "accessibility"
  | "voice-video"
  | "text-images"
  | "keybinds"
  | "language"
  | "advanced"
  | "premium"
  | "admin-users"
  | "admin-servers"
  | "admin-badges"
  | "admin-announcements"
  | "admin-settings"
  | "admin-logs"
  | "admin-experiments"
  | "admin-tts-sounds"
  | "admin-tts-voices"
  | "admin-translations"
  | "admin-stats"
  | "bug-reports"
  | "admin-bug-reports";

const statusOptions = [
  { value: "online", label: "Online", color: "#8B5CF6" },
  { value: "idle", label: "Idle", color: "#A78BFA" },
  { value: "dnd", label: "Do Not Disturb", color: "#EF4444" },
  { value: "offline", label: "Invisible", color: "#555555" },
];

const CONNECTION_PROVIDERS: Array<{
  id: string; label: string; color: string; bg: string;
  hint: string;
  category: "social" | "gaming" | "music" | "streaming";
}> = [
  { id: "lastfm",    label: "Last.fm",     color: "#e4335a", bg: "#e4335a20", hint: "Authorise via Last.fm — shows your live scrobbles on your profile.", category: "music" },
  { id: "spotify",   label: "Spotify",     color: "#1db954", bg: "#1db95420", hint: "Authorise via Spotify.", category: "music" },
  { id: "youtube",   label: "YouTube",     color: "#ff0000", bg: "#ff000020", hint: "Authorise via Google/YouTube.", category: "streaming" },
  { id: "twitch",    label: "Twitch",      color: "#9146ff", bg: "#9146ff20", hint: "Authorise via Twitch.", category: "streaming" },
  { id: "steam",     label: "Steam",       color: "#4a90d9", bg: "#4a90d920", hint: "Authorise via Steam.", category: "gaming" },
  { id: "xbox",      label: "Xbox",        color: "#107c10", bg: "#107c1020", hint: "Authorise via Microsoft/Xbox.", category: "gaming" },
  { id: "psn",       label: "PlayStation", color: "#00439c", bg: "#00439c20", hint: "Authorise via PlayStation Network.", category: "gaming" },
  { id: "battlenet", label: "Battle.net",  color: "#148eff", bg: "#148eff20", hint: "Authorise via Battle.net.", category: "gaming" },
  { id: "roblox",    label: "Roblox",      color: "#e8000b", bg: "#e8000b20", hint: "Authorise via Roblox.", category: "gaming" },
  { id: "github",    label: "GitHub",      color: "#c9d1d9", bg: "#ffffff12", hint: "Authorise via GitHub.", category: "social" },
  { id: "twitter",   label: "X / Twitter", color: "#1d9bf0", bg: "#1d9bf020", hint: "Authorise via X.", category: "social" },
  { id: "instagram", label: "Instagram",   color: "#e1306c", bg: "#e1306c20", hint: "Authorise via Instagram.", category: "social" },
  { id: "discord",   label: "Discord",     color: "#5865f2", bg: "#5865f220", hint: "Managed through your Serika account.", category: "social" },
  { id: "serika",    label: "Serika",      color: "#8B5CF6", bg: "#8B5CF620", hint: "Managed through your Serika account.", category: "social" },
  { id: "website",   label: "Website",     color: "#8B5CF6", bg: "#8B5CF620", hint: "Enter your personal website URL.", category: "social" },
];

const CONNECTION_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "music",     label: "Music" },
  { id: "gaming",    label: "Gaming" },
  { id: "streaming", label: "Streaming" },
  { id: "social",    label: "Social" },
];

type GTFunc = ReturnType<typeof useGT>;

function connectionCategoryLabel(id: string, gt: GTFunc): string {
  switch (id) {
    case 'music': return gt('Music');
    case 'gaming': return gt('Gaming');
    case 'streaming': return gt('Streaming');
    case 'social': return gt('Social');
    default: return id;
  }
}

function connectionProviderHint(id: string, gt: GTFunc): string {
  switch (id) {
    case 'lastfm': return gt('Authorise via Last.fm — shows your live scrobbles on your profile.');
    case 'spotify': return gt('Authorise via Spotify.');
    case 'youtube': return gt('Authorise via Google/YouTube.');
    case 'twitch': return gt('Authorise via Twitch.');
    case 'steam': return gt('Authorise via Steam.');
    case 'xbox': return gt('Authorise via Microsoft/Xbox.');
    case 'psn': return gt('Authorise via PlayStation Network.');
    case 'battlenet': return gt('Authorise via Battle.net.');
    case 'roblox': return gt('Authorise via Roblox.');
    case 'github': return gt('Authorise via GitHub.');
    case 'twitter': return gt('Authorise via X.');
    case 'instagram': return gt('Authorise via Instagram.');
    case 'discord': return gt('Managed through your Serika account.');
    case 'serika': return gt('Managed through your Serika account.');
    case 'website': return gt('Enter your personal website URL.');
    default: return '';
  }
}

function ConnectionsTabContent({
  userConnections,
  setUserConnections,
  connectingProvider,
  setConnectingProvider,
  connectingValue,
  setConnectingValue,
  connectionsEnabled = true,
  disabledProviders = [],
}: {
  userConnections: any[];
  setUserConnections: Dispatch<SetStateAction<any[]>>;
  connectingProvider: string | null;
  setConnectingProvider: (v: string | null) => void;
  connectingValue: string;
  setConnectingValue: (v: string) => void;
  connectionsEnabled?: boolean;
  disabledProviders?: string[];
}) {
  const gt = useGT();
  const connectedMap = Object.fromEntries(userConnections.map((c) => [c.provider, c]));

  // Handle OAuth return (success/error params in URL)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success) {
      const label = CONNECTION_PROVIDERS.find((p) => p.id === success)?.label || success;
      toast.success(gt("{label} connected!", { label }));
      // Refresh connections
      fetch("/api/users/me/connections")
        .then((r) => r.json())
        .then((d) => d.connections && setUserConnections(d.connections))
        .catch(() => {});
      params.delete("success");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    } else if (error) {
      const msgs: Record<string, string> = {
        denied: gt("Authorisation was cancelled."),
        state_missing: gt("Session expired. Please try again."),
        session_failed: gt("Failed to complete authorisation. Please try again."),
        error: gt("An error occurred while linking the account."),
        not_configured: gt("This provider is not configured on this instance."),
        connections_disabled: gt("Connections have been temporarily disabled by staff."),
        unauthorized: gt("You must be logged in to connect an account."),
      };
      // Match prefix errors like "lastfm_denied", "github_denied", etc.
      const base = error.includes("_") ? error.split("_").slice(1).join("_") : error;
      toast.error(msgs[base] || gt("Connection failed."));
      params.delete("error");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (provider: string, accountId: string) => {
    if (!accountId.trim()) return;
    try {
      const res = await fetch("/api/users/me/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, accountId: accountId.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setUserConnections((prev) => {
          const filtered = prev.filter((c) => c.provider !== provider);
          return [data.connection, ...filtered];
        });
        toast.success(gt("{label} connected", { label: CONNECTION_PROVIDERS.find((p) => p.id === provider)?.label || provider }));
        setConnectingProvider(null);
        setConnectingValue("");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error((err as any).error || gt("Failed to connect"));
      }
    } catch {
      toast.error(gt("Failed to connect"));
    }
  };

  const handleDisconnect = async (connectionId: string, provider: string) => {
    const res = await fetch(`/api/users/me/connections/${connectionId}`, { method: "DELETE" });
    if (res.ok) {
      setUserConnections((prev) => prev.filter((c) => c.id !== connectionId));
      toast.success(gt("{label} disconnected", { label: CONNECTION_PROVIDERS.find((p) => p.id === provider)?.label || provider }));
    } else {
      toast.error(gt("Failed to disconnect"));
    }
  };

  const activeProviderDef = connectingProvider
    ? CONNECTION_PROVIDERS.find((x) => x.id === connectingProvider)
    : null;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">{gt("Connections")}</h2>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        {gt("Link your accounts to show them on your profile. Some connections display live activity.")}
      </p>

      {!connectionsEnabled && (
        <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-3">
          <Lock className="w-5 h-5 text-yellow-400 shrink-0" />
          <div>
            <p className="text-yellow-400 font-semibold text-sm">{gt("Connections are temporarily disabled")}</p>
            <p className="text-yellow-400/70 text-xs">{gt("Account linking has been turned off by staff. You can still disconnect existing accounts.")}</p>
          </div>
        </div>
      )}

      {/* Inline connect form */}
      {connectingProvider && activeProviderDef && (
        <div className="mb-6 p-4 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
              style={{ backgroundColor: activeProviderDef.bg, color: activeProviderDef.color }}
            >
              {activeProviderDef.label[0]}
            </div>
            <p className="text-white font-semibold text-sm">{gt("Connect {label}", { label: activeProviderDef.label })}</p>
            <button
              onClick={() => { setConnectingProvider(null); setConnectingValue(""); }}
              className="ml-auto text-[var(--text-muted)] hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">{connectionProviderHint(activeProviderDef.id, gt)}</p>
          <div className="flex gap-2">
            <Input
              autoFocus
              value={connectingValue}
              onChange={(e) => setConnectingValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleConnect(connectingProvider, connectingValue)}
              placeholder={gt("https://yoursite.com")}
              className="flex-1 bg-[var(--bg-card)] border-[var(--border-subtle)] text-white"
            />
            <button
              onClick={() => void handleConnect(connectingProvider, connectingValue)}
              disabled={!connectingValue.trim()}
              className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-40 font-medium transition-opacity"
              style={{ backgroundColor: activeProviderDef.color }}
            >
              {gt("Connect")}
            </button>
          </div>
        </div>
      )}

      {/* Provider list grouped by category */}
      <div className="space-y-6">
        {CONNECTION_CATEGORIES.map(({ id: catId, label: catLabel }) => {
          const catProviders = CONNECTION_PROVIDERS.filter((p) => p.category === catId);
          return (
            <div key={catId}>
              <p className="text-xs font-semibold uppercase text-[var(--text-muted)] tracking-wide mb-2">{connectionCategoryLabel(catId, gt)}</p>
              <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)]">
                {catProviders.map((p, i) => {
                  const conn = connectedMap[p.id];
                  const isExpanded = connectingProvider === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 px-4 py-3 bg-[var(--bg-app)] transition-colors${i < catProviders.length - 1 ? " border-b border-[var(--border-subtle)]" : ""}`}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: p.bg }}
                      >
                        {(() => { const Icon = getConnectionIcon(p.id); return <Icon size={18} style={{ color: p.color }} />; })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">{p.label}</p>
                        {conn ? (
                          <p className="text-xs text-[#22c55e] truncate flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                            {conn.displayName || conn.username || conn.accountId}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--text-muted)]">{connectionProviderHint(p.id, gt)}</p>
                        )}
                      </div>
                      {conn ? (
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--text-muted)]">{gt("Show on profile")}</span>
                            <ToggleSwitch
                              size="sm"
                              checked={conn.visible !== false}
                              onCheckedChange={async (checked) => {
                                try {
                                  const res = await fetch(`/api/users/me/connections/${conn.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ visible: checked }),
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    setUserConnections((prev) =>
                                      prev.map((c) => (c.id === conn.id ? data.connection : c))
                                    );
                                    toast.success(gt("Visibility updated"));
                                  } else {
                                    toast.error(gt("Failed to update visibility"));
                                  }
                                } catch {
                                  toast.error(gt("Failed to update visibility"));
                                }
                              }}
                            />
                          </div>
                          {p.id === "serika" || p.id === "discord" ? (
                            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--app-accent)]/10 text-[var(--app-accent)] shrink-0">
                              {gt("Managed")}
                            </span>
                          ) : (
                            <button
                              onClick={() => void handleDisconnect(conn.id, p.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              {gt("Disconnect")}
                            </button>
                          )}
                        </div>
                      ) : p.id === "serika" || p.id === "discord" ? (
                        <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--app-accent)]/10 text-[var(--app-accent)] shrink-0">
                          {gt("Managed")}
                        </span>
                      ) : disabledProviders.includes(p.id) ? (
                        <button
                          disabled
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400/50 cursor-not-allowed shrink-0 border border-red-500/20"
                        >
                          {gt("Disabled")}
                        </button>
                      ) : connectionsEnabled ? (
                        p.id === "website" ? (
                          <button
                            onClick={() => { setConnectingProvider(isExpanded ? null : p.id); setConnectingValue(""); }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white shrink-0 transition-opacity hover:opacity-90"
                            style={{ backgroundColor: p.color }}
                          >
                            {isExpanded ? gt("Cancel") : gt("Connect")}
                          </button>
                        ) : (
                          <a
                            href={`/api/auth/${p.id}/initiate`}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white shrink-0 transition-opacity hover:opacity-90 inline-block"
                            style={{ backgroundColor: p.color }}
                          >
                            {gt("Connect")}
                          </a>
                        )
                      ) : (
                        <button
                          disabled
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-[#555] cursor-not-allowed shrink-0"
                        >
                          {gt("Connect")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Voice & Video Tab ─── */

function VoiceVideoTab({
  userSettings,
  isLoadingSettings,
  saveSettingsPatch,
  gt,
}: {
  userSettings: Record<string, any> | null;
  isLoadingSettings: boolean;
  saveSettingsPatch: (patch: Record<string, any>, sectionLabel: string) => void;
  gt: GTFunc;
}) {
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const micAnalyserRef = useRef<{ analyser: AnalyserNode; ctx: AudioContext; stream: MediaStream } | null>(null);
  const micAnimRef = useRef<number>(0);

  const startMicTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: Boolean(userSettings?.voiceVideo?.echoCancellation),
          noiseSuppression: Boolean(userSettings?.voiceVideo?.noiseSuppression),
          autoGainControl: Boolean(userSettings?.voiceVideo?.autoGainControl),
        },
        video: false,
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micAnalyserRef.current = { analyser, ctx, stream };
      setMicTesting(true);

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 2));
        micAnimRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      toast.error(gt("Microphone access denied"));
    }
  };

  const stopMicTest = () => {
    setMicTesting(false);
    setMicLevel(0);
    if (micAnimRef.current) cancelAnimationFrame(micAnimRef.current);
    if (micAnalyserRef.current) {
      micAnalyserRef.current.stream.getTracks().forEach((t) => t.stop());
      micAnalyserRef.current.ctx.close();
      micAnalyserRef.current = null;
    }
  };

  const startVideoPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: 640, height: 360 },
      });
      setVideoStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      toast.error(gt("Camera access denied"));
    }
  };

  const stopVideoPreview = () => {
    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
      setVideoStream(null);
    }
  };

  useEffect(() => {
    return () => {
      stopMicTest();
      stopVideoPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ttsEnabled = Boolean(userSettings?.accessibility?.tts);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[var(--text-primary)]">{gt("Voice & Video")}</h2>

      {/* Voice Settings */}
      <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
        <div className="flex items-center gap-3 mb-1">
          <Mic className="w-5 h-5 text-[var(--app-accent)]" />
          <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Input Device")}</h3>
        </div>

        {isLoadingSettings || !userSettings ? (
          <div className="text-[var(--text-muted)] text-sm">{gt("Loading settings...")}</div>
        ) : (
          <>
            {/* Input Volume */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-[var(--text-primary)] font-medium">{gt("Input Volume")}</label>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">{userSettings.voiceVideo?.inputVolume ?? 100}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                value={userSettings.voiceVideo?.inputVolume ?? 100}
                onChange={(e) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), inputVolume: Number(e.target.value) } }, "voice-video")}
                className="w-full accent-[var(--app-accent)]"
              />
            </div>

            {/* Mic Test */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-[var(--text-primary)] font-medium">{gt("Microphone Test")}</label>
                <button
                  onClick={micTesting ? stopMicTest : startMicTest}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5",
                    micTesting
                      ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                      : "bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white"
                  )}
                >
                  {micTesting ? (
                    <><span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> {gt("Stop")}</>
                  ) : (
                    <><Mic2 className="w-3.5 h-3.5" /> {gt("Test")}</>
                  )}
                </button>
              </div>
              {micTesting && (
                <div className="h-8 rounded-lg bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--app-accent)] to-[#10B981] transition-[width] duration-75"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="h-px bg-[var(--border-subtle)]" />

            {/* Audio Processing Toggles */}
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-[var(--text-primary)] font-medium">{gt("Noise Suppression")}</p>
                <p className="text-sm text-[var(--text-secondary)]">{gt("Reduce background noise from your microphone")}</p>
              </div>
              <ToggleSwitch size="sm" checked={Boolean(userSettings.voiceVideo?.noiseSuppression)} onCheckedChange={(checked) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), noiseSuppression: checked } }, "voice-video")} />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-[var(--text-primary)] font-medium">{gt("Echo Cancellation")}</p>
                <p className="text-sm text-[var(--text-secondary)]">{gt("Prevent echo from speakers into your microphone")}</p>
              </div>
              <ToggleSwitch size="sm" checked={Boolean(userSettings.voiceVideo?.echoCancellation)} onCheckedChange={(checked) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), echoCancellation: checked } }, "voice-video")} />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-[var(--text-primary)] font-medium">{gt("Automatic Gain Control")}</p>
                <p className="text-sm text-[var(--text-secondary)]">{gt("Automatically adjust microphone volume")}</p>
              </div>
              <ToggleSwitch size="sm" checked={Boolean(userSettings.voiceVideo?.autoGainControl)} onCheckedChange={(checked) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), autoGainControl: checked } }, "voice-video")} />
            </label>

            <div className="h-px bg-[var(--border-subtle)]" />

            {/* Push to Talk */}
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-[var(--text-primary)] font-medium">{gt("Push to Talk")}</p>
                <p className="text-sm text-[var(--text-secondary)]">{gt("Hold a key to transmit voice")}</p>
              </div>
              <ToggleSwitch size="sm" checked={Boolean(userSettings.voiceVideo?.pushToTalk)} onCheckedChange={(checked) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), pushToTalk: checked } }, "voice-video")} />
            </label>
            {userSettings.voiceVideo?.pushToTalk && (
              <div className="ml-0 p-3 rounded-lg bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)]">
                <label className="text-xs text-[var(--text-muted)] block mb-2">{gt("Push to Talk Key")}</label>
                <input
                  type="text"
                  value={userSettings.voiceVideo?.pushToTalkKey || "V"}
                  onChange={(e) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), pushToTalkKey: e.target.value.toUpperCase().slice(0, 1) } }, "voice-video")}
                  className="w-16 text-center font-mono text-lg px-2 py-1.5 rounded-lg bg-[var(--bg-input)] text-white border border-[var(--border-color)] focus:border-[var(--app-accent)] outline-none"
                  maxLength={1}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Output Settings */}
      <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
        <div className="flex items-center gap-3 mb-1">
          <Volume2 className="w-5 h-5 text-[var(--app-accent)]" />
          <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Output Device")}</h3>
        </div>
        {isLoadingSettings || !userSettings ? (
          <div className="text-[var(--text-muted)] text-sm">{gt("Loading settings...")}</div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[var(--text-primary)] font-medium">{gt("Output Volume")}</label>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">{userSettings.voiceVideo?.outputVolume ?? 100}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={userSettings.voiceVideo?.outputVolume ?? 100}
              onChange={(e) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), outputVolume: Number(e.target.value) } }, "voice-video")}
              className="w-full accent-[var(--app-accent)]"
            />

            <div className="flex items-center justify-between pt-2">
              <label className="text-sm text-[var(--text-primary)] font-medium">{gt("Soundboard Volume")}</label>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">{userSettings.voiceVideo?.soundboardVolume ?? 100}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={userSettings.voiceVideo?.soundboardVolume ?? 100}
              onChange={(e) => saveSettingsPatch({ voiceVideo: { ...(userSettings.voiceVideo || {}), soundboardVolume: Number(e.target.value) } }, "voice-video")}
              aria-label="Soundboard playback volume"
              className="w-full accent-[var(--app-accent)]"
            />
          </div>
        )}
      </div>

      {/* Video Preview */}
      <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
        <div className="flex items-center gap-3 mb-1">
          <Camera className="w-5 h-5 text-[var(--app-accent)]" />
          <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Camera Preview")}</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={videoStream ? stopVideoPreview : startVideoPreview}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              videoStream
                ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                : "bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white"
            )}
          >
            {videoStream ? gt("Stop Preview") : gt("Start Preview")}
          </button>
          <label className="flex items-center justify-between cursor-pointer flex-1">
            <span className="text-sm text-[var(--text-primary)]">{gt("Stream Preview")}</span>
            <ToggleSwitch size="sm" checked={Boolean(userSettings?.voiceVideo?.streamPreview)} onCheckedChange={(checked) => saveSettingsPatch({ voiceVideo: { ...(userSettings?.voiceVideo || {}), streamPreview: checked } }, "voice-video")} />
          </label>
        </div>
        {videoStream && (
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover video-mirror" />
          </div>
        )}
      </div>

      {/* Text-to-Speech */}
      <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
        <div className="flex items-center gap-3 mb-1">
          <Megaphone className="w-5 h-5 text-[var(--app-accent)]" />
          <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Text-to-Speech")}</h3>
        </div>
        {isLoadingSettings || !userSettings ? (
          <div className="text-[var(--text-muted)] text-sm">{gt("Loading settings...")}</div>
        ) : (
          <>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-[var(--text-primary)] font-medium">{gt("Text-to-Speech")}</p>
                <p className="text-sm text-[var(--text-secondary)]">{gt("Read incoming messages aloud")}</p>
              </div>
              <ToggleSwitch size="sm" checked={ttsEnabled} onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), tts: checked } }, "voice-video")} />
            </label>

            {/* TTS Usage Guide */}
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/50 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-[var(--app-accent)]">{gt("TTS Usage Guide")}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {gt("Type")} <code className="px-1 py-0.5 rounded bg-white/10 text-white">/tts</code> {gt("before your message to send it as speech.")}
              </p>
              <p className="text-xs text-white pl-3">
                <code className="px-1 py-0.5 rounded bg-white/10">/tts [f] Hello</code> — {gt("female voice")}
              </p>
              <p className="text-xs text-white pl-3">
                <code className="px-1 py-0.5 rounded bg-white/10">/tts [m] Hello</code> — {gt("male voice")}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {gt("Keywords:")} <span className="text-white">[f]</span>, <span className="text-white">[female]</span>, <span className="text-white">[girl]</span> {gt("for female")} &middot; <span className="text-white">[m]</span>, <span className="text-white">[male]</span>, <span className="text-white">[boy]</span> {gt("for male")}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {gt("Voices are English-only. Set a default below or override per message.")}
              </p>
            </div>

            {/* Reading speed */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-primary)] font-medium">{gt("Reading speed")}</span>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">
                  {(userSettings.accessibility?.ttsRate ?? 1).toFixed(1)}×
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={userSettings.accessibility?.ttsRate ?? 1}
                onChange={(e) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), ttsRate: parseFloat(e.target.value) } }, "voice-video")}
                className="w-full accent-[var(--app-accent)]"
              />
            </div>

            {/* Voice gender */}
            <label className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-primary)] font-medium">{gt("Voice")}</span>
              <select
                value={userSettings.accessibility?.ttsVoice ?? "auto"}
                onChange={(e) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), ttsVoice: e.target.value } }, "voice-video")}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-input)] text-white text-sm border border-[var(--border-color)] focus:border-[var(--app-accent)] outline-none"
              >
                <option value="auto">{gt("Automatic")}</option>
                <option value="female">{gt("Female")}</option>
                <option value="male">{gt("Male")}</option>
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  const { user, logout, updateUser, refresh } = useAuth();
  const gt = useGT();
  const { settings: themeSettings, applyUserSettingsPatch, updateSettings } = useTheme();
  const { servers } = useServer();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profiles");
  const [displayName, setDisplayName] = useState("");
  const [profileTab, setProfileTab] = useState<"main" | "server">("main");
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [serverNickname, setServerNickname] = useState("");
  const [serverAvatar, setServerAvatar] = useState<string | null>(null);
  const [serverBanner, setServerBanner] = useState<string | null>(null);
  const [serverMemberLoading, setServerMemberLoading] = useState(false);

  const [initialServerNickname, setInitialServerNickname] = useState("");
  const [initialServerAvatar, setInitialServerAvatar] = useState<string | null>(null);
  const [initialServerBanner, setInitialServerBanner] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [timezone, setTimezone] = useState("");
  const [showTimezone, setShowTimezone] = useState(false);
  const [customStatus, setCustomStatus] = useState("");
  const [status, setStatus] = useState("online");
  const [displayNameStyle, setDisplayNameStyle] = useState<{
    font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
    effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
    color?: string;
    gradient?: string[];
  }>({ font: 'default', effect: 'solid', color: '', gradient: [] });
  const [profileColor, setProfileColor] = useState("");
  const [profileGradient, setProfileGradient] = useState<string[]>([]);
  const [profileGradientAngle, setProfileGradientAngle] = useState(135);
  const [profileGradientType, setProfileGradientType] = useState<'linear' | 'radial'>('linear');
  const [profileGradientRadialPosition, setProfileGradientRadialPosition] = useState('center');
  const [profileCardEffect, setProfileCardEffect] = useState<'normal' | 'glassmorphism' | 'glow' | 'holographic' | 'neon'>('normal');
  const [profileCardBlur, setProfileCardBlur] = useState(8);
  const [profileCardOpacity, setProfileCardOpacity] = useState(0.85);
  const [profileCardBorderColor, setProfileCardBorderColor] = useState("");
  const [profileCardBorderGlow, setProfileCardBorderGlow] = useState(false);
  const [profileCardBorderWidth, setProfileCardBorderWidth] = useState(1);
  const [nameplate, setNameplate] = useState<{
    type?: 'none' | 'color' | 'gradient' | 'preset';
    color?: string;
    gradient?: string[];
    presetId?: string;
  }>({ type: 'none' });

  const previewUser = useMemo(() => {
    const isServer = profileTab === "server";
    return {
      id: user?.id || "preview-id",
      username: user?.username || "username",
      displayName: isServer ? (serverNickname || displayName || user?.username || "") : (displayName || user?.username || ""),
      avatar: isServer ? (serverAvatar || user?.avatar) : (user?.avatar),
      banner: isServer ? (serverBanner || user?.banner) : (user?.banner),
      bio: bio,
      pronouns: pronouns,
      timezone: timezone,
      showTimezone: showTimezone,
      customStatus: customStatus,
      status: (status as any) || "online",
      badges: user?.badges || [],
      createdAt: user?.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString(),
      isPremium: user?.isPremium || false,
      customization: {
        profileColor: profileColor,
        profileGradient: profileGradient,
        displayNameStyle: displayNameStyle,
        nameplate: nameplate,
        profileGradientAngle,
        profileGradientType,
        profileGradientRadialPosition,
        profileCardEffect,
        profileCardBlur,
        profileCardOpacity,
        profileCardBorderColor,
        profileCardBorderGlow,
        profileCardBorderWidth,
      }
    };
  }, [
    user,
    profileTab,
    serverNickname,
    displayName,
    serverAvatar,
    serverBanner,
    bio,
    pronouns,
    timezone,
    showTimezone,
    customStatus,
    status,
    profileColor,
    profileGradient,
    displayNameStyle,
    nameplate,
    profileGradientAngle,
    profileGradientType,
    profileGradientRadialPosition,
    profileCardEffect,
    profileCardBlur,
    profileCardOpacity,
    profileCardBorderColor,
    profileCardBorderGlow,
    profileCardBorderWidth,
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userSettings, setUserSettings] = useState<Record<string, any> | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState<string | null>(null);
  const [authorizedApps, setAuthorizedApps] = useState<any[]>([]);
  const [deviceSessions, setDeviceSessions] = useState<any[]>([]);
  const [userConnections, setUserConnections] = useState<any[]>([]);
  const [connectionsEnabled, setConnectionsEnabled] = useState(true);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);

  // Avatar/Banner upload state
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string>("");
  const [cropperType, setCropperType] = useState<"avatar" | "banner">("avatar");

  // Admin state
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [adminServerSearch, setAdminServerSearch] = useState("");
  const [adminUsers, setAdminUsers] = useState<Array<{
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    avatar?: string;
    badges: string[];
    isVerified: boolean;
    isBanned: boolean;
    isStaff: boolean;
    createdAt: string;
  }>>([]);
  const [adminServers, setAdminServers] = useState<Array<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    memberCount: number;
    owner: { username: string; displayName?: string };
    isDiscoverable: boolean;
    isPartnered: boolean;
    createdAt: string;
  }>>([]);
  const [adminLogs, setAdminLogs] = useState<Array<{
    id: string;
    admin: { id?: string; username: string; displayName?: string; avatar?: string };
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
    reason?: string;
    createdAt: string;
  }>>([]);
  const [adminStats, setAdminStats] = useState<{
    users: number;
    servers: number;
    messages: number;
    banned: number;
    bots: number;
    newUsersToday: number;
    newUsersThisWeek: number;
    messagesToday: number;
    onlineUsers: number;
    totalMemberships: number;
    activeServers: number;
  } | null>(null);
  const [platformSettings, setPlatformSettings] = useState<{
    maintenanceMode: boolean;
    allowRegistration: boolean;
    connectionsEnabled?: boolean;
    disabledProviders?: string[];
    globalAnnouncement?: string;
    oembedWhitelist?: string[];
    allowedFileTypes?: { type: string; safe: boolean }[];
    warnOnUnknownFileTypes?: boolean;
  } | null>(null);
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    avatar?: string;
    banner?: string;
    bio?: string;
    badges: string[];
    isBanned: boolean;
    banReason?: string;
    isStaff?: boolean;
    staffRole?: string;
    isVerified?: boolean;
    isPremium?: boolean;
    premiumSince?: string;
    createdAt?: string;
    stats?: { servers: number; messages: number };
  } | null>(null);
  const [selectedServer, setSelectedServer] = useState<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    memberCount?: number;
    owner: { username: string; displayName?: string };
    isDiscoverable: boolean;
    isPartnered: boolean;
    createdAt: string;
  } | null>(null);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [adminLogFilter, setAdminLogFilter] = useState<string>("all");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [adminLogPage, setAdminLogPage] = useState(1);
  const [adminLogPagination, setAdminLogPagination] = useState<{ page: number; limit: number; total: number; pages: number } | null>(null);
  const [announcementText, setAnnouncementText] = useState("");
  const [oembedDomainInput, setOembedDomainInput] = useState("");
  const [fileTypeInput, setFileTypeInput] = useState("");
  const [fontTestText, setFontTestText] = useState("The quick brown fox jumps over the lazy dog");
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectingValue, setConnectingValue] = useState("");

  // Initialize form with user data
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
      setBio(user.bio || "");
      setPronouns(user.pronouns || "");
      setTimezone(user.timezone || "");
      setShowTimezone(user.showTimezone ?? false);
      setCustomStatus(user.customStatus || "");
      setStatus(user.status || "online");
      setDisplayNameStyle(user.customization?.displayNameStyle || { font: 'default', effect: 'solid', color: '', gradient: [] });
      setProfileColor(user.customization?.profileColor || "");
      setProfileGradient(user.customization?.profileGradient || []);
      setProfileGradientAngle(user.customization?.profileGradientAngle ?? 135);
      setProfileGradientType(user.customization?.profileGradientType || 'linear');
      setProfileGradientRadialPosition(user.customization?.profileGradientRadialPosition || 'center');
      setProfileCardEffect(user.customization?.profileCardEffect || 'normal');
      setProfileCardBlur(user.customization?.profileCardBlur ?? 8);
      setProfileCardOpacity(user.customization?.profileCardOpacity ?? 0.85);
      setProfileCardBorderColor(user.customization?.profileCardBorderColor || "");
      setProfileCardBorderGlow(user.customization?.profileCardBorderGlow ?? false);
      setProfileCardBorderWidth(user.customization?.profileCardBorderWidth ?? 1);
      setNameplate(user.customization?.nameplate || { type: 'none' });
    }
  }, [user]);

  const fetchUserSettings = async () => {
    setIsLoadingSettings(true);
    try {
      const [settingsRes, appsRes, devicesRes, connectionsRes] = await Promise.all([
        fetch("/api/users/me/settings"),
        fetch("/api/users/me/authorized-apps"),
        fetch("/api/users/me/devices"),
        fetch("/api/users/me/connections"),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setUserSettings(data.settings || {});
      }
      if (appsRes.ok) {
        const data = await appsRes.json();
        setAuthorizedApps(data.apps || []);
      }
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        setDeviceSessions(data.devices || []);
      }
      if (connectionsRes.ok) {
        const data = await connectionsRes.json();
        setUserConnections(data.connections || []);
      }
    } catch (error) {
      console.error("Failed to fetch user settings:", error);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const saveSettingsPatch = async (patch: Record<string, any>, sectionLabel: string) => {
    setIsSavingSettings(sectionLabel);
    try {
      const response = await fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: patch }),
      });

      if (response.ok) {
        setUserSettings((prev) => ({ ...(prev || {}), ...patch }));
        applyUserSettingsPatch(patch);
        if (patch.notifications) setUserNotificationSettings(patch.notifications);
        if (typeof patch.voiceVideo?.soundboardVolume === "number") voiceService.setSoundboardVolume(patch.voiceVideo.soundboardVolume);
        toast.success(gt("Settings saved"));
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to save settings"));
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(gt("Failed to save settings"));
    } finally {
      setIsSavingSettings(null);
    }
  };

  const saveAppearancePatch = (appearancePatch: Record<string, any>) => {
    const mergedAppearance = { ...(userSettings?.appearance || {}), ...appearancePatch };
    setUserSettings((prev) => ({ ...(prev || {}), appearance: mergedAppearance }));
    applyUserSettingsPatch({ appearance: mergedAppearance });
    void saveSettingsPatch({ appearance: mergedAppearance }, "appearance");
  };

  useEffect(() => {
    if (!open) return;
    fetchUserSettings();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const settingsTab = params.get("settings") || params.get("openSettings");
      if (settingsTab === "connections") {
        setActiveTab("connections");
      }
    }
  }, [open]);

  useEffect(() => {
    if (!userSettings) return;
    applyUserSettingsPatch(userSettings);
  }, [userSettings, applyUserSettingsPatch]);

  // Initialize selected server when profile tab is opened or servers change
  useEffect(() => {
    if (servers.length > 0 && !selectedServerId) {
      setSelectedServerId(servers[0].id);
    }
  }, [servers, selectedServerId]);

  // Fetch server-specific profile whenever selectedServerId or profileTab changes
  useEffect(() => {
    const fetchServerProfile = async () => {
      if (profileTab !== "server" || !selectedServerId || !user?.id) return;
      setServerMemberLoading(true);
      try {
        const res = await fetch(`/api/servers/${selectedServerId}/members/${user.id}`);
        if (res.ok) {
          const member = await res.json();
          const nick = member.nickname || "";
          const av = member.avatarOverride || null;
          const ban = member.banner || null;

          setServerNickname(nick);
          setServerAvatar(av);
          setServerBanner(ban);

          setInitialServerNickname(nick);
          setInitialServerAvatar(av);
          setInitialServerBanner(ban);
        }
      } catch (err) {
        console.error("Failed to fetch server profile:", err);
      } finally {
        setServerMemberLoading(false);
      }
    };
    fetchServerProfile();
  }, [profileTab, selectedServerId, user?.id]);

  // Track changes
  useEffect(() => {
    if (profileTab === "main" && user) {
      const changed =
        displayName !== (user.displayName || "") ||
        bio !== (user.bio || "") ||
        pronouns !== (user.pronouns || "") ||
        timezone !== (user.timezone || "") ||
        showTimezone !== (user.showTimezone ?? false) ||
        customStatus !== (user.customStatus || "") ||
        status !== (user.status || "online") ||
        JSON.stringify(displayNameStyle) !== JSON.stringify(user.customization?.displayNameStyle || { font: 'default', effect: 'solid', color: '', gradient: [] }) ||
        profileColor !== (user.customization?.profileColor || "") ||
        JSON.stringify(profileGradient) !== JSON.stringify(user.customization?.profileGradient || []) ||
        JSON.stringify(nameplate) !== JSON.stringify(user.customization?.nameplate || { type: 'none' });
      setHasChanges(changed);
    } else if (profileTab === "server") {
      const changed =
        serverNickname !== initialServerNickname ||
        serverAvatar !== initialServerAvatar ||
        serverBanner !== initialServerBanner;
      setHasChanges(changed);
    }
  }, [
    displayName,
    bio,
    pronouns,
    timezone,
    showTimezone,
    customStatus,
    status,
    displayNameStyle,
    profileColor,
    profileGradient,
    nameplate,
    user,
    profileTab,
    serverNickname,
    initialServerNickname,
    serverAvatar,
    initialServerAvatar,
    serverBanner,
    initialServerBanner,
  ]);

  // Handle escape key. Capture phase so it fires even if a child stops
  // propagation, but yield to any nested dialog/menu/popover so Escape closes
  // that first (e.g. an open picker inside settings) before closing settings.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const nested = document.querySelector(
        '[role="dialog"],[role="alertdialog"],[role="menu"],[data-radix-popper-content-wrapper]'
      );
      if (nested) return; // let the nested overlay handle Escape first
      e.preventDefault();
      onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true } as EventListenerOptions);
  }, [open, onOpenChange]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (profileTab === "main") {
        const response = await fetch("/api/users/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            bio,
            pronouns,
            timezone: timezone || null,
            showTimezone,
            customStatus,
            status,
            customization: {
              displayNameStyle,
              profileColor,
              profileGradient,
              profileGradientAngle,
              profileGradientType,
              profileGradientRadialPosition,
              profileCardEffect,
              profileCardBlur,
              profileCardOpacity,
              profileCardBorderColor,
              profileCardBorderGlow,
              profileCardBorderWidth,
              nameplate,
            },
          }),
        });

        if (response.ok) {
          // Update local state immediately
          updateUser({
            displayName,
            bio,
            pronouns,
            timezone: timezone || undefined,
            showTimezone,
            customStatus,
            status: status as "online" | "idle" | "dnd" | "offline",
            customization: {
              ...(user?.customization || {}),
              displayNameStyle,
              profileColor,
              profileGradient,
              profileGradientAngle,
              profileGradientType,
              profileGradientRadialPosition,
              profileCardEffect,
              profileCardBlur,
              profileCardOpacity,
              profileCardBorderColor,
              profileCardBorderGlow,
              profileCardBorderWidth,
              nameplate,
            },
          });
          setHasChanges(false);
          toast.success(gt("Profile saved!"));
          // Refresh to get full updated data
          await refresh();
        } else {
          toast.error(gt("Failed to save profile"));
        }
      } else {
        // Save server profile
        const response = await fetch(`/api/servers/${selectedServerId}/members/@me`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname: serverNickname || null,
            avatar: serverAvatar || null,
            banner: serverBanner || null,
          }),
        });

        if (response.ok) {
          setInitialServerNickname(serverNickname);
          setInitialServerAvatar(serverAvatar);
          setInitialServerBanner(serverBanner);
          setHasChanges(false);
          toast.success(gt("Server profile saved!"));
          await refresh();
        } else {
          const data = await response.json();
          toast.error(data.error || gt("Failed to save server profile"));
        }
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(gt("Failed to save profile"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onOpenChange(false);
    toast.success(gt("Logged out"));
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropperImage(reader.result as string);
      setCropperType("avatar");
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  };

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }

    // GIFs bypass the cropper to preserve animation
    if (file.type === "image/gif") {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(gt("GIF must be less than 50MB"));
        return;
      }
      handleGifBannerUpload(file);
      if (bannerInputRef.current) {
        bannerInputRef.current.value = "";
      }
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropperImage(reader.result as string);
      setCropperType("banner");
      setCropperOpen(true);
    };
    reader.readAsDataURL(file);

    if (bannerInputRef.current) {
      bannerInputRef.current.value = "";
    }
  };

  const handleGifBannerUpload = async (file: File) => {
    const isAvatar = false;
    let endpoint = "/api/upload/banner";
    if (profileTab === "server" && selectedServerId) {
      endpoint = `/api/upload/server/${selectedServerId}/banner`;
    }

    setIsUploadingBanner(true);
    const formData = new FormData();
    formData.append("file", file, file.name);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (profileTab === "main") {
          updateUser({ banner: data.url });
        } else {
          setServerBanner(data.url);
        }
        toast.success(gt("Banner updated!"));
        void refresh();
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to upload banner"));
      }
    } catch {
      toast.error(gt("Failed to upload banner"));
    } finally {
      setIsUploadingBanner(false);
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    const isAvatar = cropperType === "avatar";
    const setUploading = isAvatar ? setIsUploadingAvatar : setIsUploadingBanner;
    
    let endpoint = isAvatar ? "/api/upload/avatar" : "/api/upload/banner";
    if (profileTab === "server" && selectedServerId) {
      endpoint = isAvatar 
        ? `/api/upload/server/${selectedServerId}/avatar`
        : `/api/upload/server/${selectedServerId}/banner`;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", croppedBlob, `${cropperType}.png`);

    // Optimistically show the cropped image immediately from a local object URL
    // so the preview updates instantly instead of waiting on the network round
    // trip + image load. Swapped for the real URL on success, reverted on error.
    const localUrl = URL.createObjectURL(croppedBlob);
    const prevAvatar = user?.avatar;
    const prevBanner = user?.banner;
    const prevServerAvatar = serverAvatar;
    const prevServerBanner = serverBanner;
    if (profileTab === "main") {
      if (isAvatar) updateUser({ avatar: localUrl });
      else updateUser({ banner: localUrl });
    } else {
      if (isAvatar) setServerAvatar(localUrl);
      else setServerBanner(localUrl);
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (profileTab === "main") {
          if (isAvatar) {
            updateUser({ avatar: data.url });
          } else {
            updateUser({ banner: data.url });
          }
        } else {
          if (isAvatar) {
            setServerAvatar(data.url);
          } else {
            setServerBanner(data.url);
          }
        }
        URL.revokeObjectURL(localUrl);
        toast.success(gt("{type} updated!", { type: isAvatar ? gt("Avatar") : gt("Banner") }));
        // Fire-and-forget: the optimistic + confirmed URL already reflects the
        // change, so don't block the UI on a full profile refetch.
        void refresh();
      } else {
        // Revert the optimistic preview on failure.
        URL.revokeObjectURL(localUrl);
        if (profileTab === "main") {
          if (isAvatar) updateUser({ avatar: prevAvatar });
          else updateUser({ banner: prevBanner });
        } else {
          if (isAvatar) setServerAvatar(prevServerAvatar);
          else setServerBanner(prevServerBanner);
        }
        const data = await response.json();
        toast.error(data.error || gt("Failed to upload {type}", { type: cropperType }));
      }
    } catch (error) {
      URL.revokeObjectURL(localUrl);
      if (profileTab === "main") {
        if (isAvatar) updateUser({ avatar: prevAvatar });
        else updateUser({ banner: prevBanner });
      } else {
        if (isAvatar) setServerAvatar(prevServerAvatar);
        else setServerBanner(prevServerBanner);
      }
      toast.error(gt("Failed to upload {type}", { type: cropperType }));
    } finally {
      setUploading(false);
    }
  };

  // Admin handlers
  const searchAdminUsers = async () => {
    if (!adminUserSearch.trim()) return;
    setIsLoadingAdmin(true);
    try {
      const response = await fetch(`/api/admin/users/search?q=${encodeURIComponent(adminUserSearch)}`);
      if (response.ok) {
        const data = await response.json();
        setAdminUsers(data.users);
        setSelectedUser((prev) => {
          if (!prev) return null;
          return data.users.find((u: any) => u.id === prev.id) || null;
        });
      } else {
        toast.error(gt("Failed to search users"));
      }
    } catch (error) {
      toast.error(gt("Failed to search users"));
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const selectUserDetail = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedUser(data);
      }
    } catch {
      // Keep whatever partial data we already have
    }
  };

  const searchAdminServers = async () => {
    if (!adminServerSearch.trim()) return;
    setIsLoadingAdmin(true);
    try {
      const response = await fetch(`/api/admin/servers/search?q=${encodeURIComponent(adminServerSearch)}`);
      if (response.ok) {
        const data = await response.json();
        setAdminServers(data.servers);
        setSelectedServer((prev) => {
          if (!prev) return null;
          return data.servers.find((s: any) => s.id === prev.id) || null;
        });
      } else {
        toast.error(gt("Failed to search servers"));
      }
    } catch (error) {
      toast.error(gt("Failed to search servers"));
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const fetchAdminStats = async () => {
    setIsLoadingAdmin(true);
    try {
      const response = await fetch("/api/admin/stats");
      if (response.ok) {
        const data = await response.json();
        setAdminStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch admin stats:", error);
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const safeParseJSON = async (response: Response) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error(response.ok ? `Invalid JSON response: ${text.slice(0, 120)}` : `${response.status} ${response.statusText}`);
    }
  };

  const fetchPlatformSettings = async () => {
    try {
      const response = await fetch("/api/admin/settings");
      const data = await safeParseJSON(response);
      if (response.ok && data) {
        setPlatformSettings(data);
        setAnnouncementText(data.globalAnnouncement || "");
      } else if (!response.ok) {
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : gt("Failed to fetch platform settings");
      console.error("Failed to fetch platform settings:", error);
      toast.error(message);
    }
  };

  const fetchAdminLogs = async (filter?: string, page?: number) => {
    setIsLoadingAdmin(true);
    try {
      const pageNum = page || adminLogPage;
      const params = new URLSearchParams();
      if (filter && filter !== "all") params.set("type", filter);
      params.set("page", String(pageNum));
      params.set("limit", "50");
      const url = `/api/admin/logs?${params.toString()}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAdminLogs(data.logs);
        setAdminLogPagination(data.pagination || null);
      }
    } catch (error) {
      console.error("Failed to fetch admin logs:", error);
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  const handleBanUser = async (userId: string, reason?: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        toast.success(gt("User banned"));
        searchAdminUsers();
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to ban user"));
      }
    } catch (error) {
      toast.error(gt("Failed to ban user"));
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/unban`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success(gt("User unbanned"));
        searchAdminUsers();
      } else {
        toast.error(gt("Failed to unban user"));
      }
    } catch (error) {
      toast.error(gt("Failed to unban user"));
    }
  };

  const handleUpdatePlatformSettings = async (updates: { maintenanceMode?: boolean; allowRegistration?: boolean; connectionsEnabled?: boolean; disabledProviders?: string[]; oembedWhitelist?: string[]; allowedFileTypes?: { type: string; safe: boolean }[]; warnOnUnknownFileTypes?: boolean }) => {
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await safeParseJSON(response);
      if (response.ok && data) {
        setPlatformSettings(data);
        toast.success(gt("Settings updated"));
      } else {
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : gt("Failed to update settings");
      toast.error(message);
      console.error("Failed to update platform settings:", error);
    }
  };

  const handlePublishAnnouncement = async () => {
    // Strip only leading/trailing blank lines, preserve internal structure
    const cleanedAnnouncement = announcementText
      .split("\n")
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
    if (!cleanedAnnouncement) return;
    try {
      // Save announcement to platform settings
      const settingsResponse = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalAnnouncement: cleanedAnnouncement }),
      });
      if (!settingsResponse.ok) {
        toast.error(gt("Failed to publish announcement"));
        return;
      }
      const settingsData = await settingsResponse.json().catch(() => null);
      if (settingsData) setPlatformSettings(settingsData);

      // Also broadcast as DMs from Serika system user
      const broadcastResponse = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cleanedAnnouncement, sendDMs: true }),
      });
      if (broadcastResponse.ok) {
        const broadcastData = await broadcastResponse.json().catch(() => null);
        const dmCount = broadcastData?.dmsSent ?? 0;
        if (dmCount === -1) {
          toast.success(gt("Announcement published — DMs are being sent in the background"));
        } else {
          toast.success(dmCount > 0 ? gt("Announcement published ({count} DMs sent)", { count: dmCount }) : gt("Announcement published"));
        }
      } else {
        toast.error(gt("Announcement saved but broadcast failed"));
      }
    } catch (error) {
      toast.error(gt("Failed to publish announcement"));
    }
  };

  const handleTogglePartner = async (serverId: string) => {
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/partner`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success(gt("Partner status toggled"));
        searchAdminServers();
      } else {
        toast.error(gt("Failed to toggle partner status"));
      }
    } catch (error) {
      toast.error(gt("Failed to toggle partner status"));
    }
  };

  const handleToggleDiscovery = async (serverId: string) => {
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/discovery`, {
        method: "POST",
      });
      if (response.ok) {
        toast.success(gt("Discovery status toggled"));
        searchAdminServers();
      } else {
        toast.error(gt("Failed to toggle discovery status"));
      }
    } catch (error) {
      toast.error(gt("Failed to toggle discovery status"));
    }
  };

  const handleDeleteServer = async (serverId: string, reason?: string) => {
    if (!confirm(gt("Are you sure you want to delete this server? This action cannot be undone."))) return;
    try {
      const response = await fetch(`/api/admin/servers/${serverId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        toast.success(gt("Server deleted"));
        searchAdminServers();
      } else {
        toast.error(gt("Failed to delete server"));
      }
    } catch (error) {
      toast.error(gt("Failed to delete server"));
    }
  };

  const handleToggleBadge = async (badgeId: string) => {
    if (!selectedUser) return;
    const currentBadges = selectedUser.badges || [];
    const newBadges = currentBadges.includes(badgeId)
      ? currentBadges.filter((b) => b !== badgeId)
      : [...currentBadges, badgeId];

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}/badges`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badges: newBadges }),
      });
      if (response.ok) {
        const updatedBadges = newBadges;
        setSelectedUser({ ...selectedUser, badges: updatedBadges });
        setAdminUsers((prev) =>
          prev.map((u) => (u.id === selectedUser.id ? { ...u, badges: updatedBadges } : u))
        );
        toast.success(gt("Badges updated"));
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to update badges"));
      }
    } catch {
      toast.error(gt("Failed to update badges"));
    }
  };

  const handleTransferOwnership = async () => {
    if (!selectedServer) {
      toast.info(gt("Select a server first"));
      return;
    }

    const newOwnerId = prompt(gt("Enter the new owner user ID"));
    if (!newOwnerId) return;

    const reason = prompt(gt("Reason for transfer (optional)")) || undefined;

    try {
      const response = await fetch(`/api/admin/servers/${selectedServer.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId, reason }),
      });
      if (response.ok) {
        toast.success(gt("Ownership transferred"));
        void searchAdminServers();
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to transfer ownership"));
      }
    } catch {
      toast.error(gt("Failed to transfer ownership"));
    }
  };

  // Admin section visibility: only admins and developers (NOT moderator/staff)
  const isStaff = user?.badges?.some((badge: string) =>
    ['admin', 'serikacord_developer'].includes(badge)
  );

  // Load admin data when tabs are activated (only for admins/developers)
  useEffect(() => {
    // Admin-only tab data fetches
    if (isStaff) {
      if (activeTab === "admin-settings" && !platformSettings) {
        fetchPlatformSettings();
        fetchAdminStats();
      } else if ((activeTab === "admin-experiments" || activeTab === "admin-announcements") && !platformSettings) {
        fetchPlatformSettings();
      } else if (activeTab === "admin-logs" && adminLogs.length === 0) {
        fetchAdminLogs();
      } else if (activeTab === "admin-stats") {
        fetchAdminStats();
      }
    }
    // Connections tab — public endpoint, available to all users
    if (activeTab === "connections") {
      fetch("/api/admin/settings/connections")
        .then((r) => r.json())
        .then((d) => {
          if (typeof d.connectionsEnabled === "boolean") setConnectionsEnabled(d.connectionsEnabled);
          if (Array.isArray(d.disabledProviders)) setDisabledProviders(d.disabledProviders);
        })
        .catch(() => {});
    }
  }, [activeTab, isStaff]);

  const renderBadges = () => {
    if (!user?.badges || user.badges.length === 0) return null;

    const badges = getBadgesByPriority(user.badges as BadgeId[]);

    return (
      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => {
          const IconComponent = badge.icon;
          return (
            <div
              key={badge.id}
              className="px-2 py-1 rounded-full flex items-center gap-1.5 text-xs"
              style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
              title={badge.description}
            >
              <IconComponent className="w-3.5 h-3.5" />
              <span>{badge.name}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // Build the (translated) menu once per locale/staff change instead of on
  // every keystroke — this array runs ~35 gt() lookups, which is a big chunk
  // of the per-render cost while typing in any settings field.
  const menuSections = useMemo(() => {
    const sections = [
      {
        title: gt("User Settings"),
        items: [
          { id: "profiles" as SettingsTab, label: gt("Profiles"), icon: User },
          { id: "content-social" as SettingsTab, label: gt("Content & Social"), icon: MessageSquare },
          { id: "data-privacy" as SettingsTab, label: gt("Data & Privacy"), icon: Lock },
          { id: "authorized-apps" as SettingsTab, label: gt("Authorized Apps"), icon: Plug },
          { id: "devices" as SettingsTab, label: gt("Devices"), icon: Smartphone },
          { id: "connections" as SettingsTab, label: gt("Connections"), icon: Link2 },
          { id: "bug-reports" as SettingsTab, label: gt("Feedback & Bugs"), icon: MessageSquareHeart },
        ],
      },
      {
        title: gt("Billing Settings"),
        items: [
          { id: "premium" as SettingsTab, label: gt("Serika+"), icon: Crown },
        ],
      },
      {
        title: gt("App Settings"),
        items: [
          { id: "appearance" as SettingsTab, label: gt("Appearance"), icon: Palette },
          { id: "accessibility" as SettingsTab, label: gt("Accessibility"), icon: Accessibility },
          { id: "voice-video" as SettingsTab, label: gt("Voice & Video"), icon: Mic },
          { id: "text-images" as SettingsTab, label: gt("Text & Images"), icon: Image },
          { id: "notifications" as SettingsTab, label: gt("Notifications"), icon: Bell },
          { id: "keybinds" as SettingsTab, label: gt("Keybinds"), icon: Keyboard },
          { id: "language" as SettingsTab, label: gt("Language"), icon: Languages },
          { id: "advanced" as SettingsTab, label: gt("Advanced"), icon: Settings },
        ],
      },
    ];

    if (isStaff) {
      sections.push({
        title: gt("Admin — Users"),
        items: [
          { id: "admin-users" as SettingsTab, label: gt("User Management"), icon: Users },
          { id: "admin-badges" as SettingsTab, label: gt("Badge Management"), icon: Award },
        ],
      });
      sections.push({
        title: gt("Admin — Platform"),
        items: [
          { id: "admin-stats" as SettingsTab, label: gt("Statistics"), icon: BarChart3 },
          { id: "admin-servers" as SettingsTab, label: gt("Server Management"), icon: Database },
          { id: "admin-announcements" as SettingsTab, label: gt("Announcements"), icon: Megaphone },
          { id: "admin-settings" as SettingsTab, label: gt("Platform Settings"), icon: Settings },
        ],
      });
      sections.push({
        title: gt("Admin — System"),
        items: [
          { id: "admin-logs" as SettingsTab, label: gt("Activity Logs"), icon: Activity },
          { id: "admin-experiments" as SettingsTab, label: gt("Experiments"), icon: FlaskConical },
          { id: "admin-tts-sounds" as SettingsTab, label: gt("TTS Sounds"), icon: Volume2 },
          { id: "admin-tts-voices" as SettingsTab, label: gt("TTS Voices"), icon: Mic2 },
          { id: "admin-translations" as SettingsTab, label: gt("Translations"), icon: Languages },
          { id: "admin-bug-reports" as SettingsTab, label: gt("Bug Reports"), icon: ShieldAlert },
        ],
      });
    }
    return sections;
  }, [gt, isStaff]);

  // Filter menu items based on search — only recompute when the query or the
  // (memoized) menu actually changes.
  const filteredSections = useMemo(() => (
    searchQuery
      ? menuSections.map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter(section => section.items.length > 0)
      : menuSections
  ), [menuSections, searchQuery]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="h-full flex flex-col md:flex-row">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{gt("Settings")}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar */}
        <div className="hidden md:flex w-56 lg:w-64 bg-[var(--bg-sidebar)] flex-col border-r border-[var(--border-subtle)] h-full overflow-hidden">
          {/* User Header */}
          <div className="p-4 border-b border-[var(--border-subtle)] flex-shrink-0">
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={cdnImage(user?.avatar)} />
                <AvatarFallback className="bg-[#8B5CF6] text-[var(--text-on-accent)]">
                  {user?.displayName?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[var(--text-primary)] truncate text-sm">
                  {user?.displayName || user?.username}
                </h3>
                <button
                  onClick={() => setActiveTab("profiles")}
                  className="text-xs text-[var(--text-secondary)] hover:text-[#8B5CF6] flex items-center gap-1 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  {gt("Edit Profiles")}
                </button>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="p-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555555]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={gt("Search")}
                className="pl-9 h-8 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] text-sm placeholder:text-[#555555]"
              />
            </div>
          </div>

          {/* Menu */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 pb-4">
              {filteredSections.map((section, i) => (
                <div key={i} className="mb-2">
                  <h3 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase px-2.5 py-2 tracking-wide">
                    {section.title}
                  </h3>
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2.5 py-1.5 rounded text-sm transition-colors mb-0.5",
                        activeTab === item.id
                          ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}

              <div className="h-px bg-[var(--border-subtle)] my-2 mx-2" />

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-2.5 py-1.5 rounded text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                {gt("Log Out")}
              </button>
            </div>
          </ScrollArea>
        </div>

        {/* Mobile Tab Navigation */}
        <div className="md:hidden overflow-x-auto border-b border-[var(--border-subtle)]">
          <div className="flex px-4 py-2 gap-2">
            {menuSections.flatMap(s => s.items).slice(0, 6).map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                  activeTab === item.id
                    ? "bg-[#8B5CF6] text-white"
                    : "bg-[var(--bg-card)] text-[var(--text-secondary)]"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-[var(--bg-card)] relative flex flex-col overflow-hidden">
          {/* Desktop Close Button */}
          <button
            onClick={() => onOpenChange(false)}
            className="hidden md:flex absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <ScrollArea className="flex-1 h-full [&_[data-radix-scroll-area-viewport]]:!overflow-y-scroll [&_[data-radix-scroll-area-scrollbar]]:!flex">
            <div className={cn("py-6 px-4 md:py-10 md:px-10 mx-auto pb-24", (activeTab.startsWith("admin-") || activeTab === "profiles") ? "max-w-[1100px]" : "max-w-[740px]")}>
              {/* Admin Logs Tab — rendered in the admin section below */}


              {/* Profiles Tab */}
              {activeTab === "profiles" && (
                <div>
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">{gt("Profiles")}</h2>
                  <p className="text-sm text-[var(--text-muted)] mb-5">{gt("Customize how others see you across SerikaCord")}</p>

                  {/* Tabs */}
                  <div className="flex gap-1 p-1 bg-[var(--bg-app)] rounded-lg w-fit mb-8 relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (!hasChanges) {
                          setProfileTab("main");
                        } else {
                          toast.error(gt("Please save or reset your changes first."));
                        }
                      }}
                      className={cn(
                        "relative px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 z-10",
                        profileTab === "main"
                          ? "text-white font-semibold"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      {profileTab === "main" && (
                        <motion.div
                          layoutId="activeProfileTab"
                          className="absolute inset-0 bg-[var(--app-accent)] rounded-md -z-10 shadow-sm"
                          transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        />
                      )}
                      {gt("Main Profile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!hasChanges) {
                          setProfileTab("server");
                        } else {
                          toast.error(gt("Please save or reset your changes first."));
                        }
                      }}
                      className={cn(
                        "relative px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 z-10",
                        profileTab === "server"
                          ? "text-white font-semibold"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      {profileTab === "server" && (
                        <motion.div
                          layoutId="activeProfileTab"
                          className="absolute inset-0 bg-[var(--app-accent)] rounded-md -z-10 shadow-sm"
                          transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        />
                      )}
                      {gt("Per-server Profiles")}
                    </button>
                  </div>

                  {/* Profile Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-6 md:gap-8">
                    <div>
                      <AnimatePresence mode="wait">
                        {profileTab === "main" ? (
                          <motion.div
                            key="main-profile"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                          >
                          {/* Avatar & Banner Section */}
                          <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5">
                            <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider mb-4">{gt("Avatar & Banner")}</h3>
                            <div className="flex gap-5 items-start">
                              <div>
                                <div
                                  onClick={() => avatarInputRef.current?.click()}
                                  className="relative w-[72px] h-[72px] rounded-full bg-[var(--bg-sidebar-elevated)] border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] cursor-pointer transition-all group overflow-hidden"
                                >
                                  {user?.avatar ? (
                                    <img src={cdnImage(user.avatar)} alt={gt("Avatar")} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                                      <Camera className="w-5 h-5" />
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    {isUploadingAvatar ? (
                                      <Loader size={20} />
                                    ) : (
                                      <Camera className="w-5 h-5 text-white" />
                                    )}
                                  </div>
                                </div>
                                <input
                                  ref={avatarInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={handleAvatarSelect}
                                />
                              </div>
                              <div className="flex-1">
                                <div
                                  onClick={() => bannerInputRef.current?.click()}
                                  className="relative w-full h-[72px] rounded-lg bg-[var(--bg-sidebar-elevated)] border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] cursor-pointer transition-all group overflow-hidden"
                                >
                                  {user?.banner ? (
                                    <img src={cdnImage(user.banner)} alt={gt("Banner")} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                                      <Image className="w-5 h-5" />
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    {isUploadingBanner ? (
                                      <Loader size={20} />
                                    ) : (
                                      <Camera className="w-5 h-5 text-white" />
                                    )}
                                  </div>
                                </div>
                                <input
                                  ref={bannerInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={handleBannerSelect}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Basic Info Section */}
                          <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                            <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Basic Info")}</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                  {gt("Display Name")}
                                </label>
                                <Input
                                  value={displayName}
                                  onChange={(e) => setDisplayName(e.target.value)}
                                  className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-10"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                  {gt("Pronouns")}
                                </label>
                                <Input
                                  value={pronouns}
                                  onChange={(e) => setPronouns(e.target.value)}
                                  className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-10"
                                  placeholder={gt("Add your pronouns")}
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                {gt("Timezone")}
                              </label>
                              <select
                                value={timezone}
                                onChange={(e) => setTimezone(e.target.value)}
                                className="w-full h-10 rounded-md bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                              >
                                <option value="">{gt("Select your timezone")}</option>
                                {Intl.supportedValuesOf("timeZone").map((tz) => (
                                  <option key={tz} value={tz}>{tz}</option>
                                ))}
                              </select>
                              <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={showTimezone}
                                  onChange={(e) => setShowTimezone(e.target.checked)}
                                  className="w-4 h-4 rounded accent-[var(--app-accent)]"
                                />
                                <span className="text-sm text-[var(--text-secondary)]">{gt("Display my current time on my profile")}</span>
                              </label>
                            </div>
                          </div>

                          {/* About & Status Section */}
                          <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                            <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("About & Status")}</h3>
                            <div>
                              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                {gt("About Me")}
                              </label>
                              <Textarea
                                value={bio}
                                onChange={(e) => setBio(e.target.value)}
                                className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] min-h-[100px] resize-y"
                                maxLength={1000}
                              />
                              <p className="text-xs text-[var(--text-muted)] text-right mt-1">{bio.length}/1000</p>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                {gt("Custom Status")}
                              </label>
                              <Input
                                value={customStatus}
                                onChange={(e) => setCustomStatus(e.target.value)}
                                className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-10"
                                placeholder={gt("What's on your mind?")}
                                maxLength={128}
                              />
                            </div>
                          </div>

                          {/* Display Name Style */}
                          <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5">
                            <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider mb-4">{gt("Display Name Style")}</h3>
                            <div className="space-y-6">
                                {/* Font */}
                                <div className="mb-6">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[14px] font-bold text-[var(--text-primary)]">{gt("Choose Font")}</span>
                                    <button onClick={() => setDisplayNameStyle((s) => ({ ...s, font: 'default' }))} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title={gt("Reset Font")}><RotateCcw className="w-4 h-4" /></button>
                                  </div>
                                  <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
                                    {([
                                      { value: 'default', label: gt("Default") },
                                      { value: 'serif', label: gt("Serif") },
                                      { value: 'mono', label: gt("Mono") },
                                      { value: 'rounded', label: gt("Rounded") },
                                      { value: 'cursive', label: gt("Cursive") },
                                      { value: 'bold', label: gt("Bold") },
                                    ] as const).map((font) => {
                                      const isSelected = displayNameStyle.font === font.value;
                                      return (
                                        <button
                                          key={font.value}
                                          onClick={() => setDisplayNameStyle((s) => ({ ...s, font: font.value }))}
                                          className={cn(
                                            "h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border-2",
                                            isSelected
                                              ? "border-[var(--app-accent)] bg-[var(--bg-sidebar-elevated)] text-[var(--text-primary)]"
                                              : "border-transparent bg-[var(--bg-sidebar)] text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
                                          )}
                                        >
                                          <span
                                            className={cn(
                                              "text-[18px] leading-none",
                                              getDisplayNameStyleClasses({ font: font.value })
                                            )}
                                            style={getDisplayNameStyleInline({ font: font.value })}
                                          >
                                            {font.label}
                                          </span>
                                          <span className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wide">
                                            Aa
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Effect */}
                                <div className="mb-6">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[14px] font-bold text-[var(--text-primary)]">{gt("Choose Effect")}</span>
                                    <button onClick={() => setDisplayNameStyle((s) => ({ ...s, effect: 'solid' }))} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title={gt("Reset Effect")}><RotateCcw className="w-4 h-4" /></button>
                                  </div>
                                  <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
                                    {([
                                      { value: 'solid', label: gt("Solid") },
                                      { value: 'gradient', label: gt("Gradient") },
                                      { value: 'neon', label: gt("Neon") },
                                      { value: 'toon', label: gt("Toon") },
                                      { value: 'pop', label: gt("Pop") },
                                    ] as const).map((effect) => (
                                      <button
                                        key={effect.value}
                                        onClick={() => setDisplayNameStyle((s) => ({ ...s, effect: effect.value }))}
                                        className={cn(
                                          "h-[52px] rounded-lg flex items-center justify-center text-[15px] font-medium transition-all border-2",
                                          displayNameStyle.effect === effect.value
                                            ? "border-[var(--app-accent)] bg-[var(--bg-sidebar-elevated)]"
                                            : "border-transparent bg-[var(--bg-sidebar)] text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
                                        )}
                                      >
                                        <span
                                          className={cn(
                                            "truncate px-2",
                                            getDisplayNameStyleClasses({ effect: effect.value, color: effect.value !== 'gradient' ? displayNameStyle.color : undefined, gradient: effect.value === 'gradient' ? displayNameStyle.gradient : undefined })
                                          )}
                                          style={getDisplayNameStyleInline({ effect: effect.value, color: displayNameStyle.color || '#fff', gradient: displayNameStyle.gradient?.length ? displayNameStyle.gradient : ['#8B5CF6', '#3B82F6'] })}
                                        >
                                          {effect.label}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Colour */}
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[14px] font-bold text-[var(--text-primary)]">{gt("Choose Colour")}</span>
                                    <button onClick={() => setDisplayNameStyle((s) => ({ ...s, color: '', gradient: [] }))} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title={gt("Reset Colour")}><RotateCcw className="w-4 h-4" /></button>
                                  </div>
                                  {displayNameStyle.effect === 'gradient' ? (
                                    <div className="space-y-3">
                                      {/* Custom gradient bar */}
                                      {(() => {
                                        const g0 = displayNameStyle.gradient?.[0] || '#8B5CF6';
                                        const g1 = displayNameStyle.gradient?.[1] || '#EC4899';
                                        return (
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0">{gt("Custom")}</span>
                                            <div className="flex items-center justify-between flex-1 rounded-lg h-10 px-2.5" style={{ background: `linear-gradient(90deg, ${g0}, ${g1})` }}>
                                              <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g0 }}>
                                                <input type="color" value={g0} onChange={(e) => setDisplayNameStyle((s) => ({ ...s, gradient: [e.target.value, s.gradient?.[1] || '#EC4899'] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                              </label>
                                              <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g1 }}>
                                                <input type="color" value={g1} onChange={(e) => setDisplayNameStyle((s) => ({ ...s, gradient: [s.gradient?.[0] || '#8B5CF6', e.target.value] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                              </label>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                      {/* Gradient presets */}
                                      <div className="flex flex-wrap gap-2.5">
                                        {[
                                          ['#FF3366', '#FFD12A'], ['#00E676', '#00B0FF'], ['#D500F9', '#FF1744'], ['#1DE9B6', '#3D5AFE'],
                                          ['#FF4081', '#E040FB'], ['#2979FF', '#00E5FF'], ['#7C4DFF', '#E040FB'], ['#F50057', '#FF3366'],
                                          ['#FF9800', '#FF5722'], ['#4CAF50', '#8BC34A'], ['#9C27B0', '#673AB7'], ['#3F51B5', '#2196F3'],
                                          ['#00BCD4', '#009688'], ['#CDDC39', '#FFEB3B'], ['#FFC107', '#FF5722']
                                        ].map((grad, i) => {
                                          const isSelected = JSON.stringify(displayNameStyle.gradient) === JSON.stringify(grad);
                                          return (
                                            <button
                                              key={i}
                                              onClick={() => setDisplayNameStyle((s) => ({ ...s, gradient: grad }))}
                                              className="w-8 h-8 rounded-full transition-all relative overflow-hidden ring-2"
                                              style={{ background: `linear-gradient(135deg, ${grad.join(', ')})`, boxShadow: isSelected ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)' : 'none', outline: isSelected ? '2px solid var(--app-accent)' : 'none', outlineOffset: 1 }}
                                            >
                                              {isSelected && (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                  <Check className="w-3.5 h-3.5 text-white drop-shadow-md" />
                                                </div>
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap gap-2.5">
                                      {/* Custom Colour Picker */}
                                      <label className="relative w-8 h-8 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40 transition-all" style={{ backgroundColor: displayNameStyle.color || '#8B5CF6' }}>
                                        <input
                                          type="color"
                                          value={displayNameStyle.color || '#8B5CF6'}
                                          onChange={(e) => setDisplayNameStyle((s) => ({ ...s, color: e.target.value }))}
                                          className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                          <Pencil className="w-3.5 h-3.5 text-white drop-shadow-md" />
                                        </div>
                                      </label>
                                      <div className="w-px h-8 bg-[var(--border-subtle)] mx-1" />
                                      {[
                                        '#F43F5E', '#EAB308', '#22C55E', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
                                        '#D946EF', '#FF1744', '#00E676', '#00B0FF', '#D500F9', '#FF9800', '#9C27B0'
                                      ].map((col, i) => {
                                        const isSelected = displayNameStyle.color === col;
                                        return (
                                          <button
                                            key={i}
                                            onClick={() => setDisplayNameStyle((s) => ({ ...s, color: col }))}
                                            className="w-8 h-8 rounded-full transition-all relative ring-2"
                                            style={{ backgroundColor: col, boxShadow: isSelected ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)' : 'none', outline: isSelected ? '2px solid var(--app-accent)' : 'none', outlineOffset: 1 }}
                                          >
                                            {isSelected && (
                                              <div className="absolute inset-0 flex items-center justify-center">
                                                <Check className="w-3.5 h-3.5 text-white drop-shadow-md" />
                                              </div>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Nameplate */}
                            <div className="mt-8">
                              <h2 className="text-[16px] font-bold text-[var(--text-primary)] mb-1">{gt("Nameplate")}</h2>
                              <p className="text-xs text-[var(--text-muted)] mb-3">{gt("A decorative plate shown behind your name in the member list, DMs, and your sidebar panel.")}</p>
                              <div className="bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
                                {/* Live preview — mirrors the sidebar user panel */}
                                <div className="relative rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
                                  {getNameplateBackground({ nameplate }) && (
                                    <div className="absolute inset-0" style={{ background: getNameplateBackground({ nameplate })!, opacity: 0.55, WebkitMaskImage: 'linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)', maskImage: 'linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)' }} />
                                  )}
                                  <div className="relative flex items-center gap-2 px-2 py-2">
                                    <img src={cdnImage(user?.avatar || undefined)} alt="" className="w-8 h-8 rounded-full object-cover bg-[var(--bg-sidebar-elevated)] shrink-0" />
                                    <span
                                      className={cn("text-sm font-bold text-[var(--text-primary)] truncate", getDisplayNameStyleClasses(displayNameStyle))}
                                      style={getDisplayNameStyleInline(displayNameStyle)}
                                    >
                                      {displayName || user?.username || gt("Your name")}
                                    </span>
                                  </div>
                                </div>

                                {/* Type selector — segmented */}
                                <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                                  {([
                                    { id: 'none', label: gt("None") },
                                    { id: 'color', label: gt("Solid") },
                                    { id: 'gradient', label: gt("Gradient") },
                                    { id: 'preset', label: gt("Presets") },
                                  ] as const).map((opt) => (
                                    <button
                                      key={opt.id}
                                      onClick={() => setNameplate((n) => ({ ...n, type: opt.id }))}
                                      className={cn(
                                        "flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors",
                                        (nameplate.type || 'none') === opt.id
                                          ? "bg-[var(--app-accent)] text-white"
                                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                      )}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>

                                {/* Solid colour swatches */}
                                {nameplate.type === 'color' && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {['#F43F5E', '#EAB308', '#22C55E', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#D946EF', '#FF9800', '#9C27B0', '#434343'].map((col) => {
                                      const on = nameplate.color === col;
                                      return (
                                        <button
                                          key={col}
                                          onClick={() => setNameplate((n) => ({ ...n, type: 'color', color: col }))}
                                          className="w-7 h-7 rounded-full relative transition-all"
                                          style={{ backgroundColor: col, boxShadow: on ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)' : 'none' }}
                                        >
                                          {on && <Check className="w-3 h-3 text-white absolute inset-0 m-auto drop-shadow-md" />}
                                        </button>
                                      );
                                    })}
                                    <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40" style={{ backgroundColor: nameplate.color || '#8B5CF6' }}>
                                      <input type="color" value={nameplate.color || '#8B5CF6'} onChange={(e) => setNameplate((n) => ({ ...n, type: 'color', color: e.target.value }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                      <Pencil className="w-3 h-3 text-white absolute inset-0 m-auto drop-shadow-md pointer-events-none" />
                                    </label>
                                  </div>
                                )}

                                {/* Gradient — custom two-colour pickers + presets */}
                                {nameplate.type === 'gradient' && (() => {
                                  const g0 = nameplate.gradient?.[0] || '#8B5CF6';
                                  const g1 = nameplate.gradient?.[1] || '#EC4899';
                                  return (
                                    <div className="space-y-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0">{gt("Custom")}</span>
                                        <div className="flex items-center justify-between flex-1 rounded-md h-9 px-2" style={{ background: `linear-gradient(90deg, ${g0}, ${g1})` }}>
                                          <label className="relative w-6 h-6 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g0 }}>
                                            <input type="color" value={g0} onChange={(e) => setNameplate((n) => ({ ...n, type: 'gradient', gradient: [e.target.value, g1] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                          </label>
                                          <label className="relative w-6 h-6 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g1 }}>
                                            <input type="color" value={g1} onChange={(e) => setNameplate((n) => ({ ...n, type: 'gradient', gradient: [g0, e.target.value] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                          </label>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {[
                                          ['#FF3366', '#FFD12A'], ['#00E676', '#00B0FF'], ['#D500F9', '#FF1744'], ['#1DE9B6', '#3D5AFE'],
                                          ['#FF4081', '#E040FB'], ['#2979FF', '#00E5FF'], ['#7C4DFF', '#E040FB'], ['#FF9800', '#FF5722'],
                                          ['#4CAF50', '#8BC34A'], ['#9C27B0', '#673AB7'], ['#00BCD4', '#009688'], ['#434343', '#000000'],
                                        ].map((grad, i) => {
                                          const on = JSON.stringify(nameplate.gradient) === JSON.stringify(grad);
                                          return (
                                            <button
                                              key={i}
                                              onClick={() => setNameplate((n) => ({ ...n, type: 'gradient', gradient: grad }))}
                                              className="w-9 h-7 rounded-md relative transition-all"
                                              style={{ background: `linear-gradient(90deg, ${grad.join(', ')})`, boxShadow: on ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)' : 'none' }}
                                            >
                                              {on && <Check className="w-3 h-3 text-white absolute inset-0 m-auto drop-shadow-md" />}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })()}

                                {/* Preset gallery */}
                                {nameplate.type === 'preset' && (
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {NAMEPLATE_PRESETS.map((preset) => {
                                      const on = nameplate.presetId === preset.id;
                                      return (
                                        <button
                                          key={preset.id}
                                          onClick={() => setNameplate((n) => ({ ...n, type: 'preset', presetId: preset.id }))}
                                          className={cn(
                                            "relative h-9 rounded-md overflow-hidden border transition-all flex items-center px-2.5",
                                            on ? "border-[var(--app-accent)] ring-2 ring-[var(--app-accent)]" : "border-[var(--border-subtle)]"
                                          )}
                                        >
                                          <div className="absolute inset-0" style={{ background: preset.css, opacity: 0.55 }} />
                                          <span className="relative text-[11px] font-semibold text-white drop-shadow-md truncate">{preset.name}</span>
                                          {on && <Check className="w-3.5 h-3.5 text-white absolute right-1.5 top-1/2 -translate-y-1/2 drop-shadow-md" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Profile Colour */}
                            <div className="mt-8">
                              <h2 className="text-[16px] font-bold text-[var(--text-primary)] mb-4">{gt("Profile Colour")}</h2>
                              <div className="bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)] p-5">
                                {/* Colour */}
                                <div className="mb-6">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[14px] font-bold text-[var(--text-primary)]">{gt("Choose Colour")}</span>
                                    <button onClick={() => setProfileColor('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title={gt("Reset Colour")}><RotateCcw className="w-4 h-4" /></button>
                                  </div>
                                  <div className="flex flex-wrap gap-2.5">
                                    <label className="relative w-8 h-8 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40 transition-all" style={{ backgroundColor: profileColor || '#8B5CF6' }}>
                                      <input type="color" value={profileColor || '#8B5CF6'} onChange={(e) => setProfileColor(e.target.value)} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Pencil className="w-3.5 h-3.5 text-white drop-shadow-md" /></div>
                                    </label>
                                    <div className="w-px h-8 bg-[var(--border-subtle)] mx-1" />
                                    {[
                                      '#F43F5E', '#EAB308', '#22C55E', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
                                      '#D946EF', '#FF1744', '#00E676', '#00B0FF', '#D500F9', '#FF9800', '#9C27B0'
                                    ].map((col, i) => {
                                      const isSelected = profileColor === col;
                                      return (
                                        <button key={i} onClick={() => setProfileColor(col)} className="w-8 h-8 rounded-full transition-all relative" style={{ backgroundColor: col, boxShadow: isSelected ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)' : 'none', outline: isSelected ? '2px solid var(--app-accent)' : 'none', outlineOffset: 1 }}>
                                          {isSelected && <div className="absolute inset-0 flex items-center justify-center"><Check className="w-3.5 h-3.5 text-white drop-shadow-md" /></div>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                {/* Gradient Background */}
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[14px] font-bold text-[var(--text-primary)]">{gt("Gradient Background (Optional)")}</span>
                                    <button onClick={() => setProfileGradient([])} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title={gt("Reset Gradient")}><RotateCcw className="w-4 h-4" /></button>
                                  </div>
                                  <div className="flex flex-wrap gap-2.5 mb-4">
                                    {[
                                      ['#FF3366', '#FFD12A'], ['#00E676', '#00B0FF'], ['#D500F9', '#FF1744'], ['#1DE9B6', '#3D5AFE'],
                                      ['#FF4081', '#E040FB'], ['#2979FF', '#00E5FF'], ['#7C4DFF', '#E040FB'], ['#F50057', '#FF3366'],
                                      ['#FF9800', '#FF5722'], ['#4CAF50', '#8BC34A'], ['#9C27B0', '#673AB7'], ['#3F51B5', '#2196F3'],
                                      ['#00BCD4', '#009688'], ['#CDDC39', '#FFEB3B'], ['#FFC107', '#FF5722']
                                    ].map((grad, i) => {
                                      const isSelected = JSON.stringify(profileGradient) === JSON.stringify(grad);
                                      return (
                                        <button key={i} onClick={() => setProfileGradient(grad)} className="w-8 h-8 rounded-full transition-all relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${grad.join(', ')})`, boxShadow: isSelected ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--app-accent)' : 'none', outline: isSelected ? '2px solid var(--app-accent)' : 'none', outlineOffset: 1 }}>
                                          {isSelected && <div className="absolute inset-0 flex items-center justify-center"><Check className="w-3.5 h-3.5 text-white drop-shadow-md" /></div>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {/* Custom two-colour gradient */}
                                  {(() => {
                                    const g0 = profileGradient?.[0] || '#8B5CF6';
                                    const g1 = profileGradient?.[1] || '#EC4899';
                                    return (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0">{gt("Custom")}</span>
                                        <div className="flex items-center justify-between flex-1 rounded-lg h-10 px-2.5" style={{ background: `linear-gradient(135deg, ${g0}, ${g1})` }}>
                                          <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g0 }}>
                                            <input type="color" value={g0} onChange={(e) => setProfileGradient([e.target.value, g1])} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                          </label>
                                          <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g1 }}>
                                            <input type="color" value={g1} onChange={(e) => setProfileGradient([g0, e.target.value])} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                                          </label>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        ) : (
                        <motion.div
                          key="server-profile"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-6"
                        >
                          {/* Server Dropdown Selector */}
                          <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5">
                            <div className="flex items-center justify-between mb-2">
                              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase">
                                {gt("Select Server")}
                              </label>
                              {hasChanges && (
                                <span className="text-xs text-amber-500 font-medium animate-pulse">
                                  {gt("Save changes before switching servers")}
                                </span>
                              )}
                            </div>
                            <select
                              value={selectedServerId}
                              onChange={(e) => setSelectedServerId(e.target.value)}
                              disabled={hasChanges}
                              className="w-full bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] h-10 px-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {servers.map((srv: any) => (
                                <option key={srv.id} value={srv.id}>
                                  {srv.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          {serverMemberLoading ? (
                            <div className="py-8 flex flex-col items-center justify-center text-[var(--text-secondary)]">
                              <Loader size={32} className="mb-2" />
                              <span className="text-sm font-medium">{gt("Loading server profile...")}</span>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {/* Nickname & Avatar Card */}
                              <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                                <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Server Identity")}</h3>
                                <div>
                                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                    {gt("Server Nickname")}
                                  </label>
                                  <Input
                                    value={serverNickname}
                                    onChange={(e) => setServerNickname(e.target.value)}
                                    className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-10"
                                    placeholder={displayName || user?.username || ""}
                                    maxLength={32}
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                                    {gt("Server Avatar Override")}
                                  </label>
                                  <div className="flex items-center gap-4">
                                    <div
                                      onClick={() => avatarInputRef.current?.click()}
                                      className="relative w-16 h-16 rounded-full bg-[var(--bg-sidebar-elevated)] border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] cursor-pointer transition-all group overflow-hidden"
                                    >
                                      {serverAvatar || user?.avatar ? (
                                        <img src={cdnImage(serverAvatar || user?.avatar)} alt={gt("Avatar")} className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                                          <Camera className="w-5 h-5" />
                                        </div>
                                      )}
                                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        {isUploadingAvatar ? (
                                          <Loader size={20} />
                                        ) : (
                                          <Camera className="w-5 h-5 text-white" />
                                        )}
                                      </div>
                                    </div>
                                    {serverAvatar && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setServerAvatar(null);
                                        }}
                                        className="text-xs text-red-400 hover:text-red-300 hover:underline font-medium transition-colors"
                                      >
                                        {gt("Reset to Global")}
                                      </button>
                                    )}
                                  </div>
                                  <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleAvatarSelect}
                                  />
                                </div>
                              </div>

                              {/* Server Banner override card */}
                              <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                                <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Server Banner Override")}</h3>
                                <div className="flex flex-col gap-2.5">
                                  <div
                                    onClick={() => bannerInputRef.current?.click()}
                                    className="relative w-full h-[72px] rounded-lg bg-[var(--bg-sidebar-elevated)] border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] cursor-pointer transition-all group overflow-hidden"
                                  >
                                    {serverBanner || user?.banner ? (
                                      <img src={cdnImage(serverBanner || user?.banner)} alt={gt("Banner")} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                                        <Image className="w-5 h-5" />
                                      </div>
                                    )}
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      {isUploadingBanner ? (
                                        <Loader size={20} />
                                      ) : (
                                        <Camera className="w-5 h-5 text-white" />
                                      )}
                                    </div>
                                  </div>
                                  {serverBanner && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setServerBanner(null);
                                      }}
                                      className="text-xs text-red-400 hover:text-red-300 hover:underline font-medium transition-colors self-start"
                                    >
                                      {gt("Reset to Global")}
                                    </button>
                                  )}
                                </div>
                                <input
                                  ref={bannerInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={handleBannerSelect}
                                />
                              </div>

                              <div className="p-4 bg-[var(--bg-sidebar)] rounded-xl border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
                                <p className="font-semibold text-[var(--text-primary)]">{gt("About Server Profiles")}</p>
                                <p>{gt("Custom nickname, avatar overrides, and banners apply only to the selected server.")}</p>
                                <p>{gt("Global attributes (about me, custom status, and name styles) will fall back to your main profile settings.")}</p>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                      </AnimatePresence>
                    </div>

                    {/* Preview */}
                    <div className="md:sticky md:top-5 self-start">
                      <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase mb-3">{gt("Preview")}</h3>
                      <ProfileCard
                        user={previewUser}
                        isCurrentUser={true}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Premium Tab */}
              {activeTab === "premium" && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5">{gt("Serika+")}</h2>
                  {user?.isPremium ? (
                    <div className="bg-gradient-to-r from-[#8B5CF6]/20 to-[#6366F1]/20 rounded-lg p-6 border border-[#8B5CF6]/30">
                      <div className="flex items-center gap-3 mb-4">
                        <Crown className="w-10 h-10 text-[#8B5CF6]" />
                        <div>
                          <h3 className="text-lg font-bold text-white">{gt("You have Serika+!")}</h3>
                          <p className="text-sm text-[var(--text-secondary)]">
                            {gt("Member since")}{" "}
                            {user.premiumSince
                              ? new Date(user.premiumSince).toLocaleDateString()
                              : gt("Unknown")}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-6">
                        <div className="bg-[var(--bg-app)] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ {gt("Custom profile themes")}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ {gt("Animated avatars")}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ {gt("Extended file uploads")}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] p-4 rounded-lg">
                          <p className="text-sm text-[#8B5CF6] font-medium">✓ {gt("Exclusive badge")}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
                      <Crown className="w-16 h-16 text-[#8B5CF6] mx-auto mb-4" />
                      <h3 className="text-2xl font-bold text-white mb-2">{gt("Upgrade to Serika+")}</h3>
                      <p className="text-[var(--text-secondary)] max-w-md mx-auto mb-6">
                        {gt("Get exclusive features like animated avatars, custom themes, enhanced upload limits, and more.")}
                      </p>
                      <a
                        href="https://accounts.serika.dev"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-md transition-colors"
                      >
                        {gt("Subscribe to Serika+")}
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === "appearance" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">{gt("Appearance")}</h2>

                  {userSettings && (
                    <div className="rounded-lg p-5 space-y-4 border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                      <div>
                        <label className="block text-sm text-[var(--text-secondary)] mb-2">{gt("Theme style")}</label>
                        <select
                          value={userSettings.appearance?.theme || userSettings.appearance?.themeStyle || themeSettings.theme || "dark"}
                          onChange={(e) => saveAppearancePatch({ theme: e.target.value })}
                          className="w-full rounded-md px-3 py-2 bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                        >
                          <option value="dark">{gt("Dark")}</option>
                          <option value="midnight">{gt("Midnight")}</option>
                          <option value="light">{gt("Light")}</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--text-primary)]">{gt("Compact mode")}</span>
                        <ToggleSwitch size="sm" checked={Boolean(userSettings.appearance?.compactMode ?? themeSettings.compactMode)} onCheckedChange={(checked) => saveAppearancePatch({ compactMode: checked })} />
                      </div>
                    </div>
                  )}

                  {/* Theme Selection */}
                  <div className="rounded-lg p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                    <h3 className="text-base font-bold text-[var(--text-primary)] mb-4">{gt("Theme")}</h3>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: "dark", label: gt("Dark"), stripA: "#111111", stripB: "#0f0f0f", body: "#0a0a0a" },
                        { id: "midnight", label: gt("Midnight"), stripA: "#0b1020", stripB: "#101728", body: "#050913" },
                        { id: "light", label: gt("Light"), stripA: "#e5e5e5", stripB: "#f0f0f0", body: "#ffffff" },
                      ].map((themeOption) => {
                        const selected = (userSettings?.appearance?.theme || userSettings?.appearance?.themeStyle || themeSettings.theme || "dark") === themeOption.id;
                        return (
                          <button
                            key={themeOption.id}
                            onClick={() => saveAppearancePatch({ theme: themeOption.id })}
                            className={cn(
                              "group p-3 rounded-xl text-left transition-all hover:scale-[1.02] bg-[var(--bg-sidebar-elevated)]",
                              selected ? "border-2 border-[var(--accent-color)]" : "border border-[var(--border-subtle)]"
                            )}
                          >
                            <div className="aspect-video rounded-lg mb-3 overflow-hidden relative" style={{ backgroundColor: themeOption.body }}>
                              <div className="absolute inset-0 flex">
                                <div className="w-3" style={{ backgroundColor: themeOption.stripA }} />
                                <div className="w-6" style={{ backgroundColor: themeOption.stripB }} />
                                <div className="flex-1" style={{ backgroundColor: themeOption.body }} />
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[var(--text-primary)] font-medium text-sm">{themeOption.label}</span>
                              {selected && <Check className="w-4 h-4 text-[var(--accent-color)]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Accent Colour */}
                  <div className="rounded-lg p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                    <h3 className="text-base font-bold text-[var(--text-primary)] mb-2">{gt("Accent Colour")}</h3>
                    <p className="text-sm text-[var(--text-secondary)] mb-4">{gt("Choose your primary accent colour")}</p>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { color: '#8B5CF6', name: gt("Purple") },
                        { color: '#6366F1', name: gt("Indigo") },
                        { color: '#3B82F6', name: gt("Blue") },
                        { color: '#06B6D4', name: gt("Cyan") },
                        { color: '#10B981', name: gt("Emerald") },
                        { color: '#F59E0B', name: gt("Amber") },
                        { color: '#EF4444', name: gt("Red") },
                        { color: '#EC4899', name: gt("Pink") },
                      ].map((c) => (
                        <button
                          key={c.color}
                          onClick={() => saveAppearancePatch({ accentColor: c.color })}
                          className={cn(
                            "w-10 h-10 rounded-full transition-all hover:scale-110 relative",
                            c.color.toLowerCase() === (userSettings?.appearance?.accentColor || themeSettings.accentColor || '#8B5CF6').toLowerCase() &&
                            "ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-card)]",
                            c.color.toLowerCase() === "#ffffff" && "border border-[var(--border-subtle)]"
                          )}
                          style={{ backgroundColor: c.color }}
                          title={c.name}
                        >
                          {c.color.toLowerCase() === (userSettings?.appearance?.accentColor || themeSettings.accentColor || '#8B5CF6').toLowerCase() && (
                            <Check className="w-5 h-5 text-white absolute inset-0 m-auto" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="bg-[var(--bg-app)] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-2">{gt("Chat Font Size")}</h3>
                    <p className="text-sm text-[var(--text-secondary)] mb-4">{gt("Adjust the size of text in chat")}</p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[var(--text-secondary)]">12px</span>
                      <input
                        type="range"
                        min="12"
                        max="20"
                        value={userSettings?.appearance?.fontSize ?? themeSettings.fontSize ?? 14}
                        onChange={(e) => saveAppearancePatch({ fontSize: Number(e.target.value) })}
                        className="flex-1 accent-[var(--accent-color)] h-1 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer"
                      />
                      <span className="text-xs text-[var(--text-secondary)]">20px</span>
                    </div>
                    <p className="text-sm text-[#dcddde] mt-3">
                      {gt("Preview ({size}px): This is how your chat will look.", { size: userSettings?.appearance?.fontSize ?? themeSettings.fontSize ?? 14 })}
                    </p>
                  </div>

                  {/* Saturation */}
                  <div className="bg-[var(--bg-app)] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-2">{gt("Saturation")}</h3>
                    <p className="text-sm text-[var(--text-secondary)] mb-4">{gt("Adjust the colour saturation of the entire app")}</p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[var(--text-secondary)]">0%</span>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={userSettings?.appearance?.saturation ?? themeSettings.saturation ?? 100}
                        onChange={(e) => saveAppearancePatch({ saturation: Number(e.target.value) })}
                        className="flex-1 accent-[var(--accent-color)] h-1 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer"
                      />
                      <span className="text-xs text-[var(--text-secondary)]">200%</span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mt-3 tabular-nums">
                      {userSettings?.appearance?.saturation ?? themeSettings.saturation ?? 100}%
                    </p>
                  </div>

                  {/* Message Display */}
                  <div className="bg-[var(--bg-app)] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-4">{gt("Message Display")}</h3>
                    <div className="space-y-4">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[var(--accent-color)] transition-colors">{gt("Show Timestamps")}</p>
                          <p className="text-sm text-[var(--text-secondary)]">{gt("Display message timestamps")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={Boolean(userSettings?.appearance?.showTimestamps ?? themeSettings.showTimestamps)} onCheckedChange={(checked) => saveAppearancePatch({ showTimestamps: checked })} />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[var(--accent-color)] transition-colors">{gt("Show Role Colours")}</p>
                          <p className="text-sm text-[var(--text-secondary)]">{gt("Colour usernames by their highest role")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={Boolean(userSettings?.appearance?.showRoleColors ?? themeSettings.showRoleColors)} onCheckedChange={(checked) => saveAppearancePatch({ showRoleColors: checked })} />
                      </label>
                    </div>
                  </div>

                  {/* Animations */}
                  <div className="bg-[var(--bg-app)] rounded-lg p-5">
                    <h3 className="text-base font-bold text-white mb-4">{gt("Animations")}</h3>
                    <div className="space-y-4">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[var(--accent-color)] transition-colors">{gt("Enable Animations")}</p>
                          <p className="text-sm text-[var(--text-secondary)]">{gt("Show smooth transitions and animations")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={Boolean(userSettings?.appearance?.enableAnimations ?? themeSettings.enableAnimations)} onCheckedChange={(checked) => saveAppearancePatch({ enableAnimations: checked })} />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-white font-medium group-hover:text-[var(--accent-color)] transition-colors">{gt("Animated Emojis")}</p>
                          <p className="text-sm text-[var(--text-secondary)]">{gt("Play animated emojis automatically")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={Boolean(userSettings?.textImages?.gifAutoplay ?? themeSettings.animatedEmojis)} onCheckedChange={(checked) => {
                            setUserSettings((prev) => ({
                              ...(prev || {}),
                              textImages: { ...(prev?.textImages || {}), gifAutoplay: checked },
                            }));
                            updateSettings({ animatedEmojis: checked });
                            void saveSettingsPatch(
                              { textImages: { ...(userSettings?.textImages || {}), gifAutoplay: checked } },
                              "text-images"
                            );
                          }} />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Voice & Video Tab */}
              {activeTab === "voice-video" && (
                <VoiceVideoTab
                  userSettings={userSettings}
                  isLoadingSettings={isLoadingSettings}
                  saveSettingsPatch={saveSettingsPatch}
                  gt={gt}
                />
              )}

              {/* Notifications Tab */}
              {activeTab === "notifications" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">{gt("Notifications")}</h2>

                  {/* DND / Do Not Disturb */}
                  <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                    <div className="flex items-center gap-2 mb-1">
                      <MinusCircle className="w-4 h-4 text-[var(--text-secondary)]" />
                      <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Do Not Disturb")}</h3>
                    </div>

                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Enable Do Not Disturb")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Suppresses all sounds, desktop notifications, and toasts")}</p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={Boolean(userSettings?.notifications?.dnd)}
                        onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), dnd: checked } }, "notifications")}
                      />
                    </label>

                    {userSettings?.notifications?.dnd && (
                      <div className="ml-0 p-4 rounded-lg bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] space-y-3">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          <p className="text-xs font-semibold text-[var(--text-secondary)]">{gt("Scheduled Quiet Hours")}</p>
                        </div>
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="text-sm text-[var(--text-primary)]">{gt("Enable schedule")}</span>
                          <ToggleSwitch
                            size="sm"
                            checked={Boolean(userSettings?.notifications?.dndSchedule?.enabled)}
                            onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), dndSchedule: { ...(userSettings?.notifications?.dndSchedule || { start: "22:00", end: "08:00" }), enabled: checked } } }, "notifications")}
                          />
                        </label>
                        {userSettings?.notifications?.dndSchedule?.enabled && (
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <label className="text-xs text-[var(--text-muted)]">{gt("Start")}</label>
                              <Input
                                type="time"
                                value={userSettings?.notifications?.dndSchedule?.start || "22:00"}
                                onChange={(e) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), dndSchedule: { ...(userSettings?.notifications?.dndSchedule || { enabled: true, end: "08:00" }), start: e.target.value } } }, "notifications")}
                                className="h-9 bg-[var(--bg-app)] border-[var(--border-subtle)]"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-xs text-[var(--text-muted)]">{gt("End")}</label>
                              <Input
                                type="time"
                                value={userSettings?.notifications?.dndSchedule?.end || "08:00"}
                                onChange={(e) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), dndSchedule: { ...(userSettings?.notifications?.dndSchedule || { enabled: true, start: "22:00" }), end: e.target.value } } }, "notifications")}
                                className="h-9 bg-[var(--bg-app)] border-[var(--border-subtle)]"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Focus Mode */}
                  <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Target className="w-4 h-4 text-[var(--text-secondary)]" />
                      <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Focus Mode")}</h3>
                    </div>
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Enable Focus Mode")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Suppress everything except direct @mentions and DMs")}</p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={Boolean(userSettings?.notifications?.focusMode)}
                        onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), focusMode: checked } }, "notifications")}
                      />
                    </label>
                  </div>

                  {/* Push / Desktop permission */}
                  <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                    <div className="flex items-center gap-2 mb-1">
                      <MonitorSmartphone className="w-4 h-4 text-[var(--text-secondary)]" />
                      <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Desktop Notifications")}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Enable Desktop & Push Notifications")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Receive native notifications on desktop, mobile and browser")}</p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={Boolean(userSettings?.notifications?.desktop)}
                        onCheckedChange={async (checked) => {
                          if (checked) {
                            const granted = await requestNotificationPermission();
                            if (!granted) {
                              toast.error(gt("Notification permission denied. Please enable it in your browser/OS settings."));
                              return;
                            }
                          }
                          saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), desktop: checked } }, "notifications");
                        }}
                      />
                    </div>
                    {userSettings?.notifications?.desktop && typeof Notification !== "undefined" && Notification.permission !== "granted" && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <p className="text-xs text-amber-400">{gt("Browser permission not granted yet.")}</p>
                        <button
                          onClick={async () => {
                            const granted = await requestNotificationPermission();
                            if (granted) toast.success(gt("Notifications enabled!"));
                            else toast.error(gt("Permission denied. Check browser settings."));
                          }}
                          className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline"
                        >
                          {gt("Grant Permission")}
                        </button>
                      </div>
                    )}

                    <div className="h-px bg-[var(--border-subtle)]" />

                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Mentions only")} <span className="ml-1.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--app-accent)]/20 text-[var(--app-accent)]">{gt("Default")}</span></p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Only send desktop notifications when you are mentioned. Turn off to notify on all messages.")}</p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={userSettings?.notifications?.notifyAllMessages !== true}
                        onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), notifyAllMessages: !checked } }, "notifications")}
                      />
                    </label>

                    <div className="h-px bg-[var(--border-subtle)]" />

                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Mute @everyone and @here")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Suppress popup notifications for @everyone and @here pings")}</p>
                      </div>
                      <ToggleSwitch size="sm" checked={Boolean(userSettings?.notifications?.muteEveryone)} onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), muteEveryone: checked } }, "notifications")} />
                    </label>

                    <div className="h-px bg-[var(--border-subtle)]" />

                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Show message preview")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Display message content in desktop notifications")}</p>
                      </div>
                      <ToggleSwitch size="sm" checked={userSettings?.notifications?.showPreview !== false} onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), showPreview: checked } }, "notifications")} />
                    </label>
                  </div>

                  {/* Sound Settings */}
                  <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-5">
                    <div className="flex items-center gap-2 mb-1">
                      <Volume2 className="w-4 h-4 text-[var(--text-secondary)]" />
                      <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Sound")}</h3>
                    </div>

                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Message Sounds")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Play a sound when a new message arrives")}</p>
                      </div>
                      <ToggleSwitch size="sm" checked={Boolean(userSettings?.notifications?.sounds)} onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), sounds: checked } }, "notifications")} />
                    </label>

                    {userSettings?.notifications?.sounds && (
                      <>
                        <div className="h-px bg-[var(--border-subtle)]" />

                        <div className="space-y-2">
                          <label className="text-sm text-[var(--text-primary)] font-medium">{gt("Sound type")}</label>
                          <div className="grid grid-cols-5 gap-2">
                            {([
                              { value: 'chime', label: gt("Chime") },
                              { value: 'ding', label: gt("Ding") },
                              { value: 'pop', label: gt("Pop") },
                              { value: 'coin', label: gt("Coin") },
                              { value: 'none', label: gt("Silent") },
                            ] as const).map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), soundType: opt.value } }, "notifications")}
                                className={cn(
                                  "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                                  (userSettings?.notifications?.soundType || 'chime') === opt.value
                                    ? "bg-[var(--app-accent)]/20 border-[var(--app-accent)] text-[var(--app-accent)]"
                                    : "bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="h-px bg-[var(--border-subtle)]" />

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm text-[var(--text-primary)] font-medium">{gt("Volume")}</label>
                            <span className="text-xs text-[var(--text-muted)] tabular-nums">{userSettings?.notifications?.soundVolume ?? 50}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={userSettings?.notifications?.soundVolume ?? 50}
                            onChange={(e) => {
                              const vol = Number(e.target.value);
                              saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), soundVolume: vol } }, "notifications");
                            }}
                            className="w-full accent-[var(--app-accent)]"
                          />
                        </div>

                        <div className="h-px bg-[var(--border-subtle)]" />

                        <label className="flex items-center justify-between cursor-pointer">
                          <div>
                            <p className="text-[var(--text-primary)] font-medium">{gt("Suppress sound when tab is focused")}</p>
                            <p className="text-sm text-[var(--text-secondary)]">{gt("Don't play notification sound when you're already viewing the app")}</p>
                          </div>
                          <ToggleSwitch
                            size="sm"
                            checked={userSettings?.notifications?.suppressSoundWhenFocused !== false}
                            onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), suppressSoundWhenFocused: checked } }, "notifications")}
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {/* In-App Toasts */}
                  <div className="rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] p-5 space-y-4">
                    <div className="flex items-center gap-2 mb-1">
                      <BellRing className="w-4 h-4 text-[var(--text-secondary)]" />
                      <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("In-App Toasts")}</h3>
                    </div>
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{gt("Suppress in-app toast notifications")}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{gt("Hide the toast popups that appear in-app for new messages")}</p>
                      </div>
                      <ToggleSwitch
                        size="sm"
                        checked={Boolean(userSettings?.notifications?.suppressToasts)}
                        onCheckedChange={(checked) => saveSettingsPatch({ notifications: { ...(userSettings?.notifications || {}), suppressToasts: checked } }, "notifications")}
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Connections tab */}
              {activeTab === "connections" && (
                <ConnectionsTabContent
                  userConnections={userConnections}
                  setUserConnections={setUserConnections}
                  connectingProvider={connectingProvider}
                  setConnectingProvider={setConnectingProvider}
                  connectingValue={connectingValue}
                  setConnectingValue={setConnectingValue}
                  connectionsEnabled={connectionsEnabled}
                  disabledProviders={disabledProviders}
                />
              )}

              {/* Default fallback for other tabs */}
              {!["profiles", "premium", "appearance", "voice-video", "notifications", "admin-users", "admin-servers", "admin-settings", "admin-logs", "admin-experiments", "admin-tts-sounds", "admin-tts-voices", "admin-translations", "admin-badges", "admin-announcements", "connections", "bug-reports", "admin-bug-reports"].includes(activeTab) && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 capitalize">
                    {activeTab.replace(/-/g, " ")}
                  </h2>
                  {isLoadingSettings || !userSettings ? (
                    <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
                      <Loader size={24} className="mx-auto" />
                    </div>
                  ) : activeTab === "authorized-apps" ? (
                    <div className="space-y-2">
                      {authorizedApps.length === 0 ? (
                        <div className="bg-[var(--bg-app)] rounded-lg p-6 text-center text-[var(--text-secondary)] text-sm">
                          {gt("No authorized apps connected.")}
                        </div>
                      ) : authorizedApps.map((app) => (
                        <div key={app.id} className="bg-[var(--bg-app)] rounded-lg p-4 flex items-center justify-between">
                          <div>
                            <p className="text-white font-medium">{app.name}</p>
                            <p className="text-xs text-[var(--text-secondary)]">{app.description || gt("No description")}</p>
                          </div>
                          <button
                            onClick={async () => {
                              const response = await fetch(`/api/users/me/authorized-apps/${app.id}`, { method: "DELETE" });
                              if (response.ok) {
                                setAuthorizedApps((prev) => prev.filter((item) => item.id !== app.id));
                                toast.success(gt("App access revoked"));
                              } else {
                                toast.error(gt("Failed to revoke app"));
                              }
                            }}
                            className="px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          >
                            {gt("Revoke")}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : activeTab === "devices" ? (
                    <div className="space-y-2">
                      {deviceSessions.length === 0 && (
                        <div className="text-center py-8 text-[var(--text-muted)] text-sm">
                          <MonitorSmartphone className="w-10 h-10 mx-auto mb-2 opacity-50" />
                          <T>No active devices. Your sessions will appear here.</T>
                        </div>
                      )}
                      {deviceSessions.map((device) => (
                        <div key={device.id} className={cn(
                          "bg-[var(--bg-app)] rounded-lg p-4 flex items-center justify-between",
                          device.current && "ring-1 ring-[var(--app-accent)]/40"
                        )}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[var(--bg-card)] flex items-center justify-center flex-shrink-0">
                              <MonitorSmartphone className="w-5 h-5 text-[var(--app-accent)]" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-white text-sm font-medium">{device.deviceName}</p>
                                {device.current && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--app-accent)]/20 text-[var(--app-accent)]">
                                    <T>Current</T>
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[var(--text-secondary)]">
                                {device.platform} · {new Date(device.lastActiveAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          {!device.current && (
                            <button
                              onClick={async () => {
                                const response = await fetch(`/api/users/me/devices/${device.id}`, { method: "DELETE" });
                                if (response.ok) {
                                  setDeviceSessions((prev) => prev.filter((item) => item.id !== device.id));
                                  toast.success(gt("Device revoked"));
                                } else {
                                  toast.error(gt("Failed to revoke device"));
                                }
                              }}
                              className="px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
                            >
                              {gt("Revoke")}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4 bg-[var(--bg-app)] rounded-lg p-5">
                      {activeTab === "content-social" && (
                        <>
                          <label className="block text-sm text-[var(--text-secondary)]">{gt("Sensitive Content Filter")}</label>
                          <select
                            value={userSettings.contentSocial?.explicitFilter || "moderate"}
                            onChange={(e) => saveSettingsPatch({ contentSocial: { ...(userSettings.contentSocial || {}), explicitFilter: e.target.value } }, "content-social")}
                            className="w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-white"
                          >
                            <option value="disabled">{gt("Disabled")}</option>
                            <option value="moderate">{gt("Moderate")}</option>
                            <option value="strict">{gt("Strict")}</option>
                          </select>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white">{gt("Show sensitive media")}</span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.contentSocial?.showSensitiveMedia)} onCheckedChange={(checked) => saveSettingsPatch({ contentSocial: { ...(userSettings.contentSocial || {}), showSensitiveMedia: checked } }, "content-social")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white">{gt("Allow direct messages from server members")}</span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.friendRequests?.allowServerMembers)} onCheckedChange={(checked) => saveSettingsPatch({ friendRequests: { ...(userSettings.friendRequests || {}), allowServerMembers: checked } }, "content-social")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white">{gt("Allow friend requests from everyone")}</span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.friendRequests?.allowEveryone)} onCheckedChange={(checked) => saveSettingsPatch({ friendRequests: { ...(userSettings.friendRequests || {}), allowEveryone: checked } }, "content-social")} />
                          </label>
                        </>
                      )}

                      {activeTab === "data-privacy" && (
                        <>
                          <div className="pb-2 mb-2 border-b border-[var(--border-subtle)]">
                            <label className="flex items-center justify-between py-2">
                              <div className="pr-4">
                                <span className="text-white">{gt("Allow data processing by Discord")}</span>
                                <p className="text-xs text-[var(--text-secondary)]">{gt("Required for your messages to sync to bridged Discord servers. When off, your messages are never sent to Discord and your data is not shared with it.")}</p>
                              </div>
                              <ToggleSwitch size="sm" checked={Boolean(userSettings.dataPrivacy?.discordBridgeOutbound)} onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), discordBridgeOutbound: checked, discordBridgePrompted: true } }, "data-privacy")} />
                            </label>
                          </div>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white">{gt("Allow data personalization")}</span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.dataPrivacy?.allowPersonalization)} onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), allowPersonalization: checked } }, "data-privacy")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white">{gt("Allow crash reports")}</span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.dataPrivacy?.allowCrashReports)} onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), allowCrashReports: checked } }, "data-privacy")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white">{gt("Allow analytics")}</span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.dataPrivacy?.allowAnalytics)} onCheckedChange={(checked) => saveSettingsPatch({ dataPrivacy: { ...(userSettings.dataPrivacy || {}), allowAnalytics: checked } }, "data-privacy")} />
                          </label>
                          <div className="pt-2 mt-2 border-t border-[var(--border-subtle)]">
                            <label className="flex items-center justify-between py-2">
                              <div>
                                <span className="text-white">{gt("Store recent activity")}</span>
                                <p className="text-xs text-[var(--text-secondary)]">{gt("Keep a private history of games and apps the desktop app detects. Turn off to stop recording.")}</p>
                              </div>
                              <ToggleSwitch
                                size="sm"
                                checked={userSettings.privacy?.storeActivityHistory ?? true}
                                onCheckedChange={(checked) => saveSettingsPatch({ privacy: { ...(userSettings.privacy || {}), storeActivityHistory: checked } }, "data-privacy")}
                              />
                            </label>
                            <button
                              onClick={async () => {
                                try {
                                  await fetch("/api/users/me/activity-history", { method: "DELETE", credentials: "include" });
                                } catch { /* ignore */ }
                              }}
                              className="mt-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)] text-[var(--text-secondary)] hover:text-white transition-colors"
                            >
                              {gt("Clear activity history")}
                            </button>
                          </div>
                        </>
                      )}

                      {activeTab === "accessibility" && (
                        <>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("Reduced motion")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Minimise animations and transitions")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.accessibility?.reducedMotion)} onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), reducedMotion: checked } }, "accessibility")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("High contrast")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Increase text and border contrast for readability")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.accessibility?.highContrast)} onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), highContrast: checked } }, "accessibility")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("Dyslexic font")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Use a dyslexia-friendly font in chat")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.accessibility?.dyslexicFont)} onCheckedChange={(checked) => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), dyslexicFont: checked } }, "accessibility")} />
                          </label>
                          <div className="py-2">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white">{gt("Message spacing")}</span>
                              <span className="text-xs text-[var(--text-secondary)]">{userSettings.accessibility?.messageSpacing === "compact" ? gt("Compact") : gt("Cozy")}</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), messageSpacing: "cozy" } }, "accessibility")}
                                className={cn(
                                  "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                                  userSettings.accessibility?.messageSpacing !== "compact"
                                    ? "bg-[var(--app-accent)]/20 border-[var(--app-accent)] text-[var(--app-accent)]"
                                    : "bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white"
                                )}
                              >
                                {gt("Cozy")}
                              </button>
                              <button
                                onClick={() => saveSettingsPatch({ accessibility: { ...(userSettings.accessibility || {}), messageSpacing: "compact" } }, "accessibility")}
                                className={cn(
                                  "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                                  userSettings.accessibility?.messageSpacing === "compact"
                                    ? "bg-[var(--app-accent)]/20 border-[var(--app-accent)] text-[var(--app-accent)]"
                                    : "bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white"
                                )}
                              >
                                {gt("Compact")}
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {activeTab === "text-images" && (
                        <>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("Inline media")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Display images and videos inline in chat")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.textImages?.inlineMedia)} onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), inlineMedia: checked } }, "text-images")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("Inline embeds")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Show rich link previews and embeds")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.textImages?.inlineEmbeds)} onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), inlineEmbeds: checked } }, "text-images")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("GIF autoplay")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Play animated GIFs automatically")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.textImages?.gifAutoplay)} onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), gifAutoplay: checked } }, "text-images")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("Emoji picker")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Show the emoji picker button in the message bar")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.textImages?.emojiPicker)} onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), emojiPicker: checked } }, "text-images")} />
                          </label>
                          <label className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-white">{gt("Sticker suggestions")}</span>
                              <p className="text-xs text-[var(--text-secondary)]">{gt("Show sticker suggestions while typing")}</p>
                            </div>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.textImages?.stickerSuggestions)} onCheckedChange={(checked) => saveSettingsPatch({ textImages: { ...(userSettings.textImages || {}), stickerSuggestions: checked } }, "text-images")} />
                          </label>
                        </>
                      )}

                      {activeTab === "keybinds" && (
                        <KeybindSettingsPanel />
                      )}

                      {activeTab === "language" && (
                        <>
                          <label className="block text-sm text-[var(--text-secondary)] mb-3"><T>Language</T></label>
                          <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg p-4">
                            <LocaleSelector />
                          </div>
                        </>
                      )}

                      {activeTab === "advanced" && (
                        <>
                          <label className="flex items-center justify-between py-2">
                            <span className="text-white"><T>Developer Mode</T></span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.advanced?.developerMode)} onCheckedChange={(checked) => saveSettingsPatch({ advanced: { ...(userSettings.advanced || {}), developerMode: checked } }, "advanced")} />
                          </label>
                          <p className="text-xs text-[var(--text-secondary)] mb-4">
                            <T>Enables extra technical information, such as copying IDs from context menus.</T>
                          </p>

                          <div className="h-px bg-[var(--border-subtle)] my-3" />

                          <label className="flex items-center justify-between py-2">
                            <span className="text-white"><T>Verbose Logging</T></span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.advanced?.verboseLogging)} onCheckedChange={(checked) => saveSettingsPatch({ advanced: { ...(userSettings.advanced || {}), verboseLogging: checked } }, "advanced")} />
                          </label>
                          <p className="text-xs text-[var(--text-secondary)] mb-4">
                            <T>Logs detailed API requests and WebSocket events to the browser console.</T>
                          </p>

                          <div className="h-px bg-[var(--border-subtle)] my-3" />

                          <label className="flex items-center justify-between py-2">
                            <span className="text-white"><T>Show API Latency</T></span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.advanced?.showLatency)} onCheckedChange={(checked) => saveSettingsPatch({ advanced: { ...(userSettings.advanced || {}), showLatency: checked } }, "advanced")} />
                          </label>
                          <p className="text-xs text-[var(--text-secondary)] mb-4">
                            <T>Displays real-time API response times and WebSocket ping in the UI.</T>
                          </p>

                          <div className="h-px bg-[var(--border-subtle)] my-3" />

                          <label className="flex items-center justify-between py-2">
                            <span className="text-white"><T>Debug Overlay</T></span>
                            <ToggleSwitch size="sm" checked={Boolean(userSettings.advanced?.debugOverlay)} onCheckedChange={(checked) => saveSettingsPatch({ advanced: { ...(userSettings.advanced || {}), debugOverlay: checked } }, "advanced")} />
                          </label>
                          <p className="text-xs text-[var(--text-secondary)] mb-4">
                            <T>Shows a floating overlay with render performance, memory usage, and component counts.</T>
                          </p>

                          <div className="h-px bg-[var(--border-subtle)] my-3" />

                          <div className="py-2">
                            <p className="text-white text-sm mb-2"><T>Developer Tools</T></p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  const token = localStorage.getItem("serika-token") || localStorage.getItem("auth-token") || "";
                                  if (token) {
                                    navigator.clipboard?.writeText(token);
                                    toast.success(gt("Session token copied to clipboard"));
                                  } else {
                                    toast.error(gt("No session token found"));
                                  }
                                }}
                                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--app-accent)] transition-colors flex items-center gap-1.5"
                              >
                                <Activity className="w-3.5 h-3.5" />
                                <T>Copy Session Token</T>
                              </button>
                              <button
                                onClick={() => {
                                  const keys = Object.keys(localStorage).filter(k => k.startsWith("serika") || k.startsWith("sc:"));
                                  keys.forEach(k => localStorage.removeItem(k));
                                  toast.success(gt("Cleared {count} cache entries", { count: keys.length }));
                                  setTimeout(() => window.location.reload(), 500);
                                }}
                                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--app-accent)] transition-colors flex items-center gap-1.5"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <T>Clear App Cache</T>
                              </button>
                              <button
                                onClick={() => {
                                  const info = {
                                    userAgent: navigator.userAgent,
                                    platform: navigator.platform,
                                    language: navigator.language,
                                    screenResolution: `${screen.width}x${screen.height}`,
                                    windowSize: `${window.innerWidth}x${window.innerHeight}`,
                                    isTauri: Boolean((window as any).__TAURI__),
                                    localStorage: Object.keys(localStorage).length,
                                    timestamp: new Date().toISOString(),
                                  };
                                  navigator.clipboard?.writeText(JSON.stringify(info, null, 2));
                                  toast.success(gt("Debug info copied to clipboard"));
                                }}
                                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--app-accent)] transition-colors flex items-center gap-1.5"
                              >
                                <Database className="w-3.5 h-3.5" />
                                <T>Copy Debug Info</T>
                              </button>
                              <button
                                onClick={() => {
                                  if (typeof window !== "undefined" && (window as any).__TAURI__) {
                                    const { open } = (window as any).__TAURI__?.core?.invoke ?? {};
                                    toast.info(gt("Tauri devtools available via F12 or Ctrl+Shift+I"));
                                  } else {
                                    toast.info(gt("Browser devtools: F12 or Ctrl+Shift+I"));
                                  }
                                }}
                                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--app-accent)] transition-colors flex items-center gap-1.5"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                <T>Open DevTools</T>
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {isSavingSettings && (
                        <div className="text-xs text-[var(--app-accent)]">
                          {gt("Saving")} {isSavingSettings}...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Admin Panel - User Management */}
              {activeTab === "admin-users" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-[#8B5CF6]" />
                    {gt("User Management")}
                  </h2>

                  {/* Search bar */}
                  <div className="bg-[var(--bg-app)] rounded-lg p-4 mb-4">
                    <div className="flex gap-4">
                      <Input
                        value={adminUserSearch}
                        onChange={(e) => setAdminUserSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchAdminUsers()}
                        placeholder={gt("Search users by email or username...")}
                        className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-white flex-1"
                      />
                      <button
                        onClick={searchAdminUsers}
                        disabled={isLoadingAdmin}
                        className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded font-medium flex items-center gap-2"
                      >
                        {isLoadingAdmin && <Loader size={16} />}
                        {gt("Search")}
                      </button>
                    </div>
                  </div>

                  {/* Two-column layout: user list + detail panel */}
                  {adminUsers.length > 0 && (
                    <div className="flex gap-4 h-[600px]">
                      {/* Left: User list */}
                      <div className="w-[320px] flex-shrink-0 bg-[var(--bg-app)] rounded-lg overflow-hidden flex flex-col">
                        <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex-shrink-0">
                          <p className="text-white font-semibold text-sm">{gt("Results ({count})", { count: adminUsers.length })}</p>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                          <div className="p-1.5 space-y-1">
                            {adminUsers.map((u) => (
                              <button
                                key={u.id}
                                onClick={() => {
                                  setSelectedUser(u);
                                  void selectUserDetail(u.id);
                                }}
                                className={cn(
                                  "w-full flex items-center gap-2.5 p-2.5 rounded-lg transition-colors text-left",
                                  selectedUser?.id === u.id
                                    ? "bg-[#8B5CF6]/15 ring-1 ring-[#8B5CF6]/40"
                                    : "hover:bg-[var(--bg-card)]"
                                )}
                              >
                                <Avatar className="w-9 h-9 flex-shrink-0">
                                  <AvatarImage src={cdnImage(u.avatar)} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                                    {u.displayName?.charAt(0) || u.username.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-white font-medium truncate">{u.displayName || u.username}</p>
                                  <p className="text-xs text-[var(--text-muted)] truncate">@{u.username}</p>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                  {u.isBanned && (
                                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded">{gt("Banned")}</span>
                                  )}
                                  {u.isStaff && (
                                    <span className="px-1.5 py-0.5 bg-[#8B5CF6]/20 text-[#8B5CF6] text-[10px] rounded">{gt("Staff")}</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      {/* Right: Detail panel */}
                      <div className="flex-1 bg-[var(--bg-app)] rounded-lg overflow-hidden flex flex-col">
                        {selectedUser ? (
                          <ScrollArea className="flex-1 min-h-0">
                            <div className="p-5 space-y-5">
                              {/* User header */}
                              <div className="flex items-center gap-3 pb-3 border-b border-[var(--border-subtle)]">
                                <Avatar className="w-12 h-12">
                                  <AvatarImage src={cdnImage(selectedUser.avatar)} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-white">
                                    {selectedUser.displayName?.charAt(0) || selectedUser.username.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="text-white font-semibold">{selectedUser.displayName || selectedUser.username}</p>
                                  <p className="text-sm text-[var(--text-muted)]">@{selectedUser.username} • {selectedUser.email}</p>
                                </div>
                              </div>

                              {/* Quick stats */}
                              {selectedUser.stats && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="bg-[var(--bg-card)] rounded-lg p-3">
                                    <p className="text-xs text-[var(--text-muted)] uppercase font-semibold">{gt("Servers")}</p>
                                    <p className="text-lg text-white font-bold">{selectedUser.stats.servers}</p>
                                  </div>
                                  <div className="bg-[var(--bg-card)] rounded-lg p-3">
                                    <p className="text-xs text-[var(--text-muted)] uppercase font-semibold">{gt("Messages")}</p>
                                    <p className="text-lg text-white font-bold">{selectedUser.stats.messages}</p>
                                  </div>
                                </div>
                              )}

                              {/* Account info */}
                              <div>
                                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("Account")}</p>
                                <div className="bg-[var(--bg-card)] rounded-lg p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-[var(--text-muted)]">{gt("Verified")}</span>
                                    <span className={cn("text-sm font-medium", selectedUser.isVerified ? "text-green-400" : "text-[var(--text-muted)]")}>
                                      {selectedUser.isVerified ? gt("Yes") : gt("No")}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-[var(--text-muted)]">{gt("Staff")}</span>
                                    <span className={cn("text-sm font-medium", selectedUser.isStaff ? "text-[#8B5CF6]" : "text-[var(--text-muted)]")}>
                                      {selectedUser.isStaff ? selectedUser.staffRole || gt("Yes") : gt("No")}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-[var(--text-muted)]">{gt("Premium")}</span>
                                    <span className={cn("text-sm font-medium", selectedUser.isPremium ? "text-[#F47FFF]" : "text-[var(--text-muted)]")}>
                                      {selectedUser.isPremium ? gt("Yes") : gt("No")}
                                    </span>
                                  </div>
                                  {selectedUser.createdAt && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm text-[var(--text-muted)]">{gt("Joined")}</span>
                                      <span className="text-sm text-white">{new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Moderation toggles */}
                              <div>
                                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("Moderation")}</p>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between bg-[var(--bg-card)] rounded-lg p-3">
                                    <div>
                                      <p className="text-sm text-white font-medium">{gt("Banned")}</p>
                                      <p className="text-xs text-[var(--text-muted)]">{gt("Prevent user from accessing the platform")}</p>
                                    </div>
                                    <ToggleSwitch
                                      size="sm"
                                      checked={selectedUser.isBanned}
                                      onCheckedChange={() => {
                                        if (selectedUser.isBanned) {
                                          void handleUnbanUser(selectedUser.id);
                                        } else {
                                          void handleBanUser(selectedUser.id, "Administrative action");
                                        }
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Badge assignment grid */}
                              <div>
                                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("Badges ({count})", { count: (selectedUser.badges || []).length })}</p>
                                <div className="grid grid-cols-2 gap-2">
                                  {Object.values(BADGES).map((badge) => {
                                    const isAssigned = (selectedUser.badges || []).includes(badge.id);
                                    const IconComponent = badge.icon;
                                    return (
                                      <button
                                        key={badge.id}
                                        onClick={() => void handleToggleBadge(badge.id)}
                                        className={cn(
                                          "flex items-center gap-2.5 p-2.5 rounded-lg border transition-all text-left",
                                          isAssigned
                                            ? "bg-[var(--bg-card)] border-[var(--border-subtle)]"
                                            : "bg-transparent border-[var(--border-subtle)] opacity-50 hover:opacity-80"
                                        )}
                                      >
                                        <div
                                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                          style={{ backgroundColor: `${badge.color}20` }}
                                        >
                                          <IconComponent className="w-4 h-4" style={{ color: badge.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm text-white font-medium truncate">{badge.name}</p>
                                          <p className="text-xs text-[var(--text-muted)] truncate">{badge.description}</p>
                                        </div>
                                        <div
                                          className={cn(
                                            "w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors",
                                            isAssigned ? "bg-[#8B5CF6] border-[#8B5CF6]" : "border-[var(--text-muted)]"
                                          )}
                                        >
                                          {isAssigned && <Check className="w-2.5 h-2.5 text-white" />}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Quick actions */}
                              <div>
                                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("Actions")}</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    onClick={() => {
                                      setActiveTab("admin-logs");
                                      setAdminLogFilter("reports");
                                      void fetchAdminLogs("reports");
                                    }}
                                    className="p-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] rounded-lg text-left transition-colors"
                                  >
                                    <p className="text-white font-medium text-sm">{gt("View Reports")}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{gt("Open filtered admin logs")}</p>
                                  </button>
                                  <button
                                    onClick={() => {
                                      window.location.href = `/dm/${selectedUser.id}`;
                                    }}
                                    className="p-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] rounded-lg text-left transition-colors"
                                  >
                                    <p className="text-white font-medium text-sm">{gt("Open DM")}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{gt("Jump to direct message")}</p>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </ScrollArea>
                        ) : (
                          <div className="flex items-center justify-center h-full p-8">
                            <div className="text-center">
                              <Users className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                              <p className="text-[var(--text-muted)]">{gt("Select a user from the list to view details and manage badges")}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {adminUsers.length === 0 && !isLoadingAdmin && (
                    <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
                      <Users className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                      <p className="text-[var(--text-muted)]">{gt("Search for users to view their profile, edit badges, or take moderation actions.")}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Panel - Server Management */}
              {activeTab === "admin-servers" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <Database className="w-6 h-6 text-[#8B5CF6]" />
                    {gt("Server Management")}
                  </h2>

                  {/* Search bar */}
                  <div className="bg-[var(--bg-app)] rounded-lg p-4 mb-4">
                    <div className="flex gap-4">
                      <Input
                        value={adminServerSearch}
                        onChange={(e) => setAdminServerSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchAdminServers()}
                        placeholder={gt("Search servers by name or ID...")}
                        className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-white flex-1"
                      />
                      <button
                        onClick={searchAdminServers}
                        disabled={isLoadingAdmin}
                        className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] disabled:opacity-50 text-white rounded font-medium flex items-center gap-2"
                      >
                        {isLoadingAdmin && <Loader size={16} />}
                        {gt("Search")}
                      </button>
                    </div>
                  </div>

                  {/* Two-column layout: server list + detail panel */}
                  {adminServers.length > 0 && (
                    <div className="flex gap-4 h-[600px]">
                      {/* Left: Server list */}
                      <div className="w-[320px] flex-shrink-0 bg-[var(--bg-app)] rounded-lg overflow-hidden flex flex-col">
                        <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex-shrink-0">
                          <p className="text-white font-semibold text-sm">{gt("Results ({count})", { count: adminServers.length })}</p>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                          <div className="p-1.5 space-y-1">
                            {adminServers.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => setSelectedServer(s)}
                                className={cn(
                                  "w-full flex items-center gap-2.5 p-2.5 rounded-lg transition-colors text-left",
                                  selectedServer?.id === s.id
                                    ? "bg-[#8B5CF6]/15 ring-1 ring-[#8B5CF6]/40"
                                    : "hover:bg-[var(--bg-card)]"
                                )}
                              >
                                <Avatar className="w-9 h-9 flex-shrink-0 rounded-lg">
                                  <AvatarImage src={cdnImage(s.icon)} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-white text-xs rounded-lg">
                                    {s.name.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-white font-medium truncate">{s.name}</p>
                                  <p className="text-xs text-[var(--text-muted)] truncate">{gt("{count} members", { count: s.memberCount })}</p>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                  {s.isPartnered && (
                                    <span className="px-1.5 py-0.5 bg-[#8B5CF6]/20 text-[#8B5CF6] text-[10px] rounded">{gt("Partner")}</span>
                                  )}
                                  {s.isDiscoverable && (
                                    <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded">{gt("Visible")}</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      {/* Right: Detail panel */}
                      <div className="flex-1 bg-[var(--bg-app)] rounded-lg overflow-hidden flex flex-col">
                        {selectedServer ? (
                          <ScrollArea className="flex-1 min-h-0">
                            <div className="p-5 space-y-5">
                              {/* Server header */}
                              <div className="flex items-center gap-3 pb-3 border-b border-[var(--border-subtle)]">
                                <Avatar className="w-12 h-12 rounded-xl">
                                  <AvatarImage src={cdnImage(selectedServer.icon || undefined)} />
                                  <AvatarFallback className="bg-[#8B5CF6] text-white rounded-xl">
                                    {selectedServer.name.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="text-white font-semibold text-lg">{selectedServer.name}</p>
                                  <p className="text-sm text-[var(--text-muted)]">
                                    {gt("Owner: {name}", { name: selectedServer.owner?.displayName || selectedServer.owner?.username || gt("Unknown") })}
                                  </p>
                                </div>
                              </div>

                              {/* Server info */}
                              <div>
                                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("Info")}</p>
                                <div className="bg-[var(--bg-card)] rounded-lg p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-[var(--text-muted)]">{gt("Server ID")}</span>
                                    <span className="text-sm text-white font-mono">{selectedServer.id}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-[var(--text-muted)]">{gt("Created")}</span>
                                    <span className="text-sm text-white">{new Date(selectedServer.createdAt).toLocaleDateString()}</span>
                                  </div>
                                  {selectedServer.description && (
                                    <div>
                                      <span className="text-sm text-[var(--text-muted)]">{gt("Description")}</span>
                                      <p className="text-sm text-white mt-1">{selectedServer.description}</p>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Server toggles */}
                              <div>
                                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("Server Status")}</p>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between bg-[var(--bg-card)] rounded-lg p-3">
                                    <div>
                                      <p className="text-sm text-white font-medium">{gt("Partnered")}</p>
                                      <p className="text-xs text-[var(--text-muted)]">{gt("Grant partner badge and perks")}</p>
                                    </div>
                                    <ToggleSwitch
                                      size="sm"
                                      checked={selectedServer.isPartnered}
                                      onCheckedChange={() => void handleTogglePartner(selectedServer.id)}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between bg-[var(--bg-card)] rounded-lg p-3">
                                    <div>
                                      <p className="text-sm text-white font-medium">{gt("Discoverable")}</p>
                                      <p className="text-xs text-[var(--text-muted)]">{gt("Show in server discovery page")}</p>
                                    </div>
                                    <ToggleSwitch
                                      size="sm"
                                      checked={selectedServer.isDiscoverable}
                                      onCheckedChange={() => void handleToggleDiscovery(selectedServer.id)}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Danger zone */}
                              <div>
                                <p className="text-xs text-red-400 uppercase font-semibold mb-2">{gt("Danger Zone")}</p>
                                <div className="space-y-2">
                                  <button
                                    onClick={handleTransferOwnership}
                                    className="w-full flex items-center justify-between p-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-left"
                                  >
                                    <div>
                                      <p className="text-sm text-white font-medium">{gt("Transfer Ownership")}</p>
                                      <p className="text-xs text-[var(--text-muted)]">{gt("Change the server owner")}</p>
                                    </div>
                                    <ExternalLink className="w-4 h-4 text-[var(--text-muted)]" />
                                  </button>
                                  <button
                                    onClick={() => void handleDeleteServer(selectedServer.id)}
                                    className="w-full flex items-center justify-between p-3 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors text-left"
                                  >
                                    <div>
                                      <p className="text-sm text-red-400 font-medium">{gt("Delete Server")}</p>
                                      <p className="text-xs text-red-400/60">{gt("Permanently remove this server")}</p>
                                    </div>
                                    <X className="w-4 h-4 text-red-400" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </ScrollArea>
                        ) : (
                          <div className="flex items-center justify-center h-full p-8">
                            <div className="text-center">
                              <Database className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                              <p className="text-[var(--text-muted)]">{gt("Select a server from the list to view details and manage settings")}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {adminServers.length === 0 && !isLoadingAdmin && (
                    <div className="bg-[var(--bg-app)] rounded-lg p-8 text-center">
                      <Database className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                      <p className="text-[var(--text-muted)]">{gt("Search for servers to view details, toggle partner/discovery status, or take moderation actions.")}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Panel - Statistics */}
              {activeTab === "admin-stats" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <BarChart3 className="w-6 h-6 text-[#8B5CF6]" />
                    {gt("Platform Statistics")}
                  </h2>

                  {isLoadingAdmin ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader size={32} />
                    </div>
                  ) : adminStats ? (
                    <div className="space-y-6">
                      {/* Primary stats grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-[var(--bg-app)] rounded-xl p-5 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-2">
                            <Users className="w-4 h-4 text-[#8B5CF6]" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Total Users")}</span>
                          </div>
                          <p className="text-3xl font-bold text-white">{adminStats.users.toLocaleString()}</p>
                          <p className="text-xs text-green-400 mt-1">+{adminStats.newUsersToday} {gt("today")}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] rounded-xl p-5 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-2">
                            <Server className="w-4 h-4 text-[#8B5CF6]" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Total Servers")}</span>
                          </div>
                          <p className="text-3xl font-bold text-white">{adminStats.servers.toLocaleString()}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">{adminStats.activeServers} {gt("new (30d)")}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] rounded-xl p-5 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageSquare className="w-4 h-4 text-[#8B5CF6]" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Total Messages")}</span>
                          </div>
                          <p className="text-3xl font-bold text-white">{adminStats.messages.toLocaleString()}</p>
                          <p className="text-xs text-green-400 mt-1">{adminStats.messagesToday.toLocaleString()} {gt("today")}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] rounded-xl p-5 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-2">
                            <Activity className="w-4 h-4 text-green-400" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Online Now")}</span>
                          </div>
                          <p className="text-3xl font-bold text-green-400">{adminStats.onlineUsers.toLocaleString()}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">{((adminStats.onlineUsers / Math.max(adminStats.users, 1)) * 100).toFixed(1)}% {gt("of users")}</p>
                        </div>
                      </div>

                      {/* Secondary stats */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-[var(--bg-app)] rounded-lg p-4 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-1">
                            <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("New This Week")}</span>
                          </div>
                          <p className="text-2xl font-bold text-white">{adminStats.newUsersThisWeek.toLocaleString()}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] rounded-lg p-4 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-1">
                            <Ban className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Banned Users")}</span>
                          </div>
                          <p className="text-2xl font-bold text-red-400">{adminStats.banned.toLocaleString()}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] rounded-lg p-4 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-1">
                            <Bot className="w-3.5 h-3.5 text-[#3B82F6]" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Bot Accounts")}</span>
                          </div>
                          <p className="text-2xl font-bold text-[#3B82F6]">{adminStats.bots.toLocaleString()}</p>
                        </div>
                        <div className="bg-[var(--bg-app)] rounded-lg p-4 border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 mb-1">
                            <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                            <span className="text-xs uppercase font-semibold text-[var(--text-muted)]">{gt("Server Memberships")}</span>
                          </div>
                          <p className="text-2xl font-bold text-white">{adminStats.totalMemberships.toLocaleString()}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">{gt("across all servers")}</p>
                        </div>
                      </div>

                      {/* Refresh button */}
                      <div className="flex justify-end">
                        <button
                          onClick={() => fetchAdminStats()}
                          className="px-4 py-2 bg-[var(--bg-card)] text-white rounded-lg text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
                        >
                          <RefreshCw className="w-4 h-4" />
                          {gt("Refresh")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-[var(--text-muted)]">
                      <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>{gt("Failed to load statistics")}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Panel - Platform Settings */}
              {activeTab === "admin-settings" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <Settings className="w-6 h-6 text-[#8B5CF6]" />
                    {gt("Platform Settings")}
                  </h2>

                  {/* Stats Overview */}
                  {adminStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-white">{adminStats.users.toLocaleString()}</p>
                        <p className="text-sm text-[var(--text-muted)]">{gt("Total Users")}</p>
                      </div>
                      <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-white">{adminStats.servers.toLocaleString()}</p>
                        <p className="text-sm text-[var(--text-muted)]">{gt("Total Servers")}</p>
                      </div>
                      <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-white">{adminStats.messages.toLocaleString()}</p>
                        <p className="text-sm text-[var(--text-muted)]">{gt("Total Messages")}</p>
                      </div>
                      <div className="bg-[var(--bg-app)] rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-green-400">+{adminStats.newUsersToday}</p>
                        <p className="text-sm text-[var(--text-muted)]">{gt("New Today")}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="bg-[var(--bg-app)] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">{gt("Maintenance Mode")}</h3>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white">{gt("Enable Maintenance Mode")}</p>
                          <p className="text-sm text-[var(--text-muted)]">{gt("Restrict access to staff only")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={platformSettings?.maintenanceMode || false} onCheckedChange={(checked) => handleUpdatePlatformSettings({ maintenanceMode: checked })} />
                      </label>
                    </div>
                    <div className="bg-[var(--bg-app)] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">{gt("Registration")}</h3>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white">{gt("Allow New Registrations")}</p>
                          <p className="text-sm text-[var(--text-muted)]">{gt("Enable new user sign-ups")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={platformSettings?.allowRegistration !== false} onCheckedChange={(checked) => handleUpdatePlatformSettings({ allowRegistration: checked })} />
                      </label>
                    </div>
                    <div className="bg-[var(--bg-app)] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">{gt("Connections")}</h3>
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <p className="text-white">{gt("Enable Account Connections")}</p>
                          <p className="text-sm text-[var(--text-muted)]">{gt("Allow users to link external accounts (Last.fm, Spotify, GitHub, etc.)")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={platformSettings?.connectionsEnabled !== false} onCheckedChange={(checked) => handleUpdatePlatformSettings({ connectionsEnabled: checked })} />
                      </label>
                      {platformSettings?.connectionsEnabled !== false && (
                        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] space-y-3">
                          <p className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">
                            {gt("Allowed Providers")}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {CONNECTION_PROVIDERS.map((prov) => {
                              const isDisabled = platformSettings?.disabledProviders?.includes(prov.id) || false;
                              return (
                                <label
                                  key={prov.id}
                                  className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-sidebar-elevated)] transition-colors"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div
                                      className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                                      style={{ backgroundColor: prov.bg }}
                                    >
                                      {(() => {
                                        const Icon = getConnectionIcon(prov.id);
                                        return <Icon size={12} style={{ color: prov.color }} />;
                                      })()}
                                    </div>
                                    <span className="text-sm text-white truncate">{prov.label}</span>
                                  </div>
                                  <ToggleSwitch
                                    size="sm"
                                    checked={!isDisabled}
                                    onCheckedChange={(checked) => {
                                      const current = platformSettings?.disabledProviders || [];
                                      const next = checked
                                        ? current.filter((id: string) => id !== prov.id)
                                        : [...current, prov.id];
                                      handleUpdatePlatformSettings({ disabledProviders: next });
                                    }}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="bg-[var(--bg-app)] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">{gt("OEmbed Whitelist")}</h3>
                      <p className="text-sm text-[var(--text-muted)] mb-3">{gt("Domains allowed for rich link embeds (Spotify, YouTube, etc.)")}</p>
                      <div className="flex gap-2 mb-3">
                        <Input
                          value={oembedDomainInput}
                          onChange={(e) => setOembedDomainInput(e.target.value)}
                          placeholder="example.com"
                          className="flex-1 bg-[var(--bg-card)] border-[var(--border-subtle)] text-white"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && oembedDomainInput.trim()) {
                              e.preventDefault();
                              const domain = oembedDomainInput.trim().toLowerCase();
                              const current = platformSettings?.oembedWhitelist || [];
                              if (!current.includes(domain)) {
                                void handleUpdatePlatformSettings({ oembedWhitelist: [...current, domain] });
                              }
                              setOembedDomainInput("");
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            if (!oembedDomainInput.trim()) return;
                            const domain = oembedDomainInput.trim().toLowerCase();
                            const current = platformSettings?.oembedWhitelist || [];
                            if (!current.includes(domain)) {
                              void handleUpdatePlatformSettings({ oembedWhitelist: [...current, domain] });
                            }
                            setOembedDomainInput("");
                          }}
                          className="px-3 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] text-white rounded text-sm font-medium"
                        >
                          {gt("Add")}
                        </button>
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {(platformSettings?.oembedWhitelist || []).length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)] italic">{gt("No custom domains. Using defaults.")}</p>
                        ) : (
                          (platformSettings?.oembedWhitelist || []).map((domain) => (
                            <div key={domain} className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-card)] rounded text-sm">
                              <span className="text-white">{domain}</span>
                              <button
                                onClick={() => {
                                  const current = platformSettings?.oembedWhitelist || [];
                                  void handleUpdatePlatformSettings({ oembedWhitelist: current.filter((d) => d !== domain) });
                                }}
                                className="text-red-400 hover:text-red-300 text-xs"
                              >
                                {gt("Remove")}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="bg-[var(--bg-app)] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">{gt("File Type Whitelist")}</h3>
                      <p className="text-sm text-[var(--text-muted)] mb-3">
                        {gt("Only whitelisted MIME types can be uploaded. Tag each as safe or bad — bad types are allowed but users get a warning.")}
                      </p>
                      <div className="flex gap-2 mb-3">
                        <Input
                          value={fileTypeInput}
                          onChange={(e) => setFileTypeInput(e.target.value)}
                          placeholder="application/zip"
                          className="flex-1 bg-[var(--bg-card)] border-[var(--border-subtle)] text-white"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && fileTypeInput.trim()) {
                              e.preventDefault();
                              const type = fileTypeInput.trim().toLowerCase();
                              const current = platformSettings?.allowedFileTypes || [];
                              if (!current.some((f) => f.type === type)) {
                                void handleUpdatePlatformSettings({ allowedFileTypes: [...current, { type, safe: true }] });
                              }
                              setFileTypeInput("");
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            if (!fileTypeInput.trim()) return;
                            const type = fileTypeInput.trim().toLowerCase();
                            const current = platformSettings?.allowedFileTypes || [];
                            if (!current.some((f) => f.type === type)) {
                              void handleUpdatePlatformSettings({ allowedFileTypes: [...current, { type, safe: true }] });
                            }
                            setFileTypeInput("");
                          }}
                          className="px-3 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] text-white rounded text-sm font-medium"
                        >
                          {gt("Add")}
                        </button>
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto mb-4">
                        {(platformSettings?.allowedFileTypes || []).length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)] italic">
                            {gt("No custom whitelist. Using defaults: image/jpeg, image/png, image/gif, image/webp, audio/mpeg, audio/ogg, audio/wav, video/mp4, video/webm, application/pdf, text/plain")}
                          </p>
                        ) : (
                          (platformSettings?.allowedFileTypes || []).map((entry) => (
                            <div key={entry.type} className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-card)] rounded text-sm">
                              <span className="text-white">{entry.type}</span>
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => {
                                    const current = platformSettings?.allowedFileTypes || [];
                                    void handleUpdatePlatformSettings({
                                      allowedFileTypes: current.map((f) => f.type === entry.type ? { ...f, safe: !f.safe } : f),
                                    });
                                  }}
                                  className={entry.safe ? "text-green-400 hover:text-green-300 text-xs font-medium" : "text-yellow-400 hover:text-yellow-300 text-xs font-medium"}
                                >
                                  {entry.safe ? gt("Safe") : gt("Bad")}
                                </button>
                                <button
                                  onClick={() => {
                                    const current = platformSettings?.allowedFileTypes || [];
                                    void handleUpdatePlatformSettings({ allowedFileTypes: current.filter((f) => f.type !== entry.type) });
                                  }}
                                  className="text-red-400 hover:text-red-300 text-xs"
                                >
                                  {gt("Remove")}
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <label className="flex items-center justify-between cursor-pointer pt-3 border-t border-[var(--border-subtle)]">
                        <div>
                          <p className="text-white">{gt("Warn on unknown file types")}</p>
                          <p className="text-sm text-[var(--text-muted)]">{gt("Show a warning to users when they upload a file type not in the whitelist")}</p>
                        </div>
                        <ToggleSwitch size="sm" checked={platformSettings?.warnOnUnknownFileTypes !== false} onCheckedChange={(checked) => handleUpdatePlatformSettings({ warnOnUnknownFileTypes: checked })} />
                      </label>
                    </div>
                    <div className="bg-[var(--bg-app)] rounded-lg p-4">
                      <h3 className="text-white font-semibold mb-3">{gt("Font Testing")}</h3>
                      <p className="text-sm text-[var(--text-muted)] mb-3">{gt("Preview how different fonts look across the app.")}</p>
                      <Input
                        value={fontTestText}
                        onChange={(e) => setFontTestText(e.target.value)}
                        className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-white mb-4"
                        placeholder={gt("Type text to preview...")}
                      />
                      <div className="space-y-3">
                        {[
                          { name: gt("Inter (Default)"), className: "font-sans" },
                          { name: gt("Mono"), className: "font-mono" },
                          { name: gt("Serif"), className: "font-serif" },
                        ].map((font) => (
                          <div key={font.name} className="p-3 bg-[var(--bg-card)] rounded-lg">
                            <p className="text-xs text-[var(--text-muted)] mb-1">{font.name}</p>
                            <p className={cn("text-white text-base", font.className)}>{fontTestText}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === "admin-logs" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
                    <Activity className="w-6 h-6 text-[#8B5CF6]" />
                    {gt("Activity Logs")}
                  </h2>
                  <div className="bg-[var(--bg-app)] rounded-lg p-4">
                    {/* Filter buttons */}
                    <div className="flex gap-2 mb-4 flex-wrap">
                      {(["all", "bans", "reports", "admin"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => {
                            setAdminLogFilter(f);
                            setAdminLogPage(1);
                            fetchAdminLogs(f, 1);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded text-sm transition-colors",
                            adminLogFilter === f
                              ? "bg-[#8B5CF6] text-white"
                              : "bg-[var(--bg-card)] text-white hover:bg-[var(--bg-hover)]"
                          )}
                        >
                          {f === "all" ? gt("All") : f === "bans" ? gt("Bans") : f === "reports" ? gt("Reports") : gt("Admin Actions")}
                        </button>
                      ))}
                    </div>

                    {/* Log entries */}
                    <div className="space-y-2">
                      {isLoadingAdmin ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader size={24} />
                        </div>
                      ) : adminLogs.length === 0 ? (
                        <div className="p-4 bg-[var(--bg-card)] rounded-lg text-center">
                          <FileText className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
                          <p className="text-white text-sm">{gt("No activity logs yet")}</p>
                          <p className="text-[var(--text-muted)] text-xs mt-1">{gt("Admin actions will appear here")}</p>
                        </div>
                      ) : (
                        adminLogs.map((log) => {
                          const isExpanded = expandedLogId === log.id;
                          const actionIcon = (() => {
                            const a = log.action;
                            if (a.includes("ban")) return { icon: Ban, color: "#EF4444" };
                            if (a.includes("report")) return { icon: AlertTriangle, color: "#F59E0B" };
                            if (a.includes("broadcast") || a.includes("announcement")) return { icon: Megaphone, color: "#3B82F6" };
                            if (a.includes("partner") || a.includes("discovery")) return { icon: Globe, color: "#10B981" };
                            if (a.includes("server") || a.includes("transfer")) return { icon: Server, color: "#8B5CF6" };
                            if (a.includes("badge")) return { icon: Award, color: "#F59E0B" };
                            if (a.includes("experiment")) return { icon: FlaskConical, color: "#06B6D4" };
                            if (a.includes("timeout")) return { icon: Clock, color: "#F59E0B" };
                            if (a.includes("settings") || a.includes("update")) return { icon: Settings, color: "#6B7280" };
                            return { icon: Zap, color: "#8B5CF6" };
                          })();
                          const ActionIcon = actionIcon.icon;
                          const targetIcon = log.targetType === "user" ? UserCog : log.targetType === "server" ? Server : log.targetType === "message" ? MessageSquare : Globe;
                          const TargetIcon = targetIcon;
                          const timeAgo = (() => {
                            const diff = Date.now() - new Date(log.createdAt).getTime();
                            const mins = Math.floor(diff / 60000);
                            const hours = Math.floor(mins / 60);
                            const days = Math.floor(hours / 24);
                            if (days > 0) return `${days}d ago`;
                            if (hours > 0) return `${hours}h ago`;
                            if (mins > 0) return `${mins}m ago`;
                            return "just now";
                          })();
                          return (
                            <div
                              key={log.id}
                              className="rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden transition-all hover:border-[var(--border-strong)]"
                            >
                              {/* Header row — clickable to expand */}
                              <button
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                className="w-full p-3 flex items-center justify-between gap-3 text-left hover:bg-[var(--bg-hover)]/50 transition-colors"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {/* Action icon */}
                                  <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ backgroundColor: `${actionIcon.color}15` }}
                                  >
                                    <ActionIcon className="w-4 h-4" style={{ color: actionIcon.color }} />
                                  </div>
                                  {/* Admin avatar + name */}
                                  <Avatar className="w-6 h-6 flex-shrink-0">
                                    <AvatarImage src={cdnImage(log.admin?.avatar)} />
                                    <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                                      {log.admin?.displayName?.charAt(0) || log.admin?.username?.charAt(0) || "?"}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-white text-sm font-medium truncate">
                                        {log.admin?.displayName || log.admin?.username || "Unknown"}
                                      </span>
                                      <span
                                        className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                                        style={{ backgroundColor: `${actionIcon.color}20`, color: actionIcon.color }}
                                      >
                                        {log.action.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-0.5">
                                      <TargetIcon className="w-3 h-3" />
                                      <span>{log.targetType}</span>
                                      <span className="font-mono opacity-60">{log.targetId.slice(0, 8)}...</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-[var(--text-muted)] text-xs hidden sm:inline">
                                    {timeAgo}
                                  </span>
                                  <ChevronDown
                                    className={cn(
                                      "w-4 h-4 text-[var(--text-muted)] transition-transform",
                                      isExpanded && "rotate-180"
                                    )}
                                  />
                                </div>
                              </button>

                              {/* Expanded details */}
                              {isExpanded && (
                                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[var(--border-subtle)]">
                                  {/* Timestamp */}
                                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pt-2">
                                    <Clock className="w-3 h-3" />
                                    <span>{new Date(log.createdAt).toLocaleString()}</span>
                                  </div>

                                  {/* Reason */}
                                  {log.reason && (
                                    <div className="flex items-start gap-2 text-sm">
                                      <AlertTriangle className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                                      <div>
                                        <span className="text-[var(--text-muted)] text-xs uppercase font-semibold">{gt("Reason")}</span>
                                        <p className="text-[var(--text-secondary)]">{log.reason}</p>
                                      </div>
                                    </div>
                                  )}

                                  {/* Target ID full */}
                                  <div className="flex items-center gap-2 text-xs">
                                    <TargetIcon className="w-3 h-3 text-[var(--text-muted)]" />
                                    <span className="text-[var(--text-muted)] uppercase font-semibold">{gt("Target")}:</span>
                                    <span className="font-mono text-[var(--text-secondary)]">{log.targetId}</span>
                                  </div>

                                  {/* Admin ID */}
                                  {log.admin?.id && (
                                    <div className="flex items-center gap-2 text-xs">
                                      <UserCog className="w-3 h-3 text-[var(--text-muted)]" />
                                      <span className="text-[var(--text-muted)] uppercase font-semibold">{gt("Admin ID")}:</span>
                                      <span className="font-mono text-[var(--text-secondary)]">{log.admin.id}</span>
                                    </div>
                                  )}

                                  {/* Details JSON */}
                                  {log.details && Object.keys(log.details).length > 0 && (
                                    <div>
                                      <p className="text-[var(--text-muted)] text-xs uppercase font-semibold mb-1">{gt("Details")}</p>
                                      <pre className="p-2.5 rounded bg-[var(--bg-app)] text-xs overflow-x-auto text-[var(--text-secondary)] border border-[var(--border-subtle)] max-h-60">
                                        {JSON.stringify(log.details, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Pagination */}
                    {adminLogPagination && adminLogPagination.pages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border-subtle)]">
                        <span className="text-xs text-[var(--text-muted)]">
                          {gt("Page {page} of {pages}", { page: adminLogPagination.page, pages: adminLogPagination.pages })}
                          {" · "}
                          {adminLogPagination.total} {gt("total")}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const prev = Math.max(1, adminLogPage - 1);
                              setAdminLogPage(prev);
                              fetchAdminLogs(adminLogFilter, prev);
                            }}
                            disabled={adminLogPage <= 1}
                            className="px-3 py-1.5 rounded text-sm bg-[var(--bg-card)] text-white hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {gt("Previous")}
                          </button>
                          <button
                            onClick={() => {
                              const next = Math.min(adminLogPagination.pages, adminLogPage + 1);
                              setAdminLogPage(next);
                              fetchAdminLogs(adminLogFilter, next);
                            }}
                            disabled={adminLogPage >= adminLogPagination.pages}
                            className="px-3 py-1.5 rounded text-sm bg-[var(--bg-card)] text-white hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {gt("Next")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Admin Panel - Badge Management (create/define badges) */}
              {activeTab === "admin-badges" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">{gt("Badge Management")}</h2>
                  <p className="text-sm text-[var(--text-muted)] mb-6">{gt("Create, edit, and manage the platform's badge definitions. To assign badges to a user, use the User Management tab.")}</p>
                  <div className="bg-[var(--bg-app)] rounded-xl p-5">
                    <div className="grid grid-cols-2 gap-2">
                      {Object.values(BADGES).map((badge) => {
                        const IconComponent = badge.icon;
                        return (
                          <div
                            key={badge.id}
                            className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]"
                          >
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${badge.color}20` }}>
                              <IconComponent className="w-4 h-4" style={{ color: badge.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white font-medium truncate">{badge.name}</p>
                              <p className="text-xs text-[var(--text-muted)] truncate">{badge.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-4">{gt("Badge definitions are defined in")}
 <code className="text-[#8B5CF6]">src/lib/constants/badges.ts</code>. {gt("Assign badges to users via User Management.")}</p>
                  </div>
                </div>
              )}

              {/* Admin Panel - Announcements */}
              {activeTab === "admin-announcements" && isStaff && (
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">{gt("Announcements")}</h2>
                  <p className="text-sm text-[var(--text-muted)] mb-6">{gt("Publish a global banner announcement visible to all users. Blank lines are preserved.")}</p>
                  <div className="bg-[var(--bg-app)] rounded-xl p-5 space-y-4">
                    {platformSettings?.globalAnnouncement && (
                      <div className="p-3 rounded-lg bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-sm text-[var(--text-primary)]">
                        <p className="text-[10px] uppercase font-semibold text-[var(--text-muted)] mb-1.5">{gt("Current Live Announcement")}</p>
                        {platformSettings.globalAnnouncement.split("\n").map((line: string, i: number, arr: string[]) => (
                          <span key={i}>{line || "\u00A0"}{i < arr.length - 1 && <br />}</span>
                        ))}
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">{gt("New Announcement")}</p>
                      <Textarea
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        placeholder={gt("Enter announcement text… Blank lines will be preserved as visual breaks.")}
                        className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-white resize-none overflow-y-auto"
                        rows={8}
                        style={{ maxHeight: "240px" }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePublishAnnouncement}
                        className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] text-white rounded-lg font-medium text-sm flex items-center gap-2"
                      >
                        <Megaphone className="w-4 h-4" />
                        {gt("Publish")}
                      </button>
                      {platformSettings?.globalAnnouncement && (
                        <button
                          onClick={async () => {
                            setAnnouncementText("");
                            try {
                              const res = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ globalAnnouncement: "" }) });
                              if (res.ok) { const data = await res.json(); setPlatformSettings(data); toast.success(gt("Announcement cleared")); }
                            } catch { toast.error(gt("Failed to clear announcement")); }
                          }}
                          className="px-4 py-2 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] rounded-lg font-medium text-sm"
                        >
                          {gt("Clear Live")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Admin Panel - Experiments */}
              {activeTab === "admin-experiments" && isStaff && (
                <AdminExperimentsPanel />
              )}

              {/* Admin Panel - TTS Sounds */}
              {activeTab === "admin-tts-sounds" && isStaff && (
                <AdminTtsSoundsPanel />
              )}

              {/* Admin Panel - TTS Voices */}
              {activeTab === "admin-tts-voices" && isStaff && (
                <AdminTtsVoicesPanel />
              )}

              {/* Admin Panel - Translations */}
              {activeTab === "admin-translations" && isStaff && (
                <AdminTranslationsPanel />
              )}

              {/* Bug Reports - User */}
              {activeTab === "bug-reports" && (
                <BugReportPanel />
              )}

              {/* Admin Panel - Bug Reports */}
              {activeTab === "admin-bug-reports" && isStaff && (
                <AdminBugReportsPanel />
              )}
            </div>
          </ScrollArea>

          {/* Close Button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[#3f4147] rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* ESC hint */}
          <div className="absolute top-5 right-16 text-xs text-[#72767d]">
            ESC
          </div>

          {/* Save bar */}
          {hasChanges && (
            <div className="absolute bottom-0 left-0 right-0 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] p-3 flex items-center justify-between animate-in slide-in-from-bottom">
              <span className="text-white text-sm">{gt("Careful — you have unsaved changes!")}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (profileTab === "main") {
                      if (user) {
                        setDisplayName(user.displayName || "");
                        setBio(user.bio || "");
                        setPronouns(user.pronouns || "");
                        setTimezone(user.timezone || "");
                        setShowTimezone(user.showTimezone ?? false);
                        setCustomStatus(user.customStatus || "");
                        setStatus(user.status || "online");
                        setDisplayNameStyle(user.customization?.displayNameStyle || { font: 'default', effect: 'solid', color: '', gradient: [] });
                        setProfileColor(user.customization?.profileColor || "");
                        setProfileGradient(user.customization?.profileGradient || []);
                        setProfileGradientAngle(user.customization?.profileGradientAngle ?? 135);
                        setProfileGradientType(user.customization?.profileGradientType || 'linear');
                        setProfileGradientRadialPosition(user.customization?.profileGradientRadialPosition || 'center');
                        setProfileCardEffect(user.customization?.profileCardEffect || 'normal');
                        setProfileCardBlur(user.customization?.profileCardBlur ?? 8);
                        setProfileCardOpacity(user.customization?.profileCardOpacity ?? 0.85);
                        setProfileCardBorderColor(user.customization?.profileCardBorderColor || "");
                        setProfileCardBorderGlow(user.customization?.profileCardBorderGlow ?? false);
                        setProfileCardBorderWidth(user.customization?.profileCardBorderWidth ?? 1);
                      }
                    } else {
                      setServerNickname(initialServerNickname);
                      setServerAvatar(initialServerAvatar);
                      setServerBanner(initialServerBanner);
                    }
                  }}
                  className="px-4 py-1.5 text-sm text-white hover:underline"
                >
                  {gt("Reset")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-1.5 bg-[#248046] hover:bg-[#1a6334] disabled:opacity-50 text-white text-sm font-medium rounded transition-colors flex items-center gap-2"
                >
                  {isSaving && <Loader size={16} />}
                  {gt("Save Changes")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Image Cropper */}
      <ImageCropper
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        imageUrl={cropperImage}
        aspectRatio={cropperType === "avatar" ? 1 : 3}
        onCropComplete={handleCropComplete}
        title={cropperType === "avatar" ? gt("Crop Avatar") : gt("Crop Banner")}
        description={
          cropperType === "avatar"
            ? gt("Adjust the crop area to select the portion of the image for your avatar.")
            : gt("Adjust the crop area to select the portion of the image for your profile banner.")
        }
        circular={cropperType === "avatar"}
      />
    </div>
  );
}
