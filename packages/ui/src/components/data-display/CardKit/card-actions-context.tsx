'use client';

import { createContext, useCallback, useContext, useState, type JSX, type ReactNode } from 'react';

import Snackbar from '@mui/material/Snackbar/index.js';

import { Alert } from '../Alert';

/**
 * The ambient wiring a self-contained row/card menu needs, and nothing else.
 *
 * A menu that owns its own popups still needs three things it cannot know: the
 * tenant it is acting inside, what to do after a write lands, and somewhere to
 * put a failure. Passing those down through the grid, the layout and the card
 * is four props of drilling per entity; holding them in context is one.
 *
 * Kept deliberately SMALL — it is not an edit-dialog host. A menu that read its
 * dialogs from here would stop being portable, because the set of dialogs is
 * per-entity. What it may read is the three facts below.
 *
 * The provider renders ONE shared error snackbar, which is the whole reason the
 * error channel is here rather than per-menu: before it, every page carried its
 * own error alert and every menu had to find its page's.
 */
interface CardActionsValue {
  /** The tenant every action in this subtree acts inside. */
  tenantSlug: string;
  /** Re-read the list after a write. */
  onRefresh: () => void;
  /** Surface a failed action's message (the shared snackbar). */
  notifyError: (message: string) => void;
}

const CardActionsContext = createContext<CardActionsValue | null>(null);

export function CardActionsProvider({
  tenantSlug,
  onRefresh,
  errorTitle,
  errorDismissLabel,
  autoHideMs = 6_000,
  children,
}: {
  tenantSlug: string;
  onRefresh: () => void;
  /**
   * The snackbar's heading — required, no default.
   *
   * It is the one sentence this provider renders on its own, and a default
   * would be the origin's language shipped as a finished-looking silence. The
   * MESSAGE beside it comes from whatever failed, which is already the host's.
   */
  errorTitle: string;
  /** The dismiss on that alert, which carries a glyph only. REQUIRED. */
  errorDismissLabel: string;
  /** How long the snackbar stays up. */
  autoHideMs?: number;
  children: ReactNode;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const notifyError = useCallback((message: string) => setError(message), []);

  return (
    <CardActionsContext.Provider value={{ tenantSlug, onRefresh, notifyError }}>
      {children}
      <Snackbar
        open={error !== null}
        autoHideDuration={autoHideMs}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <span>
          <Alert
            variant="danger"
            title={errorTitle}
            description={error ?? ''}
            closable
            closeLabel={errorDismissLabel}
            onClose={() => setError(null)}
            data-testid="card-action-error"
          />
        </span>
      </Snackbar>
    </CardActionsContext.Provider>
  );
}

/**
 * Read the tenant + refresh + error wiring.
 *
 * THROWS outside a provider rather than answering a null object, deliberately:
 * a menu whose `onRefresh` silently did nothing would leave the operator
 * looking at a stale row after a delete that worked, which reads as the delete
 * having failed. Failing at mount says where the provider is missing.
 */
export function useCardActions(): CardActionsValue {
  const value = useContext(CardActionsContext);
  if (!value) {
    throw new Error('useCardActions must be used within a CardActionsProvider');
  }
  return value;
}
