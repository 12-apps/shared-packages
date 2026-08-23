'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';

import type { PlatformHomologacaoCopy } from './copy';

/**
 * The platform screens' words, for the eight components that render them.
 *
 * A CONTEXT rather than a prop, for the same reason the settings surface uses
 * one: this is a tree of small cards — the outcome form, the paste-ready
 * answers, the anexo, the environment cards and the fields inside them — and
 * threading one object through all of them as props is how a copy port comes
 * to exist, be required, and go unread.
 *
 * It stays a single REQUIRED prop at the two mounts (`PlatformHomologacao` and
 * `ConnectApplicationPanel`), which is the only place a host has to answer.
 */
const PlatformCopyContext = createContext<PlatformHomologacaoCopy | null>(null);

export function PlatformCopyProvider({
  copy,
  children,
}: {
  copy: PlatformHomologacaoCopy;
  children: ReactNode;
}): JSX.Element {
  return <PlatformCopyContext.Provider value={copy}>{children}</PlatformCopyContext.Provider>;
}

/**
 * The words these screens render — THROWS outside a provider rather than
 * falling back.
 *
 * A fallback could only be this package's own answer, handed silently to the
 * next platform's operator. Failing at the mount is the point: it is the one
 * moment a host can still be told it forgot.
 */
export function usePlatformCopy(): PlatformHomologacaoCopy {
  const copy = useContext(PlatformCopyContext);
  if (!copy) {
    throw new Error('usePlatformCopy must be rendered inside a <PlatformCopyProvider>');
  }
  return copy;
}
