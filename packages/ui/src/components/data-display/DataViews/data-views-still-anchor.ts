'use client';

import type { PopoverActions } from '@mui/material/Popover/index.js';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * What the popover hangs from: the trigger's box as it was when it opened —
 * a MUI "virtual element", so the popover keeps its own anchor origin.
 */
interface StillElement {
  nodeType: 1;
  getBoundingClientRect: () => DOMRect;
}

const stillOf = (element: HTMLElement): StillElement => {
  const box = element.getBoundingClientRect();
  return { nodeType: 1, getBoundingClientRect: () => box };
};

/**
 * A popover that holds STILL while it is open (FUT-4144 UI review round 2).
 *
 * Anchored to an element, a popover follows it. A filter applied from inside
 * one grows the toolbar a "Limpar" and a badge, the trigger moves, and the
 * panel jumped 55px sideways under the finger that had just tapped a day. The
 * point it hangs from is read once, when it opens — and again only when the
 * window itself is resized, which is the one move a reader expects it to make.
 *
 * The other move it makes is when its own HEIGHT changes after it was placed
 * (a preset row settling into a select once measured, a refused day's message):
 * MUI places a popover once, so a taller one ran off a 320×568 screen. The
 * paper's size is watched and the popover re-placed, which moves it only when
 * its height really changed — never on a tap that leaves it the same size.
 *
 * Spread `popoverProps` onto a MUI `Popover` and pass `paperRef` as the paper
 * slot's `ref`.
 */
export function useStillAnchor(): {
  anchor: HTMLElement | null;
  open: (element: HTMLElement) => void;
  close: () => void;
  paperRef: (node: HTMLDivElement | null) => void;
  popoverProps: {
    open: boolean;
    anchorEl: StillElement | null;
    anchorOrigin: { vertical: 'bottom'; horizontal: 'left' };
    action: RefObject<PopoverActions | null>;
  };
} {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [still, setStill] = useState<StillElement | null>(null);
  const action = useRef<PopoverActions | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const paperRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let height = node.offsetHeight;
    observer.current = new ResizeObserver(() => {
      if (node.offsetHeight === height) return;
      height = node.offsetHeight;
      action.current?.updatePosition();
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => {
    if (!anchor) return undefined;
    const follow = (): void => setStill(stillOf(anchor));
    window.addEventListener('resize', follow);
    return () => window.removeEventListener('resize', follow);
  }, [anchor]);

  return {
    anchor,
    open: (element) => {
      setStill(stillOf(element));
      setAnchor(element);
    },
    close: () => setAnchor(null),
    paperRef,
    popoverProps: {
      open: Boolean(anchor),
      anchorEl: anchor ? still : null,
      anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
      action,
    },
  };
}
