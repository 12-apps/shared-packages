import { Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { JSX, ReactNode } from "react";

import type { PaymentShortfall, PaymentStockGone } from "@12-apps/payments-backend";

import { CheckCircleOutlineIcon, ErrorOutlineIcon, ScheduleIcon } from "./icons";
import { Fact } from "./payment-status-parts";
import type { ShortPaymentCopy } from "./short-copy";
import { useCheckoutComponents } from "./ui";
import type { StatusOutcomeCopy } from "./view-copy";

/**
 * The confirmation screen when money ARRIVED and the payable is still not
 * settled (FUT-612, option C) — a capture short of the total, and a full one
 * the store could not fulfil.
 *
 * Rendered only on a fact the SERVER states (`shortfall`, `stockGone`): the
 * client never infers either from amounts, so a declined card can never land
 * here, and a host that sends neither keeps today's screen byte for byte.
 *
 * The approved screen's grammar, in this package's tokens: an amber headline
 * (never red: nothing failed that the buyer did), what is missing as the
 * heading, a receipt of total / paid / missing, and two actions — pay only the
 * difference, or cancel and have the capture returned. Both are the host's to
 * bind; an action the host did not bind is not offered.
 */

type Tone = "success" | "warning";
type Glyph = "alert" | "clock" | "check";

const GLYPH: Record<Glyph, typeof ScheduleIcon> = {
  alert: ErrorOutlineIcon,
  clock: ScheduleIcon,
  check: CheckCircleOutlineIcon,
};

const TONE_COLOR: Record<Tone, string> = { success: "success.main", warning: "warning.main" };

/** The approved screen's chip: the glyph in a disc of its own tone, faintly tinted. */
const CHIP_SIZE = 7;
const CHIP_TINT = 0.14;

/** Under this the two actions stand one under the other; above it they share a row. */
const ACTION_MIN_PX = 224;

/** Which face a shortfall shows, from the server's facts alone. */
type ShortFace = "OPEN" | "REVIEWING" | "REFUNDED" | "REFUND_PENDING" | "SETTLED";

function shortFaceOf(shortfall: PaymentShortfall): ShortFace {
  if (shortfall.resolution !== null) return shortfall.resolution;
  // Nothing left to ask of the buyer — a person moved the total under it —
  // so no "pay" is offered: the store is checking (contract C13).
  return shortfall.dueCents > 0 ? "OPEN" : "REVIEWING";
}

function Headline({ outcome, tone, glyph, testId }: { outcome: StatusOutcomeCopy; tone: Tone; glyph: Glyph; testId: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const Icon = GLYPH[glyph];
  return (
    <Box
      data-testid={testId}
      sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, textAlign: "center" }}
    >
      <Box
        aria-hidden="true"
        data-testid="payment-short-chip"
        sx={{
          width: (theme) => theme.spacing(CHIP_SIZE),
          height: (theme) => theme.spacing(CHIP_SIZE),
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: TONE_COLOR[tone],
          bgcolor: (theme) => alpha(theme.palette[tone].main, CHIP_TINT),
        }}
      >
        <Icon fontSize="large" />
      </Box>
      {/* The approved headline is a step above the slot's largest text: the
          theme's own h6 (1.25rem at MUI's defaults), so a host scale moves it. */}
      <Box component="h2" sx={{ typography: "h6", fontWeight: "fontWeightBold", m: 0 }}>
        {outcome.heading}
      </Box>
      <Text variant="body" size="sm" as="p" style={{ opacity: 0.75 }}>
        {outcome.support}
      </Text>
    </Box>
  );
}

/**
 * The two actions: side by side when both fit at {@link ACTION_MIN_PX} each (a
 * computer), each across the row when they do not (a phone, 320 px).
 */
function ActionRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box
      data-testid="payment-short-actions"
      sx={{ display: "flex", flexWrap: "wrap", gap: 1, "& > *": { flex: (theme) => `1 1 ${theme.typography.pxToRem(ACTION_MIN_PX)}`, minWidth: 0 } }}
    >
      {children}
    </Box>
  );
}

/** Total, paid, and what is still missing — the paid row says how it was paid. */
function ShortReceipt({ copy, shortfall }: { copy: ShortPaymentCopy; shortfall: PaymentShortfall }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      data-testid="payment-short-receipt"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 2,
        borderRadius: 2,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Fact label={copy.totalLabel} value={copy.money(shortfall.totalCents)} testId="payment-short-total" />
      <Fact
        label={copy.paidLabel(copy.methodNames[shortfall.paidMethod])}
        value={`− ${copy.money(shortfall.paidCents)}`}
        testId="payment-short-paid"
      />
      <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1, display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Text variant="body" size="sm" weight="bold" as="span">
          {copy.dueLabel}
        </Text>
        <Text variant="body" size="sm" weight="bold" as="span" data-testid="payment-short-due">
          {copy.money(shortfall.dueCents)}
        </Text>
      </Box>
    </Box>
  );
}

