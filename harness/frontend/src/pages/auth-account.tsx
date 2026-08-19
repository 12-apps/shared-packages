import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import { authScreens, webAuth } from '../auth/surface';

/**
 * The signed-in account page, carrying `PasswordSecurityCard`.
 *
 * The card asks the SERVER which of "add a password" and "change a password" it
 * is in, which is the whole subject of one journey: an account that signed up
 * with Google has never had a password, and a form demanding the current one
 * would be impossible to complete. The host mounts it and passes nothing.
 */
export function AuthAccountPage(): JSX.Element {
  const { PasswordSecurityCard } = authScreens;
  return (
    <webAuth.SessionProvider>
      <Box
        data-testid="page-auth-account"
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 520 }}
      >
        <Heading level="h1">Minha conta</Heading>
        <Text color="secondary" size="sm">
          Tudo abaixo desta linha vem de @12-apps/auth.
        </Text>
        <PasswordSecurityCard />
      </Box>
    </webAuth.SessionProvider>
  );
}
