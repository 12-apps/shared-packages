import { useEffect, useRef, useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Container } from "@12-apps/ui/layout/Container";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { SocialLoginContainer } from "@12-apps/ui/social-login-button";

import { useScreens } from "./context";
import { failureMessage, type EmailAuthScreenReason } from "./copy";

/**
 * The page the confirmation link opens: spend the token, then say what
 * happened.
 *
 * ## Why the link is a page and the consumption is a POST
 *
 * Mail clients and corporate security scanners PREFETCH links. If the link
 * itself were the GET that consumed the token, a scanner would burn it before
 * the recipient ever clicked, and the person would arrive at "this link was
 * already used" having done nothing wrong. So the link opens this page and the
 * page POSTs — a prefetch renders the page and spends nothing.
 *
 * ## Why the effect guards with a ref
 *
 * React's development StrictMode mounts every effect twice on purpose. Against
 * a single-use token that is not a nuisance, it is a bug: the first call
 * consumes and the second reports `token-invalid`, so verification "fails" for
 * every developer while working perfectly in production. The ref makes the
 * second mount a no-op.
 */
export function VerifyEmailScreen({
  token,
  onContinue,
}: {
  token: string | null;
  onContinue: () => void;
}): JSX.Element {
  const { client, copy } = useScreens();
  const [state, setState] = useState<"pending" | "done" | "failed">("pending");
  const [reason, setReason] = useState<EmailAuthScreenReason | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!token) {
      setState("failed");
      setReason("token-invalid");
      return;
    }
    void client.verifyEmail(token).then((result) => {
      if (result.ok) {
        setState("done");
      } else {
        setState("failed");
        setReason(result.reason);
      }
    });
  }, [client, token]);

  if (state === "pending") {
    return (
      <Container variant="centered" padding="lg">
        <LoadingState variant="spinner" message={copy.verifyEmail.verifying} size="md" />
      </Container>
    );
  }

  const done = state === "done";
  return (
    <Container variant="centered" padding="lg">
      <SocialLoginContainer
        title={done ? copy.verifyEmail.doneTitle : copy.verifyEmail.failedTitle}
        showDivider={false}
      >
        {done ? (
          <Alert
            variant="success"
            title={copy.verifyEmail.successAlertTitle}
            description={copy.verifyEmail.successDescription}
            data-testid="verify-success"
          />
        ) : (
          <Alert
            variant="warning"
            title={copy.verifyEmail.failedAlertTitle}
            description={failureMessage(copy, reason ?? "token-invalid")}
            data-testid="verify-failed"
          />
        )}
        <Spacer size="md" />
        <Button
          variant="solid"
          color="primary"
          fullWidth
          onClick={onContinue}
          dataTestId="verify-continue"
        >
          {done ? copy.verifyEmail.continueSignIn : copy.verifyEmail.continueBack}
        </Button>
      </SocialLoginContainer>
    </Container>
  );
}
