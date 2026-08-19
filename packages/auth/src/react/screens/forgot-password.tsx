import { useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Container } from "@12-apps/ui/layout/Container";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { SocialLoginContainer } from "@12-apps/ui/social-login-button";
import { Text } from "@12-apps/ui/typography/Text";

import { useScreens } from "./context";
import type { EmailAuthScreenReason } from "./copy";
import { FailureBanner, LinkButton } from "./shared";

/**
 * Ask for a reset link.
 *
 * ## The screen deliberately cannot tell you whether the account exists
 *
 * Success and "no such address" produce the SAME confirmation, because the
 * endpoint answers the same either way. That is not the screen being coy: an
 * honest "we could not find that e-mail" would let anyone check who has an
 * account here, one address at a time, with no credentials at all.
 *
 * So the confirmation is expected to say what actually happened — a message was
 * sent IF the address is registered — rather than implying it definitely was.
 * Being vague about the outcome while being precise about the condition is the
 * honest way to say it, and `copy.forgotPassword.sentDescription` receives the
 * address so a host can phrase it that way.
 */

/** The confirmation, which is the same whether or not an account was found. */
function LinkSent({
  email,
  onBackToLogin,
}: {
  email: string;
  onBackToLogin: () => void;
}): JSX.Element {
  const { copy } = useScreens();
  return (
    <Container variant="centered" padding="lg">
      <SocialLoginContainer title={copy.forgotPassword.sentTitle} showDivider={false}>
        <Alert
          variant="success"
          title={copy.forgotPassword.sentAlertTitle}
          description={copy.forgotPassword.sentDescription(email)}
        />
        <Spacer size="md" />
        <Button
          variant="outline"
          color="primary"
          fullWidth
          onClick={onBackToLogin}
          dataTestId="back-to-login"
        >
          {copy.forgotPassword.backToLogin}
        </Button>
      </SocialLoginContainer>
    </Container>
  );
}

export function ForgotPasswordScreen({
  onBackToLogin,
}: {
  onBackToLogin: () => void;
}): JSX.Element {
  const { client, copy } = useScreens();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [reason, setReason] = useState<EmailAuthScreenReason | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setReason(null);
    try {
      const result = await client.requestPasswordReset(email);
      if (result.ok) setSent(true);
      else setReason(result.reason);
    } finally {
      setPending(false);
    }
  }

  if (sent) return <LinkSent email={email} onBackToLogin={onBackToLogin} />;

  return (
    <Container variant="centered" padding="lg">
      <SocialLoginContainer title={copy.forgotPassword.title} showDivider={false}>
        <Text color="secondary" size="sm" style={{ textAlign: "center", marginBottom: "1rem" }}>
          {copy.forgotPassword.intro}
        </Text>

        <FailureBanner
          title={copy.forgotPassword.failureTitle}
          reason={reason}
          onDismiss={() => setReason(null)}
        />

        <form onSubmit={(event) => void handleSubmit(event)} data-testid="forgot-password-form">
          <Input
            id="forgot-email"
            name="email"
            label={copy.forgotPassword.emailLabel}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            fullWidth
            required
            autoFocus
            data-testid="forgot-email"
          />
          <Spacer size="md" />
          <Button
            type="submit"
            variant="solid"
            color="primary"
            fullWidth
            loading={pending}
            disabled={pending || email.length === 0}
            dataTestId="forgot-submit"
          >
            {copy.forgotPassword.submit}
          </Button>
        </form>

        <Spacer size="md" />
        <LinkButton onClick={onBackToLogin} dataTestId="back-to-login">
          {copy.forgotPassword.backToLogin}
        </LinkButton>
      </SocialLoginContainer>
    </Container>
  );
}
