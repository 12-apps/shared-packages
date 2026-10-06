import { Box } from "@mui/material";
import { useEffect, useMemo, useState, type JSX } from "react";

import { useCheckoutCopy } from "./copy-context";
import { PixAfterCopy } from "./pix-after-copy";
import { PixPane, type PixTab } from "./pix-pane";
import { PIX_CONTAINER, PIX_WIDE, useClipboardCopy } from "./pix-parts";
import { usePixStage } from "./pix-stage";
import type { PixPaneCopy, SettlingCopy } from "./screens-copy";
import { StalledWait } from "./stalled-wait";
import type { CheckoutOrder, OrderStatus, PixCharge } from "./types";
import { useCheckoutComponents } from "./ui";
import { usePaymentPolling } from "./use-payment-polling";

/**
 * PIX payment view: the pane to pay from (tabs on a phone, QR and code side by
 * side on a desktop — `./pix-pane`), and after a copy the wait that follows
 * (`./pix-after-copy`). Polls the order in the background throughout and hands
 * a terminal status up to the parent, which then shows the payment-status
 * screen. The 2026-10-06 redesign moved the layout out; the wait stays here.
 */

/**
 * PIX payment view: a scannable QR (rendered client-side from the "copia e cola"
 * payload), the copyable code, and a live pending indicator. Polls the order in
 * the background and hands a terminal status up to the parent, which then shows
 * the payment-status screen.
 */

/**
 * How many polls at the opening cadence before the wait decays (FUT-1170).
 *
 * Twelve is thirty seconds at the default 2.5 s, which is the window the common
 * case lives in: a buyer on this screen has the QR in front of them and pays
 * within a few taps, and the answer lands within seconds of the webhook.
 * Everything after that window is an abandoned tab, or a shopper who has gone
 * to fetch a different phone — and paying full cadence for it taxes the case
 * that matters to subsidise the one that does not.
 */
const PIX_FAST_POLLS = 12;

/**
 * The decayed cadence. Six asks a minute rather than twenty-four, and the two
 * re-arm events (`visibilitychange`, `online`) still poll IMMEDIATELY when the
 * buyer comes back from their bank app — which is the moment they are waiting
 * on, so the slow phase costs them nothing there.
 */
const PIX_SLOW_INTERVAL_MS = 15_000;

/**
 * How long the wait outlives the code itself.
 *
 * The bound is the CHARGE's expiry, because that is the fact that ends this
 * screen: after it, the server flips the order and answers a terminal EXPIRED.
 * The grace is room for that flip to happen and be observed — stopping exactly
 * at the expiry would end the wait one poll before the answer it exists for.
 */
const PIX_EXPIRY_GRACE_MS = 60_000;

/**
 * The bound for a charge whose expiry cannot be read — a malformed instant, or
 * an order that arrived without one.
 *
 * Unbounded is not the safe reading. It was the shipped one, and it is what let
 * a forgotten tab ask a provider every 2.5 s for as long as it stayed open. A
 * quarter of an hour is longer than any PIX code this checkout raises, and the
 * buyer gets the ask back with one press.
 */
const PIX_FALLBACK_WAIT_MS = 15 * 60_000;

/** How long to keep asking about this charge — see the constants above. */
function pixWaitMs(expiresAt: string | undefined): number {
  const deadline = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return PIX_FALLBACK_WAIT_MS;
  return Math.max(0, deadline - Date.now()) + PIX_EXPIRY_GRACE_MS;
}


/**
 * Which of the wait's three faces the footer is showing — STOPPED, then STILL
 * TRYING, then working.
 *
 * The card pane's order, and for its reason (`SubmittedState`): a wait that
 * failed its way to its own clock carries both flags, and "we keep trying" over
 * a wait nothing is scheduled for is the lie. The sentences are the shared
 * {@link SettlingCopy} ones, so the two panes say the same thing about the same
 * situation rather than drifting into two accounts of it.
 */
