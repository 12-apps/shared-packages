import { useTheme } from '@mui/material/styles/index.js';
import * as React from 'react';

import { uiThemeFromMui } from './mui-bridge';
import type { UiTheme } from '../tokens/theme';

/**
 * The web reading of the theme: MUI's, as a `UiTheme`.
 *
 * Derived rather than provided on purpose. A host that already mounts its own
 * `ThemeProvider` (every origin app does, through `@12-apps/app-shell`) gets
 * the same numbers a MUI-styled sibling paints with, and nothing has to be
 * mounted twice or kept in step.
 */
export function useUiTheme(): UiTheme {
  const theme = useTheme();
  return React.useMemo(() => uiThemeFromMui(theme), [theme]);
}
