import type { Theme } from '@mui/material/styles/index.js';

import type { ColorValue, MuiColor } from './vocabulary';

/**
 * `@12-apps/ui/tokens` keeps its whole surface here. The vocabulary itself —
 * the size and colour unions and their runtime lists — lives in
 * `./vocabulary`, which imports nothing, so the native renderer can read it
 * without this file's MUI `Theme` import following it into `dist/types-native`.
 */
export * from './vocabulary';
export { headingMetrics } from './typography';
// The renderer-neutral theme and the colour arithmetic behind it, so a web
// host can build a `UiTheme` from the same module path a native one does.
export * from './theme';
export * from './color';

export interface Accent {
  main: string;
  light: string;
  dark: string;
  contrastText: string;
}

export function accentFor(theme: Theme, color: ColorValue): Accent {
  if (color === 'neutral') {
    const grey = theme.palette.grey;
    return {
      // Explicit fallbacks: the ramp is indexed, and under
      // `noUncheckedIndexedAccess` every stop is `string | undefined`.
      main: grey[600] ?? '#757575',
      light: grey[400] ?? '#bdbdbd',
      dark: grey[800] ?? '#424242',
      // Grey 600 carries white text in both themes.
      contrastText: '#fff',
    };
  }
  // Past the `neutral` return, `paletteKey` can only produce a `MuiColor` — but
  // its signature still admits `'grey'`, and TS cannot narrow a return type by
  // the argument. Naming the key here keeps the accent branch honestly typed
  // instead of casting the hole shut.
  const key: MuiColor = color === 'danger' ? 'error' : color;
  return theme.palette[key];
}
