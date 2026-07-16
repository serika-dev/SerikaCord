"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft,  Trash2, Camera, Image, Lock, RotateCcw, Check, Pencil } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { setUserNotificationSettings } from "@/lib/services/notificationUX";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import Link from "next/link";
import { getConnectionIcon } from "@/components/user/ConnectionIcon";
import { cn, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import { NAMEPLATE_PRESETS, getNameplateBackground } from "@/lib/constants/nameplates";
import { T, useGT } from "gt-next";
import { LocaleSelector } from "@/components/ui/LocaleSelector";
import { Loader } from "@/components/ui/Loader";

const sectionTitles: Record<string, string> = {
  privacy: "Privacy & Safety",
  apps: "Authorized Apps",
  notifications: "Notifications",
  appearance: "Appearance",
  accessibility: "Accessibility",
  voice: "Voice & Video",
  language: "Language",
  premium: "SerikaCord Premium",
  help: "Help & Support",
  "bug-report": "Report a Bug",
  feedback: "Give Feedback",
  status: "Status",
  profiles: "Profiles",
  connections: "Connections",
};

function getSectionTitle(section: string, gt: (s: string) => string): string {
  const titles: Record<string, string> = {
    privacy: gt("Privacy & Safety"),
    apps: gt("Authorized Apps"),
    notifications: gt("Notifications"),
    appearance: gt("Appearance"),
    accessibility: gt("Accessibility"),
    voice: gt("Voice & Video"),
    language: gt("Language"),
    premium: gt("SerikaCord Premium"),
    help: gt("Help & Support"),
    "bug-report": gt("Report a Bug"),
    feedback: gt("Give Feedback"),
    status: gt("Status"),
    profiles: gt("Profiles"),
    connections: gt("Connections"),
  };
  return titles[section] || sectionTitles[section] || section;
}

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

const statusOptions = ["online", "idle", "dnd", "offline"] as const;

type SettingsObject = Record<string, any>;

export default function MobileSettingsSectionPage() {
  const params = useParams();
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const gt = useGT();
  const { applyUserSettingsPatch } = useTheme();
  const section = (params.section as string) || "privacy";

  const [settings, setSettings] = useState<SettingsObject | null>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionsEnabled, setConnectionsEnabled] = useState(true);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [supportText, setSupportText] = useState("");

  // Profiles states
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [timezone, setTimezone] = useState("");
  const [showTimezone, setShowTimezone] = useState(false);
  const [customStatus, setCustomStatus] = useState("");
  const [status, setStatus] = useState("online");
  const [displayNameStyle, setDisplayNameStyle] = useState<{
    font?: "default" | "serif" | "mono" | "rounded" | "cursive" | "bold";
    effect?: "solid" | "gradient" | "neon" | "toon" | "pop";
    color?: string;
    gradient?: string[];
  }>({ font: "default", effect: "solid", color: "", gradient: [] });
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

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);

  // Connections states
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectingValue, setConnectingValue] = useState("");

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
      setBio(user.bio || "");
      setPronouns(user.pronouns || "");
      setTimezone(user.timezone || "");
      setShowTimezone(user.showTimezone ?? false);
      setCustomStatus(user.customStatus || "");
      setStatus(user.status || "online");
      setDisplayNameStyle(user.customization?.displayNameStyle || { font: "default", effect: "solid", color: "", gradient: [] });
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

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
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
        const data = await response.json();
        updateUser(data.user || data);
        toast.success(gt("Profile saved successfully!"));
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to save profile"));
      }
    } catch {
      toast.error(gt("Failed to save profile"));
    } finally {
      setIsSaving(false);
    }
  };

  const title = getSectionTitle(section, gt);

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const [meRes, settingsRes, appsRes, devicesRes, connectionsRes] = await Promise.all([
        fetch("/api/users/@me"),
        fetch("/api/users/me/settings"),
        fetch("/api/users/me/authorized-apps"),
        fetch("/api/users/me/devices"),
        fetch("/api/users/me/connections"),
      ]);

      // Refresh the auth context with the latest profile from the DB so the
      // profile form seeds from live data instead of a stale in-memory copy.
      if (meRes.ok) {
        const me = await meRes.json();
        if (me && !me.error) updateUser(me);
      }

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.settings || {});
        applyUserSettingsPatch(data.settings || {});
      }
      if (appsRes.ok) {
        const data = await appsRes.json();
        setApps(data.apps || []);
      }
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        setDevices(data.devices || []);
      }
      if (connectionsRes.ok) {
        const data = await connectionsRes.json();
        setConnections(data.connections || []);
      }
      if (section === "connections") {
        const connSettingsRes = await fetch("/api/admin/settings/connections");
        if (connSettingsRes.ok) {
          const d = await connSettingsRes.json();
          if (typeof d.connectionsEnabled === "boolean") setConnectionsEnabled(d.connectionsEnabled);
          if (Array.isArray(d.disabledProviders)) setDisabledProviders(d.disabledProviders);
        }
      }
    } catch (error) {
      console.error("Failed to load settings section:", error);
      toast.error(gt("Failed to load settings"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [section]);

  const saveSettings = async (patch: SettingsObject) => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: patch }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save settings");
      }

      setSettings((prev) => ({ ...(prev || {}), ...patch }));
      applyUserSettingsPatch(patch);
      if (patch.notifications) setUserNotificationSettings(patch.notifications);
      toast.success(gt("Settings saved"));
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(error instanceof Error ? error.message : gt("Failed to save settings"));
    } finally {
      setIsSaving(false);
    }
  };

  const statusSection = useMemo(() => {
    if (section !== "status") return null;
    return (
      <div className="space-y-3">
        {statusOptions.map((status) => (
          <button
            key={status}
            onClick={async () => {
              const response = await fetch("/api/users/me", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
              });
              if (response.ok) {
                updateUser({ status: status as any });
                toast.success(gt("Status set to {status}", { status }));
              } else {
                toast.error(gt("Failed to update status"));
              }
            }}
            className={`w-full p-4 rounded-xl border text-left capitalize ${user?.status === status ? "bg-[var(--bg-active)] border-[var(--app-accent)] text-[var(--text-primary)]" : "bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]"}`}
          >
            {status}
          </button>
        ))}
      </div>
    );
  }, [section, user?.status, updateUser]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--bg-app)]">
        <Loader size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-[var(--bg-hover)]">
          <ArrowLeft className="w-5 h-5 text-[var(--text-primary)]" />
        </button>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">{title}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-20">
        {section === "privacy" && settings && (
          <div className="space-y-4">
            <ToggleRow
              label={gt("Allow direct messages")}
              checked={settings.privacy?.directMessages === "everyone"}
              onChange={(checked) =>
                saveSettings({ privacy: { ...(settings.privacy || {}), directMessages: checked ? "everyone" : "friends" } })
              }
            />
            <ToggleRow
              label={gt("Allow friend requests")}
              checked={settings.privacy?.friendRequests !== "none"}
              onChange={(checked) =>
                saveSettings({ privacy: { ...(settings.privacy || {}), friendRequests: checked ? "everyone" : "none" } })
              }
            />
            <ToggleRow
              label={gt("Activity status")}
              checked={Boolean(settings.privacy?.showActivity)}
              onChange={(checked) => saveSettings({ privacy: { ...(settings.privacy || {}), showActivity: checked } })}
            />
            <ToggleRow
              label={gt("Crash reports")}
              checked={Boolean(settings.dataPrivacy?.allowCrashReports)}
              onChange={(checked) => saveSettings({ dataPrivacy: { ...(settings.dataPrivacy || {}), allowCrashReports: checked } })}
            />
          </div>
        )}

        {section === "notifications" && settings && (
          <div className="space-y-4">
            <ToggleRow label={gt("Desktop notifications")} checked={Boolean(settings.notifications?.desktop)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), desktop: checked } })} />
            <ToggleRow label={gt("Sounds")} checked={Boolean(settings.notifications?.sounds)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), sounds: checked } })} />
            <ToggleRow label={gt("Mentions")} checked={Boolean(settings.notifications?.mentions)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), mentions: checked } })} />
            <ToggleRow label={gt("Direct messages")} checked={Boolean(settings.notifications?.directMessages)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), directMessages: checked } })} />
            <ToggleRow label={gt("Do Not Disturb")} checked={Boolean(settings.notifications?.dnd)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), dnd: checked } })} />
            <ToggleRow label={gt("Focus Mode")} checked={Boolean(settings.notifications?.focusMode)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), focusMode: checked } })} />
            <ToggleRow label={gt("Mute @everyone")} checked={Boolean(settings.notifications?.muteEveryone)} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), muteEveryone: checked } })} />
            <ToggleRow label={gt("Show message preview")} checked={settings.notifications?.showPreview !== false} onChange={(checked) => saveSettings({ notifications: { ...(settings.notifications || {}), showPreview: checked } })} />
          </div>
        )}

        {section === "appearance" && settings && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <label className="text-sm text-[var(--text-secondary)]">{gt("Theme")}</label>
              <select
                value={settings.appearance?.theme || settings.appearance?.themeStyle || "dark"}
                onChange={(e) => saveSettings({ appearance: { ...(settings.appearance || {}), theme: e.target.value } })}
                className="mt-2 w-full h-10 rounded-md bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] px-3 text-[var(--text-primary)]"
              >
                <option value="dark">{gt("Dark")}</option>
                <option value="midnight">{gt("Midnight")}</option>
                <option value="light">{gt("Light")}</option>
              </select>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <label className="text-sm text-[var(--text-secondary)]">{gt("Accent Colour")}</label>
              <input
                type="color"
                value={settings.appearance?.accentColor || "#8B5CF6"}
                onChange={(e) => saveSettings({ appearance: { ...(settings.appearance || {}), accentColor: e.target.value } })}
                className="mt-2 h-10 w-full rounded-md bg-transparent"
              />
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <div className="flex items-center justify-between">
                <label className="text-sm text-[var(--text-secondary)]">{gt("Text Colour")}</label>
                {(settings.appearance?.textColor || "").trim() && (
                  <button
                    onClick={() => saveSettings({ appearance: { ...(settings.appearance || {}), textColor: "" } })}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {gt("Reset to default")}
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1 mb-2">{gt("Override the default text color for the current theme.")}</p>
              <input
                type="color"
                value={settings.appearance?.textColor || "#d5d9e8"}
                onChange={(e) => saveSettings({ appearance: { ...(settings.appearance || {}), textColor: e.target.value } })}
                className="h-10 w-full rounded-md bg-transparent"
              />
            </div>
            <ToggleRow label={gt("Compact mode")} checked={Boolean(settings.appearance?.compactMode)} onChange={(checked) => saveSettings({ appearance: { ...(settings.appearance || {}), compactMode: checked } })} />
          </div>
        )}

        {section === "accessibility" && settings && (
          <div className="space-y-4">
            <ToggleRow label={gt("Reduced motion")} checked={Boolean(settings.accessibility?.reducedMotion)} onChange={(checked) => saveSettings({ accessibility: { ...(settings.accessibility || {}), reducedMotion: checked } })} />
            <ToggleRow label={gt("High contrast")} checked={Boolean(settings.accessibility?.highContrast)} onChange={(checked) => saveSettings({ accessibility: { ...(settings.accessibility || {}), highContrast: checked } })} />
            <ToggleRow label={gt("Dyslexic font")} checked={Boolean(settings.accessibility?.dyslexicFont)} onChange={(checked) => saveSettings({ accessibility: { ...(settings.accessibility || {}), dyslexicFont: checked } })} />
          </div>
        )}

        {section === "voice" && settings && (
          <div className="space-y-4">
            <ToggleRow label={gt("Noise suppression")} checked={Boolean(settings.voiceVideo?.noiseSuppression)} onChange={(checked) => saveSettings({ voiceVideo: { ...(settings.voiceVideo || {}), noiseSuppression: checked } })} />
            <ToggleRow label={gt("Echo cancellation")} checked={Boolean(settings.voiceVideo?.echoCancellation)} onChange={(checked) => saveSettings({ voiceVideo: { ...(settings.voiceVideo || {}), echoCancellation: checked } })} />
            <ToggleRow label={gt("Push to talk")} checked={Boolean(settings.voiceVideo?.pushToTalk)} onChange={(checked) => saveSettings({ voiceVideo: { ...(settings.voiceVideo || {}), pushToTalk: checked } })} />
          </div>
        )}

        {section === "language" && settings && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <label className="text-sm text-[var(--text-secondary)] mb-3 block"><T>Language</T></label>
              <LocaleSelector />
            </div>
          </div>
        )}

        {section === "apps" && (
          <div className="space-y-3">
            {apps.length === 0 ? <p className="text-[var(--text-secondary)] text-sm">{gt("No authorized apps.")}</p> : apps.map((app) => (
              <div key={app.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 flex items-center justify-between">
                <div>
                  <p className="text-[var(--text-primary)] font-medium">{app.name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{app.description || gt("No description")}</p>
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/users/me/authorized-apps/${app.id}`, { method: "DELETE" });
                    setApps((prev) => prev.filter((a) => a.id !== app.id));
                    toast.success(gt("App access revoked"));
                  }}
                  className="p-2 rounded-md hover:bg-red-500/10 text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {section === "premium" && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <p className="text-[var(--text-primary)] font-semibold">{user?.isPremium ? gt("Your Premium is Active") : gt("Premium is not active")}</p>
            <p className="text-sm text-[var(--text-secondary)] mt-2">{gt("Premium unlocks profile cosmetics and extra media limits.")}</p>
          </div>
        )}

        {(section === "help" || section === "bug-report" || section === "feedback") && (
          <div className="space-y-3">
            <textarea
              value={supportText}
              onChange={(e) => setSupportText(e.target.value)}
              placeholder={section === "bug-report" ? gt("Describe the bug...") : gt("Write your message...")}
              className="w-full min-h-[140px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-[var(--text-primary)]"
            />
            <button
              onClick={() => {
                if (!supportText.trim()) return;
                localStorage.setItem(`support-${section}-${Date.now()}`, supportText.trim());
                setSupportText("");
                toast.success(gt("Submitted. Thank you."));
              }}
              className="px-4 py-2 rounded-md bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
            >
              {gt("Submit")}
            </button>
          </div>
        )}

        {section === "status" && statusSection}

        {section === "account" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src={cdnImage(user?.avatar)} />
                <AvatarFallback className="bg-[var(--app-accent)] text-white text-xl font-bold">
                  {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[var(--text-primary)] truncate">{user?.displayName || user?.username}</p>
                <p className="text-sm text-[var(--text-muted)] truncate">@{user?.username}</p>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3">
              <div>
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{gt("Display Name")}</label>
                <p className="text-sm text-[var(--text-primary)] mt-0.5">{user?.displayName || gt("Not set")}</p>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{gt("Username")}</label>
                <p className="text-sm text-[var(--text-primary)] mt-0.5">@{user?.username}</p>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{gt("Email")}</label>
                <p className="text-sm text-[var(--text-primary)] mt-0.5">{user?.email || gt("Not set")}</p>
              </div>
              {user?.isPremium && (
                <div>
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{gt("Premium")}</label>
                  <p className="text-sm text-[var(--app-accent)] mt-0.5">{gt("Active")}</p>
                </div>
              )}
            </div>
            <Link href="/channels/profile" className="block w-full text-center py-2.5 rounded-lg bg-[var(--app-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
              {gt("Edit Profile")}
            </Link>
          </div>
        )}

        {section === "apps" && (
          <div className="mt-6 space-y-3">
            <h3 className="text-sm text-[var(--text-secondary)]">{gt("Connected Devices")}</h3>
            {devices.map((device) => (
              <div key={device.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 flex items-center justify-between">
                <div>
                  <p className="text-[var(--text-primary)] text-sm">{device.deviceName}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{device.platform} • {new Date(device.lastActiveAt).toLocaleString()}</p>
                </div>
                {!device.current && (
                  <button
                    onClick={async () => {
                      await fetch(`/api/users/me/devices/${device.id}`, { method: "DELETE" });
                      setDevices((prev) => prev.filter((d) => d.id !== device.id));
                      toast.success(gt("Device removed"));
                    }}
                    className="text-red-400 text-xs"
                  >
                    {gt("Revoke")}
                  </button>
                )}
              </div>
            ))}

            <h3 className="text-sm text-[var(--text-secondary)] pt-2">{gt("Connections")}</h3>
            {connections.length === 0 ? <p className="text-xs text-[var(--text-muted)]">{gt("No social connections.")}</p> : connections.map((connection) => (
              <div key={connection.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 flex items-center justify-between">
                <div>
                  <p className="text-[var(--text-primary)] text-sm capitalize">{connection.provider}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{connection.displayName || connection.username || connection.accountId}</p>
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/users/me/connections/${connection.id}`, { method: "DELETE" });
                    setConnections((prev) => prev.filter((c) => c.id !== connection.id));
                    toast.success(gt("Disconnected"));
                  }}
                  className="text-red-400 text-xs"
                >
                  {gt("Disconnect")}
                </button>
              </div>
            ))}
          </div>
        )}

        {section === "profiles" && (
          <div className="space-y-6">
            {/* Avatar & Banner section */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Avatar & Banner")}</h3>
              
              <div className="space-y-4">
                {/* Avatar preview and upload */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Avatar className="w-20 h-20 border-2 border-[var(--border-subtle)]">
                      <AvatarImage src={cdnImage(user?.avatar)} />
                      <AvatarFallback className="bg-[var(--app-accent)] text-white text-2xl font-bold">
                        {(displayName || user?.username || "U").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                    >
                      {isUploadingAvatar ? (
                        <Loader size={20} />
                      ) : (
                        <Camera className="w-5 h-5 text-white" />
                      )}
                    </button>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">{gt("Profile Avatar")}</h4>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{gt("Click image to upload new avatar")}</p>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsUploadingAvatar(true);
                        // Optimistically preview from a local object URL so the
                        // avatar updates instantly instead of waiting on upload.
                        const localUrl = URL.createObjectURL(file);
                        const prevAvatar = user?.avatar;
                        updateUser({ avatar: localUrl });
                        const formData = new FormData();
                        formData.append("file", file);
                        try {
                          const res = await fetch("/api/upload/avatar", {
                            method: "POST",
                            body: formData,
                          });
                          if (res.ok) {
                            const data = await res.json();
                            updateUser({ avatar: data.url });
                            URL.revokeObjectURL(localUrl);
                            toast.success(gt("Avatar updated!"));
                          } else {
                            const data = await res.json();
                            updateUser({ avatar: prevAvatar });
                            URL.revokeObjectURL(localUrl);
                            toast.error(data.error || gt("Failed to upload avatar"));
                          }
                        } catch {
                          updateUser({ avatar: prevAvatar });
                          URL.revokeObjectURL(localUrl);
                          toast.error(gt("Failed to upload avatar"));
                        } finally {
                          setIsUploadingAvatar(false);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Banner preview and upload */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">{gt("Profile Banner")}</h4>
                    <p className="text-xs text-[var(--text-muted)]">{gt("Click banner to upload")}</p>
                  </div>
                  <div
                    onClick={() => bannerInputRef.current?.click()}
                    className="relative w-full h-24 rounded-lg overflow-hidden bg-[var(--bg-sidebar-elevated)] border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--app-accent)] cursor-pointer transition-all group flex items-center justify-center"
                  >
                    {user?.banner ? (
                      <img src={cdnImage(user.banner)} alt="Banner" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-[var(--text-muted)] gap-1">
                        <Image className="w-6 h-6" />
                        <span className="text-xs">{gt("No banner set")}</span>
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
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setIsUploadingBanner(true);
                      // Optimistically preview from a local object URL so the
                      // banner updates instantly instead of waiting on upload.
                      const localUrl = URL.createObjectURL(file);
                      const prevBanner = user?.banner;
                      updateUser({ banner: localUrl });
                      const formData = new FormData();
                      formData.append("file", file);
                      try {
                        const res = await fetch("/api/upload/banner", {
                          method: "POST",
                          body: formData,
                        });
                        if (res.ok) {
                          const data = await res.json();
                          updateUser({ banner: data.url });
                          URL.revokeObjectURL(localUrl);
                          toast.success(gt("Banner updated!"));
                        } else {
                          const data = await res.json();
                          updateUser({ banner: prevBanner });
                          URL.revokeObjectURL(localUrl);
                          toast.error(data.error || gt("Failed to upload banner"));
                        }
                      } catch {
                        updateUser({ banner: prevBanner });
                        URL.revokeObjectURL(localUrl);
                        toast.error(gt("Failed to upload banner"));
                      } finally {
                        setIsUploadingBanner(false);
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Basic Info section */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Basic Info")}</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                    {gt("Display Name")}
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full h-11 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 text-sm focus:outline-none focus:border-[var(--app-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                    {gt("Pronouns")}
                  </label>
                  <input
                    type="text"
                    placeholder={gt("Add your pronouns")}
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    className="w-full h-11 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 text-sm focus:outline-none focus:border-[var(--app-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                    {gt("Timezone")}
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full h-11 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 text-sm focus:outline-none focus:border-[var(--app-accent)]"
                  >
                    <option value="">{gt("Select your timezone")}</option>
                    {Intl.supportedValuesOf("timeZone").map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-3 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showTimezone}
                      onChange={(e) => setShowTimezone(e.target.checked)}
                      className="w-4 h-4 rounded accent-[var(--app-accent)] bg-[var(--bg-app)] border-[var(--border-subtle)]"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">{gt("Display my current time on my profile")}</span>
                  </label>
                </div>
              </div>
            </div>

            {/* About Me section */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("About Me")}</h3>
              <div>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={user?.isPremium ? 500 : 190}
                  className="w-full min-h-[100px] rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] p-3 text-sm focus:outline-none focus:border-[var(--app-accent)] resize-y"
                  placeholder={gt("Tell us about yourself...")}
                />
                <p className="text-xs text-[var(--text-muted)] text-right mt-1">{bio.length}/{user?.isPremium ? 500 : 190}</p>
              </div>
            </div>

            {/* Status & Custom Status */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Status & Custom Status")}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                    {gt("Online Status")}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "online", label: gt("Online"), color: "#23A559" },
                      { value: "idle", label: gt("Idle"), color: "#F0B232" },
                      { value: "dnd", label: gt("Do Not Disturb"), color: "#EF4444" },
                      { value: "offline", label: gt("Invisible"), color: "#888888" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStatus(opt.value)}
                        className={cn(
                          "h-10 rounded-lg flex items-center gap-2 px-3 text-sm transition-all border border-[var(--border-subtle)]",
                          status === opt.value
                            ? "bg-[var(--bg-sidebar-elevated)] border-[var(--app-accent)] text-[var(--text-primary)]"
                            : "bg-[var(--bg-app)] text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)]"
                        )}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">
                    {gt("Custom Status")}
                  </label>
                  <input
                    type="text"
                    value={customStatus}
                    onChange={(e) => setCustomStatus(e.target.value)}
                    maxLength={128}
                    placeholder={gt("What's on your mind?")}
                    className="w-full h-11 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 text-sm focus:outline-none focus:border-[var(--app-accent)]"
                  />
                </div>
              </div>
            </div>

            {/* Display Name Style */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Display Name Style")}</h3>
                <button
                  onClick={() => setDisplayNameStyle({ font: "default", effect: "solid", color: "", gradient: [] })}
                  className="text-xs text-[var(--app-accent)] flex items-center gap-1 hover:underline"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> {gt("Reset")}
                </button>
              </div>

              <div className="space-y-4">
                {/* Font */}
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">{gt("Choose Font")}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "default", label: gt("Default") },
                      { value: "serif", label: gt("Serif") },
                      { value: "mono", label: gt("Mono") },
                      { value: "rounded", label: gt("Rounded") },
                      { value: "cursive", label: gt("Cursive") },
                      { value: "bold", label: gt("Bold") },
                    ].map((f) => {
                      const isSelected = displayNameStyle.font === f.value;
                      return (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => setDisplayNameStyle((s) => ({ ...s, font: f.value as any }))}
                          className={cn(
                            "h-12 rounded-lg flex flex-col items-center justify-center transition-all border border-[var(--border-subtle)]",
                            isSelected
                              ? "bg-[var(--bg-sidebar-elevated)] border-[var(--app-accent)] text-[var(--text-primary)]"
                              : "bg-[var(--bg-app)] text-[var(--text-secondary)]"
                          )}
                        >
                          <span className={cn("text-sm", getDisplayNameStyleClasses({ font: f.value as any }))} style={getDisplayNameStyleInline({ font: f.value as any })}>
                            {f.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Effect */}
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">{gt("Choose Effect")}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "solid", label: gt("Solid") },
                      { value: "gradient", label: gt("Gradient") },
                      { value: "neon", label: gt("Neon") },
                      { value: "toon", label: gt("Toon") },
                      { value: "pop", label: gt("Pop") },
                    ].map((eff) => {
                      const isSelected = displayNameStyle.effect === eff.value;
                      return (
                        <button
                          key={eff.value}
                          type="button"
                          onClick={() => setDisplayNameStyle((s) => ({ ...s, effect: eff.value as any }))}
                          className={cn(
                            "h-12 rounded-lg flex items-center justify-center transition-all border border-[var(--border-subtle)]",
                            isSelected
                              ? "bg-[var(--bg-sidebar-elevated)] border-[var(--app-accent)] text-[var(--text-primary)]"
                              : "bg-[var(--bg-app)] text-[var(--text-secondary)]"
                          )}
                        >
                          <span
                            className={cn("text-xs truncate px-1", getDisplayNameStyleClasses({ effect: eff.value as any, color: eff.value !== "gradient" ? displayNameStyle.color : undefined, gradient: eff.value === "gradient" ? displayNameStyle.gradient : undefined }))}
                            style={getDisplayNameStyleInline({ effect: eff.value as any, color: displayNameStyle.color || "#fff", gradient: displayNameStyle.gradient?.length ? displayNameStyle.gradient : ["#8B5CF6", "#3B82F6"] })}
                          >
                            {eff.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Colours / Presets */}
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">{gt("Colour Preset")}</label>
                  {displayNameStyle.effect === "gradient" ? (
                    <div className="space-y-3">
                      {/* Custom gradient bar */}
                      {(() => {
                        const g0 = displayNameStyle.gradient?.[0] || "#8B5CF6";
                        const g1 = displayNameStyle.gradient?.[1] || "#EC4899";
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0">{gt("Custom")}</span>
                            <div className="flex items-center justify-between flex-1 rounded-lg h-10 px-2.5" style={{ background: `linear-gradient(90deg, ${g0}, ${g1})` }}>
                              <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g0 }}>
                                <input type="color" value={g0} onChange={(e) => setDisplayNameStyle((s) => ({ ...s, gradient: [e.target.value, s.gradient?.[1] || "#EC4899"] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                              </label>
                              <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g1 }}>
                                <input type="color" value={g1} onChange={(e) => setDisplayNameStyle((s) => ({ ...s, gradient: [s.gradient?.[0] || "#8B5CF6", e.target.value] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                              </label>
                            </div>
                          </div>
                        );
                      })()}
                      {/* Gradient presets */}
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["#FF3366", "#FFD12A"], ["#00E676", "#00B0FF"], ["#D500F9", "#FF1744"], ["#1DE9B6", "#3D5AFE"],
                          ["#FF4081", "#E040FB"], ["#2979FF", "#00E5FF"], ["#7C4DFF", "#E040FB"], ["#F50057", "#FF3366"],
                          ["#FF9800", "#FF5722"], ["#4CAF50", "#8BC34A"], ["#9C27B0", "#673AB7"], ["#3F51B5", "#2196F3"]
                        ].map((grad, i) => {
                          const isSelected = JSON.stringify(displayNameStyle.gradient) === JSON.stringify(grad);
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setDisplayNameStyle((s) => ({ ...s, gradient: grad }))}
                              className="w-8 h-8 rounded-full transition-all relative overflow-hidden border border-white/10"
                              style={{ background: `linear-gradient(135deg, ${grad.join(", ")})`, outline: isSelected ? "2px solid var(--app-accent)" : "none", outlineOffset: 2 }}
                            >
                              {isSelected && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                  <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <label className="relative w-8 h-8 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40 transition-all shrink-0 border border-white/20" style={{ backgroundColor: displayNameStyle.color || "#8B5CF6" }}>
                        <input
                          type="color"
                          value={displayNameStyle.color || "#8B5CF6"}
                          onChange={(e) => setDisplayNameStyle((s) => ({ ...s, color: e.target.value }))}
                          className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0"
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Pencil className="w-3.5 h-3.5 text-white drop-shadow" />
                        </div>
                      </label>
                      <div className="w-px h-8 bg-[var(--border-subtle)] mx-1 shrink-0" />
                      {[
                        "#F43F5E", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6",
                        "#D946EF", "#FF1744", "#00E676", "#00B0FF"
                      ].map((col, i) => {
                        const isSelected = displayNameStyle.color === col;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setDisplayNameStyle((s) => ({ ...s, color: col }))}
                            className="w-8 h-8 rounded-full transition-all relative border border-white/10"
                            style={{ backgroundColor: col, outline: isSelected ? "2px solid var(--app-accent)" : "none", outlineOffset: 2 }}
                          >
                            {isSelected && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <Check className="w-3.5 h-3.5 text-white drop-shadow" />
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
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Nameplate")}</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">{gt("A decorative plate shown behind your name in the member list, DMs, and your sidebar panel.")}</p>
              </div>

              {/* Live preview */}
              <div className="relative rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)]">
                {getNameplateBackground({ nameplate }) && (
                  <div className="absolute inset-0" style={{ background: getNameplateBackground({ nameplate })!, opacity: 0.55, WebkitMaskImage: "linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)", maskImage: "linear-gradient(90deg, #000 70%, rgba(0,0,0,0.35) 100%)" }} />
                )}
                <div className="relative flex items-center gap-2 px-2.5 py-2.5">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarImage src={cdnImage(user?.avatar)} />
                    <AvatarFallback className="bg-[var(--app-accent)] text-white text-xs font-bold">
                      {(displayName || user?.username || "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className={cn("text-sm font-bold text-[var(--text-primary)] truncate", getDisplayNameStyleClasses(displayNameStyle))} style={getDisplayNameStyleInline(displayNameStyle)}>
                    {displayName || user?.username || "Your name"}
                  </span>
                </div>
              </div>

              {/* Type selector — segmented */}
              <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                {([
                  { id: "none", label: gt("None") },
                  { id: "color", label: gt("Solid") },
                  { id: "gradient", label: gt("Gradient") },
                  { id: "preset", label: gt("Presets") },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setNameplate((n) => ({ ...n, type: opt.id }))}
                    className={cn(
                      "flex-1 px-2 py-2 rounded-md text-xs font-semibold transition-colors",
                      (nameplate.type || "none") === opt.id
                        ? "bg-[var(--app-accent)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Solid colours */}
              {nameplate.type === "color" && (
                <div className="flex flex-wrap gap-2">
                  {["#F43F5E", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6", "#D946EF", "#FF9800", "#9C27B0", "#434343"].map((col) => {
                    const on = nameplate.color === col;
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setNameplate((n) => ({ ...n, type: "color", color: col }))}
                        className="w-8 h-8 rounded-full relative transition-all"
                        style={{ backgroundColor: col, boxShadow: on ? "0 0 0 2px var(--bg-card), 0 0 0 4px var(--app-accent)" : "none" }}
                      >
                        {on && <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow-md" />}
                      </button>
                    );
                  })}
                  <label className="relative w-8 h-8 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40 border border-white/20" style={{ backgroundColor: nameplate.color || "#8B5CF6" }}>
                    <input type="color" value={nameplate.color || "#8B5CF6"} onChange={(e) => setNameplate((n) => ({ ...n, type: "color", color: e.target.value }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                    <Pencil className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow-md pointer-events-none" />
                  </label>
                </div>
              )}

              {/* Gradient */}
              {nameplate.type === "gradient" && (() => {
                const g0 = nameplate.gradient?.[0] || "#8B5CF6";
                const g1 = nameplate.gradient?.[1] || "#EC4899";
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0">{gt("Custom")}</span>
                      <div className="flex items-center justify-between flex-1 rounded-lg h-10 px-2.5" style={{ background: `linear-gradient(90deg, ${g0}, ${g1})` }}>
                        <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g0 }}>
                          <input type="color" value={g0} onChange={(e) => setNameplate((n) => ({ ...n, type: "gradient", gradient: [e.target.value, g1] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                        </label>
                        <label className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer ring-2 ring-white/70 shadow" style={{ backgroundColor: g1 }}>
                          <input type="color" value={g1} onChange={(e) => setNameplate((n) => ({ ...n, type: "gradient", gradient: [g0, e.target.value] }))} className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0" />
                        </label>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ["#FF3366", "#FFD12A"], ["#00E676", "#00B0FF"], ["#D500F9", "#FF1744"], ["#1DE9B6", "#3D5AFE"],
                        ["#FF4081", "#E040FB"], ["#2979FF", "#00E5FF"], ["#7C4DFF", "#E040FB"], ["#FF9800", "#FF5722"],
                        ["#4CAF50", "#8BC34A"], ["#9C27B0", "#673AB7"], ["#00BCD4", "#009688"], ["#434343", "#000000"],
                      ].map((grad, i) => {
                        const on = JSON.stringify(nameplate.gradient) === JSON.stringify(grad);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setNameplate((n) => ({ ...n, type: "gradient", gradient: grad }))}
                            className="w-10 h-8 rounded-md relative transition-all"
                            style={{ background: `linear-gradient(90deg, ${grad.join(", ")})`, boxShadow: on ? "0 0 0 2px var(--bg-card), 0 0 0 4px var(--app-accent)" : "none" }}
                          >
                            {on && <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow-md" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Presets */}
              {nameplate.type === "preset" && (
                <div className="grid grid-cols-2 gap-2">
                  {NAMEPLATE_PRESETS.map((preset) => {
                    const on = nameplate.presetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setNameplate((n) => ({ ...n, type: "preset", presetId: preset.id }))}
                        className={cn(
                          "relative h-10 rounded-lg overflow-hidden border transition-all flex items-center px-3",
                          on ? "border-[var(--app-accent)] ring-2 ring-[var(--app-accent)]" : "border-[var(--border-subtle)]"
                        )}
                      >
                        <div className="absolute inset-0" style={{ background: preset.css, opacity: 0.55 }} />
                        <span className="relative text-xs font-semibold text-white drop-shadow-md truncate">{preset.name}</span>
                        {on && <Check className="w-4 h-4 text-white absolute right-2 top-1/2 -translate-y-1/2 drop-shadow-md" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Profile Theme Colour */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Profile Theme")}</h3>
                <button
                  onClick={() => {
                    setProfileColor("");
                    setProfileGradient([]);
                    setProfileGradientAngle(135);
                    setProfileGradientType('linear');
                    setProfileGradientRadialPosition('center');
                    setProfileCardEffect('normal');
                    setProfileCardBlur(8);
                    setProfileCardOpacity(0.85);
                    setProfileCardBorderColor("");
                    setProfileCardBorderGlow(false);
                    setProfileCardBorderWidth(1);
                  }}
                  className="text-xs text-[var(--app-accent)] flex items-center gap-1 hover:underline"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> {gt("Reset")}
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">{gt("Theme Colour")}</label>
                  <div className="flex flex-wrap gap-2">
                    <label className="relative w-8 h-8 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40 transition-all shrink-0 border border-white/20" style={{ backgroundColor: profileColor || "#8B5CF6" }}>
                      <input
                        type="color"
                        value={profileColor || "#8B5CF6"}
                        onChange={(e) => setProfileColor(e.target.value)}
                        className="absolute inset-[-10px] w-[200%] h-[200%] cursor-pointer opacity-0"
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Pencil className="w-3.5 h-3.5 text-white drop-shadow" />
                      </div>
                    </label>
                    <div className="w-px h-8 bg-[var(--border-subtle)] mx-1 shrink-0" />
                    {[
                      "#F43F5E", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6",
                      "#D946EF", "#FF1744", "#00E676", "#00B0FF"
                    ].map((col, i) => {
                      const isSelected = profileColor === col;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setProfileColor(col)}
                          className="w-8 h-8 rounded-full transition-all relative border border-white/10"
                          style={{ backgroundColor: col, outline: isSelected ? "2px solid var(--app-accent)" : "none", outlineOffset: 2 }}
                        >
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">{gt("Gradient Background (Optional)")}</label>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {[
                      ["#FF3366", "#FFD12A"], ["#00E676", "#00B0FF"], ["#D500F9", "#FF1744"], ["#1DE9B6", "#3D5AFE"],
                      ["#FF4081", "#E040FB"], ["#2979FF", "#00E5FF"], ["#7C4DFF", "#E040FB"], ["#F50057", "#FF3366"],
                      ["#FF9800", "#FF5722"], ["#4CAF50", "#8BC34A"], ["#9C27B0", "#673AB7"], ["#3F51B5", "#2196F3"]
                    ].map((grad, i) => {
                      const isSelected = JSON.stringify(profileGradient) === JSON.stringify(grad);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setProfileGradient(grad)}
                          className="w-8 h-8 rounded-full transition-all relative overflow-hidden border border-white/10"
                          style={{ background: `linear-gradient(135deg, ${grad.join(", ")})`, outline: isSelected ? "2px solid var(--app-accent)" : "none", outlineOffset: 2 }}
                        >
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom two-colour gradient (matches PC) */}
                {(() => {
                  const g0 = profileGradient?.[0] || "#8B5CF6";
                  const g1 = profileGradient?.[1] || "#EC4899";
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

                {/* Premium Card Effects */}
                <div className="mt-6 border-t border-[var(--border-subtle)] pt-6">
                  <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">{gt("Premium Card Effect")}</h3>
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    {[
                      { id: 'normal', name: gt('Normal'), desc: gt('Default profile styling') },
                      { id: 'glassmorphism', name: gt('Glassmorphism'), desc: gt('Frosted glass look') },
                      { id: 'glow', name: gt('Outer Glow'), desc: gt('Luminous ambient aura') },
                      { id: 'neon', name: gt('Neon Border'), desc: gt('Vibrant neon edges') },
                      { id: 'holographic', name: gt('Holographic'), desc: gt('Animated color shift') }
                    ].map((effect) => {
                      const isSelected = profileCardEffect === effect.id;
                      return (
                        <button
                          key={effect.id}
                          type="button"
                          onClick={() => setProfileCardEffect(effect.id as any)}
                          className={cn(
                            "p-3 rounded-lg border text-left transition-all relative overflow-hidden",
                            isSelected 
                              ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10" 
                              : "border-[var(--border-subtle)] bg-[var(--bg-sidebar)] hover:border-white/20"
                          )}
                        >
                          <div className="text-xs font-bold text-[var(--text-primary)] mb-0.5">{effect.name}</div>
                          <div className="text-[10px] text-[var(--text-muted)] leading-tight">{effect.desc}</div>
                          {isSelected && (
                            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--app-accent)]" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Glassmorphism Controls */}
                  {profileCardEffect === 'glassmorphism' && (
                    <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg mb-6">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase">{gt("Backdrop Blur")}</label>
                          <span className="text-xs font-mono text-[var(--text-muted)]">{profileCardBlur}px</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="24" 
                          value={profileCardBlur}
                          onChange={(e) => setProfileCardBlur(Number(e.target.value))}
                          className="w-full accent-[var(--app-accent)]"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase">{gt("Card Opacity")}</label>
                          <span className="text-xs font-mono text-[var(--text-muted)]">{Math.round(profileCardOpacity * 100)}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="10" 
                          max="100" 
                          value={Math.round(profileCardOpacity * 100)}
                          onChange={(e) => setProfileCardOpacity(Number(e.target.value) / 100)}
                          className="w-full accent-[var(--app-accent)]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Custom Border Styling */}
                  <div className="bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <input 
                          type="checkbox"
                          id="borderGlow"
                          checked={profileCardBorderGlow}
                          onChange={(e) => setProfileCardBorderGlow(e.target.checked)}
                          className="rounded border-[var(--border-subtle)] text-[var(--app-accent)] focus:ring-[var(--app-accent)] bg-transparent"
                        />
                        <label htmlFor="borderGlow" className="text-xs font-bold text-[var(--text-primary)] cursor-pointer">
                          {gt("Enable Border Glow")}
                        </label>
                      </div>
                      {profileCardBorderColor && (
                        <button 
                          type="button"
                          onClick={() => setProfileCardBorderColor("")} 
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[10px]"
                        >
                          {gt("Reset Colour")}
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 font-medium text-xs">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase">{gt("Border Width")}</label>
                          <span className="text-xs font-mono text-[var(--text-muted)]">{profileCardBorderWidth}px</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" 
                          max="5" 
                          value={profileCardBorderWidth}
                          onChange={(e) => setProfileCardBorderWidth(Number(e.target.value))}
                          className="w-full accent-[var(--app-accent)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2">{gt("Border Colour")}</label>
                        <div className="flex items-center gap-2">
                          <label className="relative w-8 h-8 rounded-full overflow-hidden cursor-pointer ring-2 ring-transparent hover:ring-white/40 transition-all border border-[var(--border-subtle)]" style={{ backgroundColor: profileCardBorderColor || '#ffffff' }}>
                            <input
                              type="color"
                              value={profileCardBorderColor || '#ffffff'}
                              onChange={(e) => setProfileCardBorderColor(e.target.value)}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                          </label>
                          <span className="text-xs font-mono text-[var(--text-muted)] select-all">
                            {profileCardBorderColor ? profileCardBorderColor.toUpperCase() : gt("MATCH THEME")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="w-full py-3 rounded-lg bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity active:scale-[0.99] flex items-center justify-center gap-2"
            >
              {isSaving && <Loader size={16} />}
              {gt("Save Changes")}
            </button>
          </div>
        )}

        {section === "connections" && (
          <div className="space-y-6">
            {!connectionsEnabled && (
              <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-3">
                <Lock className="w-5 h-5 text-yellow-400 shrink-0" />
                <div>
                  <p className="text-yellow-400 font-semibold text-sm">{gt("Connections are temporarily disabled")}</p>
                  <p className="text-yellow-400/70 text-xs">{gt("Account linking has been turned off by staff. You can still disconnect existing accounts.")}</p>
                </div>
              </div>
            )}
            <p className="text-sm text-[var(--text-muted)]">
              {gt("Connect your accounts to display them on your profile.")}
            </p>
            {CONNECTION_CATEGORIES.map((cat) => {
              const catProviders = CONNECTION_PROVIDERS.filter((p) => p.category === cat.id);
              return (
                <div key={cat.id} className="space-y-3">
                  <h3 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider px-1">
                    {connectionCategoryLabel(cat.id, gt)}
                  </h3>
                  <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
                    {catProviders.map((prov) => {
                      const conn = connections.find((c) => c.provider === prov.id);
                      const isExpanded = connectingProvider === prov.id;
                      return (
                        <div key={prov.id} className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                style={{ backgroundColor: prov.bg }}
                              >
                                {(() => {
                                  const Icon = getConnectionIcon(prov.id);
                                  return <Icon size={18} style={{ color: prov.color }} />;
                                })()}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-white">{prov.label}</p>
                                {conn ? (
                                  <p className="text-xs text-[#22c55e] truncate flex items-center gap-1">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                                    {conn.displayName || conn.username || conn.accountId}
                                  </p>
                                ) : (
                                  <p className="text-xs text-[var(--text-muted)]">{connectionProviderHint(prov.id, gt)}</p>
                                )}
                              </div>
                            </div>
                            {conn ? (
                              prov.id === "serika" || prov.id === "discord" ? (
                                <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--app-accent)]/10 text-[var(--app-accent)]">
                                  {gt("Managed")}
                                </span>
                              ) : (
                                <button
                                  onClick={async () => {
                                    const res = await fetch(`/api/users/me/connections/${conn.id}`, { method: "DELETE" });
                                    if (res.ok) {
                                      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
                                      toast.success(gt("{provider} disconnected", { provider: prov.label }));
                                    } else {
                                      toast.error(gt("Failed to disconnect"));
                                    }
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                >
                                  {gt("Disconnect")}
                                </button>
                              )
                            ) : prov.id === "serika" || prov.id === "discord" ? (
                              <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--app-accent)]/10 text-[var(--app-accent)]">
                                {gt("Managed")}
                              </span>
                            ) : disabledProviders.includes(prov.id) ? (
                              <button
                                disabled
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400/50 cursor-not-allowed border border-red-500/20"
                              >
                                {gt("Disabled")}
                              </button>
                            ) : connectionsEnabled ? (
                              prov.id === "website" ? (
                                <button
                                  onClick={() => {
                                    setConnectingProvider(isExpanded ? null : prov.id);
                                    setConnectingValue("");
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
                                  style={{ backgroundColor: prov.color }}
                                >
                                  {isExpanded ? gt("Cancel") : gt("Connect")}
                                </button>
                              ) : (
                                <a
                                  href={`/api/auth/${prov.id}/initiate`}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 inline-block"
                                  style={{ backgroundColor: prov.color }}
                                >
                                  {gt("Connect")}
                                </a>
                              )
                            ) : (
                              <button
                                disabled
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-[#555] cursor-not-allowed"
                              >
                                {gt("Connect")}
                              </button>
                            )}
                          </div>

                          {conn && (
                            <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]/40">
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
                                      setConnections((prev) =>
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
                          )}

                          {isExpanded && prov.id === "website" && (
                            <div className="flex gap-2 pt-2">
                              <input
                                type="text"
                                placeholder="https://example.com"
                                value={connectingValue}
                                onChange={(e) => setConnectingValue(e.target.value)}
                                className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
                              />
                              <button
                                onClick={async () => {
                                  if (!connectingValue.trim()) return;
                                  try {
                                    const res = await fetch("/api/users/me/connections", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ provider: "website", accountId: connectingValue.trim() }),
                                    });
                                    if (res.ok) {
                                      const data = await res.json();
                                      setConnections((prev) => [data.connection, ...prev.filter((c) => c.provider !== "website")]);
                                      toast.success(gt("Website connected"));
                                      setConnectingProvider(null);
                                      setConnectingValue("");
                                    } else {
                                      const err = await res.json().catch(() => ({}));
                                      toast.error(err.error || gt("Failed to connect"));
                                    }
                                  } catch {
                                    toast.error(gt("Failed to connect"));
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
                              >
                                {gt("Save")}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isSaving && (
        <div className="absolute bottom-6 right-6 px-3 py-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm flex items-center gap-2">
          <Loader size={16} />
          {gt("Saving...")}
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <span className="text-[var(--text-primary)]">{label}</span>
      <ToggleSwitch size="sm" checked={checked} onCheckedChange={(checked) => onChange(checked)} />
    </label>
  );
}
