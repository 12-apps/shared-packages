import { useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Spacer } from "@12-apps/ui/layout/Spacer";

import { useScreens } from "./context";

/**
 * The "send it again" action: the sign-in form's unverified warning and the
 * confirmation page's dead link both offer it.
 *
 * Its own component so the button owns its pending state — inlining it would
 * put another piece of state on the form and make "which request is in flight"
 * ambiguous while both can be.
 */
export function ResendVerification({
  email,
  onSent,
  disabled = false,
}: {
  email: string;
  onSent: () => void;
  disabled?: boolean;
}): JSX.Element {
  const { client, copy } = useScreens();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      color="primary"
      fullWidth
      loading={pending}
      disabled={pending || disabled}
      dataTestId="resend-verification"
      onClick={() => {
        setPending(true);
        // The endpoint always acknowledges — it must not reveal whether the
        // address is registered — so there is no failure branch to render.
        void client
          .resendVerification(email)
          .then(onSent)
          .finally(() => setPending(false));
      }}
    >
      {copy.signIn.resend}
    </Button>
  );
}

/**
 * A spent or expired confirmation link, with the way out it promises (FUT-3474).
 *
 * The copy already says "Peça um novo"; until now nothing on the page could.
 * The link carries only its token, so the address is asked for here — the
 * resend answers the same whether or not it is registered, so asking reveals
 * nothing.
 */
export function ResendForDeadLink(): JSX.Element {
  const { client, copy } = useScreens();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <Alert variant="success" description={copy.signIn.resentDescription} data-testid="verify-resent" />
    );
  }
  const ready = email.includes("@") && !pending;
  // A form, so Enter in the field sends it as the button does.
  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    // The endpoint always acknowledges — it must not reveal whether the
    // address is registered — so there is no failure branch to render.
    void client
      .resendVerification(email)
      .then(() => setSent(true))
      .finally(() => setPending(false));
  };
  return (
    <form onSubmit={send} data-testid="verify-resend-form">
      <Input
        id="verify-resend-email"
        name="email"
        label={copy.signIn.emailLabel}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        fullWidth
        data-testid="verify-resend-email"
      />
      <Spacer size="sm" />
      <Button
        type="submit"
        variant="outline"
        color="primary"
        fullWidth
        loading={pending}
        disabled={!ready}
        dataTestId="resend-verification"
      >
        {copy.signIn.resend}
      </Button>
    </form>
  );
}
