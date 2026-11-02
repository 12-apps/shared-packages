import type * as React from 'react';
import { useLayoutEffect, useState } from 'react';

import { textFitOf, type BlockTextFit } from './day-ruler-model';

/** A text span's own width, measured with it shown for the measurement alone. */
function widthOf(span: HTMLElement | null): number {
  if (!span) return Number.POSITIVE_INFINITY;
  const shown = span.style.display;
  span.style.display = 'inline';
  const range = span.ownerDocument.createRange();
  range.selectNodeContents(span);
  const width = range.getBoundingClientRect().width;
  span.style.display = shown;
  return width;
}

/**
 * Which of a block's texts fits it, by pixels (FUT-3825, FUT-3831): the full
 * text's and the short text's own widths against the room the block leaves
 * them, re-read whenever the block is resized. A wide block keeps
 * "18:00–23:00"; one too short for it says its start ("18:00"); one too short
 * even for that says nothing — never a cut "18:".
 *
 * Each text is measured with its span shown for the measurement alone
 * (synchronously, so nothing is painted), whichever one is standing in. Where
 * nothing can be measured (no `ResizeObserver`) it answers `fallback`.
 */
export function useTextFit(block: React.RefObject<HTMLElement | null>, text: string, short: string, fallback: BlockTextFit): BlockTextFit {
  const [fit, setFit] = useState<BlockTextFit>(fallback);

  useLayoutEffect(() => {
    const el = block.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const full = el.querySelector<HTMLElement>('[data-dr-text="full"]');
      if (!full) return;
      const style = getComputedStyle(el);
      const room = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      if (!(room > 0)) {
        // A bar with no room at all (narrower than its own padding) says nothing.
        if (el.clientWidth > 0) setFit('none');
        return;
      }
      setFit(textFitOf(widthOf(full), widthOf(el.querySelector<HTMLElement>('[data-dr-text="short"]')), room));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [block, text, short]);

  return fit;
}
