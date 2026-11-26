/**
 * InlineConfirm — the confirmation of an irreversible act, drawn IN PLACE,
 * inside the list row it acts on, under a hairline. It is `ConfirmAction`'s
 * contract without the popup: nothing runs until the verb is pressed, one
 * write per confirmation, a failure stays visible, focus starts on the safe
 * button and Escape backs out. For a list the reader must keep in view while
 * deciding — a queue, a set of rows — where a dialog would cover it.
 */
import Divider from '@mui/material/Divider/index.js';
import { styled } from '@mui/material/styles/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

import { rem } from '../../../tokens/relative';
import { Button } from '../../form/Button';

import type { InlineConfirmProps } from './InlineConfirm.types';

/** The query container the action row reads; never a media query. */
const INLINE_CONFIRM_CONTAINER = 'inline-confirm';

/** Below this width of the space it is given (a phone's card), each button spans the line. */
const INLINE_CONFIRM_NARROW_BELOW = 288;

/**
 * The action row wraps WHOLE buttons. The verb leads at the start edge and
 * the cancel follows; stacked, the verb is on top and the cancel at the
 * bottom (`components-guidelines.md`, "Stacked buttons"). The DOM keeps the
 * cancel FIRST, so it is first in the tab order: `row-reverse` with
 * `wrap-reverse` draws the order, the markup never reorders.
 */
const Actions = styled('div')(({ theme }) => ({
  display: 'flex',
  flexDirection: 'row-reverse',
  flexWrap: 'wrap-reverse',
  justifyContent: 'flex-end',
  columnGap: theme.spacing(1),
  rowGap: theme.spacing(1),
  // A narrow row (a phone's card): each button takes a whole line of its own.
  [`@container ${INLINE_CONFIRM_CONTAINER} (width < ${rem(theme, INLINE_CONFIRM_NARROW_BELOW)})`]: {
    '& > *': { flexGrow: 1, flexBasis: '100%' },
  },
}));

const Root = styled('div')(({ theme }) => ({
  // A flex item in a host's row would otherwise collapse to nothing.
  width: '100%',
  containerType: 'inline-size',
  containerName: INLINE_CONFIRM_CONTAINER,
  display: 'flex',
  flexDirection: 'column',
  // The prototype's rhythm on the theme's stops: ~13px from the hairline to the
  // question, ~4px from the question to its body, 8px before the buttons.
  '& > .inline-confirm-title': { marginTop: theme.spacing(1.5) },
  '& > .inline-confirm-text': { marginTop: theme.spacing(0.5) },
  '& > .inline-confirm-actions': { marginTop: theme.spacing(1) },
}));

/** The rejection's own sentence when it has one; the host's fallback otherwise. */
function failureText(error: unknown, fallback?: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback ?? '';
}

/**
 * Run the act once: pending while its promise is out, the failure kept and
 * announced (`role="alert"`), with focus on the verb, so a keyboard reader
 * retries with Enter instead of tabbing back in. A confirmation the host closed forgets its failure, so reopening it
 * never shows a stale one.
 */
function useConfirmRun(open: boolean, onConfirm: InlineConfirmProps['onConfirm'], errorText?: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPending(true);
    // Called in the click itself, so the act starts in the reader's gesture.
    new Promise<unknown>((resolve) => resolve(onConfirm()))
      .catch((reason: unknown) => setError(failureText(reason, errorText)))
      .finally(() => {
        inFlight.current = false;
        setPending(false);
      });
  }, [errorText, onConfirm]);
  const reset = useCallback(() => setError(null), []);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (error !== null) confirmRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);
  return { pending, error, confirmRef, run, reset };
}

/**
 * Focus moves to the cancel when the confirmation opens — the safe tap, so a
 * stray Enter cannot complete the act. Backing out hands focus back AFTER the
 * host has re-rendered — on the commit that closes the confirmation (or
 * unmounts it), never inside the click — to `returnFocusTo()` when given, else
 * to the element that held focus when it opened, if that is still in the page.
 * A trigger the host hides while the confirmation is open is unmounted by
 * then, so such a host passes `returnFocusTo`.
 */
function useReturnFocus(
  open: boolean,
  cancelRef: React.RefObject<HTMLButtonElement | null>,
  returnFocusTo: InlineConfirmProps['returnFocusTo'],
): () => void {
  const before = useRef<HTMLElement | null>(null);
  const wanted = useRef(false);
  const target = useRef(returnFocusTo);
  useEffect(() => {
    target.current = returnFocusTo;
  });
  const giveBack = useCallback(() => {
    if (!wanted.current) return;
    wanted.current = false;
    const element = target.current?.() ?? before.current;
    before.current = null;
    if (element && element.isConnected) element.focus();
  }, []);
  useEffect(() => {
    if (!open) {
      giveBack();
      return;
    }
    const active = typeof document === 'undefined' ? null : document.activeElement;
    before.current = active instanceof HTMLElement && active !== document.body ? active : null;
    cancelRef.current?.focus();
  }, [cancelRef, giveBack, open]);
  // A host that unmounts the confirmation instead of closing it.
  useEffect(() => giveBack, [giveBack]);
  return useCallback(() => {
    wanted.current = true;
  }, []);
}

export function InlineConfirm({
  open,
  title,
  description,
  irreversibleNote,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  errorText,
  returnFocusTo,
  dataTestId = 'inline-confirm',
}: InlineConfirmProps): React.JSX.Element | null {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const { pending, error, confirmRef, run, reset } = useConfirmRun(open, onConfirm, errorText);
  const askForFocusBack = useReturnFocus(open, cancelRef, returnFocusTo);

  const cancel = useCallback(() => {
    if (pending) return;
    reset();
    askForFocusBack();
    onCancel();
  }, [askForFocusBack, onCancel, pending, reset]);

  if (!open) return null;
  return (
    <Root
      role="group"
      aria-labelledby={titleId}
      data-testid={dataTestId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        cancel();
      }}
    >
      <Divider />
      <Typography id={titleId} className="inline-confirm-title" variant="body1" component="p" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description ? (
        <Typography className="inline-confirm-text" variant="body2" component="p" color="text.secondary">
          {description}
        </Typography>
      ) : null}
      {irreversibleNote ? (
        <Typography className="inline-confirm-text" variant="body2" component="p" sx={{ fontWeight: 600 }} data-testid={`${dataTestId}-irreversible`}>
          {irreversibleNote}
        </Typography>
      ) : null}
      {error ? (
        <Typography className="inline-confirm-text" variant="body2" component="p" color="error" role="alert" data-testid={`${dataTestId}-error`}>
          {error}
        </Typography>
      ) : null}
      {/* Neither button is natively disabled while the write is out — the
          pressed one would drop focus to the page: the verb is `loading`
          (aria-disabled, press ignored) and the cancel is aria-disabled, its
          press ignored by `cancel`. */}
      <Actions className="inline-confirm-actions">
        <Button ref={cancelRef} variant="outline" color="primary" aria-disabled={pending || undefined} onClick={cancel} dataTestId={`${dataTestId}-cancel`}>
          {cancelText}
        </Button>
        <Button ref={confirmRef} variant="solid" color="danger" loading={pending} onClick={run} dataTestId={`${dataTestId}-confirm`}>
          {confirmText}
        </Button>
      </Actions>
    </Root>
  );
}
