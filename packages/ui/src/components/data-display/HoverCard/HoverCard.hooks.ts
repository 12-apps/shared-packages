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
 * document itself, in the CAPTURE phase, where a `stopPropagation` further in
 * cannot swallow it. It only observes: no `preventDefault`, so the tap or
 * click still reaches whatever it landed on. Attached while open, removed on
 * close and on unmount.
 */
const useClickAway = (
  active: boolean,
  inside: () => ReadonlyArray<Element | null>,
  onAway: () => void,
) => {
  React.useEffect(() => {
    if (!active) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && inside().some((el) => el?.contains(target))) return;
      onAway();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [active, inside, onAway]);
};

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

/**
 * When the card is open, and the delays that decide it.
 *
 * Three timers are in play: the enter delay before opening, the exit delay
 * before closing (so the pointer can travel from the trigger onto the card
 * without dismissing it), and the long-press timer on touch. Each cancels the
 * others' pending work, which is why they live together.
 */
export const useHoverCard = ({
  disabled,
  touchEnabled,
  enterDelay,
  exitDelay,
  onOpen,
  onClose,
}: HoverCardTimingInput) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  const enterTimeoutRef = React.useRef<number | undefined>(undefined);
  const exitTimeoutRef = React.useRef<number | undefined>(undefined);
  /** The card's own box, inside the popover paper: a press here is not "away". */
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  // Probed in an effect, not during render, so SSR and hydration stay intact.
  React.useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

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

  const { triggerHandlers, cardHandlers } = useHoverHandlers({
    isTouchDevice,
    touchEnabled,
    enterDelay,
    openCard,
    closeCard,
    exitTimeoutRef,
  });

  const insideCard = React.useCallback(() => [anchorEl, contentRef.current], [anchorEl]);

  useEscapeKey(isOpen, handleClose);
  useClickAway(isOpen, insideCard, handleClose);
  useClearOnUnmount(enterTimeoutRef, exitTimeoutRef);

  return { anchorEl, isOpen, handleClose, triggerHandlers, cardHandlers, contentRef };
};
