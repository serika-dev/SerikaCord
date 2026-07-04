"use client";

import { useState } from "react";
import { 
  Shield, 
  ShieldCheck, 
  ShieldHalf, 
  Handshake, 
  Sparkles, 
  Heart, 
  Bot, 
  Bug, 
  Crown, 
  Code,
  Zap,
  Flame,
  Scale,
  ChevronDown,
  HandHeart,
  FlaskConical,
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
    icon: Sparkles,
    color: '#8B5CF6',
    bgColor: 'bg-[#8B5CF6]/20',
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
  
  // HypeSquad Badges
  hypesquad_bravery: {
    name: 'HypeSquad Bravery',
    description: 'Member of HypeSquad Bravery',
    icon: Zap,
    color: '#9C84EF',
    bgColor: 'bg-[#9C84EF]/20',
  },
  hypesquad_brilliance: {
    name: 'HypeSquad Brilliance',
    description: 'Member of HypeSquad Brilliance',
    icon: Flame,
    color: '#A78BFA',
    bgColor: 'bg-[#A78BFA]/20',
  },
  hypesquad_balance: {
    name: 'HypeSquad Balance',
    description: 'Member of HypeSquad Balance',
    icon: Scale,
    color: '#7C3AED',
    bgColor: 'bg-[#7C3AED]/20',
  },
} as const;

export type BadgeId = keyof typeof BADGE_CONFIG;

interface BadgeProps {
  id: BadgeId;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  className?: string;
}

const sizeMap = {
  sm: 14,
  md: 18,
  lg: 22,
};

export function Badge({ id, size = 'md', showTooltip = true, className }: BadgeProps) {
  const config = BADGE_CONFIG[id];
  
  if (!config) return null;
  
  const Icon = config.icon;
  const iconSize = sizeMap[size];
  
  const badge = (
    <div 
      className={cn(
        "flex items-center justify-center rounded-md transition-transform hover:scale-110",
        size === 'sm' && "w-5 h-5",
        size === 'md' && "w-6 h-6",
        size === 'lg' && "w-8 h-8",
        config.bgColor,
        className
      )}
    >
      <Icon 
        className="flex-shrink-0" 
        style={{ color: config.color }} 
        width={iconSize} 
        height={iconSize} 
      />
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
        <div className="text-sm font-semibold">{config.name}</div>
        <div className="text-xs text-[#888888]">{config.description}</div>
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

export function BadgeList({ badges, size = 'md', maxDisplay = 5, className, expandable = true }: BadgeListProps) {
  const [showAllBadges, setShowAllBadges] = useState(false);
  const displayBadges = badges.slice(0, maxDisplay);
  const remaining = badges.length - maxDisplay;
  
  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn("flex items-center gap-1", className)}>
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
                    <DialogTitle className="text-white">All Badges ({badges.length})</DialogTitle>
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
                              <Icon className="w-5 h-5" style={{ color: config.color }} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-white text-sm">{config.name}</p>
                              <p className="text-xs text-[#888888] truncate">{config.description}</p>
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
                  {remaining} more badge{remaining > 1 ? 's' : ''}
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
}

const SERVER_BADGE_CONFIG = {
  partnered: {
    name: 'Partnered',
    icon: Handshake,
    color: '#8B5CF6',
  },
  verified: {
    name: 'Verified',
    icon: ShieldCheck,
    color: '#8B5CF6',
  },
  discoverable: {
    name: 'Discoverable',
    icon: Sparkles,
    color: '#7C3AED',
  },
};

export function ServerBadge({ type, size = 'md' }: ServerBadgeProps) {
  const config = SERVER_BADGE_CONFIG[type];
  const Icon = config.icon;
  
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
              size === 'sm' && "text-[10px] px-1.5",
            )}
            style={{ 
              backgroundColor: `${config.color}20`,
              color: config.color 
            }}
          >
            <Icon width={size === 'sm' ? 10 : 12} height={size === 'sm' ? 10 : 12} />
            {config.name}
          </div>
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="bg-[#0a0a0a] text-white border border-[#222222]"
        >
          {config.name} Server
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
