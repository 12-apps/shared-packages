'use client';

import { createContext, useContext, type ReactNode } from 'react';
import React from 'react';

import type { LightboxCopy } from '../../../copy';

/**
 * The lightbox's words, for the four control components that render them.
 *
 * A CONTEXT rather than props: the viewer is `Lightbox` → `LightboxOverlay` →
 * three separate control clusters, and threading one object down three hops is
 * how a copy port comes to exist, be required, and go unread. It stays a
 * single REQUIRED prop at the mount, which is the only place a host answers.
 */
const LightboxCopyContext = createContext<LightboxCopy | null>(null);

export function LightboxCopyProvider({
  copy,
  children,
}: {
  copy: LightboxCopy;
  children: ReactNode;
}): React.JSX.Element {
  return <LightboxCopyContext.Provider value={copy}>{children}</LightboxCopyContext.Provider>;
}

/**
 * The words this viewer renders — THROWS outside a provider rather than
 * falling back.
 *
 * Every one of them is an aria-label on a glyph, so a fallback would be the
 * one failure nobody sees in review: the sighted path renders identically
 * whichever language it is in.
 */
export function useLightboxCopy(): LightboxCopy {
  const copy = useContext(LightboxCopyContext);
  if (!copy) {
    throw new Error('useLightboxCopy must be rendered inside a <LightboxCopyProvider>');
  }
  return copy;
}
