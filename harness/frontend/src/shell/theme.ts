import { createTheme } from '@12-apps/ui/mui/styles';

/**
 * The harness renders under the design system's own theme, not MUI's defaults.
 *
 * `@12-apps/ui`'s components are authored against these tokens — the ones its
 * Storybook mounts every story with (`packages/ui/.storybook/preview.tsx`,
 * which is the source of truth this mirrors). Without them, a consumer here
 * sees MUI-blue chrome that exists nowhere a real host would see it, and every
 * screenshot taken from this harness is of a product that does not ship.
 *
 * A host's own theme is its own business: the origin host layers tenant brand
 * overrides on top of these very tokens. The harness takes them unmodified
 * because it is the neutral case — what a package looks like before anyone
 * brands it.
 */
export const harnessTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#6366F1' },
    secondary: { main: '#8B5CF6' },
  },
});
