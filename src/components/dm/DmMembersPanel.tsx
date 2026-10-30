"use client";

import { useMemo } from "react";
import { MemberList } from "@/components/chat/MemberSidebar";
import { ProfileCard, type ProfileCardUser } from "@/components/user/ProfileCard";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { directMessageMembers, type DmPerson } from "@/lib/chat/dmMembers";

/**
 * A 1:1 DM's right panel: their profile (about me, mutual servers / friends,
 * note) above the same member list as servers, with them and you; tapping a
 * row opens the same profile card as in a server.
 */
export function DmMembersPanel({
  recipient,
  recipientLoading,
  self,
  className,
}: {
  recipient: (DmPerson & { isFriend?: boolean }) | null;
  recipientLoading: boolean;
  self: DmPerson | null;
  className?: string;
}) {
  const members = useMemo(() => directMessageMembers(recipientLoading ? null : recipient, self), [recipient, recipientLoading, self]);
  return (
    <MemberList
      members={members}
      isLoading={recipientLoading && !recipient}
      className={className ?? "w-full md:w-full bg-[var(--bg-app)] border-[var(--border-subtle)]"}
      header={
        recipientLoading ? (
          <UserProfileSkeleton />
        ) : recipient ? (
          <ProfileCard
            user={recipient as unknown as ProfileCardUser}
            isFriend={recipient.isFriend}
            hideMessageButton
            hideConnections
            noRoundedCorners
            className="w-full max-w-none"
          />
        ) : null
      }
    />
  );
}
