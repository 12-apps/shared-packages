import type { JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import { AUTH_ROUTES, authScreens, goTo, webAuth } from '../auth/surface';

/**
 * Signing in — `@12-apps/auth`'s `EmailPasswordForm` on a host's login page.
 *
 * The arrangement every adopter has: the package draws the e-mail + password
 * half, the host draws the social buttons beside it and decides where a
 * successful sign-in goes. Nothing here knows how a password is checked.
 *
 * The Google button is the HOST'S, and it is not decoration. One journey
 * asserts that adding a password does not take a social login away, and the
 * only place that shows is a sign-in screen. It calls the session's own
 * `signIn`, which is the real handshake — this deployment simply configures no
 * OAuth provider (see `auth-host.ts` for why a CI runner cannot), so the round
 * trip ends at Auth.js rather than at Google. What the scenario asserts is that
 * the method is still OFFERED, which is a claim about this screen.
 */
function LoginScreen(): JSX.Element {
  const { EmailPasswordForm } = authScreens;
  const { signIn } = webAuth.useSession();

  return (
    <Box
      data-testid="page-auth-login"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}
    >
      <Heading level="h1">Entrar</Heading>

      <EmailPasswordForm
        callbackUrl={AUTH_ROUTES.account}
        onSignedIn={() => goTo(AUTH_ROUTES.account)}
        onForgotPassword={() => goTo(AUTH_ROUTES.forgotPassword)}
      />

      <Text color="secondary" size="xs" as="p">
        ou
      </Text>
      <Button
        variant="outline"
        onClick={() => void signIn('google', AUTH_ROUTES.account)}
        data-testid="login-google"
      >
        Continuar com Google
      </Button>

      <Button variant="text" onClick={() => goTo(AUTH_ROUTES.signup)} data-testid="login-signup">
        Criar uma conta
      </Button>
    </Box>
  );
}

export function AuthLoginPage(): JSX.Element {
  // The provider is the host's mounting, and it has to be here rather than
  // around the whole shell: `useSession` throws outside it, and the packaged
  // form reads the session through the hook this app handed the factory.
  return (
    <webAuth.SessionProvider>
      <LoginScreen />
    </webAuth.SessionProvider>
  );
}
