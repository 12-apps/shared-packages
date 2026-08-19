import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import { AUTH_ROUTES, authScreens, goTo, webAuth } from '../auth/surface';

/**
 * "I forgot my password" — the whole screen comes from the package.
 *
 * The host supplies one thing: where "back to sign in" goes. That is the
 * shape every screen in this folder has, and the reason the pages are this
 * short is the point being made.
 */
export function AuthForgotPasswordPage(): JSX.Element {
  const { ForgotPasswordScreen } = authScreens;
  return (
    <webAuth.SessionProvider>
      <Box data-testid="page-auth-forgot-password" sx={{ maxWidth: 420 }}>
        <ForgotPasswordScreen onBackToLogin={() => goTo(AUTH_ROUTES.login)} />
      </Box>
    </webAuth.SessionProvider>
  );
}
