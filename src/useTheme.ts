import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { paletteFor, typography, type Palette, type TypeStyle } from './theme';

export function useTheme(): { palette: Palette; type: TypeStyle; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = paletteFor(scheme);
  const type = useMemo(() => typography(palette), [palette]);
  return { palette, type, scheme };
}

/** Styles for the active scheme, or for a fixed palette (the dark viewer). */
export function useThemed<T>(factory: (p: Palette) => T, forced?: Palette): {
  palette: Palette;
  type: TypeStyle;
  styles: T;
} {
  const theme = useTheme();
  const palette = forced ?? theme.palette;
  const type = useMemo(() => (forced ? typography(forced) : theme.type), [forced, theme.type]);
  const styles = useMemo(() => factory(palette), [factory, palette]);
  return { palette, type, styles };
}
