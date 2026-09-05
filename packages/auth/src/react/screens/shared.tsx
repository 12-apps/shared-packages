import type { JSX, ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Spacer } from "@12-apps/ui/layout/Spacer";

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
 * The refusal banner.
 *
 * Renders nothing for `null`, so a caller can drop it in unconditionally
 * instead of wrapping it in a fragment-and-spacer each time — which is what
 * pushed three of these components past the size gate.
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
      <Spacer size="sm" />
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
