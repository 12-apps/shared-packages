import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import { AuthSettingsScreen } from '../auth/surface';

/**
 * The platform sign-in console — the OPERATOR's screen, not a shopper's.
 *
 * A whole page from one factory call. This used to be ~270 lines of toggle
 * plumbing in every adopter's back office, and the half that mattered was never
 * the plumbing: it was the COPY telling an operator what each switch costs. Now
 * both ship, and the host passes a copy pack and a date format.
 *
 * No `SessionProvider` around it: its two endpoints are session-gated on the
 * SERVER, and the screen itself never reads a session.
 */
export function AuthSettingsPage(): JSX.Element {
  return (
    <Box sx={{ maxWidth: 720 }}>
      <AuthSettingsScreen />
    </Box>
  );
}
