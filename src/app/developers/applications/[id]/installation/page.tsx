"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Copy, Check, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { PERMISSION_BITS } from "@/lib/permissions/bits";
import { serikaToDiscord } from "@/lib/botapi/permissionBits";

const allScopes = [
  "bot", "applications.commands", "applications.commands.permissions.update",
  "identify", "email", "connections", "guilds", "guilds.join",
  "guilds.members.read", "messages.read", "rpc", "rpc.notifications.read",
  "webhook.incoming", "dm_channels.read", "voice", "activity.read", "activity.write",
];

// Install-link names -> Serika's canonical bits (src/lib/permissions/bits.ts).
const permissionBits: Record<string, bigint> = {
  CREATE_INSTANT_INVITE: PERMISSION_BITS.CREATE_INVITE,
  KICK_MEMBERS: PERMISSION_BITS.KICK_MEMBERS,
  BAN_MEMBERS: PERMISSION_BITS.BAN_MEMBERS,
  ADMINISTRATOR: PERMISSION_BITS.ADMINISTRATOR,
  MANAGE_CHANNELS: PERMISSION_BITS.MANAGE_CHANNELS,
  MANAGE_GUILD: PERMISSION_BITS.MANAGE_SERVER,
  ADD_REACTIONS: PERMISSION_BITS.ADD_REACTIONS,
  VIEW_AUDIT_LOG: PERMISSION_BITS.VIEW_AUDIT_LOG,
  VIEW_GUILD_INSIGHTS: PERMISSION_BITS.VIEW_SERVER_INSIGHTS,
  VIEW_CHANNEL: PERMISSION_BITS.VIEW_CHANNEL,
  SEND_MESSAGES: PERMISSION_BITS.SEND_MESSAGES,
  SEND_TTS_MESSAGES: PERMISSION_BITS.SEND_TTS_MESSAGES,
  MANAGE_MESSAGES: PERMISSION_BITS.MANAGE_MESSAGES,
  EMBED_LINKS: PERMISSION_BITS.EMBED_LINKS,
  ATTACH_FILES: PERMISSION_BITS.ATTACH_FILES,
  READ_MESSAGE_HISTORY: PERMISSION_BITS.READ_MESSAGE_HISTORY,
  MENTION_EVERYONE: PERMISSION_BITS.MENTION_EVERYONE,
  USE_EXTERNAL_EMOJIS: PERMISSION_BITS.USE_EXTERNAL_EMOJIS,
  CONNECT: PERMISSION_BITS.CONNECT,
  SPEAK: PERMISSION_BITS.SPEAK,
  STREAM: PERMISSION_BITS.VIDEO,
  MUTE_MEMBERS: PERMISSION_BITS.MUTE_MEMBERS,
  DEAFEN_MEMBERS: PERMISSION_BITS.DEAFEN_MEMBERS,
  MOVE_MEMBERS: PERMISSION_BITS.MOVE_MEMBERS,
  USE_VAD: PERMISSION_BITS.USE_VOICE_ACTIVITY,
  PRIORITY_SPEAKER: PERMISSION_BITS.PRIORITY_SPEAKER,
  CHANGE_NICKNAME: PERMISSION_BITS.CHANGE_NICKNAME,
  MANAGE_NICKNAMES: PERMISSION_BITS.MANAGE_NICKNAMES,
  MANAGE_ROLES: PERMISSION_BITS.MANAGE_ROLES,
  MANAGE_WEBHOOKS: PERMISSION_BITS.MANAGE_WEBHOOKS,
  MANAGE_EMOJIS_AND_STICKERS: PERMISSION_BITS.MANAGE_EMOJIS_AND_STICKERS,
  CREATE_GUILD_EXPRESSIONS: PERMISSION_BITS.CREATE_EXPRESSIONS,
  USE_APPLICATION_COMMANDS: PERMISSION_BITS.USE_APPLICATION_COMMANDS,
  REQUEST_TO_SPEAK: PERMISSION_BITS.REQUEST_TO_SPEAK,
  MANAGE_EVENTS: PERMISSION_BITS.MANAGE_EVENTS,
  CREATE_EVENTS: PERMISSION_BITS.CREATE_EVENTS,
  MANAGE_THREADS: PERMISSION_BITS.MANAGE_THREADS,
  CREATE_PUBLIC_THREADS: PERMISSION_BITS.CREATE_PUBLIC_THREADS,
  CREATE_PRIVATE_THREADS: PERMISSION_BITS.CREATE_PRIVATE_THREADS,
  USE_EXTERNAL_STICKERS: PERMISSION_BITS.USE_EXTERNAL_STICKERS,
  SEND_MESSAGES_IN_THREADS: PERMISSION_BITS.SEND_MESSAGES_IN_THREADS,
  USE_EMBEDDED_ACTIVITIES: PERMISSION_BITS.USE_EMBEDDED_ACTIVITIES,
  MODERATE_MEMBERS: PERMISSION_BITS.MODERATE_MEMBERS,
  USE_SOUNDBOARD: PERMISSION_BITS.USE_SOUNDBOARD,
  USE_EXTERNAL_SOUNDS: PERMISSION_BITS.USE_EXTERNAL_SOUNDS,
  SEND_VOICE_MESSAGES: PERMISSION_BITS.SEND_VOICE_MESSAGES,
  SET_VOICE_CHANNEL_STATUS: PERMISSION_BITS.SET_VOICE_CHANNEL_STATUS,
  SEND_POLLS: PERMISSION_BITS.SEND_POLLS,
  USE_EXTERNAL_APPS: PERMISSION_BITS.USE_EXTERNAL_APPS,
  PIN_MESSAGES: PERMISSION_BITS.PIN_MESSAGES,
};

