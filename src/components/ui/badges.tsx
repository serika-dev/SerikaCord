"use client";

import { useState } from "react";
import { 
  Shield, 
  ShieldCheck, 
  ShieldHalf, 
  Handshake, 
  UserStar, 
  Heart, 
  Bot, 
  Bug, 
  Crown, 
  Code,
  ChevronDown,
  HandHeart,
  FlaskConical,
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
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

// Badge definitions
const BADGE_CONFIG = {
  // Staff Badges
  staff: {
    name: 'Serika Staff',
    description: 'Official Serika staff member',
    icon: ShieldCheck,
    color: '#8B5CF6',
    bgColor: 'bg-[#8B5CF6]/20',
  },
  admin: {
    name: 'Administrator',
    description: 'Platform administrator',
    icon: Shield,
    color: '#EF4444',
    bgColor: 'bg-[#EF4444]/20',
  },
  moderator: {
    name: 'Moderator',
    description: 'Platform moderator',
    icon: ShieldHalf,
    color: '#A78BFA',
    bgColor: 'bg-[#A78BFA]/20',
  },
  
  // Partner & Premium
  partner: {
    name: 'Partnered Server Owner',
    description: 'Owner of a partnered server',
    icon: Handshake,
    color: '#8B5CF6',
    bgColor: 'bg-[#8B5CF6]/20',
  },
  serika_plus: {
    name: 'Serika+',
    description: 'Serika+ subscriber',
    icon: UserStar,
    color: '#F47FFF',
    bgColor: 'bg-[#F47FFF]/20',
  },
  early_supporter: {
    name: 'Early Supporter',
    description: 'Supported Serika in its early days',
    icon: Heart,
    color: '#A78BFA',
    bgColor: 'bg-[#A78BFA]/20',
  },
  
  // Achievement Badges
  verified_bot_developer: {
    name: 'Verified Bot Developer',
    description: 'Developer of a verified bot',
    icon: Bot,
    color: '#8B5CF6',
    bgColor: 'bg-[#8B5CF6]/20',
  },
  bug_hunter: {
    name: 'Bug Hunter',
    description: 'Found and reported critical bugs',
    icon: Bug,
    color: '#7C3AED',
    bgColor: 'bg-[#7C3AED]/20',
  },
  bug_hunter_gold: {
    name: 'Bug Hunter (Gold)',
    description: 'Elite bug hunter',
    icon: Bug,
    color: '#FFD700',
    bgColor: 'bg-[#FFD700]/20',
  },
  
  // Server Badges
  server_owner: {
    name: 'Server Owner',
    description: 'Owns at least one server',
    icon: Crown,
    color: '#FFD700',
    bgColor: 'bg-[#FFD700]/20',
  },
  active_developer: {
    name: 'Active Developer',
    description: 'Active application developer',
    icon: Code,
    color: '#8B5CF6',
    bgColor: 'bg-[#8B5CF6]/20',
  },

  // SerikaCord badges
  serikacord_developer: {
    name: 'SerikaCord Developer',
    description: 'Core developer of SerikaCord',
    icon: Code,
    color: '#e2b714',
    bgColor: 'bg-[#e2b714]/20',
  },
  serikacord_contributor: {
    name: 'SerikaCord Contributor',
    description: 'Contributed to SerikaCord',
    icon: HandHeart,
    color: '#A78BFA',
    bgColor: 'bg-[#A78BFA]/20',
  },
  serikacord_tester: {
    name: 'SerikaCord Tester',
    description: 'Helped test SerikaCord',
    icon: FlaskConical,
    color: '#23A55A',
    bgColor: 'bg-[#23A55A]/20',
  },
  
} as const;

export type BadgeId = keyof typeof BADGE_CONFIG;

/** Public accessor for a badge's display metadata (name/description/color). */
export function getBadgeMeta(id: BadgeId): { name: string; description: string; color: string } | null {
  const config = BADGE_CONFIG[id];
  if (!config) return null;
  return { name: config.name, description: config.description, color: config.color };
}

export function badgeLabel(id: BadgeId, gt: ReturnType<typeof useGT>): { name: string; description: string } {
  switch (id) {
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
    default: return { name: id, description: '' };
  }
}

interface BadgeProps {
  id: BadgeId;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  className?: string;
}

const badgeIconSizes = { xs: 16, sm: 20, md: 24, lg: 32 };

function BadgeIcon({ icon: Icon, color, size = 'md' }: { icon: LucideIcon; color: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const outer = badgeIconSizes[size];
  const inner = Math.round(outer * 0.5);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: outer, height: outer }}>
      <BadgeOutline className="absolute inset-0" width={outer} height={outer} color={color} strokeWidth={2} />
      <Icon className="relative z-10" width={inner} height={inner} color={color} strokeWidth={2} />
    </div>
  );
}

export function Badge({ id, size = 'md', showTooltip = true, className }: BadgeProps) {
  const gt = useGT();
  const config = BADGE_CONFIG[id];
  
  if (!config) return null;
  
  const Icon = config.icon;
  
  const labels = badgeLabel(id, gt);

  const badge = (
    <div 
      className={cn(
        "flex items-center justify-center rounded-md transition-transform hover:scale-110",
        size === 'xs' && "w-4 h-4",
        size === 'sm' && "w-5 h-5",
        size === 'md' && "w-6 h-6",
        size === 'lg' && "w-8 h-8",
        config.bgColor,
        className
      )}
    >
      <BadgeIcon icon={Icon} color={config.color} size={size} />
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
        <div className="text-xs text-[#888888]">{labels.description}</div>
      </TooltipContent>
    </Tooltip>
  );
}

interface BadgeListProps {
  badges: BadgeId[];
  size?: 'sm' | 'md' | 'lg';
  maxDisplay?: number;
  className?: string;
  expandable?: boolean;
}

export function BadgeList({ badges, size = 'md', maxDisplay, className, expandable = false }: BadgeListProps) {
  const gt = useGT();
  const [showAllBadges, setShowAllBadges] = useState(false);
  const displayBadges = badges.slice(0, maxDisplay ?? badges.length);
  const remaining = badges.length - (maxDisplay ?? badges.length);
  
  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn("flex items-center flex-wrap gap-1", className)}>
        {displayBadges.map((badgeId) => (
          <Badge key={badgeId} id={badgeId} size={size} />
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
                      {badges.map((badgeId) => {
                        const config = BADGE_CONFIG[badgeId];
                        if (!config) return null;
                        const Icon = config.icon;
                        return (
                          <div
                            key={badgeId}
                            className="flex items-center gap-3 p-3 rounded-lg bg-[#0a0a0a] hover:bg-[#1a1a1a] transition-colors"
                          >
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${config.color}20` }}
                            >
                              <BadgeIcon icon={Icon} color={config.color} size="lg" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-white text-sm">{badgeLabel(badgeId, gt).name}</p>
                              <p className="text-xs text-[#888888] truncate">{badgeLabel(badgeId, gt).description}</p>
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
            <BadgeIcon icon={Icon} color={config.color} size={iconSize} />
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
