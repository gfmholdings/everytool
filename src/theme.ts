// Design tokens — from the approved mockup: iOS system surfaces, one vivid
// blue as THE accent, a single warm orange reserved for the "one thing that
// matters" per screen, and every numeral in the same bold sans style so a
// number never changes costume between screens.

export const colors = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  ink: '#1C1C1E',
  muted: '#6B7280',
  faint: '#AEAEB2',
  border: '#E5E7EB',
  accent: '#007AFF', // the vivid blue — primary actions, tool glyphs
  accentPressed: '#0066D6',
  accentSoft: '#E3F0FF',
  orange: '#F5861F', // the one warm accent (icon tile, free-day moments)
  good: '#248A3D',
  danger: '#D70015',
  keyboardBg: '#D1D3D9',
  keyBg: '#FFFFFF',
  keyDark: '#AEB3BC',
};

export const type = {
  // THE numeral styles. Every number in the app uses one of these.
  num: { fontSize: 28, fontWeight: '800' as const, color: colors.ink },
  numBig: { fontSize: 40, fontWeight: '800' as const, color: colors.ink },
  numSmall: { fontSize: 16, fontWeight: '700' as const, color: colors.muted },
  h1: { fontSize: 26, fontWeight: '800' as const, color: colors.ink },
  h2: { fontSize: 19, fontWeight: '700' as const, color: colors.ink },
  body: { fontSize: 16, color: colors.ink },
  small: { fontSize: 13.5, color: colors.muted },
  label: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
};

export const space = {
  screen: 20,
  cardPad: 18,
  gap: 12,
  radius: 18,
};