const bitmaskOf = (names: string[]) => names.reduce((acc, p) => acc | (permissionBits[p] ?? 0n), 0n);

const permissions = [
  { name: "Create Invite", value: "CREATE_INSTANT_INVITE" },
  { name: "Kick Members", value: "KICK_MEMBERS" },
  { name: "Ban Members", value: "BAN_MEMBERS" },
  { name: "Administrator", value: "ADMINISTRATOR" },
  { name: "Manage Channels", value: "MANAGE_CHANNELS" },
  { name: "Manage Server", value: "MANAGE_GUILD" },
  { name: "Add Reactions", value: "ADD_REACTIONS" },
  { name: "View Audit Log", value: "VIEW_AUDIT_LOG" },
  { name: "View Server Insights", value: "VIEW_GUILD_INSIGHTS" },
  { name: "View Channels", value: "VIEW_CHANNEL" },
  { name: "Send Messages", value: "SEND_MESSAGES" },
  { name: "Send TTS Messages", value: "SEND_TTS_MESSAGES" },
  { name: "Manage Messages", value: "MANAGE_MESSAGES" },
  { name: "Embed Links", value: "EMBED_LINKS" },
  { name: "Attach Files", value: "ATTACH_FILES" },
  { name: "Read Message History", value: "READ_MESSAGE_HISTORY" },
  { name: "Mention Everyone", value: "MENTION_EVERYONE" },
  { name: "Use External Emojis", value: "USE_EXTERNAL_EMOJIS" },
  { name: "Connect", value: "CONNECT" },
  { name: "Speak", value: "SPEAK" },
  { name: "Video", value: "STREAM" },
  { name: "Mute Members", value: "MUTE_MEMBERS" },
  { name: "Deafen Members", value: "DEAFEN_MEMBERS" },
  { name: "Move Members", value: "MOVE_MEMBERS" },
  { name: "Use Voice Activity", value: "USE_VAD" },
  { name: "Priority Speaker", value: "PRIORITY_SPEAKER" },
  { name: "Change Nickname", value: "CHANGE_NICKNAME" },
  { name: "Manage Nicknames", value: "MANAGE_NICKNAMES" },
  { name: "Manage Roles", value: "MANAGE_ROLES" },
  { name: "Manage Webhooks", value: "MANAGE_WEBHOOKS" },
  { name: "Manage Emojis", value: "MANAGE_EMOJIS_AND_STICKERS" },
  { name: "Create Expressions", value: "CREATE_GUILD_EXPRESSIONS" },
  { name: "Use Application Commands", value: "USE_APPLICATION_COMMANDS" },
  { name: "Request to Speak", value: "REQUEST_TO_SPEAK" },
  { name: "Manage Events", value: "MANAGE_EVENTS" },
  { name: "Create Events", value: "CREATE_EVENTS" },
  { name: "Manage Threads", value: "MANAGE_THREADS" },
  { name: "Create Public Threads", value: "CREATE_PUBLIC_THREADS" },
  { name: "Create Private Threads", value: "CREATE_PRIVATE_THREADS" },
  { name: "Use External Stickers", value: "USE_EXTERNAL_STICKERS" },
  { name: "Send Messages in Threads", value: "SEND_MESSAGES_IN_THREADS" },
  { name: "Use Embedded Activities", value: "USE_EMBEDDED_ACTIVITIES" },
  { name: "Moderate Members", value: "MODERATE_MEMBERS" },
  { name: "Use Soundboard", value: "USE_SOUNDBOARD" },
  { name: "Use External Sounds", value: "USE_EXTERNAL_SOUNDS" },
  { name: "Send Voice Messages", value: "SEND_VOICE_MESSAGES" },
  { name: "Set Voice Channel Status", value: "SET_VOICE_CHANNEL_STATUS" },
  { name: "Create Polls", value: "SEND_POLLS" },
  { name: "Use External Apps", value: "USE_EXTERNAL_APPS" },
  { name: "Pin Messages", value: "PIN_MESSAGES" },
];

