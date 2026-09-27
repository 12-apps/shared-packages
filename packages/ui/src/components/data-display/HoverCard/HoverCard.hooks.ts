import React from 'react';

type TimerRef = React.MutableRefObject<number | undefined>;

/**
 * Cancel the timer a ref holds, and forget it. Every place that schedules
 * or dismisses goes through this, so no timer outlives the ref that could
 * cancel it (FUT-2619: an overwritten enter timer reopened a dismissed card).
 */
const clearPending = (ref: TimerRef) => {
  if (ref.current !== undefined) window.clearTimeout(ref.current);
  ref.current = undefined;
};

interface HandlerInput {
  isTouchDevice: boolean;
  touchEnabled: boolean;
  enterDelay: number;
  openCard: (trigger: HTMLElement) => void;
  closeCard: () => void;
  exitTimeoutRef: TimerRef;
}

/**
 * The pointer and touch handlers, over the open/close pair. Touch gets a
 * long-press because there is no hover to respond to; the card's own handlers
 * keep it open while the pointer is travelling onto it.
 */
const useHoverHandlers = ({
  isTouchDevice,
  touchEnabled,
  enterDelay,
  openCard,
  closeCard,
  exitTimeoutRef,
}: HandlerInput) => {
  const [touchTimeout, setTouchTimeout] = React.useState<number>();

  /** A touch device with touch disabled has no hover to respond to. */
  const hoverIgnored = isTouchDevice && !touchEnabled;

  const cancelTouch = React.useCallback(() => {
    if (touchTimeout) {
      window.clearTimeout(touchTimeout);
      setTouchTimeout(undefined);
    }
  }, [touchTimeout]);

  React.useEffect(
    () => () => {
      if (touchTimeout) window.clearTimeout(touchTimeout);
    },
    [touchTimeout],
  );

  const triggerHandlers = {
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      if (hoverIgnored) return;
      openCard(event.currentTarget);
    },
    onMouseLeave: () => {
      if (hoverIgnored) return;
      closeCard();
    },
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      if (!touchEnabled) return;
      if (touchTimeout) window.clearTimeout(touchTimeout);
      // Read NOW: React nulls `currentTarget` once the handler returns, so
      // the long-press timer used to open the card with no anchor at all.
      const trigger = event.currentTarget;
      setTouchTimeout(window.setTimeout(() => openCard(trigger), enterDelay));
    },
    // End and cancel do the same thing: the press did not become a long press.
    onTouchEnd: cancelTouch,
    onTouchCancel: cancelTouch,
  };

  /** Moving onto the card keeps it open; leaving it starts the exit delay. */
  const cardHandlers = {
    onMouseEnter: () => clearPending(exitTimeoutRef),
    onMouseLeave: closeCard,
  };

  return { triggerHandlers, cardHandlers };
};

