"use client";

import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, cdnImage } from "@/lib/utils";

export interface GroupIconMember {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
}

/**
 * A group DM's picture: its own icon when it has one, otherwise two member
 * avatars stacked diagonally (one member: their avatar; nobody: a people glyph).
 */
export function GroupDmIcon({
  icon,
  members,
  size = 32,
  className,
}: {
  icon?: string | null;
  members: GroupIconMember[];
  size?: number;
  className?: string;
}) {
  const box = { width: size, height: size };
  if (icon) {
    return (
      <Avatar className={cn("shrink-0", className)} style={box}>
        <AvatarImage src={cdnImage(icon)} alt="" />
        <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
          <Users style={{ width: size * 0.5, height: size * 0.5 }} />
        </AvatarFallback>
      </Avatar>
    );
  }
  const [a, b] = members;
  if (!a) {
    return (
      <div
        className={cn("shrink-0 rounded-full flex items-center justify-center bg-[var(--app-accent)] text-[var(--text-on-accent)]", className)}
        style={box}
      >
        <Users style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    );
  }
  const face = (m: GroupIconMember, px: number, extra?: string) => (
    <Avatar className={cn("absolute", extra)} style={{ width: px, height: px }}>
      <AvatarImage src={cdnImage(m.avatar)} alt="" />
      <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]" style={{ fontSize: Math.max(8, px * 0.4) }}>
        {(m.displayName || m.username || "?").charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
  if (!b) {
    return <div className={cn("relative shrink-0", className)} style={box}>{face(a, size, "inset-0")}</div>;
  }
  const px = Math.round(size * 0.7);
  return (
    <div className={cn("relative shrink-0", className)} style={box} aria-hidden>
      {face(a, px, "top-0 left-0")}
      {face(b, px, "bottom-0 right-0 ring-2 ring-[var(--bg-sidebar)]")}
    </div>
  );
}
