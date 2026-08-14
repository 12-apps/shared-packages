import { useEffect } from 'react';

/**
 * Making room for a FIXED banner, so it never covers the app it is warning
 * about.
 *
 * Only a host whose own chrome is fixed needs this. A `height: 100dvh` flex
 * column where nothing is `fixed` or `sticky` takes the bar as an ordinary
 * `flex: 0 0 auto` row and the content region simply gets shorter — no offset
 * math exists to get wrong. A storefront is usually the opposite: a fixed header
 * with a spacer reserving its height in flow, plus routes that render a
 * chrome-free frame with no header at all. A bar mounted above the router there
 * would sit UNDER the header on one route and over the content on the other.
 *
 * Two writes, because there are two kinds of thing to move:
 *   - `padding-top` on `<body>` shifts everything in normal flow, which covers
 *     the chrome-free frames and every page that has no fixed chrome;
 *   - a CSS custom property, which a fixed header reads for its own `top`. Flow
 *     padding cannot move a fixed element; only its own offset can.
 *
 * Measured rather than assumed: the bar wraps to two lines on a narrow phone,
 * and a hard-coded height would let it cover exactly the content a phone user
 * has least room to spare.
 */

/**
 * The custom property a host's fixed chrome offsets itself by. Absent (and
 * therefore `0px` via the fallback) whenever no banner is on screen.
 *
 * Vendor-neutral on purpose: a host reads this exported name rather than typing
 * a string of its own, so the two cannot drift.
 */
export const IMPERSONATION_OFFSET_VAR = '--impersonation-banner-height';

/**
 * Reserve `bar`'s height at the top of the document while it is mounted, and
 * give every byte of it back on unmount.
 *
 * Re-measures on resize — the only thing that changes the bar's height, since
 * its content is a fixed set of short labels whose per-second countdown does not
 * reflow it.
 */
export function useChromeOffset(bar: HTMLElement | null): void {
  useEffect(() => {
    if (!bar) return undefined;
    const apply = (): void => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      document.documentElement.style.setProperty(IMPERSONATION_OFFSET_VAR, `${height}px`);
      document.body.style.paddingTop = `${height}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty(IMPERSONATION_OFFSET_VAR);
      document.body.style.paddingTop = '';
    };
  }, [bar]);
}