/** Escape dismisses the card while it is open. */
const useEscapeKey = (active: boolean, onEscape: () => void) => {
  React.useEffect(() => {
    if (!active) return;

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [active, onEscape]);
};

/**
 * A press anywhere outside the trigger and the card dismisses it.
 *
 * Touch has no mouse-leave, and MUI's own click-away was the popover's
 * backdrop, which `pointer-events: none` on the popover root (so the page
 * under an open card stays usable) takes out of play. So this listens on the
 * document itself, in the BUBBLE phase — the last stop a native `pointerdown`
 * reaches, after every capture-phase and bubble-phase handler anywhere in the
 * tree has already run, INCLUDING `useCardOwnership`'s capture-phase marker
 * below (FUT-2776: see that hook for why this ordering, not "cannot be
 * swallowed by a `stopPropagation` further in", now drives the phase choice).
 * It only observes: no `preventDefault`, so the tap or click still reaches
 * whatever it landed on. Attached while open, removed on close and on
 * unmount.
 */
const useClickAway = (
  active: boolean,
  inside: () => ReadonlyArray<Element | null>,
  consumeOwnPress: () => boolean,
  onAway: () => void,
) => {
  React.useEffect(() => {
    if (!active) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      // Read (and reset) UNCONDITIONALLY: a stale `true` left over from a
      // press this listener never got to see (e.g. one dispatched while the
      // card was closed) must not leak into the next one.
      const ownedByReactTree = consumeOwnPress();
      const target = event.target as Node | null;
      const ownedByDom = Boolean(target) && inside().some((el) => el?.contains(target));
      if (ownedByReactTree || ownedByDom) return;
      onAway();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [active, inside, consumeOwnPress, onAway]);
};

/**
 * Whether the pointerdown `useClickAway` is about to look at started inside
 * the card's OWN React tree — a MUI `Select`'s menu, a nested `Popover`, a
 * `DropdownMenu` the card's `content` renders — even when that control's DOM
 * node is not a descendant of the card's box at all, because it portalled
 * itself out near `document.body` (FUT-2776).
 *
 * React re-parents a portal's events to bubble AND capture through its OWNING
 * React tree, not the DOM tree it renders into (see the React docs on
 * `createPortal`), so an `onPointerDownCapture` on the card's own content root
 * still fires for a press inside a portal the card's content renders, and
 * NEVER fires for a press inside an unrelated one mounted by something that
 * is not a descendant of the card in the REACT tree — ownership, not timing.
 * That is the whole fix: the previous approach (a `MutationObserver` on
 * `document.body`) treated ANY element appended to the body while the card
 * was open as inside, so an unrelated Snackbar, dev overlay or Popover that
 * happened to mount at the same time stopped closing the card too.
 *
 * The marker itself must run at CAPTURE, on an ANCESTOR of everything the
 * card's content can render (including anything it portals out): capture
 * runs top-down and completes, for the WHOLE tree, before bubbling begins,
 * so it is immune to a nested control calling `stopPropagation` during ITS
 * OWN bubble — that would only cut off propagation on the way back up, after
 * our ancestor capture handler already ran. `useClickAway`'s document
 * listener reads the flag from its OWN bubble-phase handler, which is why it
 * moved off capture: a capture-phase listener on `document` is the outermost
 * node in the capture path, so it would fire BEFORE this marker even could —
 * a bubble-phase listener on `document` is the innermost point of the bubble
 * path instead, so it is guaranteed to run last, after this marker's capture
 * pass has already set the flag for the same event.
 */
const useCardOwnership = () => {
  const pressedInsideRef = React.useRef(false);

  const markInside = React.useCallback(() => {
    pressedInsideRef.current = true;
  }, []);

  const consume = React.useCallback(() => {
    const wasInside = pressedInsideRef.current;
    pressedInsideRef.current = false;
    return wasInside;
  }, []);

  return { markInside, consume };
};

/** The trigger and the card's own box — a plain DOM containment check. */
const useInsideCard = (
  anchorEl: HTMLElement | null,
  contentRef: React.MutableRefObject<HTMLDivElement | null>,
) =>
  React.useCallback(
    () => [anchorEl, contentRef.current],
    [anchorEl, contentRef],
  );

/** Whatever is still pending when the card unmounts is cancelled with it. */
const useClearOnUnmount = (...refs: TimerRef[]) => {
  React.useEffect(
    () => () => refs.forEach(clearPending),
    // The refs are stable objects: a mount/unmount pair, as before.
    [],
  );
};

interface HoverCardTimingInput {
  disabled: boolean;
  touchEnabled: boolean;
  enterDelay: number;
  exitDelay: number;
  onOpen?: () => void;
  onClose?: () => void;
}

type VisibilityInput = Omit<HoverCardTimingInput, 'touchEnabled'>;

/**
 * The open/close state and its two timers, split out of `useHoverCard` so
 * that composing it with click-away, escape and ownership reads as one flat
 * list rather than one long function.
 *
 * The enter delay before opening and the exit delay before closing (so the
 * pointer can travel from the trigger onto the card without dismissing it)
 * each cancel the other's pending work, which is why they live together.
 */
const useCardVisibility = ({ disabled, enterDelay, exitDelay, onOpen, onClose }: VisibilityInput) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const enterTimeoutRef = React.useRef<number | undefined>(undefined);
  const exitTimeoutRef = React.useRef<number | undefined>(undefined);

  const openCard = React.useCallback(
    (trigger: HTMLElement) => {
      if (disabled) return;

      clearPending(exitTimeoutRef);
      // A second enter before the delay ran out (a click and then a hover, or
      // the pointer jittering across the edge) must REPLACE the pending open,
      // not add one: an overwritten timer can no longer be cancelled, and it
      // reopened the card after Escape had closed it.
      clearPending(enterTimeoutRef);

      enterTimeoutRef.current = window.setTimeout(() => {
        setAnchorEl(trigger);
        setIsOpen(true);
        onOpen?.();
      }, enterDelay);
    },
    [disabled, enterDelay, onOpen],
  );

  const closeCard = React.useCallback(() => {
    clearPending(enterTimeoutRef);
    clearPending(exitTimeoutRef);

    exitTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setAnchorEl(null);
      onClose?.();
    }, exitDelay);
  }, [exitDelay, onClose]);

  // Escape and the popover's own close are FINAL: nothing still pending may
  // reopen the card behind them. It opens again on the next enter.
  const handleClose = React.useCallback(() => {
    clearPending(enterTimeoutRef);
    clearPending(exitTimeoutRef);
    setIsOpen(false);
    setAnchorEl(null);
    onClose?.();
  }, [onClose]);

  return { anchorEl, isOpen, openCard, closeCard, handleClose, enterTimeoutRef, exitTimeoutRef };
};

export const useHoverCard = ({
  disabled,
  touchEnabled,
  enterDelay,
  exitDelay,
  onOpen,
  onClose,
}: HoverCardTimingInput) => {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  /** The card's own box, inside the popover paper: a press here is not "away". */
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const { anchorEl, isOpen, openCard, closeCard, handleClose, enterTimeoutRef, exitTimeoutRef } =
    useCardVisibility({ disabled, enterDelay, exitDelay, onOpen, onClose });

  // Probed in an effect, not during render, so SSR and hydration stay intact.
  React.useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  const { triggerHandlers, cardHandlers } = useHoverHandlers({
    isTouchDevice,
    touchEnabled,
    enterDelay,
    openCard,
    closeCard,
    exitTimeoutRef,
  });

  const insideCard = useInsideCard(anchorEl, contentRef);
  const { markInside, consume } = useCardOwnership();

  useEscapeKey(isOpen, handleClose);
  useClickAway(isOpen, insideCard, consume, handleClose);
  useClearOnUnmount(enterTimeoutRef, exitTimeoutRef);

  return {
    anchorEl,
    isOpen,
    handleClose,
    triggerHandlers,
    cardHandlers,
    contentRef,
    /** Wire onto the card's content root as `onPointerDownCapture` (FUT-2776). */
    onContentPointerDownCapture: markInside,
  };
};