function pixWaitPanel(
  copy: SettlingCopy,
  error: string | null,
  timedOut: boolean,
): { title: string; description: string; testId: string } | null {
  if (timedOut) {
    return { title: copy.takingLonger, description: copy.takingLongerHelp, testId: "pix-poll-timeout" };
  }
  if (error) return { title: copy.connectionLost, description: error, testId: "pix-poll-error" };
  return null;
}

/**
 * The live footer: the pulsing "awaiting payment" indicator, or — while the
 * poll cannot reach us, or once it has stopped — the same wait said out loud,
 * with a way to restart it.
 *
 * A WARNING rather than a danger (FUT-1144). The old red panel said "não foi
 * possível confirmar o pagamento" and meant it: four consecutive failures ended
 * the wait, so a shopper who paid during a ten-second blip watched a QR under a
 * final-sounding refusal that would never update. The QR is still good, the
 * wait is still running, and the sentence now says both.
 *
 * The elapsed face is FUT-1170's half. The PIX wait is bounded now, and a bound
 * that stops the polling without changing what is on screen is the same silent
 * failure one screen later: a pulsing dot beside "Aguardando pagamento…" for a
 * wait that is no longer asking anything.
 */
function PixPollFooter({
  error,
  timedOut,
  onCheckAgain,
  awaiting,
}: {
  error: string | null;
  timedOut: boolean;
  onCheckAgain: () => void;
  /** What the healthy wait says: whose confirmation it is waiting for, or "Verificando…" after a copy. */
  awaiting: string;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const { settling } = useCheckoutCopy().screens;
  const panel = pixWaitPanel(settling, error, timedOut);
  if (panel) {
    // The same panel the card and wallet panes show, held to the width of the
    // copy-and-paste strip above it so the centred PIX column stays a column.
    return (
      <Box sx={{ width: "100%", maxWidth: 420 }}>
        <StalledWait
          title={panel.title}
          description={panel.description}
          onCheckAgain={onCheckAgain}
          testId={panel.testId}
          actionTestId="pix-check-again"
        />
      </Box>
    );
  }
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
      <LoadingDot />
      <Text variant="caption" size="xs" color="secondary" as="span" data-testid="pix-awaiting">
        {awaiting}
      </Text>
    </Box>
  );
}

/**
 * The words that depend on who confirms. A store-confirmed Pix must not say
 * "a confirmação é automática": nothing confirms it but the store.
 */
function pixSentences(copy: PixPaneCopy, manual: boolean): Pick<PixPaneCopy, "validUntil" | "awaiting" | "afterCopy"> {
  return (manual ? copy.manual : undefined) ?? copy;
}

/**
 * The deadline and the wait, rendered once for both layouts: narrow, two
 * centred lines under the pane; wide, one footer row under a hairline with the
 * wait on the left and the deadline on the right.
 */
function PixFooter({ deadline, children }: { deadline: string; children: JSX.Element }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        textAlign: "center",
        [PIX_WIDE]: { flexDirection: "row-reverse", justifyContent: "space-between", textAlign: "left", pt: 2.25, borderTop: "1px solid", borderColor: "divider" },
      }}
    >
      <Text variant="caption" size="xs" color="secondary" as="p" data-testid="pix-expiry" style={{ margin: 0 }}>
        {deadline}
      </Text>
      {children}
    </Box>
  );
}

/** The poll, bounded by the charge's own expiry (FUT-1170). */
function usePixPolling(order: CheckoutOrder, onResolved: (status: OrderStatus) => void, pollIntervalMs: number) {
  // Fixed once per charge (FUT-1170): the bound is a span, so recomputing it
  // every render would keep pushing the deadline out — and it is an effect
  // dependency, so it would also restart the wait on every render.
  const expiresAt = order.pix?.expiresAt;
  const maxWaitMs = useMemo(() => pixWaitMs(expiresAt), [expiresAt]);
  const polling = usePaymentPolling(order.orderId, {
    intervalMs: pollIntervalMs,
    slowAfterPolls: PIX_FAST_POLLS,
    // Never FASTER than the opening cadence: a host that opens slowly means it.
    slowIntervalMs: Math.max(pollIntervalMs, PIX_SLOW_INTERVAL_MS),
    maxWaitMs,
  });
  const { status } = polling;
  // Bubble a terminal status up once, so the parent can advance to the status step.
  useEffect(() => {
    if (status && status !== "AWAITING_PAYMENT") onResolved(status);
  }, [status, onResolved]);
  return polling;
}

