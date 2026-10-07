import { useCallback, useEffect, useState } from 'react';

/**
 * Keep the toast column announceable while a sheet is open.
 *
 * MUI's modal manager marks every other child of `<body>` `aria-hidden` when a
 * sheet opens, and un-hides them only when the LAST modal closes. The column is
 * a `<body>` child too, so a toast raised from inside a drawer — "Saved", an
 * undo — would be silent for a screen reader for as long as any sheet stayed
 * open. A live region outside the modal is exactly what should still speak, so
 * the mark is taken back off whenever it lands.
 */
export function useStaysAnnounced(): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (node === null || typeof MutationObserver === 'undefined') return undefined;
    const unhide = (): void => {
      if (node.getAttribute('aria-hidden') === 'true') node.removeAttribute('aria-hidden');
    };
    unhide();
    const watch = new MutationObserver(unhide);
    watch.observe(node, { attributes: true, attributeFilter: ['aria-hidden'] });
    return () => watch.disconnect();
  }, [node]);
  return useCallback((next: HTMLElement | null) => setNode(next), []);
}
