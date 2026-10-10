"use client";

import { memo } from "react";
import { cdnImage } from "@/lib/utils";

export interface RoleIconData {
  id?: string;
  name?: string;
  icon?: string | null;
  unicodeEmoji?: string | null;
}

/**
 * A role's icon (uploaded image or unicode emoji), shown next to member names
 * in chat, the member list and profiles, like Discord. The tooltip is the
 * role name.
 */
export const RoleIcon = memo(function RoleIcon({
  role,
  size = 16,
  className,
}: {
  role: RoleIconData | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!role || (!role.icon && !role.unicodeEmoji)) return null;
  const label = role.name || "";
  if (role.icon) {
    return (
      <img
        src={cdnImage(role.icon)}
        alt={label}
        title={label}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={"inline-block shrink-0 object-contain select-none " + (className ?? "")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={"inline-flex shrink-0 items-center justify-center leading-none select-none " + (className ?? "")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.9) }}
    >
      {role.unicodeEmoji}
    </span>
  );
});
