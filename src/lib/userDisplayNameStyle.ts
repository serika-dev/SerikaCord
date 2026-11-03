import type { CSSProperties } from 'react';
import {
  safeCssColor,
  safeCssColorList,
  safeEnum,
  safeGradientAngle,
  safeNumber,
  safeRadialPosition,
} from '@/lib/profiles/customizationSafety';

const PROFILE_CARD_EFFECTS = ['normal', 'glassmorphism', 'glow', 'holographic', 'neon'] as const;
const PROFILE_GRADIENT_TYPES = ['linear', 'radial'] as const;

export interface DisplayNameStyle {
  font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
  effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
  color?: string;
  gradient?: string[];
}

const FONT_CLASS_MAP: Record<string, string> = {
  default: 'font-sans',
  serif: 'font-serif',
  mono: 'font-mono',
  rounded: 'font-sans',
  cursive: 'italic',
  bold: 'font-sans',
};

export function getDisplayNameStyleClasses(style: DisplayNameStyle | undefined): string {
  if (!style) return '';
  const classes: string[] = [];

  const fontClass = style.font ? FONT_CLASS_MAP[style.font] : '';
  if (fontClass) classes.push(fontClass);

  switch (style.effect) {
    case 'gradient':
      classes.push('bg-clip-text text-transparent');
      break;
    case 'pop':
      classes.push('tracking-wide');
      break;
  }

  return classes.join(' ');
}

export function getDisplayNameStyleInline(style: DisplayNameStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  // Stored values may predate server validation: only colours reach CSS.
  const gradient = safeCssColorList(style.gradient, 4);
  const color = safeCssColor(style.color);

  if (style.effect === 'gradient' && gradient.length >= 2) {
    css.backgroundImage = `linear-gradient(90deg, ${gradient.join(', ')})`;
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    css.color = 'transparent';
  } else if (color) {
    css.color = color;
  }

  switch (style.font) {
    case 'default':
      css.fontFamily = 'var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)';
      break;
    case 'serif':
      css.fontFamily = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
      break;
    case 'mono':
      css.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      break;
    case 'rounded':
      css.fontFamily = 'ui-rounded, "Hiragino Maru Gothic ProN", "Quicksand", "Comfortaa", "Manjari", "Arial Rounded MT Bold", "Calibri", system-ui, sans-serif';
      css.fontWeight = 600;
      break;
    case 'cursive':
      css.fontFamily = '"Comic Sans MS", "Chalkboard SE", "Bradley Hand", cursive, sans-serif';
      css.fontStyle = 'italic';
      break;
    case 'bold':
      css.fontFamily = 'var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)';
      css.fontWeight = 900;
      break;
  }

  if (style.effect === 'neon') {
    const glow = color || '#8B5CF6';
    css.color = '#fff';
    css.textShadow = `0 0 6px ${glow}, 0 0 14px ${glow}, 0 0 22px ${convertHexToRgba(glow, 0.8)}, 0 0 38px ${convertHexToRgba(glow, 0.5)}, 0 0 55px ${convertHexToRgba(glow, 0.3)}`;
  }

  if (style.effect === 'toon') {
    css.textShadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 2px #000, 0 0 4px rgba(0,0,0,0.4)';
  }

  if (style.effect === 'pop') {
    css.textShadow = '1px 1px 0 rgba(0,0,0,0.25), 2px 2px 0 rgba(0,0,0,0.25), 3px 3px 0 rgba(0,0,0,0.3), 4px 4px 0 rgba(0,0,0,0.35)';
  }

  return css;
}

// Convert hex color to rgba helper
export const convertHexToRgba = (hex: string, opacity: number): string => {
  if (!hex || typeof hex !== 'string') return hex;
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex.substring(0, 1) + cleanHex.substring(0, 1), 16);
    const g = parseInt(cleanHex.substring(1, 2) + cleanHex.substring(1, 2), 16);
    const b = parseInt(cleanHex.substring(2, 3) + cleanHex.substring(2, 3), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  } else if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  if (hex.startsWith('rgb')) {
    return hex.replace(/[\d.]+\)/, `${opacity})`).replace('rgb(', 'rgba(');
  }
  return hex;
};

