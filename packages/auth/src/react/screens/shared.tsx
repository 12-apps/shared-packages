import { useEffect, useRef, type JSX, type ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Box } from "@12-apps/ui/mui/Box";
import type { Theme } from "@12-apps/ui/mui/styles";
import { Button } from "@12-apps/ui/form/Button";

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

/**
 * How far below the top of the window the refusal floats.
 *
 * Under the host's header rather than over it. 76px clears a 64px header with
 * a 12px gap, which is the storefront's. A host with a different header sets
 * `--auth-refusal-top` on its root to its own height plus the gap.
 */
const REFUSAL_TOP = "var(--auth-refusal-top, 76px)";

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
  top: REFUSAL_TOP,
  left: 16,
  right: 16,
  mx: "auto",
  maxWidth: 440,
  zIndex: "snackbar",
  bgcolor: "background.paper",
  borderRadius: (theme: Theme) => theme.spacing(1.5),
} as const;

/**
 * The refusal banner. It FLOATS: fixed under the host's header, over the page.
 *
 * It used to sit in the form's flow, at the top of the form, while the button
 * that caused it sat at the bottom. On a phone that is a screen apart, so the
 * banner needed scrolling into view, and it sat 8px from the first field. The
 * product owner chose the floating banner over the inline one with more room
 * (FUT-2393). It is on screen wherever the page is scrolled, and nothing in
 * the form moves when it appears or goes. What it costs: it covers the part of
 * the page under it until it is closed. That is why it is closable and opaque.
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
      <Box sx={FLOATING} data-testid="auth-failure-layer">
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
      </Box>
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
