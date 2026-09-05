import * as React from 'react';

import type { UiTheme } from '../tokens/theme';

/**
 * The native renderer's theme channel.
 *
 * Only the native files read it. On the web the theme every component paints
 * from is MUI's, reached through emotion's own context, and `use-ui-theme.ts`
 * derives a `UiTheme` view of it — so there is exactly one source of truth per
 * renderer rather than two that can disagree.
 */
export const UiThemeContext = React.createContext<UiTheme | null>(null);
