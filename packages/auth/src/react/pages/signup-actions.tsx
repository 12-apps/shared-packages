import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";

import { Box } from "@12-apps/ui/mui/Box";

/**
 * The sign-up page's action block: the consent, the submit and the other ways
 * in, kept together and in view. Its own module because it is its own
 * mechanism — a sticky block, the window it measures and the scroll padding it
 * reserves — where `./card` is the page's static shell.
 */

/** The sign-up page's action block — the test hook for "is it together, and is it pinned". */
export const SIGNUP_ACTIONS_TEST_ID = "signup-actions";

/**
 * How much of the window the pinned block may cover.
 *
 * Pinned, the block covers the bottom of the form, and in a tall enough window
 * that is a fair trade for keeping the providers in view. In a SHORT one it is
 * not. Measured at 320×256 (a 1280×1024 window at 400% zoom), the 265px block
 * covered every field at every scroll position, so the form could not be filled
 * in at all; at 683×325 (a 1366×768 laptop at 200%) it left 34px of form between
 * the host's header and itself. So the block pins only while it takes at most
 * half the window, and otherwise sits in its own place like the rest of the
 * form. Measured on the storefront, the half sits between the cases on either
 * side of it: both portrait phones on its ladder pin (320×568 at 46%, 360×640
 * at 38%), and a landscape phone (844×390 at 57%) and the two zoomed windows
 * above do not.
 */
const MAX_PINNED_SHARE = 0.5;

/**
 * How much of the window a block already pinned may cover before it lets go.
 *
 * Above {@link MAX_PINNED_SHARE} on purpose. A phone's window changes height as
 * the page scrolls — Safari's toolbars slide away and back — and a single line
 * would switch the block between its own place and the bottom of the window at
 * every crossing, under a thumb that is mid-scroll. With the gap between the two
 * shares, a window has to shrink well past the line before a pinned block lets
 * go, and grow back under it before the block pins again.
 */
const RELEASE_SHARE = 0.6;

/**
 * Whether the block is short enough, against this window, to be pinned at all.
 *
 * Decided on the TALLEST the block has been, never on its height of the moment.
 * Its own content changes height under the person using it: ticking the terms
 * removes the host's hint (262px to 221px at 320 wide), and a submit in flight
 * shortens its button. Decided on the height of the moment, a window between the
 * two heights moved the block from its own place to the bottom of the window
 * under the finger that ticked the box. Measured at 320×460 (an iPhone SE's
 * Safari window with its toolbars shown), the checkbox jumped 170px up, and the
 * now-enabled "Continuar com o Google" took its place: a second tap there started
 * a Google sign-up instead of the e-mail one being filled in. So only the WINDOW
 * can pin the block; its content can only ever release it, by growing.
 */
function useRoomToPin(ref: RefObject<HTMLDivElement | null>): boolean {
  const [room, setRoom] = useState(true);
  // Before paint, so a block too tall to pin never shows pinned for a frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const seen = { tallest: 0, room: false };
    const decide = (): void => {
      seen.tallest = Math.max(seen.tallest, el.offsetHeight);
      const share = seen.tallest / window.innerHeight;
      seen.room = share <= (seen.room ? RELEASE_SHARE : MAX_PINNED_SHARE);
      setRoom(seen.room);
    };
    decide();
    window.addEventListener("resize", decide);
    // The block's own height is watched so that it can GROW past the line. A
    // shorter block changes nothing (see above). jsdom has no ResizeObserver;
    // losing it costs the growing case only.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(decide);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", decide);
      observer?.disconnect();
    };
  }, [ref]);
  return room;
}

/**
 * Whether a bottom-sticky element is pinned to the window right now.
 *
 * It sticks at `bottom: -1px`, so while pinned its last pixel hangs below the
 * window and it is never wholly inside it; in its own place it is. That one
 * pixel is what an `IntersectionObserver` can see, and it spares a scroll
 * listener. jsdom has no observer, so there the answer is simply "not pinned".
 * A block not allowed to pin ({@link useRoomToPin}) is never reported pinned,
 * however far below the window its own place is.
 */
