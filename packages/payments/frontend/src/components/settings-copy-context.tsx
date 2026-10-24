'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';

import type { PaymentsFailureCopy } from './failure-copy';
import type { PaymentsSettingsCopy } from './settings-copy';
import { EN_US_PAYMENTS_SETTINGS_COPY } from './settings-en-US';

/**
 * The settings surface's words, for the fifteen components that render them
 * (FUT-760).
 *
 * A CONTEXT rather than a prop, unlike `CheckoutViewCopy`: this screen is a
 * tree of small pieces — the status bar, the environment tabs, the connection
 * card, the credential form, the priority list, the walkthrough — and threading
 * one object through all of them as props is how a copy port comes to exist,
 * be required, and go unread. It stays a single REQUIRED prop at the mount
 * (`PaymentProviderSettings`), which is the only place a host has to answer.
 */
const PaymentsSettingsCopyContext = createContext<PaymentsSettingsCopy | null>(null);

export function PaymentsSettingsCopyProvider({
  copy,
  children,
}: {
  copy: PaymentsSettingsCopy;
  children: ReactNode;
}): JSX.Element {
  return (
    <PaymentsSettingsCopyContext.Provider value={copy}>
      {children}
    </PaymentsSettingsCopyContext.Provider>
  );
}

/**
 * The words this settings screen renders — THROWS outside a provider rather
 * than falling back.
 *
 * A fallback could only be the origin host's Portuguese, handed silently to the
 * next adopter's store owner. Failing at the mount is the point: it is the one
 * moment a host can still be told it forgot.
 */
export function usePaymentsSettingsCopy(): PaymentsSettingsCopy {
  const copy = useContext(PaymentsSettingsCopyContext);
  if (!copy) {
    throw new Error(
      'usePaymentsSettingsCopy must be rendered inside a <PaymentsSettingsCopyProvider>',
    );
  }
  return copy;
}

/**
 * The failure sentences in force: the host's pack's when it states
 * them, else the English pack's. Never throws, so a hook that loads data above
 * the provider can still turn a refusal into a sentence instead of relaying the
 * server's message.
 */
export function usePaymentsFailureCopy(): PaymentsFailureCopy {
  const copy = useContext(PaymentsSettingsCopyContext);
  return copy?.failures ?? EN_US_PAYMENTS_SETTINGS_COPY.failures!;
}
