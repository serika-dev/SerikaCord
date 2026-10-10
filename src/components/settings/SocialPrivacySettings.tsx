"use client";

import { useGT } from "gt-next";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { friendRequestSources, messageRequestsEnabled } from "@/lib/settings/privacy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Settings = Record<string, any> | null | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Patch = Record<string, any>;

function Row({ label, description, checked, disabled, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <span className="text-[var(--text-primary)]">{label}</span>
        {description && <p className="text-xs text-[var(--text-muted)]">{description}</p>}
      </div>
      <ToggleSwitch size="sm" checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

/**
 * Discord's "Friend Requests" page: who can send you a friend request
 * (Everyone / Friends of Friends / Server Members). Stored as
 * `privacy.friendRequestSources` and enforced by POST /api/friends/add.
 */
export function FriendRequestSettings({ settings, save }: { settings: Settings; save: (patch: Patch) => void }) {
  const gt = useGT();
  const src = friendRequestSources(settings);
  const nobody = settings?.privacy?.friendRequests === "none" || settings?.friendRequests?.allowEveryone === false;
  const setSources = (next: { everyone: boolean; friendsOfFriends: boolean; serverMembers: boolean }) => {
    const any = next.everyone || next.friendsOfFriends || next.serverMembers;
    save({
      privacy: { friendRequests: any ? "everyone" : "none", friendRequestSources: next },
      // Keep the legacy master switch in step (older clients read it).
      friendRequests: { allowEveryone: any },
    });
  };
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-1">{gt("Who can send you a friend request")}</p>
      <Row
        label={gt("Everyone")}
        checked={!nobody && src.everyone}
        onChange={(checked) => setSources(checked
          ? { everyone: true, friendsOfFriends: true, serverMembers: true }
          : { everyone: false, friendsOfFriends: !nobody && src.friendsOfFriends, serverMembers: !nobody && src.serverMembers })}
      />
      <Row
        label={gt("Friends of Friends")}
        description={gt("People who share a friend with you.")}
        checked={!nobody && src.friendsOfFriends}
        disabled={!nobody && src.everyone}
        onChange={(checked) => setSources({ everyone: false, friendsOfFriends: checked, serverMembers: !nobody && src.serverMembers })}
      />
      <Row
        label={gt("Server Members")}
        description={gt("People who are in a server with you.")}
        checked={!nobody && src.serverMembers}
        disabled={!nobody && src.everyone}
        onChange={(checked) => setSources({ everyone: false, friendsOfFriends: !nobody && src.friendsOfFriends, serverMembers: checked })}
      />
    </div>
  );
}

/** "Message Requests" toggle (Content & Social / Privacy & Safety). */
export function MessageRequestSettings({ settings, save }: { settings: Settings; save: (patch: Patch) => void }) {
  const gt = useGT();
  return (
    <Row
      label={gt("Enable message requests from people you may not know")}
      description={gt("New DMs from people who aren't your friends go to Message Requests, without notifications, until you accept them.")}
      checked={messageRequestsEnabled(settings)}
      onChange={(checked) => save({ privacy: { messageRequests: checked } })}
    />
  );
}

/** Discord's "Activity Privacy" page. */
export function ActivityPrivacySettings({ settings, save }: { settings: Settings; save: (patch: Patch) => void }) {
  const gt = useGT();
  return (
    <div>
      <Row
        label={gt("Share your detected activities with others")}
        description={gt("Show what you're playing, listening to or watching on your profile, in the member list and to friends.")}
        checked={settings?.privacy?.showActivity !== false}
        onChange={(checked) => save({ privacy: { showActivity: checked } })}
      />
      <Row
        label={gt("Store recent activity")}
        description={gt("Keep a private history of games and apps the desktop app detects.")}
        checked={settings?.privacy?.storeActivityHistory !== false}
        onChange={(checked) => save({ privacy: { storeActivityHistory: checked } })}
      />
    </div>
  );
}