export function getProfileBackgroundStyle(
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    profileGradientAngle?: number;
    profileGradientType?: 'linear' | 'radial';
    profileGradientRadialPosition?: string;
    profileCardEffect?: 'normal' | 'glassmorphism' | 'glow' | 'holographic' | 'neon';
    profileCardBlur?: number;
    profileCardOpacity?: number;
    profileCardBorderColor?: string;
    profileCardBorderGlow?: boolean;
    profileCardBorderWidth?: number;
  } | null,
  options?: { opaque?: boolean }
): CSSProperties {
  if (!customization) return {};
  // Every value is re-checked here: rows saved before server validation may
  // hold anything, and these strings are interpolated into CSS.
  const profileGradient = safeCssColorList(customization.profileGradient);
  const profileColor = safeCssColor(customization.profileColor) ?? '';
  const profileGradientType = safeEnum(customization.profileGradientType, PROFILE_GRADIENT_TYPES, 'linear');
  const profileGradientAngle = safeGradientAngle(customization.profileGradientAngle);
  const profileGradientRadialPosition = safeRadialPosition(customization.profileGradientRadialPosition);
  const profileCardEffect = safeEnum(customization.profileCardEffect, PROFILE_CARD_EFFECTS, 'normal');
  const profileCardBlur = safeNumber(customization.profileCardBlur, 0, 24, 8);
  const profileCardOpacity = safeNumber(customization.profileCardOpacity, 0, 1, 0.85);
  const profileCardBorderColor = safeCssColor(customization.profileCardBorderColor) ?? '';
  const profileCardBorderGlow = customization.profileCardBorderGlow === true;
  const profileCardBorderWidth = safeNumber(customization.profileCardBorderWidth, 0, 5, 1);

  const style: CSSProperties = {};

  // 1. Background Value
  let backgroundVal = '';
  if (profileGradient && profileGradient.length >= 2) {
    if (profileGradientType === 'radial') {
      backgroundVal = `radial-gradient(circle at ${profileGradientRadialPosition}, ${profileGradient.join(', ')})`;
    } else {
      backgroundVal = `linear-gradient(${profileGradientAngle}deg, ${profileGradient.join(', ')})`;
    }
  } else if (profileColor) {
    backgroundVal = profileColor;
  }

  // 2. Card Effect styling
  if (profileCardEffect === 'glassmorphism') {
    if (options?.opaque) {
      if (backgroundVal) {
        if (backgroundVal.startsWith('linear-gradient') || backgroundVal.startsWith('radial-gradient')) {
          style.background = backgroundVal;
        } else {
          style.backgroundColor = backgroundVal;
        }
      }
    } else {
      style.backdropFilter = `blur(${profileCardBlur}px)`;
      style.WebkitBackdropFilter = `blur(${profileCardBlur}px)`;

      if (profileGradient && profileGradient.length >= 2) {
        const transparentGrad = profileGradient.map((color) => convertHexToRgba(color, profileCardOpacity));
        if (profileGradientType === 'radial') {
          style.background = `radial-gradient(circle at ${profileGradientRadialPosition}, ${transparentGrad.join(', ')})`;
        } else {
          style.background = `linear-gradient(${profileGradientAngle}deg, ${transparentGrad.join(', ')})`;
        }
      } else if (profileColor) {
        style.backgroundColor = convertHexToRgba(profileColor, profileCardOpacity);
      } else {
        style.backgroundColor = `rgba(12, 12, 16, ${profileCardOpacity})`;
      }
    }
  } else if (profileCardEffect === 'holographic') {
    style.background = `linear-gradient(${profileGradientAngle}deg, #ff7b00, #ff007b, #9900ff, #0022ff, #00ff77, #ff7b00)`;
    style.backgroundSize = '400% 400%';
    style.animation = 'holographic-animation 12s ease infinite';
  } else {
    // Normal / other effects
    if (backgroundVal) {
      if (backgroundVal.startsWith('linear-gradient') || backgroundVal.startsWith('radial-gradient')) {
        style.background = backgroundVal;
      } else {
        style.backgroundColor = backgroundVal;
      }
    }
  }

  // Glow / Neon shadow effects
  const primaryAccent = (profileGradient && profileGradient[0]) || profileColor || '#8B5CF6';
  const secondaryAccent = (profileGradient && profileGradient[1]) || primaryAccent;

  if (profileCardEffect === 'glow') {
    style.boxShadow = `0 10px 30px -5px rgba(0, 0, 0, 0.3), 0 0 20px 2px ${convertHexToRgba(primaryAccent, 0.35)}`;
  } else if (profileCardEffect === 'neon') {
    style.boxShadow = `0 0 5px ${primaryAccent}, 0 0 15px ${secondaryAccent}`;
  }

  // Custom Border styling
  if (profileCardBorderColor) {
    style.borderColor = profileCardBorderColor;
    style.borderWidth = `${profileCardBorderWidth}px`;
    style.borderStyle = 'solid';
  } else if (profileCardBorderGlow) {
    style.borderColor = primaryAccent;
    style.borderWidth = `${profileCardBorderWidth}px`;
    style.borderStyle = 'solid';
    style.boxShadow = style.boxShadow 
      ? `${style.boxShadow}, 0 0 8px ${convertHexToRgba(primaryAccent, 0.5)}`
      : `0 0 8px ${convertHexToRgba(primaryAccent, 0.5)}`;
  }

  return style;
}

export function getProfileBannerStyle(customization?: {
  profileColor?: string;
  profileGradient?: string[];
  profileGradientAngle?: number;
  profileGradientType?: 'linear' | 'radial';
  profileGradientRadialPosition?: string;
} | null): CSSProperties {
  if (!customization) return {};
  const profileGradient = safeCssColorList(customization.profileGradient);
  const profileColor = safeCssColor(customization.profileColor);
  const profileGradientType = safeEnum(customization.profileGradientType, PROFILE_GRADIENT_TYPES, 'linear');
  const profileGradientAngle = safeGradientAngle(customization.profileGradientAngle);
  const profileGradientRadialPosition = safeRadialPosition(customization.profileGradientRadialPosition);

  if (profileGradient.length >= 2) {
    if (profileGradientType === 'radial') {
      return { background: `radial-gradient(circle at ${profileGradientRadialPosition}, ${profileGradient.join(', ')})` };
    }
    return { background: `linear-gradient(${profileGradientAngle}deg, ${profileGradient.join(', ')})` };
  }
  if (profileColor) {
    return { backgroundColor: profileColor };
  }
  return {};
}
