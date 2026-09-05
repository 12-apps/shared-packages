import * as React from 'react';

import { UiThemeContext } from './ui-theme-context';
import { DEFAULT_UI_THEME, type UiTheme } from '../tokens/theme';

/** The theme the nearest `UiProvider` set, or the package default without one. */
export function useUiTheme(): UiTheme {
  return React.useContext(UiThemeContext) ?? DEFAULT_UI_THEME;
}
