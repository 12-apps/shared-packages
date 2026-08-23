import { render as rtlRender, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { JSX, ReactElement, ReactNode } from 'react';

import { PaymentsSettingsCopyProvider } from '../components/settings-copy-context';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * `render`, wrapped in the copy provider a real host mounts (FUT-760).
 *
 * The settings components read their words from context and THROW without it,
 * deliberately — a fallback could only be the origin host's Portuguese. That
 * makes every suite rendering one of them a host, so they get what a host
 * provides rather than each file growing a wrapper of its own.
 *
 * The pt-BR pack, because these suites assert on the sentences it produces:
 * wording that changed by accident still fails a test.
 */
function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <PaymentsSettingsCopyProvider copy={PT_BR_PAYMENTS_SETTINGS_COPY}>
      {children}
    </PaymentsSettingsCopyProvider>
  );
}

export function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

export * from '@testing-library/react';