type GTFunc = ReturnType<typeof useGT>;

function permNameLabel(value: string, gt: GTFunc): string {
  switch (value) {
    case 'CREATE_INSTANT_INVITE': return gt('Create Invite');
    case 'KICK_MEMBERS': return gt('Kick Members');
    case 'BAN_MEMBERS': return gt('Ban Members');
    case 'ADMINISTRATOR': return gt('Administrator');
    case 'MANAGE_CHANNELS': return gt('Manage Channels');
    case 'MANAGE_GUILD': return gt('Manage Server');
    case 'ADD_REACTIONS': return gt('Add Reactions');
    case 'VIEW_AUDIT_LOG': return gt('View Audit Log');
    case 'VIEW_GUILD_INSIGHTS': return gt('View Server Insights');
    case 'VIEW_CHANNEL': return gt('View Channels');
    case 'SEND_MESSAGES': return gt('Send Messages');
    case 'SEND_TTS_MESSAGES': return gt('Send TTS Messages');
    case 'MANAGE_MESSAGES': return gt('Manage Messages');
    case 'EMBED_LINKS': return gt('Embed Links');
    case 'ATTACH_FILES': return gt('Attach Files');
    case 'READ_MESSAGE_HISTORY': return gt('Read Message History');
    case 'MENTION_EVERYONE': return gt('Mention Everyone');
    case 'USE_EXTERNAL_EMOJIS': return gt('Use External Emojis');
    case 'CONNECT': return gt('Connect');
    case 'SPEAK': return gt('Speak');
    case 'STREAM': return gt('Video');
    case 'MUTE_MEMBERS': return gt('Mute Members');
    case 'DEAFEN_MEMBERS': return gt('Deafen Members');
    case 'MOVE_MEMBERS': return gt('Move Members');
    case 'USE_VAD': return gt('Use Voice Activity');
    case 'PRIORITY_SPEAKER': return gt('Priority Speaker');
    case 'CHANGE_NICKNAME': return gt('Change Nickname');
    case 'MANAGE_NICKNAMES': return gt('Manage Nicknames');
    case 'MANAGE_ROLES': return gt('Manage Roles');
    case 'MANAGE_WEBHOOKS': return gt('Manage Webhooks');
    case 'MANAGE_EMOJIS_AND_STICKERS': return gt('Manage Emojis');
    case 'CREATE_GUILD_EXPRESSIONS': return gt('Create Expressions');
    case 'USE_APPLICATION_COMMANDS': return gt('Use Application Commands');
    case 'REQUEST_TO_SPEAK': return gt('Request to Speak');
    case 'MANAGE_EVENTS': return gt('Manage Events');
    case 'MANAGE_THREADS': return gt('Manage Threads');
    case 'CREATE_PUBLIC_THREADS': return gt('Create Public Threads');
    case 'CREATE_PRIVATE_THREADS': return gt('Create Private Threads');
    case 'USE_EXTERNAL_STICKERS': return gt('Use External Stickers');
    case 'SEND_MESSAGES_IN_THREADS': return gt('Send Messages in Threads');
    case 'USE_EMBEDDED_ACTIVITIES': return gt('Use Embedded Activities');
    case 'MODERATE_MEMBERS': return gt('Moderate Members');
    case 'CREATE_EVENTS': return gt('Create Events');
    case 'USE_SOUNDBOARD': return gt('Use Soundboard');
    case 'USE_EXTERNAL_SOUNDS': return gt('Use External Sounds');
    case 'SEND_VOICE_MESSAGES': return gt('Send Voice Messages');
    case 'SET_VOICE_CHANNEL_STATUS': return gt('Set Voice Channel Status');
    case 'SEND_POLLS': return gt('Create Polls');
    case 'USE_EXTERNAL_APPS': return gt('Use External Apps');
    case 'PIN_MESSAGES': return gt('Pin Messages');
    default: return value;
  }
}

