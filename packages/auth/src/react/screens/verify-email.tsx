import { useEffect, useRef, useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Container } from "@12-apps/ui/layout/Container";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { SocialLoginContainer } from "@12-apps/ui/social-login-button";

import type { EmailAuth } from "../create-email-auth";
import { useScreens, type ScreensSession } from "./context";
import { failureMessage, type EmailAuthScreenReason } from "./copy";

/** What a verified link led to, for the host to route on. */
export interface VerifiedOutcome {
  /** The address the link proved — to prefill a sign-in when `signedIn` is false. */
  email: string;
  /** This browser signed up, and is now signed in. */
  signedIn: boolean;
}

type VerifyState =
  | { state: "pending" }
  | { state: "done" }
  | { state: "failed"; reason: EmailAuthScreenReason };

/**
 * Spend the token and, when this browser signed up, sign in with it.
 *
 * Signing in is only attempted for a host that asked (`onVerified`): the
 * others keep the old screen, "confirmed — sign in". A failed sign-in is
 * still a verified address, so it reports `signedIn: false` rather than an
 * error — the host's sign-in page is the right next step either way.
 */
async function verifyAndSignIn(
  client: EmailAuth,
  session: ScreensSession,
  token: string,
  callbackUrl: string | undefined,
): Promise<{ ok: true; outcome: VerifiedOutcome } | { ok: false; reason: EmailAuthScreenReason }> {
  const verified = await client.verifyEmail(token);
  if (!verified.ok) return verified;
  const { email, canSignIn } = verified.data;
  if (!canSignIn || !session.signInWithLink) return { ok: true, outcome: { email, signedIn: false } };
  const signedIn = await session.signInWithLink({ token, callbackUrl });
  return { ok: true, outcome: { email, signedIn: signedIn.ok } };
}

/**
 * Spend the token once, and say what happened.
 *
 * The ref is the StrictMode guard the screen's docblock explains: a second
 * mount must not spend a single-use token a second time.
 */
function useVerification(
  token: string | null,
  onVerified: ((outcome: VerifiedOutcome) => void) | undefined,
  callbackUrl: string | undefined,
): VerifyState {
  const { client, useSession } = useScreens();
  const session = useSession();
  const [view, setView] = useState<VerifyState>({ state: "pending" });
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!token) {
      setView({ state: "failed", reason: "token-invalid" });
      return;
    }
    if (!onVerified) {
      void client.verifyEmail(token).then((result) => {
        setView(result.ok ? { state: "done" } : { state: "failed", reason: result.reason });
      });
      return;
    }
    void verifyAndSignIn(client, session, token, callbackUrl).then((result) => {
      if (result.ok) onVerified(result.outcome);
      else setView({ state: "failed", reason: result.reason });
    });
  }, [client, session, token, callbackUrl, onVerified]);

  return view;
}

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
  onVerified,
  callbackUrl,
}: {
  token: string | null;
  onContinue: () => void;
  /**
   * Take over once the link is verified (FUT-3474). With it, the browser that
   * signed up is signed in on the spot and the host is told so; any other is
   * told the address, so the host can send it to sign in with it filled in.
   * The screen keeps showing its spinner: the host is expected to navigate.
   * Without it, the screen says "confirmed" and waits for `onContinue`.
   */
  onVerified?: (outcome: VerifiedOutcome) => void;
  /** Where the sign-in should land, passed through to the session. */
  callbackUrl?: string;
}): JSX.Element {
  const { copy } = useScreens();
  const view = useVerification(token, onVerified, callbackUrl);
  const { state } = view;
  const reason = view.state === "failed" ? view.reason : null;
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
