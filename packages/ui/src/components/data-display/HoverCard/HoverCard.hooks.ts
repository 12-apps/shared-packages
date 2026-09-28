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
 * — including one a nested control (or something entirely unrelated to the
 * card) calls on its OWN bubble — cannot swallow it (FUT-2776 adversarial
 * review: a bubble-phase listener here was tried and reverted; see below).
 * It only observes: no `preventDefault`, so the tap or click still reaches
 * whatever it landed on. Attached while open, removed on close and on
 * unmount.
 *
 * That capture placement is exactly what makes the decision impossible to
 * make SYNCHRONOUSLY: `document` is the outermost node on the capture path,
 * so this handler fires before React's own capture dispatch even starts —
 * before `useCardOwnership`'s marker on the card's content root (also
 * capture, but on a node further down the same tree) has had a chance to run
 * for this same event. So the decision is deferred — but NOT to a microtask:
 * a microtask here reads the marker before it is set for TRUSTED input (a
 * real press, or Playwright's `page.mouse`), which is the very bug this hook
 * exists to fix (FUT-2776, third-review adversarial probe, measured with
 * real Chromium and `page.mouse.down()`):
 *
 *   TRUSTED:  doc-capture-sync → doc-capture-microtask (marker unset) → inner-capture (sets marker)
 *   SCRIPT:   doc-capture-sync → inner-capture (sets marker) → doc-capture-microtask (marker set)
 *
 * Chromium runs any microtasks queued by a capture-phase listener BEFORE
 * dispatching to the next listener on the path when the event is trusted —
 * so a microtask queued here runs before `useCardOwnership`'s capture
 * listener further down the tree ever gets a turn, and the ownership check
 * always reads empty. A script-dispatched event (`fireEvent`, `userEvent` in
 * jsdom, or in a Storybook `play` function) instead completes its WHOLE
 * capture-then-bubble dispatch before any microtask runs — which is why
 * every test under the microtask version passed and the bug still shipped.
 * A macrotask (`setTimeout(0)`) is not part of the event dispatch under
 * EITHER kind of input, so it always runs after the whole dispatch — marker
 * included — regardless of trusted vs. script. That ordering is what this
 * hook now relies on.
 *
 * `sessionRef` replaces a plain boolean: it is a fresh object assigned each
 * time the card opens (this effect's mount), so a `setTimeout` callback
 * queued for a press during one open session can tell whether it is still
 * that SAME session by comparing against the ref, not just whether the card
 * happens to be open again — the card closing and reopening while a stale
 * timeout is still pending must not let that timeout act on the new session.
 * Every scheduled timeout is also tracked so a close or unmount can cancel
 * whatever is still pending, rather than letting it fire against a card that
 * is no longer there to close.
 */
const useClickAway = (
  active: boolean,
  inside: () => ReadonlyArray<Element | null>,
  ownsEvent: (event: Event) => boolean,
  onAway: () => void,
) => {
  const sessionRef = React.useRef<object | null>(null);
  const pendingRef = React.useRef<Set<number>>(new Set());

  React.useEffect(() => {
    if (!active) return undefined;

    const session = {};
    sessionRef.current = session;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const timeoutId = window.setTimeout(() => {
        pendingRef.current.delete(timeoutId);
        // Stale: this session closed (or a newer one opened) before this
        // press's decision could run.
        if (sessionRef.current !== session) return;

        const target = event.target as Node | null;
        const ownedByReactTree = ownsEvent(event);
        const ownedByDom = Boolean(target) && inside().some((el) => el?.contains(target));
        if (ownedByReactTree || ownedByDom) return;
        onAway();
      }, 0);
      pendingRef.current.add(timeoutId);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      sessionRef.current = null;
      pendingRef.current.forEach((id) => window.clearTimeout(id));
      pendingRef.current.clear();
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [active, inside, ownsEvent, onAway]);
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
 * That is the whole fix: the ORIGINAL approach (a `MutationObserver` on
 * `document.body`) treated ANY element appended to the body while the card
 * was open as inside, so an unrelated Snackbar, dev overlay or Popover that
 * happened to mount at the same time stopped closing the card too.
 *
 * Tracked per NATIVE EVENT OBJECT in a `WeakSet`, not a boolean flag: a
 * boolean stayed `true` forever once a press set it whose NATIVE propagation
 * then got stopped before reaching `useClickAway`'s own (bubble-phase, in
 * that earlier revision) listener — common for anything that treats the
 * press as its own gesture — so the marker never got consumed, and the
 * NEXT, genuinely outside press read a STALE `true` and stayed open
 * (FUT-2776, caught on adversarial review of the first fix here). Keying on
 * the event itself instead needs no consuming step and cannot go stale: a
 * `WeakSet` entry only ever answers for the ONE dispatch that created it,
 * and nothing outside this closure keeps a reference to a past pointerdown
 * once `useClickAway`'s deferred (`setTimeout(0)`, not a microtask — see that
 * hook for why) check for it has run, so the entry is simply garbage from
 * then on.
 */
const useCardOwnership = () => {
  const ownedEventsRef = React.useRef<WeakSet<Event>>(new WeakSet());

  const markInside = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    ownedEventsRef.current.add(event.nativeEvent);
  }, []);

  const ownsEvent = React.useCallback(
    (event: Event) => ownedEventsRef.current.has(event),
    [],
  );

  return { markInside, ownsEvent };
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
  const { markInside, ownsEvent } = useCardOwnership();

  useEscapeKey(isOpen, handleClose);
  useClickAway(isOpen, insideCard, ownsEvent, handleClose);
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
