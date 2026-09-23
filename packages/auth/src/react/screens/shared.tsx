import { useEffect, useRef, type JSX, type ReactNode, type RefObject } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Box } from "@12-apps/ui/mui/Box";
import { useTheme, type Theme } from "@12-apps/ui/mui/styles";
import { Button } from "@12-apps/ui/form/Button";
import { Portal } from "@12-apps/ui/utility/Portal";

import { useScreens } from "./context";
import { failureMessage, type EmailAuthScreenReason } from "./copy";

/**
 * The two pieces every screen in this folder reaches for.
 *
 * They live together rather than in whichever screen happened to need one
 * first: `FailureBanner` used to be exported from the forgot-password screen
 * and `LinkButton` from the sign-in form, so four files imported a component
 * from a screen they had nothing else to do with.
 */

/**
 * Bring a notice into view when it appears, if it appeared off screen.
 *
 * It wraps the notices that sit in a form's flow: the unverified-e-mail notice
 * and the sign-up page's host notice. The refusal banner floats instead (see
 * {@link FailureBanner}), and needs no scrolling.
 *
 * A form's notice renders at the TOP of the form and the button that caused it
 * is at the bottom. On a phone the two are a screen apart: measured at 360×640
 * on sign-up, the page was scrolled to the submit when "Criar conta" was
 * tapped, the banner rendered above the window, and nothing on screen changed
 * except the button going back to enabled. Centred rather than scrolled to the
 * top edge, because the host's header may be pinned there. Already on screen,
 * it is left where it is — a banner that jumped the page every time would be its
 * own problem. The Alert inside carries `role="alert"`, so a screen reader hears
 * it wherever it is.
 */
export function RevealOnAppear({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // The refusal itself, not this wrapper: the wrapper has no box of its own.
    const target = ref.current?.firstElementChild;
    // jsdom has no `scrollIntoView`; there is no screen to bring it onto there.
    if (!(target instanceof HTMLElement) || typeof target.scrollIntoView !== "function") return;
    const { top, bottom } = target.getBoundingClientRect();
    if (top >= 0 && bottom <= window.innerHeight) return;
    target.scrollIntoView({ block: "center" });
  }, []);
  // `contents`, so the wrapper is never a flex item of its own: a notice that
  // renders nothing (a dismissed one) must not leave a gap in the card's column.
  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

/** An app bar's height in spacing units: MUI's desktop toolbar, and the storefront's header. */
const APP_BAR_UNITS = 8;

/** The room above the refusal (below the header) and below it (above a focused control). */
const GAP_UNITS = 1.5;

/**
 * How far below the top of the window the refusal floats.
 *
 * Under the host's header rather than over it: by default an app bar's height
 * plus the gap. A host with a different header sets `--auth-refusal-top` on its
 * root to its own height plus the gap, and a host with no fixed header to the
 * gap alone.
 */
const refusalTop = (theme: Theme): string =>
  `var(--auth-refusal-top, ${theme.spacing(APP_BAR_UNITS + GAP_UNITS)})`;

/**
 * The floating layer the refusal sits on.
 *
 * Opaque: the host's alert pane is translucent glass, which over a form lets
 * the words underneath read through the refusal's own. The paper behind it
 * keeps the host's tint and loses the see-through. The radius is the Alert's
 * own (`theme.spacing(1.5)`), so no paper corner shows past its rounding.
 */
const FLOATING = {
  position: "fixed",
  top: refusalTop,
  left: (theme: Theme) => theme.spacing(2),
  right: (theme: Theme) => theme.spacing(2),
  mx: "auto",
  maxWidth: 440,
  zIndex: "snackbar",
  bgcolor: "background.paper",
  borderRadius: (theme: Theme) => theme.spacing(1.5),
} as const;

/**
 * Keep the control a keyboard user moves to clear of the refusal (WCAG 2.4.11).
 *
 * The browser scrolls a focused control into view, and a control under the
 * refusal counts as in view: the refusal is not the window's edge. The root's
 * `scroll-padding-top` is what says where the view starts, so while the refusal
 * is up it is the refusal's bottom edge plus the gap. The host's own value comes
 * back when the refusal goes. The pinned sign-up block reserves its room at the
 * bottom the same way (`useReserveFocusRoom`, `pages/signup-actions.tsx`).
 *
 * Measured before this, sign-up at 320×568 after a weak password: Shift+Tab
 * from "Criar conta" put focus on the password field with none of it visible,
 * under the refusal.
 */
function useReserveFocusRoomBelow(ref: RefObject<HTMLDivElement | null>): void {
  const theme = useTheme();
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const before = root.style.scrollPaddingTop;
    const gap = theme.spacing(GAP_UNITS);
    const publish = (): void => {
      root.style.scrollPaddingTop = `calc(${el.getBoundingClientRect().bottom}px + ${gap})`;
    };
    publish();
    // jsdom has no ResizeObserver; losing it costs the resize case only.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingTop = before;
    };
  }, [ref, theme]);
}

