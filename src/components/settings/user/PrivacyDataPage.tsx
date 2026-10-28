"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import {
  Activity,
  BarChart3,
  ChevronRight,
  Database,
  ExternalLink,
  Eye,
  Keyboard,
  MessageSquare,
  ShieldCheck,
  Share2,
  UserPlus,
} from "lucide-react";
import { SettingsCard, SettingsPageHeader, SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { SettingsRadioCards } from "@/components/settings/blocks/SettingsRadioCards";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsButton, settingsButtonClass } from "@/components/settings/blocks/SettingsButton";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsDangerZone } from "@/components/settings/blocks/SettingsDangerZone";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useServerOptional } from "@/contexts/ServerContext";
import {
  activitySharing,
  dmAllowedViaServer,
  dmAudience,
  dmServerOverrides,
  friendRequestSources,
  messageRequestsEnabled,
  typingIndicatorsEnabled,
  type DmAudience,
} from "@/lib/settings/privacy";
import { cdnImage, cn } from "@/lib/utils";
import type { UserSettingsValue } from "@/components/settings/user/types";
import type { SettingsPatch } from "@/lib/settings/mergeSettings";

/** Serika Accounts owns email, password, passkeys and account deletion. */
const ACCOUNTS_SETTINGS_URL = "https://accounts.serika.dev/settings";
const PRIVACY_EMAIL = "privacy@serika.dev";
/** Show a filter over the per-server list past this many servers. */
const SERVER_FILTER_THRESHOLD = 8;

/** Other settings pages this one links to. */
export type PrivacyLinkTarget = "profiles" | "connections" | "devices" | "authorized-apps" | "encryption" | "bug-reports";

