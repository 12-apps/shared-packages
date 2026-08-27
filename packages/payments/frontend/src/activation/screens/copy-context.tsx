'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';

import type { ActivationStepCopy } from './copy';

/**
 * Step 3's words, for the dozen panels that render them.
 *
 * A CONTEXT rather than a prop, for the same reason `PaymentsSettingsCopy` is
 * one: this step is a tree of small pieces — six settled states, the waiting
 * panel, the link actions, two flows and the form between them — and threading
 * one object through all of them as props is how a copy port comes to exist,
 * be required, and go unread. It stays a single REQUIRED field at the mount
 * (`createActivationStep`), which is the only place a host has to answer.
 */
const ActivationCopyContext = createContext<ActivationStepCopy | null>(null);

export function ActivationCopyProvider({
  copy,
  children,
}: {
  copy: ActivationStepCopy;
  children: ReactNode;
}): JSX.Element {
  return <ActivationCopyContext.Provider value={copy}>{children}</ActivationCopyContext.Provider>;
}

/**
 * The words this step renders — THROWS outside a provider rather than falling
 * back.
 *
 * A fallback could only be the origin host's Portuguese, handed silently to the
 * next adopter's store owner. Failing at the mount is the point: it is the one
 * moment a host can still be told it forgot.
 */
export function useActivationCopy(): ActivationStepCopy {
  const copy = useContext(ActivationCopyContext);
  if (!copy) {
    throw new Error('useActivationCopy must be rendered inside an <ActivationCopyProvider>');
  }
  return copy;
}
