// Everytool color tokens. Light and dark each have one primary action color.
// Screens, the keyboard, the share sheet, and the widgets read these roles
// and do not pick their own hex. WCAG AA: 4.5:1 for text, 3:1 for separators
// and other UI chrome, in both modes.

export type Palette = {
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  surface: string;
  background: string;
  textPrimary: string;
  textSecondary: string;
  destructive: string;
  onDestructive: string;
  success: string;
  warning: string;
  separator: string;
  toast: string;
  onToast: string;
  media: string;
  onMedia: string;
  mediaRaised: string;
  mediaTrack: string;
  scrim: string;
  primaryWash: string;
  hideFill: string;
  keyboardBackground: string;
  keyBackground: string;
  keySpecial: string;
};

export const light: Palette = {
  primary: '#0066D6',
  onPrimary: '#FFFFFF',
  secondary: '#E8E8ED',
  onSecondary: '#1C1C1E',
  surface: '#FFFFFF',
  background: '#F2F2F7',
  textPrimary: '#1C1C1E',
  textSecondary: '#5C6370',
  destructive: '#D70015',
  onDestructive: '#FFFFFF',
  success: '#1E7A34',
  warning: '#9A4D00',
  separator: '#85858A',
  toast: '#1C1C1E',
  onToast: '#FFFFFF',
  media: '#000000',
  onMedia: '#FFFFFF',
  mediaRaised: '#1C1C1E',
  mediaTrack: '#2C2C2E',
  scrim: 'rgba(0, 0, 0, 0.55)',
  primaryWash: 'rgba(0, 102, 214, 0.35)',
  hideFill: 'rgba(120, 120, 128, 0.92)',
  keyboardBackground: '#D1D6DB',
  keyBackground: '#FFFFFF',
  keySpecial: '#B8BDC7',
};

export const dark: Palette = {
  primary: '#4DA3FF',
  onPrimary: '#1C1C1E',
  secondary: '#2C2C2E',
  onSecondary: '#FFFFFF',
  surface: '#1C1C1E',
  background: '#000000',
  textPrimary: '#FFFFFF',
  textSecondary: '#AEAEB2',
  destructive: '#FF453A',
  onDestructive: '#1C1C1E',
  success: '#30D158',
  warning: '#FF9F0A',
  separator: '#85858A',
  toast: '#3A3A3C',
  onToast: '#FFFFFF',
  media: '#000000',
  onMedia: '#FFFFFF',
  mediaRaised: '#1C1C1E',
  mediaTrack: '#2C2C2E',
  scrim: 'rgba(0, 0, 0, 0.55)',
  primaryWash: 'rgba(77, 163, 255, 0.35)',
  hideFill: 'rgba(120, 120, 128, 0.92)',
  keyboardBackground: '#1C1C1E',
  keyBackground: '#525252',
  keySpecial: '#2E2E2E',
};

/** Signature ink. Document color, not a button. */
export const documentInk = {
  black: '#000000',
  blue: '#0033CC',
};

export function paletteFor(scheme: 'light' | 'dark' | null | undefined): Palette {
  return scheme === 'dark' ? dark : light;
}

export const space = {
  screen: 20,
  cardPad: 18,
  gap: 12,
  radius: 18,
};

export function typography(p: Palette) {
  return {
    num: { fontSize: 28, fontWeight: '800' as const, color: p.textPrimary },
    numBig: { fontSize: 40, fontWeight: '800' as const, color: p.textPrimary },
    numSmall: { fontSize: 16, fontWeight: '700' as const, color: p.textSecondary },
    h1: { fontSize: 26, fontWeight: '800' as const, color: p.textPrimary },
    h2: { fontSize: 19, fontWeight: '700' as const, color: p.textPrimary },
    body: { fontSize: 16, color: p.textPrimary },
    small: { fontSize: 13.5, color: p.textSecondary },
    label: {
      fontSize: 13,
      fontWeight: '700' as const,
      color: p.textSecondary,
      letterSpacing: 0.4,
      textTransform: 'uppercase' as const,
    },
  };
}

export type TypeStyle = ReturnType<typeof typography>;

function channel(hex: string, index: number): number {
  const h = hex.replace('#', '');
  const wide = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return Number.parseInt(wide.slice(index * 2, index * 2 + 2), 16) / 255;
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = linearize(channel(hex, 0));
  const g = linearize(channel(hex, 1));
  const b = linearize(channel(hex, 2));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. Only solid #rgb / #rrggbb colors. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
