import type * as React from 'react';
import { useLayoutEffect, useState } from 'react';

/**
 * Whether a block's full text fits it, by pixels (FUT-3825): the full text's
 * own width against the room the block leaves it, re-read whenever the block
 * is resized. A wide block on a narrow ruler keeps "18:00–23:00"; only one too
 * short for it says its start.
 *
 * The full text is measured with its span shown for the measurement alone
 * (synchronously, so nothing is painted), even while the short text stands in
 * for it. Where nothing can be measured (no `ResizeObserver`) it answers
 * `fallback`.
 */
export function useTextFits(block: React.RefObject<HTMLElement | null>, text: string, fallback: boolean): boolean {
  const [fits, setFits] = useState(fallback);

  useLayoutEffect(() => {
    const el = block.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const full = el.querySelector<HTMLElement>('[data-dr-text="full"]');
      if (!full) return;
      const shown = full.style.display;
      full.style.display = 'inline';
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(full);
      const width = range.getBoundingClientRect().width;
      full.style.display = shown;
      const style = getComputedStyle(el);
      const room = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      if (room > 0) setFits(width <= room + 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [block, text]);

  return fits;
}
