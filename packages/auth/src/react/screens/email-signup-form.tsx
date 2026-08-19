import { useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { Text } from "@12-apps/ui/typography/Text";

import { useScreens } from "./context";
import type { EmailAuthScreenReason } from "./copy";
import { PasswordField } from "./password-field";
import { FailureBanner } from "./shared";

/**
 * Create an account with an e-mail and a password.
 *
 * ## The success screen has two shapes, and the difference is the platform's
 *
 * With verification REQUIRED the answer is "check your e-mail" and the person
 * cannot sign in yet. With it switched off the account works immediately, so
 * the form signs them straight in rather than making them retype what they just
 * chose. The server reports which happened (`status`), and the screen renders
 * that rather than guessing — a screen that assumed one would show the wrong
 * message on every deployment configured the other way.
 *
 * ## Consent still runs
 *
 * `onBeforeSubmit` is where the caller records it. Signing up with a password
 * is a sign-up like any other, and consent is a property of the person rather
 * than of the method they picked — so whatever gates the social buttons gates
 * this form too.
 */

interface SignupState {
  name: string;
  email: string;
  password: string;
  pending: boolean;
  reason: EmailAuthScreenReason | null;
  violations: readonly string[] | null;
  sent: boolean;
  setName: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  dismiss: () => void;
  submit: (event: FormEvent) => Promise<void>;
}

export interface SignupConfig {
  callbackUrl: string;
  onBeforeSubmit: () => Promise<void>;
  onSignedIn: () => void;
  disabled?: boolean;
}

function useSignup(config: SignupConfig): SignupState {
  const { client } = useScreens();
  const { signInWithPassword } = useScreens().useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<EmailAuthScreenReason | null>(null);
  const [violations, setViolations] = useState<readonly string[] | null>(null);
  const [sent, setSent] = useState(false);

  /** Register, then take whichever of the two paths the server reports. */
  async function register(): Promise<void> {
    const result = await client.signUp({ email, password, name: name || undefined });
    if (!result.ok) {
      setReason(result.reason);
      setViolations(result.violations ?? null);
      return;
    }
    if (result.data.status === "verification-sent") {
      setSent(true);
      return;
    }
    // Verification is off, so the credentials work right now. Signing in here
    // rather than sending them to the login screen saves retyping a password
    // chosen ten seconds ago; a failure falls through to this form's banner.
    const signedIn = await signInWithPassword({
      email,
      password,
      callbackUrl: config.callbackUrl,
    });
    if (signedIn.ok) config.onSignedIn();
    else setReason(signedIn.reason);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending || config.disabled) return;
    setPending(true);
    setReason(null);
    setViolations(null);
    try {
      try {
        await config.onBeforeSubmit();
      } catch {
        setReason("unknown");
        return;
      }
      await register();
    } finally {
      setPending(false);
    }
  }

  return {
    name,
    email,
    password,
    pending,
    reason,
    violations,
    sent,
    setName,
    setEmail,
    setPassword,
    dismiss: () => setReason(null),
    submit,
  };
}

export function EmailSignupForm(props: SignupConfig): JSX.Element {
  const { copy } = useScreens();
  const form = useSignup(props);

  if (form.sent) {
    return (
      <Alert
        variant="success"
        title={copy.signUp.sentTitle}
        description={copy.signUp.sentDescription(form.email)}
        data-testid="signup-verification-sent"
      />
    );
  }

  return (
    <form onSubmit={(event) => void form.submit(event)} data-testid="email-signup-form">
      <FailureBanner
        title={copy.signUp.failureTitle}
        reason={form.reason}
        violations={form.violations}
        onDismiss={form.dismiss}
      />

      <Input
        id="signup-name"
        name="name"
        label={copy.signUp.nameLabel}
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
        autoComplete="name"
        fullWidth
        data-testid="signup-name"
      />
      <Spacer size="sm" />
      <Input
        id="signup-email"
        name="email"
        label={copy.signUp.emailLabel}
        type="email"
        value={form.email}
        onChange={(event) => form.setEmail(event.target.value)}
        autoComplete="email"
        fullWidth
        required
        data-testid="signup-email"
      />
      <Spacer size="sm" />
      <PasswordField
        id="signup-password"
        label={copy.signUp.passwordLabel}
        value={form.password}
        onChange={form.setPassword}
        autoComplete="new-password"
        dataTestId="signup-password"
      />
      <Spacer size="xs" />
      <Text color="secondary" size="sm">
        {copy.signUp.passwordHint}
      </Text>
      <Spacer size="md" />
      <Button
        type="submit"
        variant="solid"
        color="primary"
        fullWidth
        loading={form.pending}
        disabled={
          props.disabled || form.pending || form.email.length === 0 || form.password.length === 0
        }
        dataTestId="signup-submit"
      >
        {copy.signUp.submit}
      </Button>
    </form>
  );
}
