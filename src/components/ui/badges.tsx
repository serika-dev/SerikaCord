"use client";

import { useState } from "react";
import {
  Handshake,
  ChevronDown,
  Badge as BadgeOutline,
  Check,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BadgeIcon as BadgeGlyph } from "@/components/ui/BadgeIcon";
import { useBadges } from "@/hooks/useBadges";
import { DEFAULT_BADGES } from "@/lib/constants/badges";
import type { BadgeDefinition } from "@/lib/badges/shared";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

// User badge definitions live in the `badges` table (see useBadges); any id a
// user holds that has a visible definition renders here.
export type BadgeId = string;

const DEFAULT_BY_ID: ReadonlyMap<string, BadgeDefinition> = new Map(DEFAULT_BADGES.map((b) => [b.id, b]));

/**
 * Display name/description for a badge. Built-in badges whose text staff
 * haven't changed use the translated strings; anything created or edited in
 * the admin panel shows its database text as-is.
 */
export function badgeLabel(
  badge: Pick<BadgeDefinition, "id" | "name" | "description">,
  gt: ReturnType<typeof useGT>,
): { name: string; description: string } {
  const builtin = DEFAULT_BY_ID.get(badge.id);
  if (!builtin || builtin.name !== badge.name || builtin.description !== badge.description) {
    return { name: badge.name, description: badge.description };
  }
  switch (badge.id) {
    case 'staff': return { name: gt('Serika Staff'), description: gt('Official Serika staff member') };
    case 'admin': return { name: gt('Administrator'), description: gt('Platform administrator') };
    case 'moderator': return { name: gt('Moderator'), description: gt('Platform moderator') };
    case 'partner': return { name: gt('Partnered Server Owner'), description: gt('Owner of a partnered server') };
    case 'serika_plus': return { name: gt('Serika+'), description: gt('Serika+ subscriber') };
    case 'early_supporter': return { name: gt('Early Supporter'), description: gt('Supported Serika in its early days') };
    case 'verified_bot_developer': return { name: gt('Verified Bot Developer'), description: gt('Developer of a verified bot') };
    case 'bug_hunter': return { name: gt('Bug Hunter'), description: gt('Found and reported critical bugs') };
    case 'bug_hunter_gold': return { name: gt('Bug Hunter (Gold)'), description: gt('Elite bug hunter') };
    case 'server_owner': return { name: gt('Server Owner'), description: gt('Owns at least one server') };
    case 'active_developer': return { name: gt('Active Developer'), description: gt('Active application developer') };
    case 'serikacord_developer': return { name: gt('SerikaCord Developer'), description: gt('Core developer of SerikaCord') };
    case 'serikacord_contributor': return { name: gt('SerikaCord Contributor'), description: gt('Contributed to SerikaCord') };
    case 'serikacord_tester': return { name: gt('SerikaCord Tester'), description: gt('Helped test SerikaCord') };
    default: return { name: badge.name, description: badge.description };
  }
}

const badgeIconSizes = { xs: 16, sm: 20, md: 24, lg: 32 };

/** Badge outline frame with a small lucide glyph inside (server badges). */
function FramedIcon({ icon: Icon, color, size = 'md' }: { icon: LucideIcon; color: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const outer = badgeIconSizes[size];
  const inner = Math.round(outer * 0.5);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: outer, height: outer }}>
      <BadgeOutline className="absolute inset-0" width={outer} height={outer} color={color} strokeWidth={2} />
      <Icon className="relative z-10" width={inner} height={inner} color={color} strokeWidth={2} />
    </div>
  );
}

/**
 * A user badge's artwork at a given size: lucide glyphs sit inside the badge
 * outline frame; custom images fill the frame on their own.
 */
export function BadgeArt({ badge, size = 'md' }: { badge: BadgeDefinition; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const outer = badgeIconSizes[size];
  if (badge.iconUrl) {
    return <BadgeGlyph badge={badge} size={outer} />;
  }
  const inner = Math.round(outer * 0.5);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: outer, height: outer }}>
      <BadgeOutline className="absolute inset-0" width={outer} height={outer} color={badge.color} strokeWidth={2} />
      <BadgeGlyph badge={badge} size={inner} className="relative z-10" />
    </div>
  );
}

interface BadgeProps {
  id: BadgeId;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  className?: string;
}

