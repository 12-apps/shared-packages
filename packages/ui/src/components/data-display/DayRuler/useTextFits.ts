import type * as React from 'react';
import { useLayoutEffect, useState } from 'react';

import { textFitOf, type BlockTextFit } from './day-ruler-model';

/** A text span's own width (its laid-out text, whatever the span's own box). */
function textWidth(span: HTMLElement | null): number {
  if (!span) return Number.POSITIVE_INFINITY;
  const range = span.ownerDocument.createRange();
  range.selectNodeContents(span);
  return range.getBoundingClientRect().width;
}

/**
 * The block's fit, measured in ONE layout: every write first (both texts
 * shown for the measurement alone), then every read, then the writes undone —
 * so a ruler of many blocks forces one layout per block, not one per text.
 * `null` when there is nothing to measure yet.
 */
function measureFit(el: HTMLElement): BlockTextFit | null {
  const full = el.querySelector<HTMLElement>('[data-dr-text="full"]');
  if (!full) return null;
  const short = el.querySelector<HTMLElement>('[data-dr-text="short"]');
  const spans = [full, short].filter((span): span is HTMLElement => span !== null);
  const shown = spans.map((span) => span.style.display);
  for (const span of spans) span.style.display = 'inline';
  const fullWidth = textWidth(full);
  const shortWidth = textWidth(short);
  const style = getComputedStyle(el);
  const outer = el.clientWidth;
  const room = outer - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  spans.forEach((span, index) => {
    span.style.display = shown[index] ?? '';
  });
  if (room > 0) return textFitOf(fullWidth, shortWidth, room);
  // A bar with no room at all (narrower than its own padding) says nothing.
  return outer > 0 ? 'none' : null;
}

/**
 * Which of a block's texts fits it, by pixels (FUT-3825, FUT-3831): the full
 * text's and the short text's own widths against the room the block leaves
 * them. A wide block keeps "18:00–23:00"; one too short for it says its start
 * ("18:00"); one too short even for that says nothing — never a cut "18:".
 *
 * Measured at once (synchronously, so nothing is painted), then again on the
 * next frame whenever the block is resized, and once more when the page's
 * fonts have loaded: a webfont arriving late changes every text's width, and
 * a fit read in the fallback font would leave a label cut. Where nothing can
 * be measured (no `ResizeObserver`) it answers `fallback`.
 */
export function useTextFit(block: React.RefObject<HTMLElement | null>, text: string, short: string, fallback: BlockTextFit): BlockTextFit {
  const [fit, setFit] = useState<BlockTextFit>(fallback);

  useLayoutEffect(() => {
    const el = block.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let live = true;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      if (!live) return;
      const next = measureFit(el);
      if (next) setFit(next);
    };
    // Resizes and the fonts come in bursts: one measurement per frame.
    const schedule = (): void => {
      if (frame || !live) return;
      frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : 0;
      if (!frame) measure();
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    el.ownerDocument.fonts?.ready.then(schedule, () => undefined);
    return () => {
      live = false;
      observer.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    };
  }, [block, text, short]);

  return fit;
}