function usePinnedToWindow(ref: RefObject<HTMLDivElement | null>, allowed: boolean): boolean {
  const [hanging, setHanging] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        // A batch lists entries oldest first; the newest is the state now.
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const floor = entry.rootBounds?.bottom ?? window.innerHeight;
        // Below the floor, not merely clipped: scrolled PAST, the block leaves
        // through the top of the window and is not pinned to anything.
        setHanging(entry.intersectionRatio < 1 && entry.boundingClientRect.bottom > floor);
      },
      { threshold: [1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return allowed && hanging;
}

/**
 * Keep the field that has focus out from under the pinned block.
 *
 * A browser scrolls a focused element into view only when it is outside the
 * window, and a field covered by a sticky block is not: measured at 320×568,
 * tabbing from the e-mail to the password left the password under the block,
 * where a keyboard user types into a field they cannot see (WCAG 2.4.11).
 * `scroll-padding-bottom` on the page's scroller is the platform's answer — it
 * shrinks the area focus scrolling treats as "in view" by the block's height —
 * so the block publishes its height there while it is mounted, and puts back
 * whatever was there before when it goes.
 */
function useReserveFocusRoom(ref: RefObject<HTMLDivElement | null>, pinnable: boolean): void {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    // A block that sits in its own place covers nothing, so it reserves nothing.
    if (!el || !pinnable) return undefined;
    const before = root.style.scrollPaddingBottom;
    const publish = (): void => {
      root.style.scrollPaddingBottom = `${el.offsetHeight}px`;
    };
    publish();
    // jsdom has no ResizeObserver; losing it costs the resize case only.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = before;
    };
  }, [ref, pinnable]);
}

/**
 * The consent, the submit and the other ways in, as ONE block that stays in
 * view.
 *
 * ## Why they are together
 *
 * The consent gate enables BOTH ways of signing up, and it used to sit at the
 * top of the card while the submit sat at the bottom, under a name, an e-mail
 * and a password. On a phone that is a screen apart: somebody who filled the
 * form reached a greyed-out "Criar conta" with the checkbox that would enable it
 * scrolled away. Moving the gate down to the submit alone would only move the
 * problem, since the provider buttons it ALSO enables sat at the top — so they
 * come down too, under the submit, and the gate sits directly beside both
 * controls it governs.
 *
 * ## Why it is pinned
 *
 * A provider button is one tap where the form is four fields and a keyboard, and
 * at the top of the card it was the first thing anybody saw. Under the form it
 * would fall below the fold of a short window. So the block is sticky at the
 * bottom: while the form is taller than the window the block rides its lower
 * edge, and once the form fits it sits in its own place. No breakpoint decides
 * it — the window's height does, the only thing that actually matters, and a
 * desktop that fits the card sees nothing move. Only a block that would cover
 * more than half the window stays in place instead ({@link MAX_PINNED_SHARE}):
 * there, pinning it would hide the very fields it sits under. That is decided
 * by the window alone, never by the block's own content changing height under a
 * tap ({@link useRoomToPin}).
 *
 * Pinned, it paints the card's own paper so the fields scroll UNDER it rather
 * than through it, and the theme's divider marks its top edge to say the page
 * continues behind. The rule is only drawn while pinned: in place, an edge
 * above the gate would cut the form in two.
 *
 * With the keyboard up, the pinned block stays at the bottom of the layout
 * viewport — behind the keyboard in every browser that overlays it, which is
 * the default in both Safari and Chrome — so it does not cover the field being
 * typed into.
 */
export function SignupActions({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const pinnable = useRoomToPin(ref);
  const pinned = usePinnedToWindow(ref, pinnable);
  useReserveFocusRoom(ref, pinnable);
  return (
    <Box
      ref={ref}
      data-testid={SIGNUP_ACTIONS_TEST_ID}
      data-pinned={pinned ? "true" : "false"}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        position: pinnable ? "sticky" : "static",
        bottom: "-1px",
        zIndex: 1,
        bgcolor: "background.paper",
        pt: 2,
        pb: 1.5,
        // The theme's rule, drawn only while pinned. Always a border, so
        // pinning never moves the layout by its width.
        borderTop: 1,
        borderColor: pinned ? "divider" : "transparent",
      }}
    >
      {children}
    </Box>
  );
}
