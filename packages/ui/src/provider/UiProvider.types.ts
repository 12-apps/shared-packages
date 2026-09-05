import type * as React from 'react';

import type { UiTheme, UiThemeOptions } from '../tokens/theme';

export interface UiProviderProps {
  /**
   * A built `UiTheme`, or the options to build one. Omit for the package
   * default: the platform's light theme.
   */
  theme?: UiTheme | UiThemeOptions;
  children: React.ReactNode;
}

/** A built theme has a `palette`; options never do. */
export const isUiTheme = (theme: UiTheme | UiThemeOptions | undefined): theme is UiTheme =>
  theme !== undefined && 'palette' in theme && 'spacing' in theme && typeof theme.spacing === 'function';
