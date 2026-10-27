"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { BadgeCheck, Globe, Lock, ShieldCheck } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";

/**
 * An application's picture in the developer portal: the app icon, else the
 * bot user's avatar (most bots only set one of the two), else the first letter
 * of the name on the accent gradient. Falls back again if an image fails.
 */
export function DevAppAvatar({
  name,
  icon,
  botAvatar,
  className,
}: {
  name: string;
  icon?: string | null;
  botAvatar?: string | null;
  className?: string;
}) {
  const sources = [icon, botAvatar].filter((s): s is string => Boolean(s));
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#6366f1] flex items-center justify-center text-white font-bold select-none",
        className,
      )}
    >
      {src ? (
        <img
          key={src}
          src={cdnImage(src)}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed((n) => n + 1)}
        />
      ) : (
        <span aria-hidden>{(name.trim().charAt(0) || "?").toUpperCase()}</span>
      )}
    </div>
  );
}

export interface DevAppStatusInput {
  verified?: boolean;
  official?: boolean;
  verificationStatus?: string | null;
  botId?: string | null;
  botPublic?: boolean;
}

/** Small status chips for an application card / row. */
export function DevAppStatus({ app, className }: { app: DevAppStatusInput; className?: string }) {
  const gt = useGT();
  const chip = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none";
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {app.official ? (
        <span className={cn(chip, "bg-[#8B5CF6]/15 text-[#c4b5fd]")}>
          <ShieldCheck className="size-3" /> {gt("Official")}
        </span>
      ) : app.verified ? (
        <span className={cn(chip, "bg-[#5865F2]/15 text-[#a5b4fc]")}>
          <BadgeCheck className="size-3" /> {gt("Verified")}
        </span>
      ) : app.verificationStatus === "pending" ? (
        <span className={cn(chip, "bg-amber-500/15 text-amber-300")}>{gt("In review")}</span>
      ) : null}
      {app.botId ? (
        app.botPublic === false ? (
          <span className={cn(chip, "bg-white/[0.06] text-[#a1a1aa]")}>
            <Lock className="size-3" /> {gt("Private bot")}
          </span>
        ) : (
          <span className={cn(chip, "bg-emerald-500/10 text-emerald-300")}>
            <Globe className="size-3" /> {gt("Public bot")}
          </span>
        )
      ) : (
        <span className={cn(chip, "bg-white/[0.06] text-[#a1a1aa]")}>{gt("No bot")}</span>
      )}
    </div>
  );
}