function PixBody({ order, pix, poll }: { order: CheckoutOrder; pix: PixCharge; poll: ReturnType<typeof usePixPolling> }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  const stage = usePixStage();
  const [tab, setTab] = useState<PixTab>("copy");
  const { copy: writeClipboard, justCopied } = useClipboardCopy(pix.copyPaste);
  // Leaving the payment step (a method switch, a terminal status) ends the
  // after-copy face with it: the next pane starts on the code.
  const { setAfterCopy } = stage;
  useEffect(() => () => setAfterCopy(false), [setAfterCopy]);

  // The locale is the HOST's (FUT-760): it decides what a buyer reads off the
  // clock, so it travels with the sentence it feeds rather than being frozen
  // to the origin host's here.
  const time = new Date(pix.expiresAt).toLocaleTimeString(copy.expiryLocale, { hour: "2-digit", minute: "2-digit" });
  const sentences = pixSentences(copy, pix.confirmation === "MANUAL");
  const footerLine = (awaiting: string): JSX.Element => (
    <PixPollFooter error={poll.error} timedOut={poll.timedOut} onCheckAgain={poll.checkAgain} awaiting={awaiting} />
  );

  if (stage.afterCopy) {
    return (
      <PixAfterCopy
        pix={pix}
        words={sentences.afterCopy}
        totalLabel={order.totalLabel}
        deadline={time}
        justCopied={justCopied}
        onCopyAgain={() => void writeClipboard()}
        onShowQr={() => {
          setTab("qr");
          setAfterCopy(false);
        }}
        onPreferCard={stage.preferCard}
        footer={footerLine(copy.verifying)}
      />
    );
  }
  return (
    <>
      <Text variant="heading" size="md" weight="bold" as="h2" style={{ margin: 0 }}>
        {copy.heading}
      </Text>
      <PixPane
        pix={pix}
        tab={tab}
        onTab={setTab}
        onCopy={() => {
          // Only a copy the clipboard TOOK moves on: the next face opens on
          // "Código Pix copiado", and a failed write leaves the code on screen
          // to select by hand.
          void writeClipboard().then((ok) => {
            if (ok) setAfterCopy(true);
          });
        }}
      />
      <PixFooter deadline={sentences.validUntil(time)}>{footerLine(sentences.awaiting)}</PixFooter>
    </>
  );
}

export function PixView({
  order,
  onResolved,
  pollIntervalMs = 2500,
}: {
  order: CheckoutOrder;
  onResolved: (status: OrderStatus) => void;
  pollIntervalMs?: number;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  const poll = usePixPolling(order, onResolved, pollIntervalMs);
  const pix = order.pix;
  if (!pix) {
    return (
      <Text variant="body" size="sm" color="danger" as="p" data-testid="pix-missing">
        {copy.chargeMissing}
      </Text>
    );
  }
  return (
    <Box data-testid="pix-view" sx={{ ...PIX_CONTAINER, display: "flex", flexDirection: "column", gap: 2 }}>
      <PixBody order={order} pix={pix} poll={poll} />
    </Box>
  );
}

/** Small pulsing dot indicating the background poll is live. */
function LoadingDot(): JSX.Element {
  return (
    <Box
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "primary.main",
        animation: "pixPulse 1.2s ease-in-out infinite",
        "@keyframes pixPulse": {
          "0%, 100%": { opacity: 0.3 },
          "50%": { opacity: 1 },
        },
      }}
    />
  );
}
