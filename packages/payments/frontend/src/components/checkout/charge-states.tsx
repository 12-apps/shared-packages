/**
 * What a card or wallet charge shows once it is out of the buyer's hands: the
 * wait for its confirmation, and a refusal (FUT-58, FUT-563, FUT-1144).
 *
 * Shared by every screen that charges — the one list's runners and wallet
 * block, and the factory's card entry — so a refusal reads the same wherever
 * the buyer met it.
 */
import type { JSX } from "react";

import type { CardSubmit } from "./card-submit";
import { useCheckoutCopy } from "./copy-context";
import { StalledWait } from "./stalled-wait";
import { useCheckoutComponents } from "./ui";

/**
 * Post-submit confirmation state: timeout > error > spinner.
 *
 * The elapsed wall-clock wait leads (the order stays AWAITING server-side and is
 * recoverable by webhook/reconcile/backfill, which is what its copy says), then
 * a poll that cannot reach us — a warning saying we are STILL TRYING, where
 * FUT-1144 found a danger Alert over a wait that had actually given up — then
 * the ordinary bounded spinner.
 *
 * That order inverted with the meaning of the two flags. An error used to BE the
 * ending; now the clock is, and a wait that failed its way to the clock carries
 * both. "We keep trying" over a wait nothing is scheduled for is the lie.
 */
export function SubmittedState({
  card,
}: {
  card: Pick<CardSubmit, "pollTimedOut" | "pollError" | "pollCheckAgain">;
}): JSX.Element {
  const { LoadingState } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.settling;
  if (card.pollTimedOut) {
    return (
      <StalledWait
        title={copy.takingLonger}
        description={copy.takingLongerHelp}
        onCheckAgain={card.pollCheckAgain}
        testId="card-poll-timeout"
        actionTestId="card-check-again"
      />
    );
  }
  if (card.pollError) {
    return (
      <StalledWait
        title={copy.connectionLost}
        description={card.pollError}
        onCheckAgain={card.pollCheckAgain}
        testId="card-poll-error"
        actionTestId="card-check-again"
      />
    );
  }
  return (
    <LoadingState
      variant="spinner"
      size="md"
      message={copy.processing}
      dataTestId="card-processing"
    />
  );
}

/**
 * What a submit came back with.
 *
 * An UNRESOLVED charge gets its own presentation (FUT-563): some provider may
 * be holding the buyer's money, so wording it as a failure — and heading it
 * "Não foi possível pagar" above a body that says "não pague de novo" — pushes
 * the buyer toward exactly the second payment it forbids.
 */
export function ChargeFailure({
  message,
  unresolved,
}: {
  message: string;
  unresolved: boolean;
}): JSX.Element {
  const { Alert } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.settling;
  if (unresolved) {
    return (
      <Alert
        variant="warning"
        title={copy.confirming}
        description={message}
        showIcon
        data-testid="card-unresolved"
      />
    );
  }
  return (
    <Alert variant="danger" title={copy.cannotPay} description={message} showIcon data-testid="card-error" />
  );
}
