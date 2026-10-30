import { useEffect, useRef } from 'react';

/**
 * WHAT THE WEEK GRID'S AND THE DAY RULER'S DRAGS SHARE (FUT-3825): the window
 * listeners a running drag needs, the ways to abort one, and the click a
 * finished or aborted drag leaves behind.
 */

/** Why a drag ended without being committed. */
export type DragAbort =
  /** Escape pressed while dragging: the button may still be down. */
  | 'escape'
  /** The window lost focus (another app, a dialog): the release may never reach the page. */
  | 'blur'
  /** A move arrived with no button down: the release happened where the page could not see it. */
  | 'released'
  /** The browser took the pointer (a scroll, a system gesture). */
  | 'pointercancel';

export interface DragWindowHandlers {
  move: (event: PointerEvent) => void;
  /** The release, wherever it happens: a release outside the grid still commits. */
  up: (event: PointerEvent) => void;
  abort: (reason: DragAbort) => void;
}

/**
 * Listen on the window while `active`: moves, the release, and the four ways a
 * drag is abandoned. Escape is taken in the capture phase and stopped there,
 * so a drawer or dialog around the grid does not also close on it.
 */
export function useDragWindow(active: boolean, handlers: DragWindowHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!active) return undefined;
    const onMove = (event: PointerEvent): void => {
      if (event.buttons === 0) latest.current.abort('released');
      else latest.current.move(event);
    };
    const onUp = (event: PointerEvent): void => latest.current.up(event);
    const onCancel = (): void => latest.current.abort('pointercancel');
    const onBlur = (): void => latest.current.abort('blur');
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.abort('escape');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active]);
}

export interface TrailingClick {
  /**
   * Ignore the click this gesture leaves behind. `released`: the button is
   * already up (a commit), so that click is in flight now; otherwise (an
   * abort with the button still down) it follows the coming release.
   */
  arm: (released: boolean) => void;
  /** A new drag starts: nothing to ignore. */
  reset: () => void;
  /** True once, for the click to ignore. */
  take: () => boolean;
}

/**
 * The click a drag leaves behind, and only that one: the flag lives until the
 * task after the release (the browser dispatches the release's click before
 * any task runs) and dies with the next press, so a later click on anything —
 * a block that cannot move, another cell — is never eaten.
 */
export function useTrailingClick(): TrailingClick {
  const armed = useRef(false);
  const undo = useRef<(() => void) | null>(null);

  const clear = (): void => {
    armed.current = false;
    undo.current?.();
    undo.current = null;
  };

  useEffect(() => clear, []);

  const arm = (released: boolean): void => {
    clear();
    armed.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (): void => {
      timer = setTimeout(clear, 0);
    };
    window.addEventListener('pointerdown', clear, true);
    if (released) later();
    else window.addEventListener('pointerup', later, { capture: true, once: true });
    undo.current = () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('pointerup', later, true);
    };
  };

  const take = (): boolean => {
    const swallow = armed.current;
    if (swallow) clear();
    return swallow;
  };

  return { arm, reset: clear, take };
}
