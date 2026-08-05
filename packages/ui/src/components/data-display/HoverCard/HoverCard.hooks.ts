import React from 'react';

interface HandlerInput {
  isTouchDevice: boolean;
  touchEnabled: boolean;
  enterDelay: number;
  openCard: (event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => void;
  closeCard: () => void;
  exitTimeoutRef: React.MutableRefObject<number | undefined>;
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
      openCard(event);
    },
    onMouseLeave: () => {
      if (hoverIgnored) return;
      closeCard();
    },
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      if (!touchEnabled) return;
      if (touchTimeout) window.clearTimeout(touchTimeout);
      setTouchTimeout(window.setTimeout(() => openCard(event), enterDelay));
    },
    // End and cancel do the same thing: the press did not become a long press.
    onTouchEnd: cancelTouch,
    onTouchCancel: cancelTouch,
  };

  /** Moving onto the card keeps it open; leaving it starts the exit delay. */
  const cardHandlers = {
    onMouseEnter: () => {
      if (exitTimeoutRef.current) window.clearTimeout(exitTimeoutRef.current);
    },
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

  // Probed in an effect, not during render, so SSR and hydration stay intact.
  React.useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  const openCard = React.useCallback(
    (event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
      if (disabled) return;

      if (exitTimeoutRef.current) {
        window.clearTimeout(exitTimeoutRef.current);
      }

      const target = event.currentTarget;
      enterTimeoutRef.current = window.setTimeout(() => {
        setAnchorEl(target);
        setIsOpen(true);
        onOpen?.();
      }, enterDelay);
    },
    [disabled, enterDelay, onOpen],
  );

  const closeCard = React.useCallback(() => {
    if (enterTimeoutRef.current) {
      window.clearTimeout(enterTimeoutRef.current);
    }

    exitTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setAnchorEl(null);
      onClose?.();
    }, exitDelay);
  }, [exitDelay, onClose]);

  const handleClose = React.useCallback(() => {
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

  useEscapeKey(isOpen, handleClose);

  React.useEffect(
    () => () => {
      if (enterTimeoutRef.current) window.clearTimeout(enterTimeoutRef.current);
      if (exitTimeoutRef.current) window.clearTimeout(exitTimeoutRef.current);
    },
    [],
  );

  return { anchorEl, isOpen, handleClose, triggerHandlers, cardHandlers };
};
