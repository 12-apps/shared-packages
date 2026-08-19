import { useState, type JSX } from 'react';

import { Checkbox } from '@12-apps/ui/form/Checkbox';
import { Box } from '@12-apps/ui/mui/Box';
import { Heading } from '@12-apps/ui/typography/Heading';

import { AUTH_ROUTES, authScreens, goTo, webAuth } from '../auth/surface';

/**
 * Creating an account — `@12-apps/auth`'s `EmailSignupForm`.
 *
 * The terms checkbox is the HOST'S, and it is the reason `SignupConfig` carries
 * `disabled` and `onBeforeSubmit` at all: accepting terms is a fact about the
 * host's own identity row, so the package refuses to own the control but has to
 * let one gate its submit. Every adopter has some version of this.
 */
function SignupScreen(): JSX.Element {
  const { EmailSignupForm } = authScreens;
  const [accepted, setAccepted] = useState(false);

  return (
    <Box
      data-testid="page-auth-signup"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}
    >
      <Heading level="h1">Criar conta</Heading>

      <Checkbox
        checked={accepted}
        onChange={(event) => setAccepted(event.target.checked)}
        label="Li e aceito os termos de uso"
        inputProps={{ 'data-testid': 'accept-terms' }}
      />

      <EmailSignupForm
        callbackUrl={AUTH_ROUTES.account}
        disabled={!accepted}
        // Where a host records the acceptance. Nothing to record here, and the
        // seam still has to be exercised: it runs BEFORE the account exists, so
        // a host that threw from it would expect no user to be created.
        onBeforeSubmit={async () => undefined}
        onSignedIn={() => goTo(AUTH_ROUTES.account)}
      />
    </Box>
  );
}

export function AuthSignupPage(): JSX.Element {
  return (
    <webAuth.SessionProvider>
      <SignupScreen />
    </webAuth.SessionProvider>
  );
}
