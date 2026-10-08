// Client-side map from allowlisted badge icon names to lucide components.
// The allowlist itself (and the server-side validation) lives in ./shared.ts;
// `satisfies` makes TypeScript fail if a name there is missing here.
import {
  ShieldCheck, Shield, ShieldHalf, ShieldAlert, BadgeCheck, Crown, Gavel, Hammer, Wrench,
  Handshake, HeartHandshake, HandHeart, Heart, Users, UserStar, UserCheck, Smile, PartyPopper, Gift, Cake,
  Code, Terminal, Bot, Bug, FlaskConical, Cpu, Atom, Braces, GitBranch, Server, Database,
  Star, Sparkles, Sparkle, Award, Trophy, Medal, Gem, Diamond, Flame, Zap, Rocket, Target, Flag, InfinityIcon, Hourglass,
  Music, Headphones, Mic, Palette, Brush, PenTool, Camera, Film, Gamepad2, Joystick, Dice5, Puzzle,
  Moon, Sun, Snowflake, Leaf, Clover, Flower2, Cat, Dog, PawPrint, Ghost, Skull, Coffee, Pizza,
  Globe, Languages, Megaphone, BookOpen, GraduationCap, Lightbulb, Lock, Key, Eye, Compass, Anchor, Feather, Swords, WandSparkles, Orbit, Telescope,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_BADGE_ICON, isBadgeIconName, type BadgeIconName } from "./shared";

export const BADGE_ICON_COMPONENTS = {
  ShieldCheck, Shield, ShieldHalf, ShieldAlert, BadgeCheck, Crown, Gavel, Hammer, Wrench,
  Handshake, HeartHandshake, HandHeart, Heart, Users, UserStar, UserCheck, Smile, PartyPopper, Gift, Cake,
  Code, Terminal, Bot, Bug, FlaskConical, Cpu, Atom, Braces, GitBranch, Server, Database,
  Star, Sparkles, Sparkle, Award, Trophy, Medal, Gem, Diamond, Flame, Zap, Rocket, Target, Flag, Infinity: InfinityIcon, Hourglass,
  Music, Headphones, Mic, Palette, Brush, PenTool, Camera, Film, Gamepad2, Joystick, Dice5, Puzzle,
  Moon, Sun, Snowflake, Leaf, Clover, Flower2, Cat, Dog, PawPrint, Ghost, Skull, Coffee, Pizza,
  Globe, Languages, Megaphone, BookOpen, GraduationCap, Lightbulb, Lock, Key, Eye, Compass, Anchor, Feather, Swords, WandSparkles, Orbit, Telescope,
} satisfies Record<BadgeIconName, LucideIcon>;

/** Component for an icon name, falling back to the default badge icon. */
export function getBadgeIconComponent(name: string | null | undefined): LucideIcon {
  return isBadgeIconName(name) ? BADGE_ICON_COMPONENTS[name] : BADGE_ICON_COMPONENTS[DEFAULT_BADGE_ICON];
}