/** Expandable "What this does" under a row: the exact rules, in plain words. */
function Details({ children }: { children: ReactNode }) {
  const gt = useGT();
  return (
    <details className="group/details mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
      <summary
        className={cn(
          "inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md text-xs font-semibold text-[var(--app-accent)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight aria-hidden className="h-3.5 w-3.5 transition-transform duration-(--motion-fast) group-open/details:rotate-90" />
        {gt("What this does")}
      </summary>
      <div className="mt-1.5 space-y-1.5 rounded-lg bg-[var(--bg-hover)] px-3 py-2.5">{children}</div>
    </details>
  );
}

function LinkButton({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  if (!onClick) return null;
  return (
    <SettingsButton variant="secondary" size="sm" onClick={onClick}>
      {children}
    </SettingsButton>
  );
}

/**
 * Settings → Data & Privacy: who can reach you, what others see, and what
 * SerikaCord keeps. Every option says exactly what it does; the rules here
 * match the server checks (lib/settings/privacy.ts and its callers).
 * Shared by the desktop settings dialog and the mobile settings page.
 */
export const PrivacyDataPage = memo(function PrivacyDataPage({
  userSettings,
  save,
  onNavigate,
  e2eeAvailable = false,
  headerActions,
}: {
  userSettings: UserSettingsValue;
  /** Applies + PATCHes a settings patch (saves immediately, like every toggle page). */
  save: (patch: SettingsPatch) => unknown;
  /** Opens another settings page; links are hidden when absent. */
  onNavigate?: (target: PrivacyLinkTarget) => void;
  /** Show the end-to-end encryption note and link. */
  e2eeAvailable?: boolean;
  headerActions?: ReactNode;
}) {
  const gt = useGT();
  const confirm = useConfirm();
  const { user } = useAuth();
  const serverCtx = useServerOptional();
  const servers = useMemo(() => serverCtx?.servers ?? [], [serverCtx?.servers]);
  const [serverFilter, setServerFilter] = useState("");
  const [clearingHistory, setClearingHistory] = useState(false);

  const s = userSettings;
  const audience: DmAudience = dmAudience(s);
  const overrides = dmServerOverrides(s);
  const sharing = activitySharing(s);
  const sources = friendRequestSources(s);
  const nobodyFriends = s?.privacy?.friendRequests === "none" || s?.friendRequests?.allowEveryone === false;
  const typing = typingIndicatorsEnabled(s);
  const requests = messageRequestsEnabled(s);
  // The client shows a chosen Invisible as "offline" (stored as "invisible").
  const invisible = user?.status === "offline";
  const storeHistory = s?.privacy?.storeActivityHistory !== false;
  const link = (target: PrivacyLinkTarget) => (onNavigate ? () => onNavigate(target) : undefined);

  // Overrides that change anything for the servers you're in right now.
  const serverIds = useMemo(() => new Set(servers.map((sv) => sv.id.toLowerCase())), [servers]);
  const overrideCount = audience === "servers"
    ? overrides.block.filter((id) => serverIds.has(id)).length
    : audience === "friends"
      ? overrides.allow.filter((id) => serverIds.has(id)).length
      : 0;
  const filteredServers = useMemo(() => {
    const q = serverFilter.trim().toLowerCase();
    const sorted = [...servers].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((sv) => sv.name.toLowerCase().includes(q)) : sorted;
  }, [servers, serverFilter]);

  const setAudience = (next: DmAudience) => {
    // Keep the legacy key older clients read in step ("friends" = off).
    save({ privacy: { directMessages: next }, friendRequests: { allowServerMembers: next !== "friends" } });
  };
  const setServerDm = (serverId: string, allowed: boolean) => {
    const id = serverId.toLowerCase();
    if (audience === "servers") {
      const block = allowed ? overrides.block.filter((x) => x !== id) : [...overrides.block.filter((x) => x !== id), id];
      save({ privacy: { dmBlockedServerIds: block } });
    } else if (audience === "friends") {
      const allow = allowed ? [...overrides.allow.filter((x) => x !== id), id] : overrides.allow.filter((x) => x !== id);
      save({ privacy: { dmAllowedServerIds: allow } });
    }
  };
  const resetServerDm = () => save({ privacy: { dmAllowedServerIds: [], dmBlockedServerIds: [] } });

  const setFriendSources = (next: { everyone: boolean; friendsOfFriends: boolean; serverMembers: boolean }) => {
    const any = next.everyone || next.friendsOfFriends || next.serverMembers;
    save({
      privacy: { friendRequests: any ? "everyone" : "none", friendRequestSources: next },
      // Keep the legacy master switch in step (older clients read it).
      friendRequests: { allowEveryone: any },
    });
  };
  // Sub-switches keep their own value while the master switch is off.
  const rawSharing = s?.privacy?.activitySharing || {};
  const shareGames = rawSharing.games !== false;
  const shareWatching = rawSharing.watching !== false;
  const shareMusic = rawSharing.music !== false;
  // Objects merge server-side, so only the changed source is sent.
  const setSharing = (patch: Partial<{ games: boolean; watching: boolean; music: boolean }>) =>
    save({ privacy: { activitySharing: patch } });

  const clearHistory = async () => {
    const ok = await confirm({
      title: gt("Clear your recent activity?"),
      description: gt("This deletes the list of games and apps on your profile. It can't be undone."),
      confirmLabel: gt("Clear history"),
    });
    if (!ok) return;
    setClearingHistory(true);
    try {
      const res = await fetch("/api/users/me/activity-history", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      toast.success(gt("Recent activity cleared"));
    } catch {
      toast.error(gt("Couldn't clear your recent activity"));
    } finally {
      setClearingHistory(false);
    }
  };

  const dmLabel = audience === "everyone" ? gt("Everyone") : audience === "servers" ? gt("Server members") : gt("Friends only");
  const friendLabel = nobodyFriends
    ? gt("Nobody")
    : sources.everyone
      ? gt("Everyone")
      : sources.friendsOfFriends && sources.serverMembers
        ? gt("Friends of friends & server members")
        : sources.friendsOfFriends
          ? gt("Friends of friends")
          : gt("Server members");

  return (
    <div className="space-y-10">
      <SettingsPageHeader
        title={gt("Data & Privacy")}
        description={gt("Who can reach you, what others can see, and what SerikaCord keeps. Changes save as soon as you make them.")}
        actions={headerActions}
      />

      {!s ? (
        <SettingsSkeleton variant="rows" count={8} />
      ) : (
        <>
          {/* At a glance: the effective state of the most important choices. */}
          <SettingsSection title={gt("At a glance")}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Glance icon={MessageSquare} label={gt("Who can DM you")} value={dmLabel}
                hint={overrideCount > 0 ? gt("Per-server overrides: {count}", { count: overrideCount }) : undefined} />
              <Glance icon={UserPlus} label={gt("Friend requests from")} value={friendLabel} />
              <Glance icon={Activity} label={gt("Activity")}
                value={!sharing.enabled ? gt("Hidden") : invisible ? gt("Hidden while Invisible") : gt("Shared")} />
              <Glance icon={BarChart3} label={gt("Analytics & tracking")} value={gt("None collected")} />
            </div>
          </SettingsSection>

          {/* ── Who can message you ───────────────────────────────────── */}
          <SettingsSection
            title={gt("Who can message you")}
            icon={MessageSquare}
            description={gt("Decides who can start a 1:1 DM or call you. Friends can always reach you.")}
          >
            <SettingsRadioCards
              ariaLabel={gt("Who can send you direct messages")}
              value={audience}
              onChange={setAudience}
              options={[
                { value: "everyone", label: gt("Everyone"), description: gt("Anyone with a SerikaCord account can message you, even without a shared server.") },
                { value: "servers", label: gt("Server members"), description: gt("Your friends, and people who share at least one server with you.") },
                { value: "friends", label: gt("Friends only"), description: gt("Only your friends, plus members of servers you allow below.") },
              ]}
            />
            <SettingsCard>
              <SettingsRow
                label={gt("How direct message privacy works")}
                description={gt("The rules behind the choice above.")}
              >
                <Details>
                  <p>{gt("This is checked every time someone sends you a DM or calls you, not only when a conversation starts. If someone stops qualifying (you unfriend them, or you no longer share a server), they can still read your past messages but can't send new ones or call you.")}</p>
                  <p>{gt("Friends and SerikaCord system messages always get through. Bots can only DM you if they share a server with you and this setting lets members of that server in.")}</p>
                  <p>{gt("Group DMs are separate: only your friends can add you to one.")}</p>
                  <p>{gt("Blocked people can never message you, call you or send you a friend request, whatever you pick here.")}</p>
                </Details>
              </SettingsRow>
              <SettingsToggleRow
                label={gt("Message requests")}
                description={gt("New DMs from people who aren't your friends go to Message Requests until you accept them.")}
                checked={requests}
                onCheckedChange={(checked) => save({ privacy: { messageRequests: checked } })}
              >
                <Details>
                  <p>{gt("A request arrives without a notification and stays out of your DM list. Accepting it, or replying, turns it into a normal DM. Ignoring it hides it from you.")}</p>
                  <p>{gt("Friends, bots and SerikaCord system accounts never land in requests, and conversations that were already going aren't affected.")}</p>
                  <p>{gt("This doesn't decide who may message you; that's the choice above. When off, allowed DMs from non-friends go straight to your DM list.")}</p>
                </Details>
              </SettingsToggleRow>
            </SettingsCard>
          </SettingsSection>

          {/* ── Per-server DMs ────────────────────────────────────────── */}
          <SettingsSection
            title={gt("Direct messages per server")}
            description={
              audience === "everyone"
                ? gt("Everyone can already message you, so these switches have no effect. Pick “Server members” or “Friends only” to use them.")
                : audience === "servers"
                  ? gt("Turn a server off to stop its members from messaging you because of it. They can still message you if you share another server that's on.")
                  : gt("Turn a server on to let its members message you, even though you otherwise only take DMs from friends.")
            }
            action={
              overrideCount > 0 ? (
                <SettingsButton variant="ghost" size="sm" onClick={resetServerDm}>{gt("Reset")}</SettingsButton>
              ) : undefined
            }
          >
            {servers.length === 0 ? (
              <SettingsCard>
                <SettingsRow label={gt("You're not in any servers yet")} />
              </SettingsCard>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <SettingsStatusPill tone={overrideCount > 0 ? "accent" : "neutral"}>
                    {overrideCount > 0 ? gt("Per-server overrides: {count}", { count: overrideCount }) : gt("No server overrides")}
                  </SettingsStatusPill>
                  {servers.length > SERVER_FILTER_THRESHOLD && (
                    <SettingsSearchInput
                      value={serverFilter}
                      onValueChange={setServerFilter}
                      placeholder={gt("Find a server")}
                      clearLabel={gt("Clear")}
                      className="w-full sm:ml-auto sm:w-56"
                    />
                  )}
                </div>
                <SettingsCard className="max-h-[22rem] overflow-y-auto">
                  {filteredServers.map((server) => (
                    <SettingsToggleRow
                      key={server.id}
                      label={
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar className="h-7 w-7 shrink-0 rounded-lg">
                            <AvatarImage src={cdnImage(server.icon)} alt="" />
                            <AvatarFallback className="rounded-lg bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-secondary)]">
                              {server.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{server.name}</span>
                        </span>
                      }
                      disabled={audience === "everyone"}
                      checked={dmAllowedViaServer(s, server.id)}
                      onCheckedChange={(checked) => setServerDm(server.id, checked)}
                      className="[&>label]:py-2.5"
                    />
                  ))}
                  {filteredServers.length === 0 && <SettingsRow label={gt("No servers match")} />}
                </SettingsCard>
              </>
            )}
          </SettingsSection>

          {/* ── Friend requests ───────────────────────────────────────── */}
          <SettingsSection title={gt("Friend requests")} icon={UserPlus} description={gt("Who can send you a friend request. Turn all three off to stop requests completely.")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Everyone")}
                description={gt("Anyone who knows your username.")}
                checked={!nobodyFriends && sources.everyone}
                onCheckedChange={(checked) => setFriendSources(checked
                  ? { everyone: true, friendsOfFriends: true, serverMembers: true }
                  : { everyone: false, friendsOfFriends: !nobodyFriends && sources.friendsOfFriends, serverMembers: !nobodyFriends && sources.serverMembers })}
              />
              <SettingsToggleRow
                label={gt("Friends of friends")}
                description={gt("People who are friends with at least one of your friends.")}
                checked={!nobodyFriends && sources.friendsOfFriends}
                disabled={!nobodyFriends && sources.everyone}
                onCheckedChange={(checked) => setFriendSources({ everyone: false, friendsOfFriends: checked, serverMembers: !nobodyFriends && sources.serverMembers })}
              />
              <SettingsToggleRow
                label={gt("Server members")}
                description={gt("People who share at least one server with you.")}
                checked={!nobodyFriends && sources.serverMembers}
                disabled={!nobodyFriends && sources.everyone}
                onCheckedChange={(checked) => setFriendSources({ everyone: false, friendsOfFriends: !nobodyFriends && sources.friendsOfFriends, serverMembers: checked })}
              >
                <Details>
                  <p>{gt("“Everyone” includes the other two, so they're locked on while it's on.")}</p>
                  <p>{gt("With all three off, nobody can send you a request, but you can still send requests and people can accept them.")}</p>
                  <p>{gt("Blocked people and SerikaCord system accounts can never send you a request.")}</p>
                </Details>
              </SettingsToggleRow>
            </SettingsCard>
          </SettingsSection>

          {/* ── Safety ───────────────────────────────────────────────── */}
          <SettingsSection title={gt("Safe messaging")} icon={ShieldCheck} description={gt("Protections that work without any setting.")}>
            <SettingsCard>
              <SettingsRow
                label={gt("Image safety scan")}
                description={gt("Every image uploaded to SerikaCord, in servers and DMs, is compared with known child sexual abuse material (Microsoft PhotoDNA) and known scam images.")}
                control={<SettingsStatusPill tone="success" dot>{gt("Always on")}</SettingsStatusPill>}
              >
                <Details>
                  <p>{gt("A match is blocked before it's stored or seen, and can lead to a restriction, a strike or a suspension of the uploader's account. Only details about the match are logged for review, never the image itself.")}</p>
                  <p>{gt("For the abuse check, images are sent to Microsoft's PhotoDNA Cloud Service. The scam check runs on SerikaCord's own servers.")}</p>
                </Details>
              </SettingsRow>
              <SettingsRow
                label={gt("Sensitive media in servers")}
                description={gt("Server moderators can blur images and videos from members without a role, or from everyone. Click blurred media to show it.")}
                control={<SettingsStatusPill tone="neutral">{gt("Set by each server")}</SettingsStatusPill>}
              />
              <SettingsRow
                label={gt("Media in your DMs")}
                description={gt("Apart from the safety scan, images in DMs aren't blurred or filtered. Message requests and blocking control who can send you anything.")}
                control={<SettingsStatusPill tone="neutral">{gt("Not filtered")}</SettingsStatusPill>}
              />
            </SettingsCard>
          </SettingsSection>

          {/* ── Activity & presence ──────────────────────────────────── */}
          <SettingsSection title={gt("Activity & presence")} icon={Activity} description={gt("What others see about what you're doing right now.")}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Share your activity")}
                description={gt("Show what you're playing, watching or listening to.")}
                checked={sharing.enabled}
                onCheckedChange={(checked) => save({ privacy: { showActivity: checked } })}
              >
                <Details>
                  <p>{gt("Your activity shows on your profile, in member lists, in your friends' Active Now, and to bots with presence access in servers you share. Anyone who can open your profile can see it, not only friends.")}</p>
                  <p>{gt("Your online status and custom status aren't affected. To look offline, set your status to Invisible.")}</p>
                </Details>
              </SettingsToggleRow>
              <SettingsToggleRow
                label={gt("Games & apps")}
                description={gt("What the SerikaCord desktop app detects, and Rich Presence from games and apps.")}
                checked={shareGames}
                disabled={!sharing.enabled}
                onCheckedChange={(checked) => setSharing({ games: checked })}
                className="pl-6"
              >
                <Details>
                  <p>{gt("When off, nobody sees your games or apps live, and the Recent activity list on your profile is hidden too. The desktop app still reports them so your own list keeps working, unless you turn off Store recent activity below.")}</p>
                </Details>
              </SettingsToggleRow>
              <SettingsToggleRow
                label={gt("Now Watching (serika.moe)")}
                description={gt("What you're watching on serika.moe, if you've linked it.")}
                checked={shareWatching}
                disabled={!sharing.enabled}
                onCheckedChange={(checked) => setSharing({ watching: checked })}
                className="pl-6"
              />
              <SettingsToggleRow
                label={gt("Music (Last.fm)")}
                description={gt("The song you're scrobbling to Last.fm, if you've connected it.")}
                checked={shareMusic}
                disabled={!sharing.enabled}
                onCheckedChange={(checked) => setSharing({ music: checked })}
                className="pl-6"
              />
              <SettingsRow
                label={gt("Invisible hides your activity")}
                description={gt("While your status is Invisible you appear offline, and your live and recent activity are hidden from everyone, including on your own profile.")}
                control={
                  <SettingsStatusPill tone={invisible ? "accent" : "neutral"} dot={invisible}>
                    {invisible ? gt("You're Invisible") : gt("You're visible")}
                  </SettingsStatusPill>
                }
              />
              <SettingsToggleRow
                label={gt("Store recent activity")}
                description={gt("Keep a list of games and apps you've used, with play time, shown as Recent activity on your profile.")}
                checked={storeHistory}
                onCheckedChange={(checked) => save({ privacy: { storeActivityHistory: checked } })}
              >
                <Details>
                  <p>{gt("Built from the desktop app's game and app detection only, not serika.moe or Last.fm. Others can see it on your full profile while Games & apps sharing is on and you're not Invisible.")}</p>
                  <p>{gt("Turning this off stops new entries but keeps the list. Clear history deletes it.")}</p>
                </Details>
                <div className="mt-2">
                  <SettingsButton variant="secondary" size="sm" onClick={clearHistory} disabled={clearingHistory}>
                    {gt("Clear history")}
                  </SettingsButton>
                </div>
              </SettingsToggleRow>
            </SettingsCard>
          </SettingsSection>

          {/* ── Typing & read status ─────────────────────────────────── */}
          <SettingsSection title={gt("Typing & read status")} icon={Keyboard}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Show when I'm typing")}
                description={gt("Let others see “… is typing” while you write.")}
                checked={typing}
                onCheckedChange={(checked) => save({ privacy: { typingIndicators: checked } })}
              >
                <Details>
                  <p>{gt("Applies in servers, DMs and group DMs, including to bots that watch typing. When off, SerikaCord drops your typing signal instead of passing it on. You still see when others type.")}</p>
                </Details>
              </SettingsToggleRow>
              <SettingsRow
                label={gt("Read receipts")}
                description={gt("SerikaCord has no read receipts. Nobody can see whether you've read their messages; where you stopped reading only syncs between your own devices.")}
                control={<SettingsStatusPill tone="success">{gt("Private")}</SettingsStatusPill>}
              />
            </SettingsCard>
          </SettingsSection>

          {/* ── Profile visibility ───────────────────────────────────── */}
          <SettingsSection title={gt("Profile visibility")} icon={Eye} description={gt("What people see when they open your profile.")}>
            <SettingsCard>
              <SettingsRow
                label={gt("Always visible")}
                description={gt("Your username, display name, avatar, banner, bio, pronouns, badges and custom status are visible to anyone who opens your profile.")}
                control={<LinkButton onClick={link("profiles")}>{gt("Edit profile")}</LinkButton>}
                stackOnMobile
              />
              <SettingsRow
                label={gt("Local time")}
                description={gt("Your timezone only appears on your profile if you choose to show it in Profiles.")}
                control={
                  <SettingsStatusPill tone={user?.showTimezone && user?.timezone ? "accent" : "neutral"}>
                    {user?.showTimezone && user?.timezone ? gt("Shown") : gt("Hidden")}
                  </SettingsStatusPill>
                }
              />
              <SettingsRow
                label={gt("Connections")}
                description={gt("Each linked account has its own switch for showing it on your profile. Websites only appear once their domain is verified.")}
                control={<LinkButton onClick={link("connections")}>{gt("Manage")}</LinkButton>}
                stackOnMobile
              />
              <SettingsRow
                label={gt("Things in common")}
                description={gt("Someone viewing your profile only sees the friends and servers you both have, never your full friend or server list.")}
              />
            </SettingsCard>
          </SettingsSection>

          {/* ── Data sharing ─────────────────────────────────────────── */}
          <SettingsSection title={gt("Sharing outside SerikaCord")} icon={Share2}>
            <SettingsCard>
              <SettingsToggleRow
                label={gt("Allow data processing by Discord")}
                description={gt("Required for your messages to sync to bridged Discord servers. When off, your messages are never sent to Discord and your data is not shared with it.")}
                checked={Boolean(s.dataPrivacy?.discordBridgeOutbound)}
                onCheckedChange={(checked) => save({ dataPrivacy: { discordBridgeOutbound: checked, discordBridgePrompted: true } })}
              >
                <Details>
                  <p>{gt("Some servers mirror their channels to a Discord server. When on, messages you send in those channels are copied there with your display name and avatar, and Discord's own privacy policy applies to the copies.")}</p>
                  <p>{gt("Turning it off stops future copies. It only affects bridged channels; nothing else is ever sent to Discord.")}</p>
                </Details>
              </SettingsToggleRow>
              <SettingsRow
                label={gt("Authorized apps")}
                description={gt("Apps you've signed in to with SerikaCord can read what you allowed when you authorized them, until you remove them.")}
                control={<LinkButton onClick={link("authorized-apps")}>{gt("Review")}</LinkButton>}
                stackOnMobile
              />
            </SettingsCard>
          </SettingsSection>

          {/* ── Improving SerikaCord ─────────────────────────────────── */}
          <SettingsSection title={gt("Data used to improve SerikaCord")} icon={BarChart3}>
            <SettingsCard>
              <SettingsRow
                label={gt("No analytics or tracking")}
                description={gt("SerikaCord doesn't collect usage analytics, telemetry or automatic crash reports, and has no advertising trackers, so there's nothing to switch off here.")}
                control={<SettingsStatusPill tone="success">{gt("None collected")}</SettingsStatusPill>}
              />
              <SettingsRow
                label={gt("Reports you send")}
                description={gt("We only hear about problems you report yourself, and only what you choose to include.")}
                control={<LinkButton onClick={link("bug-reports")}>{gt("Feedback & Bugs")}</LinkButton>}
                stackOnMobile
              />
            </SettingsCard>
          </SettingsSection>

          {/* ── Your data ────────────────────────────────────────────── */}
          <SettingsSection title={gt("Your data")} icon={Database} description={gt("What SerikaCord stores about you, and how to get or delete it.")}>
            <SettingsCard>
              <SettingsRow
                label={gt("Messages")}
                description={gt("Stored encrypted, so a copy of the database alone can't be read. SerikaCord's servers decrypt them to deliver, search and moderate messages. Search uses scrambled word fingerprints, never readable text.")}
                control={e2eeAvailable ? <LinkButton onClick={link("encryption")}>{gt("Encryption")}</LinkButton> : undefined}
                stackOnMobile
              >
                {e2eeAvailable && (
                  <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
                    {gt("End-to-end encrypted DMs are locked with keys only your devices hold, so SerikaCord can't read them at all.")}
                  </p>
                )}
              </SettingsRow>
              <SettingsRow
                label={gt("Files and images")}
                description={gt("Stored on our file storage and served from cdn.serika.chat under a long random link. Anyone who has the link can open the file.")}
              />
              <SettingsRow
                label={gt("Deleted messages")}
                description={gt("Deleting a message removes it for everyone right away. How long deleted data stays in backups is set out in the Privacy Policy.")}
              />
              <SettingsRow
                label={gt("Signed-in devices")}
                description={gt("Each device you sign in on keeps its name, platform and a shortened IP address (with the last part removed).")}
                control={<LinkButton onClick={link("devices")}>{gt("Devices")}</LinkButton>}
                stackOnMobile
              />
              <SettingsRow
                label={gt("Account and sign-in")}
                description={gt("Your email, password, passkeys and linked Discord or serika.moe accounts are managed on Serika Accounts.")}
                stackOnMobile
                control={
                  <a href={ACCOUNTS_SETTINGS_URL} target="_blank" rel="noopener noreferrer" className={settingsButtonClass("secondary", "sm")}>
                    {gt("Serika Accounts")}
                    <ExternalLink aria-hidden />
                  </a>
                }
              />
              <SettingsRow
                label={gt("Request a copy of your data")}
                description={gt("There's no instant download yet. Email us from your account's email address and we'll send you a copy within one month.")}
                stackOnMobile
                control={
                  <a
                    href={`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent("SerikaCord data request")}`}
                    className={settingsButtonClass("secondary", "sm")}
                  >
                    {gt("Email {address}", { address: PRIVACY_EMAIL })}
                  </a>
                }
              />
            </SettingsCard>
            <SettingsDangerZone>
              <SettingsRow
                label={gt("Delete account")}
                description={gt("Done from your Serika account. Your profile and data are removed and servers you own pass to another member. This can't be undone.")}
                danger
                stackOnMobile
                control={
                  <a href={ACCOUNTS_SETTINGS_URL} target="_blank" rel="noopener noreferrer" className={settingsButtonClass("danger", "sm", "max-sm:w-full")}>
                    {gt("Delete account")}
                    <ExternalLink aria-hidden />
                  </a>
                }
              />
            </SettingsDangerZone>
            <nav aria-label={gt("Legal")} className="flex flex-wrap gap-x-4 gap-y-1 px-0.5 text-xs text-[var(--text-muted)]">
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center underline underline-offset-2 hover:text-[var(--text-primary)]">{gt("Privacy Policy")}</a>
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center underline underline-offset-2 hover:text-[var(--text-primary)]">{gt("Terms of Service")}</a>
              <a href="/guidelines" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center underline underline-offset-2 hover:text-[var(--text-primary)]">{gt("Community Guidelines")}</a>
            </nav>
          </SettingsSection>
        </>
      )}
    </div>
  );
});

function Glance({ icon: Icon, label, value, hint }: { icon: typeof Activity; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3">
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.04em]">{label}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--app-accent)]">{hint}</p>}
    </div>
  );
}
