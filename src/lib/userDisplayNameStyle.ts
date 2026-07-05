import type { CSSProperties } from 'react';

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
  cursive: 'font-serif italic',
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
    case 'neon':
      classes.push('drop-shadow-[0_0_6px_rgba(255,255,255,0.6)]');
      break;
    case 'toon':
      classes.push('text-shadow-sm');
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

  if (style.effect === 'gradient' && style.gradient && style.gradient.length >= 2) {
    css.backgroundImage = `linear-gradient(90deg, ${style.gradient.join(', ')})`;
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    css.color = 'transparent';
  } else if (style.color) {
    css.color = style.color;
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
      css.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
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
    const glow = style.color || '#ffffff';
    css.textShadow = `0 0 6px ${glow}, 0 0 12px ${glow}, 0 0 18px ${glow}`;
  }

  if (style.effect === 'toon') {
    css.textShadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
  }

  if (style.effect === 'pop') {
    css.textShadow = '2px 2px 0 rgba(0,0,0,0.4)';
  }

  return css;
}

export function getProfileBackgroundStyle(customization?: {
  profileColor?: string;
  profileGradient?: string[];
  profileAccentColor?: string;
} | null): CSSProperties {
  if (!customization) return {};
  const { profileGradient, profileColor } = customization;

  if (profileGradient && profileGradient.length >= 2) {
    return { background: `linear-gradient(135deg, ${profileGradient.join(', ')})` };
  }
  if (profileColor) {
    return { backgroundColor: profileColor };
  }
  return {};
}
