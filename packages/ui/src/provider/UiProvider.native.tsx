import * as React from 'react';

import { UiThemeContext } from './ui-theme-context';
import { isUiTheme, type UiProviderProps } from './UiProvider.types';
import { createUiTheme } from '../tokens/theme';

/** The native `UiProvider`: the theme every native component reads. */
export function UiProvider({ theme, children }: UiProviderProps): React.JSX.Element {
  const ui = React.useMemo(() => (isUiTheme(theme) ? theme : createUiTheme(theme)), [theme]);
  return <UiThemeContext.Provider value={ui}>{children}</UiThemeContext.Provider>;
}

UiProvider.displayName = 'UiProvider';
