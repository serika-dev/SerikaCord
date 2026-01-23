// Badge system for SerikaCord
import {
  ShieldCheck,
  Shield,
  ShieldAlert,
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
  type LucideIcon,
} from "lucide-react";

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  priority: number;
}

export const BADGES: Record<string, Badge> = {
  // Staff Badges
  SERIKACORD_DEVELOPER: {
    id: 'serikacord_developer',
    name: 'SerikaCord Developer',
    description: 'Core developer of SerikaCord',
    icon: Code,
    color: '#e2b714',
    priority: 150,
  },
  STAFF: {
    id: 'staff',
    name: 'Serika Staff',
    description: 'Official Serika staff member',
    icon: ShieldCheck,
    color: '#5865F2',
    priority: 100,
  },
  ADMIN: {
    id: 'admin',
    name: 'Administrator',
    description: 'Platform administrator',
    icon: Shield,
    color: '#ED4245',
    priority: 99,
  },
  MODERATOR: {
    id: 'moderator',
    name: 'Moderator',
    description: 'Platform moderator',
    icon: ShieldAlert,
    color: '#FEE75C',
    priority: 98,
  },
  
  // Partner & Premium
  PARTNER: {
    id: 'partner',
    name: 'Partnered Server Owner',
    description: 'Owner of a partnered server',
    icon: Handshake,
    color: '#5865F2',
    priority: 90,
  },
  SERIKA_PLUS: {
    id: 'serika_plus',
    name: 'Serika+',
    description: 'Serika+ subscriber',
    icon: Sparkles,
    color: '#F47FFF',
    priority: 85,
  },
  EARLY_SUPPORTER: {
    id: 'early_supporter',
    name: 'Early Supporter',
    description: 'Supported Serika in its early days',
    icon: Heart,
    color: '#EB459E',
    priority: 80,
  },
  
  // Achievement Badges
  VERIFIED_BOT_DEVELOPER: {
    id: 'verified_bot_developer',
    name: 'Verified Bot Developer',
    description: 'Developer of a verified bot',
    icon: Bot,
    color: '#57F287',
    priority: 70,
  },
  BUG_HUNTER: {
    id: 'bug_hunter',
    name: 'Bug Hunter',
    description: 'Found and reported critical bugs',
    icon: Bug,
    color: '#57F287',
    priority: 65,
  },
  BUG_HUNTER_GOLD: {
    id: 'bug_hunter_gold',
    name: 'Bug Hunter (Gold)',
    description: 'Elite bug hunter',
    icon: Bug,
    color: '#FFD700',
    priority: 66,
  },
  
  // Server Badges
  SERVER_OWNER: {
    id: 'server_owner',
    name: 'Server Owner',
    description: 'Owns at least one server',
    icon: Crown,
    color: '#FFD700',
    priority: 50,
  },
  ACTIVE_DEVELOPER: {
    id: 'active_developer',
    name: 'Active Developer',
    description: 'Active application developer',
    icon: Code,
    color: '#23A55A',
    priority: 55,
  },
  
  // Special Event Badges
  HYPESQUAD_BRAVERY: {
    id: 'hypesquad_bravery',
    name: 'HypeSquad Bravery',
    description: 'Member of HypeSquad Bravery',
    icon: Zap,
    color: '#9C84EF',
    priority: 40,
  },
  HYPESQUAD_BRILLIANCE: {
    id: 'hypesquad_brilliance',
    name: 'HypeSquad Brilliance',
    description: 'Member of HypeSquad Brilliance',
    icon: Flame,
    color: '#F47B67',
    priority: 40,
  },
  HYPESQUAD_BALANCE: {
    id: 'hypesquad_balance',
    name: 'HypeSquad Balance',
    description: 'Member of HypeSquad Balance',
    icon: Scale,
    color: '#45DDC0',
    priority: 40,
  },
};

// BadgeKey is the uppercase key like 'STAFF'
export type BadgeKey = keyof typeof BADGES;
// BadgeId is the lowercase id like 'staff'
export type BadgeId = Badge['id'];

export const getBadgesByPriority = (badgeIds: BadgeId[]): Badge[] => {
  const badgeMap = Object.values(BADGES).reduce((acc, badge) => {
    acc[badge.id] = badge;
    return acc;
  }, {} as Record<string, Badge>);
  
  return badgeIds
    .map(id => badgeMap[id])
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);
};
