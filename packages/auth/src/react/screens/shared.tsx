import type { JSX, ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
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

/** A button that reads as a link. Shared by the two screens that need one. */
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
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        textDecoration: "underline",
        fontSize: "0.85rem",
        padding: 0,
        color: "inherit",
        width: "100%",
        font: "inherit",
      }}
    >
      {children}
    </button>
  );
}
