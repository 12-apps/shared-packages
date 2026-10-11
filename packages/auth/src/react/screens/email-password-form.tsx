import { useCallback, useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Spacer } from "@12-apps/ui/layout/Spacer";

import { useScreens } from "./context";
import type { EmailAuthScreenReason } from "./copy";
import { PasswordField } from "./password-field";
import { ResendVerification } from "./resend-verification";
import { FailureBanner, LinkButton, RevealOnAppear } from "./shared";

/**
 * Sign in with an e-mail and a password.
 *
 * Rendered ABOVE the social buttons on a login screen, and it does not
 * navigate: `signInWithPassword` resolves with the outcome, so a wrong password
 * appears beside the fields the person just filled in rather than through a
 * full page reload that empties them.
 *
 * ## The one branch that is not just an error
 *
 * `email-not-verified` means the password was RIGHT and the address is not
 * confirmed yet. Showing it as a plain failure would leave the person stuck
 * with correct credentials and no next step, so it renders as a warning with a
 * resend action — which is the only thing that actually moves them forward.
 */

interface SignInState {
  email: string;
  password: string;
  pending: boolean;
  reason: EmailAuthScreenReason | null;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  dismiss: () => void;
  submit: (event: FormEvent) => Promise<void>;
}

/** The form's state and its one action, so the component below is only markup. */
function useSignIn(
  callbackUrl: string,
  onSignedIn: () => void,
  initialEmail: string,
): SignInState {
  const { signInWithPassword } = useScreens().useSession();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<EmailAuthScreenReason | null>(null);

  const submit = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      if (pending) return;
      setPending(true);
      setReason(null);
      try {
        const result = await signInWithPassword({ email, password, callbackUrl });
        if (result.ok) onSignedIn();
        else setReason(result.reason);
      } finally {
        setPending(false);
      }
    },
    [callbackUrl, email, onSignedIn, password, pending, signInWithPassword],
  );

  return {
    email,
    password,
    pending,
    reason,
    setEmail,
    setPassword,
    dismiss: () => setReason(null),
    submit,
  };
}

/** The unverified state: a warning plus the only action that helps. */
function UnverifiedNotice({
  email,
  resent,
  onResent,
}: {
  email: string;
  resent: boolean;
  onResent: () => void;
}): JSX.Element {
  const { copy } = useScreens();
  return (
    <>
      {/*
        The same `auth-failure` + `data-reason` pair `FailureBanner` emits, and
        it has to be: this IS the refusal display for `email-not-verified`, it
        merely looks different because it carries an action. Without the pair
        the one refusal a caller most needs to distinguish — right password,
        unconfirmed address — was the only one no test could read, and it went
        unnoticed until a second host ran the packaged journeys.
      */}
      <RevealOnAppear>
        <Alert
          variant="warning"
          title={copy.signIn.unverifiedTitle}
          description={
            resent ? copy.signIn.resentDescription : copy.signIn.unverifiedDescription
          }
          data-testid="auth-failure"
          data-reason="email-not-verified"
        />
      </RevealOnAppear>
      <Spacer size="sm" />
      {!resent && (
        <>
          <ResendVerification email={email} onSent={onResent} />
          <Spacer size="sm" />
        </>
      )}
    </>
  );
}

interface EmailPasswordFormProps {
  callbackUrl: string;
  onSignedIn: () => void;
  onForgotPassword: () => void;
  /**
   * The address to start with — the one a confirmation link just proved,
   * when it was opened somewhere that could not be signed in. Read once.
   */
  initialEmail?: string;
}

export function EmailPasswordForm({
  callbackUrl,
  onSignedIn,
  onForgotPassword,
  initialEmail = "",
}: EmailPasswordFormProps): JSX.Element {
  const { copy } = useScreens();
  const form = useSignIn(callbackUrl, onSignedIn, initialEmail);
  const [resent, setResent] = useState(false);
  const unverified = form.reason === "email-not-verified";

  return (
    <form onSubmit={(event) => void form.submit(event)} data-testid="email-password-form">
      {/*
        The SHARED banner, not a hand-rolled Alert. This screen carried its own
        for no reason anybody could name, and the cost was that `auth-failure`
        and `data-reason` were missing from the single most important refusal in
        the package — a wrong password on the sign-in form. Every other screen
        used the shared one, so the gap was invisible until a second host ran
        the packaged journeys against this one.
      */}
      {!unverified && (
        <FailureBanner
          title={copy.signIn.failureTitle}
          reason={form.reason}
          onDismiss={form.dismiss}
        />
      )}

      {unverified && (
        <UnverifiedNotice
          email={form.email}
          resent={resent}
          onResent={() => setResent(true)}
        />
      )}

      <Input
        id="login-email"
        name="email"
        label={copy.signIn.emailLabel}
        type="email"
        value={form.email}
        onChange={(event) => form.setEmail(event.target.value)}
        autoComplete="email"
        fullWidth
        required
        data-testid="login-email"
      />
      <Spacer size="sm" />
      <PasswordField
        id="login-password"
        label={copy.signIn.passwordLabel}
        value={form.password}
        onChange={form.setPassword}
        autoComplete="current-password"
        dataTestId="login-password"
        // An address handed over by a confirmation link leaves one field to
        // fill: start the shopper there, not on the field already done.
        autoFocus={initialEmail.length > 0}
      />
      <Spacer size="md" />
      <Button
        type="submit"
        variant="solid"
        color="primary"
        fullWidth
        loading={form.pending}
        disabled={form.pending || form.email.length === 0 || form.password.length === 0}
        dataTestId="login-submit"
      >
        {copy.signIn.submit}
      </Button>
      <Spacer size="sm" />
      <LinkButton onClick={onForgotPassword} dataTestId="go-to-forgot-password">
        {copy.signIn.forgotPassword}
      </LinkButton>
    </form>
  );
}