export default function InstallationPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading, saving, saveApp } = useApplication(appId);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["bot"]);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [customInstallUrl, setCustomInstallUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (app) {
      setSelectedScopes(app.installParams?.scopes || ["bot"]);
      setCustomInstallUrl(app.customInstallUrl || "");
      // Saved install params use Serika's bit numbers.
      let savedPerms = 0n;
      try { savedPerms = BigInt(app.installParams?.permissions || "0"); } catch { /* malformed */ }
      if (savedPerms > 0n) {
        const names = Object.entries(permissionBits)
          .filter(([, bit]) => (savedPerms & bit) === bit)
          .map(([name]) => name);
        setSelectedPerms(names);
      }
    }
  }, [app]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const togglePerm = (perm: string) => {
    setSelectedPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  // Snowflake-format apps read install links with Discord's bit numbers
  // (the authorize page converts them back to Serika's).
  const selectedMask = bitmaskOf(selectedPerms);
  const linkMask = app?.apiIdFormat === "snowflake" ? serikaToDiscord(selectedMask) : selectedMask;
  const installLink = `https://api.serika.chat/api/oauth2/authorize?client_id=${app?.clientId || appId}&scope=${selectedScopes.join("+")}${selectedPerms.length > 0 ? `&permissions=${linkMask}` : ""}`;

  const handleSave = async () => {
    const permBitmask = selectedMask;
    await saveApp({
      installParams: { scopes: selectedScopes, permissions: String(permBitmask) },
      customInstallUrl,
    });
    toast.success(gt("Installation settings saved"));
  };

  const copyLink = () => {
    navigator.clipboard.writeText(customInstallUrl || installLink);
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

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">{gt("Installation")}</h1>

      {/* Install Link */}
      <div className="mb-8">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Install Link")}
        </label>
        <div className="flex items-center gap-2 bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5">
          <code className="text-sm text-[#ccc] flex-1 truncate font-mono">
            {customInstallUrl || installLink}
          </code>
          <button
            onClick={copyLink}
            className="p-1.5 rounded hover:bg-white/10 text-[#888] hover:text-white transition-colors"
          >
            {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
          </button>
        </div>
      </div>

      {/* Custom Install URL */}
      <div className="mb-8">
        <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
          {gt("Custom Install URL (Optional)")}
        </label>
        <input
          type="text"
          value={customInstallUrl}
          onChange={(e) => setCustomInstallUrl(e.target.value)}
          placeholder="https://your-site.com/install"
          className="w-full bg-[#1a1a1a] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50"
        />
        <p className="text-xs text-[#666] mt-1.5">
          {gt("Override the default install link with your own.")}
        </p>
      </div>

      {/* OAuth2 Scopes */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold mb-3">{gt("Authorization Scopes")}</h3>
        <p className="text-xs text-[#666] mb-3">
          {gt("Select the scopes your app requests during installation.")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {allScopes.map((scope) => (
            <label
              key={scope}
              className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 cursor-pointer hover:bg-white/[0.04] transition-colors"
            >
              <ToggleSwitch
                size="sm"
                checked={selectedScopes.includes(scope)}
                onCheckedChange={() => toggleScope(scope)}
                aria-label={scope}
              />
              <span className="text-xs font-mono text-[#ccc]">{scope}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Bot Permissions */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold mb-3">{gt("Bot Permissions")}</h3>
        <p className="text-xs text-[#666] mb-3">
          {gt("Select the permissions your bot needs. These are requested during installation.")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {permissions.map((perm) => (
            <label
              key={perm.value}
              className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 cursor-pointer hover:bg-white/[0.04] transition-colors"
            >
              <ToggleSwitch
                size="sm"
                checked={selectedPerms.includes(perm.value)}
                onCheckedChange={() => togglePerm(perm.value)}
                aria-label={permNameLabel(perm.value, gt)}
              />
              <span className="text-xs text-[#ccc]">{permNameLabel(perm.value, gt)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-sm font-medium rounded-md transition-colors"
        >
          {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
          {gt("Save Changes")}
        </button>
      </div>
    </div>
  );
}
