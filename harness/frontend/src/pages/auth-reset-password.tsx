import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import { AUTH_ROUTES, authScreens, goTo, tokenFromUrl, webAuth } from '../auth/surface';

/**
 * The page a reset link opens.
 *
 * The token is read from the URL by the HOST, because only the host knows how
 * its own router carries one — see `tokenFromUrl`. `null` is a legitimate
 * value: somebody who typed the address by hand has no token, and the packaged
 * screen renders its "ask for a new link" state rather than a blank form.
 */
export function AuthResetPasswordPage(): JSX.Element {
  const { ResetPasswordScreen } = authScreens;
  return (
    <webAuth.SessionProvider>
      <Box data-testid="page-auth-reset-password" sx={{ maxWidth: 420 }}>
        <ResetPasswordScreen
          token={tokenFromUrl()}
          onDone={() => goTo(AUTH_ROUTES.login)}
          onRequestNewLink={() => goTo(AUTH_ROUTES.forgotPassword)}
        />
      </Box>
    </webAuth.SessionProvider>
  );
}