/**
 * Close the refusal when focus lands on a control whose middle it covers.
 *
 * The scroll padding clears every control the page can scroll to below the
 * refusal. It cannot help at the top of the page: at a scroll of 0 there is no
 * room left above, and a field the refusal sits on stays under it. Measured:
 * the sign-up name field at 320×568 and 360×640, and the Google button on a
 * login with no header above it (at 1280×800 all but its bottom 10px, none of
 * its label). Somebody who has gone back up there to fix the form is past the
 * refusal's message, so it closes, as if they had closed it.
 *
 * The middle, because that is where a control's label is: a sliver showing
 * past the refusal's edge does not show what has focus. Measured a frame after
 * the focus, so after the browser's own focus scrolling. A control whose middle
 * shows is left as it is.
 */
function useCloseWhenItHidesFocus(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return undefined;
    let frame = 0;
    const check = (): void => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || layer.contains(focused)) return;
      const field = focused.getBoundingClientRect();
      const over = layer.getBoundingClientRect();
      const x = (field.left + field.right) / 2;
      const y = (field.top + field.bottom) / 2;
      if (x >= over.left && x <= over.right && y >= over.top && y <= over.bottom) close.current();
    };
    const onFocusIn = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [ref]);
}

/**
 * The layer itself, in a portal at the end of the document.
 *
 * A portal because the refusal's place in the tree is the form's, and the form
 * is not a place a fixed layer can trust: in a `Stack` it took the column's
 * spacing as a top margin (forgot and reset password floated it 16px lower),
 * and an ancestor with a `transform` would pin it to that ancestor instead of
 * the window.
 *
 * The container is named rather than left to `Portal`: without one it renders
 * into the body first and into a container of its own from the next render on,
 * and that move remounts the refusal — a new node on the form's first keystroke
 * after it, which a screen reader may announce again.
 */
function FloatingLayer({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useReserveFocusRoomBelow(ref);
  useCloseWhenItHidesFocus(ref, onClose);
  return (
    <Portal container={document.body}>
      <Box ref={ref} sx={FLOATING} data-testid="auth-failure-layer">
        {children}
      </Box>
    </Portal>
  );
}

/**
 * The refusal banner. It FLOATS: fixed under the host's header, over the page.
 *
 * It used to sit in the form's flow, at the top of the form, while the button
 * that caused it sat at the bottom. On a phone that is a screen apart, so the
 * banner needed scrolling into view, and it sat 8px from the first field. The
 * product owner chose the floating banner over the inline one with more room
 * (FUT-2393). It is on screen wherever the page is scrolled, and nothing in
 * the form moves when it appears or goes. What it costs: it covers the part of
 * the page under it until it is closed. That is why it is closable and opaque,
 * why focus scrolling keeps clear of it ({@link useReserveFocusRoomBelow}), and
 * why it closes when focus lands where scrolling cannot clear it
 * ({@link useCloseWhenItHidesFocus}).
 *
 * Renders nothing for `null`, so a caller can drop it in unconditionally.
 */
export function FailureBanner({
  title,
  reason,
  violations,
  onDismiss,
}: {
  title: string;
  reason: EmailAuthScreenReason | null;
  violations?: readonly string[] | null;
  onDismiss: () => void;
}): JSX.Element | null {
  const { copy } = useScreens();
  if (!reason) return null;
  return (
    <>
      {/*
        `data-testid` + `data-reason` so a test can assert WHICH refusal came
        back without matching the host's own words. The copy is the host's — a
        journey that asserted "E-mail ou senha incorretos." would only ever run
        in a pt-BR app, which is exactly what stops these scenarios shipping
        with the library. The reason code is the same in every consumer.
      */}
      <FloatingLayer onClose={onDismiss}>
        <Alert
          variant="danger"
          title={title}
          description={failureMessage(copy, reason, violations)}
          closable
          closeLabel={copy.dismissFailure}
          onClose={onDismiss}
          data-testid="auth-failure"
          data-reason={reason}
        />
      </FloatingLayer>
    </>
  );
}

/**
 * The quiet action beside a form's real one — "I forgot my password", "back to
 * sign in". Shared by the two screens that need one.
 *
 * The design system's `ghost` button rather than a hand-styled `<button>`. The
 * hand-styled one carried a permanent underline in the inherited ink at
 * `0.85rem`, which is the browser's default anchor and reads on a finished
 * screen as a link that escaped the stylesheet. It also had `padding: 0`, so
 * the tap target was the height of the words — around 18px against the 44px a
 * thumb needs.
 *
 * `text` is the variant that exists for exactly this: quiet next to a solid
 * button, in the theme's own ink, with a hover wash and a real hit area. Not
 * `ghost`, which sounds like the same thing and is not — it maps onto MUI's
 * `contained`, so it keeps that variant's elevation and renders as a raised
 * white slab competing with the submit button directly above it.
 */
export function LinkButton({
  onClick,
  dataTestId,
  children,
}: {
  onClick: () => void;
  dataTestId: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="text"
      color="primary"
      size="sm"
      fullWidth
      onClick={onClick}
      dataTestId={dataTestId}
    >
      {children}
    </Button>
  );
}
