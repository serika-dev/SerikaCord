"use client";

import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Crown, Check, Clock } from "lucide-react";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { StaffPill } from "@/components/chat/StaffPill";
import { SystemPill } from "@/components/chat/SystemPill";
import { useTheme } from "@/contexts/ThemeContext";
import { useServerMembers } from "@/contexts/ServerContext";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { cn, getTimeoutRemaining, cdnImage } from "@/lib/utils";
import { useChatGt } from "./ChatGtContext";
import type { CSSProperties } from 'react';
import type { MessageAuthor } from "@/lib/chat/types";

interface GroupAvatarProps {
  author: MessageAuthor;
  serverId?: string;
}

/** The 40px avatar in the message gutter, wrapped in a profile popup when possible. */
export const GroupAvatar = memo(function GroupAvatar({ author, serverId }: GroupAvatarProps) {
  const initial = (author.displayName || author.username || "?").charAt(0).toUpperCase();
  const avatar = (
    <Avatar className="w-10 h-10 mt-0.5">
      <AvatarImage src={cdnImage(author.avatar)} loading="lazy" alt="" />
      <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">{initial}</AvatarFallback>
    </Avatar>
  );

  if (!author.id || author.id === "unknown") return avatar;

  return (
    <MemberProfilePopup
      member={{
        id: author.id,
        username: author.username || "unknown",
        displayName: author.displayName,
        avatar: author.avatar,
        badges: author.badges,
      }}
      serverId={serverId}
      side="right"
      align="start"
    >
      <button
        className="block rounded-full focus-visible:outline-2 focus-visible:outline-[#8B5CF6] cursor-pointer hover:opacity-90 transition-opacity"
        aria-label={`View profile of ${author.displayName || author.username}`}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {avatar}
      </button>
    </MemberProfilePopup>
  );
});

interface GroupHeaderProps {
  author: MessageAuthor;
  formattedTimestamp: string;
  serverId?: string;
  roleColor?: string;
}

/** Author name + staff pill + timestamp row above the first message of a group. */
export const GroupHeader = memo(function GroupHeader({ author, formattedTimestamp, serverId, roleColor }: GroupHeaderProps) {
  const gt = useChatGt();
  const { settings } = useTheme();
  // Server-only: surface a red clock next to timed-out members. In DMs the
  // members list is empty so this is a no-op.
  const { members } = useServerMembers();
  const authorTimeout = serverId
    ? getTimeoutRemaining(
        (members as Array<{ id: string; communicationDisabledUntil?: string | null }>).find((m) => m.id === author.id)?.communicationDisabledUntil
      )
    : { active: false, label: "" };
  const name = author.displayName || author.username || gt("Unknown");
  const styleClasses = getDisplayNameStyleClasses(author.customization?.displayNameStyle);
  const styleInline = getDisplayNameStyleInline(author.customization?.displayNameStyle);
  const hasCustomStyle = Boolean(author.customization?.displayNameStyle && (author.customization.displayNameStyle.color || author.customization.displayNameStyle.gradient?.length || author.customization.displayNameStyle.effect !== 'solid' || author.customization.displayNameStyle.font !== 'default'));
  const effectiveColor = !hasCustomStyle && settings.showRoleColors && roleColor ? roleColor : undefined;

  // Cap font weight so bold/rounded styles don't make names look larger than others in chat
  const chatInline: CSSProperties = hasCustomStyle
    ? { ...styleInline, fontWeight: 500 }
    : (effectiveColor ? { color: effectiveColor } : {});

  return (
    <div className="flex items-center gap-2 mb-1">
      {author.id && author.id !== "unknown" ? (
        <MemberProfilePopup
          member={{
            id: author.id,
            username: author.username || "unknown",
            displayName: author.displayName,
            avatar: author.avatar,
            badges: author.badges,
            isBot: author.isBot,
            isVerified: author.isVerified,
          }}
          serverId={serverId}
          side="right"
          align="start"
        >
          <button onContextMenu={(e) => e.stopPropagation()} className={cn("!text-[0.8rem] font-medium leading-tight whitespace-nowrap hover:underline focus-visible:outline-2 focus-visible:outline-[#8B5CF6] rounded flex items-center gap-1", styleClasses)} style={chatInline}>
            <span>{name}</span>
            {author.isOwner && (
              <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />
            )}
            {authorTimeout.active && (
              <span title={gt("Timed out — {time} remaining", { time: authorTimeout.label })} className="inline-flex flex-shrink-0 text-[#EF4444]">
                <Clock className="w-3.5 h-3.5" />
              </span>
            )}
            {author.isSystem && (
              <SystemPill isSystem={author.isSystem} />
            )}
            {author.isDiscord && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase scale-90 origin-left bg-[#5865F2] text-white">
                {gt("Discord")}
              </span>
            )}
            {author.isBot && !author.isSystem && !author.isDiscord && (
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase scale-90 origin-left",
                author.isVerified 
                  ? "bg-[#5865F2] text-white" 
                  : "bg-[#4f545c]/30 text-[#b9bbbe] border border-white/[0.04]"
              )}>
                {author.isVerified && <Check className="w-2.5 h-2.5 shrink-0 stroke-[3px]" />}
                {gt("Bot")}
              </span>
            )}
          </button>
        </MemberProfilePopup>
      ) : (
        <span className={cn("!text-[0.8rem] font-medium leading-tight whitespace-nowrap text-[var(--text-primary)] flex items-center gap-1", styleClasses)} style={chatInline}>
          <span>{name}</span>
          {author.isSystem && (
            <SystemPill isSystem={author.isSystem} />
          )}
          {author.isDiscord && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase scale-90 origin-left bg-[#5865F2] text-white">
              {gt("Discord")}
            </span>
          )}
          {author.isBot && !author.isSystem && !author.isDiscord && (
            <span className={cn(
              "inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase scale-90 origin-left",
              author.isVerified 
                ? "bg-[#5865F2] text-white" 
                : "bg-[#4f545c]/30 text-[#b9bbbe] border border-white/[0.04]"
            )}>
              {author.isVerified && <Check className="w-2.5 h-2.5 shrink-0 stroke-[3px]" />}
              {gt("Bot")}
            </span>
          )}
        </span>
      )}
      <StaffPill badges={author.badges} />
      <span className="text-[10px] leading-none text-[var(--text-muted)] whitespace-nowrap">{formattedTimestamp}</span>
    </div>
  );
});