export function Badge({ id, size = 'md', showTooltip = true, className }: BadgeProps) {
  const gt = useGT();
  const { byId } = useBadges();
  const def = byId.get(id);

  if (!def || def.hidden) return null;

  const labels = badgeLabel(def, gt);

  const badge = (
    <div
      className={cn(
        "flex items-center justify-center rounded-md transition-transform hover:scale-110",
        size === 'xs' && "w-4 h-4",
        size === 'sm' && "w-5 h-5",
        size === 'md' && "w-6 h-6",
        size === 'lg' && "w-8 h-8",
        className
      )}
      style={{ backgroundColor: `${def.color}33` }}
    >
      <BadgeArt badge={def} size={size} />
    </div>
  );

  if (!showTooltip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-[#0a0a0a] text-white border border-[#222222] px-3 py-2"
      >
        <div className="text-sm font-semibold">{labels.name}</div>
        {labels.description && <div className="text-xs text-[#888888]">{labels.description}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

interface BadgeListProps {
  /** A user's badge ids, in any order; unknown/hidden ids are skipped. */
  badges: readonly BadgeId[];
  size?: 'sm' | 'md' | 'lg';
  maxDisplay?: number;
  className?: string;
  expandable?: boolean;
}

export function BadgeList({ badges: badgeIds, size = 'md', maxDisplay, className, expandable = false }: BadgeListProps) {
  const gt = useGT();
  const { resolve } = useBadges();
  const [showAllBadges, setShowAllBadges] = useState(false);
  const badges = resolve(badgeIds);
  const displayBadges = badges.slice(0, maxDisplay ?? badges.length);
  const remaining = Math.max(0, badges.length - (maxDisplay ?? badges.length));

  if (badges.length === 0) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn("flex items-center flex-wrap gap-1", className)}>
        {displayBadges.map((badge) => (
          <Badge key={badge.id} id={badge.id} size={size} />
        ))}
        {remaining > 0 && (
          expandable ? (
            <>
              <button
                onClick={() => setShowAllBadges(true)}
                className={cn(
                  "flex items-center justify-center gap-0.5 rounded-md bg-[#111111] text-[#888888] text-xs font-medium cursor-pointer border border-[#222222] hover:bg-[#1a1a1a] hover:text-white transition-colors",
                  size === 'sm' && "h-5 px-1.5",
                  size === 'md' && "h-6 px-2 text-[10px]",
                  size === 'lg' && "h-8 px-2.5 text-xs",
                )}
              >
                +{remaining}
                <ChevronDown className="w-3 h-3" />
              </button>

              <Dialog open={showAllBadges} onOpenChange={setShowAllBadges}>
                <DialogContent className="bg-[#111111] border-[#222222] max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-white">{gt("All Badges")} ({badges.length})</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="max-h-[400px]">
                    <div className="grid grid-cols-1 gap-2 pr-4">
                      {badges.map((badge) => {
                        const labels = badgeLabel(badge, gt);
                        return (
                          <div
                            key={badge.id}
                            className="flex items-center gap-3 p-3 rounded-lg bg-[#0a0a0a] hover:bg-[#1a1a1a] transition-colors"
                          >
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${badge.color}20` }}
                            >
                              <BadgeArt badge={badge} size="lg" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-white text-sm">{labels.name}</p>
                              <p className="text-xs text-[#888888] truncate">{labels.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center justify-center rounded-md bg-[#111111] text-[#888888] text-xs font-medium cursor-default border border-[#222222]",
                    size === 'sm' && "w-5 h-5",
                    size === 'md' && "w-6 h-6 text-[10px]",
                    size === 'lg' && "w-8 h-8 text-xs",
                  )}
                >
                  +{remaining}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="bg-[#0a0a0a] text-white border border-[#222222] px-3 py-2"
              >
                <div className="text-sm">
                  {gt("{count} more badges", { count: remaining })}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        )}
      </div>
    </TooltipProvider>
  );
}


// Server badges (for partnered/verified servers)
interface ServerBadgeProps {
  type: 'partnered' | 'verified' | 'discoverable';
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}

const SERVER_BADGE_CONFIG = {
  partnered: {
    name: 'Partnered',
    innerIcon: Handshake,
    color: '#8B5CF6',
  },
  verified: {
    name: 'Verified',
    innerIcon: Check,
    color: '#5865F2',
  },
  discoverable: {
    name: 'Discoverable',
    innerIcon: UsersRound,
    color: '#23A55A',
  },
};

function serverBadgeLabel(type: 'partnered' | 'verified' | 'discoverable', gt: ReturnType<typeof useGT>): string {
  switch (type) {
    case 'partnered': return gt('Partnered');
    case 'verified': return gt('Verified');
    case 'discoverable': return gt('Discoverable');
    default: return type;
  }
}

export function ServerBadge({ type, size = 'md', iconOnly = false }: ServerBadgeProps) {
  const gt = useGT();
  const config = SERVER_BADGE_CONFIG[type];
  const Icon = config.innerIcon;
  const iconSize = size === 'sm' ? 'xs' : 'sm';
  
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
              size === 'sm' && "text-[10px] px-1.5",
              iconOnly && "px-0.5 py-0.5",
            )}
            style={{ 
              backgroundColor: `${config.color}20`,
              color: config.color 
            }}
          >
            <FramedIcon icon={Icon} color={config.color} size={iconSize} />
            {!iconOnly && serverBadgeLabel(type, gt)}
          </div>
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="bg-[#0a0a0a] text-white border border-[#222222]"
        >
          {gt("{name} Server", { name: serverBadgeLabel(type, gt) })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
