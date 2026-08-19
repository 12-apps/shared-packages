import { useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Container } from "@12-apps/ui/layout/Container";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { SocialLoginContainer } from "@12-apps/ui/social-login-button";
import { Text } from "@12-apps/ui/typography/Text";

import { useScreens } from "./context";
import type { EmailAuthScreenReason } from "./copy";
import { PasswordField } from "./password-field";
import { FailureBanner } from "./shared";

/**
 * Choose a new password, using the token from the reset link.
 *
 * ## Why the confirmation field is here and not in the backend
 *
 * "Type it again" catches a typo in a field nobody can read, and it is purely a
 * UI concern — the backend has no opinion about it and receives one password.
 * Putting it server-side would make a client-side typo cost a round trip and a
 * spent token.
 *
 * ## Why a rejected password leaves the link usable
 *
 * The server checks the policy BEFORE consuming the token, so a weak-password
 * refusal comes back with the link still valid and the person simply tries
 * again on this same screen. The alternative — consume, then validate — would
 * burn the link on a typo and send them back to their inbox for another one.
 */

/** A one-message screen with a single action. Three of the states below are one. */
function Outcome({
  title,
  variant,
  alertTitle,
  message,
  action,
  onAction,
  dataTestId,
}: {
  title: string;
  variant: "success" | "warning";
  alertTitle: string;
  message: string;
  action: string;
  onAction: () => void;
  dataTestId: string;
}): JSX.Element {
  return (
    <Container variant="centered" padding="lg">
      <SocialLoginContainer title={title} showDivider={false}>
        <Alert variant={variant} title={alertTitle} description={message} />
        <Spacer size="md" />
        <Button
          variant="solid"
          color="primary"
          fullWidth
          onClick={onAction}
          dataTestId={dataTestId}
        >
          {action}
        </Button>
      </SocialLoginContainer>
    </Container>
  );
}

interface ResetState {
  password: string;
  confirmation: string;
  pending: boolean;
  reason: EmailAuthScreenReason | null;
  violations: readonly string[] | null;
  done: boolean;
  mismatch: boolean;
  setPassword: (value: string) => void;
  setConfirmation: (value: string) => void;
  dismiss: () => void;
  submit: (event: FormEvent) => Promise<void>;
}

function useReset(token: string | null): ResetState {
  const { client } = useScreens();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<EmailAuthScreenReason | null>(null);
  const [violations, setViolations] = useState<readonly string[] | null>(null);
  const [done, setDone] = useState(false);
  const mismatch = confirmation.length > 0 && password !== confirmation;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending || mismatch || !token) return;
    setPending(true);
    setReason(null);
    setViolations(null);
    try {
      const result = await client.resetPassword(token, password);
      if (result.ok) {
        setDone(true);
      } else {
        setReason(result.reason);
        setViolations(result.violations ?? null);
      }
    } finally {
      setPending(false);
    }
  }

  return {
    password,
    confirmation,
    pending,
    reason,
    violations,
    done,
    mismatch,
    setPassword,
    setConfirmation,
    dismiss: () => setReason(null),
    submit,
  };
}

export function ResetPasswordScreen({
  token,
  onDone,
  onRequestNewLink,
}: {
  token: string | null;
  onDone: () => void;
  onRequestNewLink: () => void;
}): JSX.Element {
  const { copy } = useScreens();
  const form = useReset(token);
  // A link opened without a token is a link that was mangled in transit — a
  // mail client that wrapped the URL, most often. Saying so beats a form that
  // submits and fails.
  const missingToken = !token;

  if (form.done) {
    return (
      <Outcome
        title={copy.resetPassword.doneTitle}
        variant="success"
        alertTitle={copy.resetPassword.okAlertTitle}
        message={copy.resetPassword.doneMessage}
        action={copy.resetPassword.doneAction}
        onAction={onDone}
        dataTestId="reset-done"
      />
    );
  }

  if (form.reason === "token-invalid" || missingToken) {
    return (
      <Outcome
        title={copy.resetPassword.title}
        variant="warning"
        alertTitle={copy.resetPassword.invalidAlertTitle}
        message={
          missingToken
            ? copy.resetPassword.missingTokenMessage
            : copy.resetPassword.expiredMessage
        }
        action={copy.resetPassword.requestNewLink}
        onAction={onRequestNewLink}
        dataTestId="request-new-link"
      />
    );
  }

  return <ResetForm form={form} />;
}

/** The form itself, split out to keep the screen above about its three states. */
function ResetForm({ form }: { form: ResetState }): JSX.Element {
  const { copy } = useScreens();
  return (
    <Container variant="centered" padding="lg">
      <SocialLoginContainer title={copy.resetPassword.title} showDivider={false}>
        <Text color="secondary" size="sm" style={{ textAlign: "center", marginBottom: "1rem" }}>
          {copy.resetPassword.intro}
        </Text>

        <FailureBanner
          title={copy.resetPassword.failureTitle}
          reason={form.reason}
          violations={form.violations}
          onDismiss={form.dismiss}
        />

        <form onSubmit={(event) => void form.submit(event)} data-testid="reset-password-form">
          <PasswordField
            id="reset-password"
            label={copy.resetPassword.newPasswordLabel}
            value={form.password}
            onChange={form.setPassword}
            autoComplete="new-password"
            dataTestId="reset-password"
            autoFocus
          />
          <Spacer size="sm" />
          <PasswordField
            id="reset-password-confirm"
            label={copy.resetPassword.confirmationLabel}
            value={form.confirmation}
            onChange={form.setConfirmation}
            autoComplete="new-password"
            error={form.mismatch}
            helperText={form.mismatch ? copy.resetPassword.mismatch : undefined}
            dataTestId="reset-password-confirm"
          />
          <Spacer size="md" />
          <Button
            type="submit"
            variant="solid"
            color="primary"
            fullWidth
            loading={form.pending}
            disabled={form.pending || form.password.length === 0 || form.mismatch}
            dataTestId="reset-submit"
          >
            {copy.resetPassword.submit}
          </Button>
        </form>
      </SocialLoginContainer>
    </Container>
  );
}
