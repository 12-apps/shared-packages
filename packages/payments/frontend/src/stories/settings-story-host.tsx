import type { JSX, ReactNode } from 'react';

import { PaymentsSettingsCopyProvider } from '../components/settings-copy-context';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * The one line a host writes above any settings component (FUT-760).
 *
 * These stories mount the package's pieces BARE — a status bar, a priority
 * list, a walkthrough — with no `PaymentProviderSettings` above them, and that
 * is the point: they show what an adopter gets from the flat exports. So they
 * supply the words the same way an adopter would, rather than the components
 * falling back to a pack the package chose.
 */
export function SettingsStoryHost({ children }: { children: ReactNode }): JSX.Element {
  return (
    <PaymentsSettingsCopyProvider copy={PT_BR_PAYMENTS_SETTINGS_COPY}>
      {children}
    </PaymentsSettingsCopyProvider>
  );
}
