import type { JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Heading } from "@12-apps/ui/typography/Heading";
import { Paragraph } from "@12-apps/ui/typography/Paragraph";
import { Spacer } from "@12-apps/ui/layout/Spacer";

/**
 * "Confira seu e-mail" — the panel shown after a link has been sent.
 *
 * ## The two actions, and why their weights are not interchangeable
 *
 * What actually resolves this screen is in the person's inbox. Neither button
 * here is the main event, so neither is a primary: **Resend** is secondary
 * because pressing it is what somebody does when the first mail did not arrive,
 * and making it prominent invites a second send before the first has landed —
 * which is how a person burns their own rate limit and ends up locked out of a
 * flow that was working.
 *
 * **Use another address** is the one this panel would be broken without. The
 * commonest failure here is a typo, and a screen with no way back forces a
 * reload and a full retype. It returns the FORM, prefilled, rather than
 * restarting the flow.
 *
 * ## Why the address is shown
 *
 * A typo is only discoverable if the person can see what was sent to. Showing
 * it costs nothing — they typed it — and is the difference between "nothing
 * arrived" and "ah, I typed .con".
 */

export interface CheckEmailCopy {
  /** "Confira seu e-mail" */
  title: string;
  /** Takes the address: "Enviamos um link para {email}." */
  description: (email: string) => string;
  /** "Reenviar o link" */
  resend: string;
  /** "Usar outro e-mail" */
  changeEmail: string;
  /** Shown once a resend succeeds. */
  resent: string;
  /** While the resend is in flight. */
  resending: string;
}

export interface CheckEmailPanelProps {
  /** The address the link went to. Shown so a typo is discoverable. */
  email: string;
  copy: CheckEmailCopy;
  /** Send another link to the same address. */
  onResend: () => void;
  /** Go back to the form, prefilled with `email`. */
  onChangeEmail: () => void;
  /** A resend is in flight. */
  resending?: boolean;
  /** A resend has succeeded at least once. */
  resent?: boolean;
  /**
   * The resend was refused — usually the send limit.
   *
   * Rendered INSIDE this panel rather than replacing it: the link that was
   * already sent is still valid, so throwing the panel away would lose the
   * person's only remaining path.
   */
  notice?: string | null;
}

export function CheckEmailPanel({
  email,
  copy,
  onResend,
  onChangeEmail,
  resending,
  resent,
  notice,
}: CheckEmailPanelProps): JSX.Element {
  return (
    <div data-testid="check-email" data-email={email}>
      <Heading level="h2">{copy.title}</Heading>
      <Paragraph data-testid="check-email-address">{copy.description(email)}</Paragraph>
      {notice ? (
        <>
          <Spacer size="sm" />
          <Alert variant="warning" description={notice} data-testid="check-email-notice" />
        </>
      ) : null}
      {resent ? (
        <>
          <Spacer size="sm" />
          <Alert variant="success" description={copy.resent} data-testid="check-email-resent" />
        </>
      ) : null}
      <Spacer size="md" />
      {/*
        `outline` is this library's secondary weight — deliberately not the
        primary, for the reason in the note above. Never disabled while a send
        is in flight either: the label carries the state, and a greyed-out
        action is the pattern this surface refuses everywhere.
      */}
      <Button variant="outline" onClick={onResend} data-testid="check-email-resend">
        {resending ? copy.resending : copy.resend}
      </Button>
      <Spacer size="sm" />
      <Button variant="ghost" onClick={onChangeEmail} data-testid="check-email-change">
        {copy.changeEmail}
      </Button>
    </div>
  );
}
