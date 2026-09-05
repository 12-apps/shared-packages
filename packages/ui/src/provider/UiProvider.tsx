import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import * as React from 'react';

import { muiThemeOptionsFrom } from './mui-bridge';
import { isUiTheme, type UiProviderProps } from './UiProvider.types';
import { createUiTheme } from '../tokens/theme';

/**
 * The same provider name on both renderers.
 *
 * On the web it is a MUI `ThemeProvider` fed from a `UiTheme`, for a host that
 * has no MUI theme of its own. A host that already mounts one (every origin app
 * does) needs nothing from this file: the web components read MUI's theme, and
 * `useUiTheme` derives the neutral view from it.
 */
export function UiProvider({ theme, children }: UiProviderProps): React.JSX.Element {
  const ui = React.useMemo(() => (isUiTheme(theme) ? theme : createUiTheme(theme)), [theme]);
  const mui = React.useMemo(() => createTheme(muiThemeOptionsFrom(ui)), [ui]);
  return <ThemeProvider theme={mui}>{children}</ThemeProvider>;
}

UiProvider.displayName = 'UiProvider';
