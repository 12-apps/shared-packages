import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import { AUTH_ROUTES, authScreens, goTo, tokenFromUrl, webAuth } from '../auth/surface';

/**
 * The page a confirmation link opens.
 *
 * It consumes the token on mount, so opening the same link twice is what
 * proves the single-use guarantee end to end — the second visit reaches a row
 * the database already stamped, and the screen says so.
 */
export function AuthVerifyPage(): JSX.Element {
  const { VerifyEmailScreen } = authScreens;
  return (
    <webAuth.SessionProvider>
      <Box data-testid="page-auth-verify" sx={{ maxWidth: 420 }}>
        <VerifyEmailScreen token={tokenFromUrl()} onContinue={() => goTo(AUTH_ROUTES.login)} />
      </Box>
    </webAuth.SessionProvider>
  );
}
