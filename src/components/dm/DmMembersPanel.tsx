"use client";

import { ProfileCard, type ProfileCardUser } from "@/components/user/ProfileCard";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DmPerson } from "@/lib/chat/dmMembers";

/**
 * A 1:1 DM's right panel: just their profile (about me, mutual servers /
 * friends, note), like Discord. A two-person DM has no member list; group DMs
 * keep theirs (GroupDmMembersPanel).
 */
export function DmMembersPanel({
  recipient,
  recipientLoading,
  className,
}: {
  recipient: (DmPerson & { isFriend?: boolean }) | null;
  recipientLoading: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-app)]",
        className
      )}
    >
      {recipientLoading ? (
        <UserProfileSkeleton />
      ) : recipient ? (
        <ProfileCard
          user={recipient as unknown as ProfileCardUser}
          isFriend={recipient.isFriend}
          hideMessageButton
          hideConnections
          noRoundedCorners
          className="w-full max-w-none flex-1 flex flex-col"
        />
      ) : null}
    </div>
  );
}