interface ShortOutcomeProps {
  copy: ShortPaymentCopy;
  shortfall: PaymentShortfall;
  /** Pay only what is missing — the host opens its method sheet for the balance. */
  onPayDifference?: () => void;
  /** Cancel and have the capture returned (decision 2: refunded at once by the provider). */
  onRequestRefund?: () => void;
  /** An act is in flight: both actions stand down, the one running shows it. */
  busy?: "pay" | "refund" | null;
  /** The way out once the short is resolved, worded by the host. */
  backAction: string;
  onBackToMenu: () => void;
}

/** The face's headline and tone; the OPEN face is the approved screen's. */
function resolvedOutcome(face: Exclude<ShortFace, "OPEN">, copy: ShortPaymentCopy, paid: string): { outcome: StatusOutcomeCopy; tone: Tone } {
  if (face === "REFUNDED") return { outcome: copy.refunded({ paid }), tone: "success" };
  if (face === "SETTLED") return { outcome: copy.settled, tone: "success" };
  if (face === "REFUND_PENDING") return { outcome: copy.refundPending({ paid }), tone: "warning" };
  return { outcome: copy.reviewing({ paid }), tone: "warning" };
}

export function ShortOutcome(props: ShortOutcomeProps): JSX.Element {
  const { copy, shortfall } = props;
  const { Button } = useCheckoutComponents();
  const face = shortFaceOf(shortfall);
  const paid = copy.money(shortfall.paidCents);
  const due = copy.money(shortfall.dueCents);

  if (face !== "OPEN") {
    const { outcome, tone } = resolvedOutcome(face, copy, paid);
    // A resolved short has its answer: the way out is all that is left. A
    // face still waiting on the store offers nothing to press.
    const done = face === "REFUNDED" || face === "SETTLED";
    return (
      <Box data-testid="payment-short-resolved" data-face={face} sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Headline
          outcome={outcome}
          tone={tone}
          glyph={tone === "success" ? "check" : "clock"}
          testId={`payment-short-${face.toLowerCase().replace("_", "-")}`}
        />
        {done ? (
          <Button variant="outline" color="neutral" size="lg" onClick={props.onBackToMenu} dataTestId="payment-back-to-menu">
            {props.backAction}
          </Button>
        ) : null}
      </Box>
    );
  }

  const busy = props.busy ?? null;
  return (
    <Box data-testid="payment-short-open" sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Headline
        outcome={{ heading: copy.heading({ due }), support: copy.support({ paid, total: copy.money(shortfall.totalCents) }) }}
        tone="warning"
        glyph="alert"
        testId="payment-short"
      />
      <ShortReceipt copy={copy} shortfall={shortfall} />
      <ActionRow>
        {props.onPayDifference ? (
          <Button
            variant="solid"
            color="primary"
            size="lg"
            onClick={props.onPayDifference}
            disabled={busy !== null}
            loading={busy === "pay"}
            fullWidth
            dataTestId="payment-short-pay"
          >
            {copy.payAction({ due })}
          </Button>
        ) : null}
        {props.onRequestRefund ? (
          <Button
            variant="outline"
            color="primary"
            size="lg"
            onClick={props.onRequestRefund}
            disabled={busy !== null}
            loading={busy === "refund"}
            fullWidth
            dataTestId="payment-short-refund"
          >
            {copy.refundAction({ paid })}
          </Button>
        ) : null}
      </ActionRow>
    </Box>
  );
}

/**
 * The whole amount arrived and an item ran out (decision 3): its own notice,
 * and NO action. The store confirms the order or returns the money, and the
 * buyer is told either way; a "pay" here would ask for money twice, and a
 * "refund" would race a store about to restock and confirm.
 */
export function StockGoneNotice({ copy, stockGone }: { copy: ShortPaymentCopy; stockGone: PaymentStockGone }): JSX.Element {
  const received = copy.money(stockGone.receivedCents);
  // The names exactly as the host sent them; none at all is its own sentence
  // (a product that vanished, a stock race the host could not attribute).
  const names = stockGone.missing.filter((name) => name.trim() !== "");
  const outcome =
    names.length === 0
      ? copy.stockGoneUnnamed({ received })
      : copy.stockGone({ received, missing: copy.joinMissing(names), count: names.length });
  return <Headline outcome={outcome} tone="warning" glyph="clock" testId="payment-stock-gone" />;
}
