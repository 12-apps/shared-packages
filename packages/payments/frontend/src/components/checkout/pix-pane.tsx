import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { usePaymentStale } from "./cart-changed";
import { useCheckoutCopy } from "./copy-context";
import { ContentCopyIcon } from "./icons";
import { StickyPayBar, useCheckoutLayout } from "./payment-step-layout";
import { Emphasized, PIX_WIDE, PixQr, StaleVeil } from "./pix-parts";
import type { PixCharge } from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * The PIX pane before a copy (the 2026-10-06 Pix redesign, laid out again by
 * the 2026-10-11 Pagamento redesign, FUT-3525).
 *
 * Narrow — a phone — the code and its button come first and the QR follows,
 * "Ou pague de outro aparelho": the buyer pays on the phone they are holding
 * and cannot scan a QR drawn on that same screen. Wide — a computer — the two
 * stand side by side, the QR on the left. The Copia/QR tabs this replaced hid
 * the QR behind a tap the phone's own buyer never needed.
 *
 * Both panels are always mounted and the switch is CSS (`PIX_WIDE`), so the
 * layout needs no measurement: the first paint is already right.
 */

/** A narrow-only element: shown under the container query's threshold. */
const NARROW_ONLY = { [PIX_WIDE]: { display: "none" } } as const;

/** A wide-only element. */
function wideOnly(display: string) {
  return { display: "none", [PIX_WIDE]: { display } } as const;
}

/** The small capitals over each column. Uppercase by CSS only. */
function ColumnHeading({
  children,
  center,
  sx,
}: {
  children: ReactNode;
  center?: boolean;
  sx?: object;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ textAlign: center ? "center" : "left", ...sx }}>
      <Text
        variant="body"
        size="xs"
        weight="bold"
        color="secondary"
        as="p"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          margin: 0,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

function QrPanel({ pix }: { pix: PixCharge }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  const stale = usePaymentStale();
  return (
    <Box
      data-testid="pix-qr-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1.25,
        minWidth: 0,
        textAlign: "center",
        pt: 2,
        borderTop: "1px solid",
        borderColor: "divider",
        [PIX_WIDE]: {
          gap: 1.75,
          p: 3,
          borderTop: "1px solid",
          borderRadius: 1.75,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        },
      }}
    >
      <ColumnHeading center sx={NARROW_ONLY}>
        {copy.otherDeviceHeading}
      </ColumnHeading>
      <ColumnHeading center sx={wideOnly("block")}>
        {copy.qrHeading}
      </ColumnHeading>
      <Box
        sx={{
          "& svg": { width: 168, height: 168 },
          [PIX_WIDE]: { "& svg": { width: 232, height: 232 } },
        }}
      >
        <StaleVeil stale={stale}>
          <PixQr
            payload={pix.copyPaste}
            size={232}
            alt={copy.qrAlt}
            testId="pix-qr"
          />
        </StaleVeil>
      </Box>
      <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0, maxWidth: 280 }}>
        <Box component="span" sx={NARROW_ONLY}>{copy.qrTabCaption}</Box>
        <Box component="span" sx={wideOnly("inline")}>
          <Emphasized text={copy.qrInstructions} />
        </Box>
      </Text>
    </Box>
  );
}

/**
 * The one action on the pane: the prototype's 56px bar (52 wide), whatever
 * the host's lg is — and on the phone's Pagamento step, the sticky pay bar's
 * button (FUT-3525).
 */
function CopyButton({ onCopy }: { onCopy: () => void }): JSX.Element {
  const { Button } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  // A changed cart makes this code the OLD order's (FUT-3535): nothing to copy
  // until the step's "Atualizar pagamento" brings a new one.
  const stale = usePaymentStale();
  return (
    <StickyPayBar>
      <Box
        sx={{
          "& > *": { minHeight: 56 },
          "& > *, & > * *": { fontWeight: 700 },
          [PIX_WIDE]: { "& > *": { minHeight: 52 } },
        }}
      >
        <Button
          variant="solid"
          color="primary"
          size="lg"
          fullWidth
          icon={<ContentCopyIcon fontSize="small" />}
          onClick={onCopy}
          disabled={stale}
          dataTestId="pix-copy"
        >
          {copy.copyAction}
        </Button>
      </Box>
    </StickyPayBar>
  );
}

function CopyPanel({
  pix,
  onCopy,
  inPanel,
}: {
  pix: PixCharge;
  onCopy: () => void;
  /** False when the phone's pay bar carries the button, at the pane's foot. */
  inPanel: boolean;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  const stale = usePaymentStale();
  return (
    <Box
      data-testid="pix-copy-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.75,
        minWidth: 0,
        [PIX_WIDE]: { justifyContent: "center" },
      }}
    >
      <ColumnHeading>{copy.copyPasteHeading}</ColumnHeading>
      {/*
        The box IS the code's frame, so whatever the host draws for inline code
        (a tinted chip, its own border and padding) is undone inside it:
        otherwise a wrapped code reads as a box inside a box.
      */}
      <StaleVeil stale={stale}>
        <Box
          sx={{
            px: 2,
            py: 1.5,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            bgcolor: "action.hover",
            "&& > *": { bgcolor: "transparent", border: 0, borderRadius: 0, p: 0 },
          }}
        >
          <Text variant="code" size="xs" as="p" data-testid="pix-code" style={{ margin: 0, wordBreak: "break-all", lineHeight: 1.55 }}>
            {pix.copyPaste}
          </Text>
        </Box>
      </StaleVeil>
      {inPanel ? <CopyButton onCopy={onCopy} /> : null}
      <Text
        variant="body"
        size="sm"
        color="secondary"
        as="p"
        style={{ margin: 0 }}
      >
        <Box component="span" sx={{ display: "block", ...NARROW_ONLY }}>
          <Emphasized text={copy.copyPasteHint} />
        </Box>
        <Box component="span" sx={wideOnly("block")}>
          <Emphasized text={copy.internetBankingHint} />
        </Box>
      </Text>
    </Box>
  );
}

/**
 * The pane itself. Narrow, the code comes first — the buyer pays on the phone
 * they are holding and cannot scan a QR drawn on that same screen — and the
 * QR follows under a hairline, for paying from another device. Wide, the two
 * stand side by side: the QR for the phone in the buyer's hand, the code for
 * their internet banking.
 */
export function PixPane({
  pix,
  onCopy,
}: {
  pix: PixCharge;
  onCopy: () => void;
}): JSX.Element {
  // The phone's Pagamento step pins the button to the bottom of the screen
  // (FUT-3525), so it goes LAST in the pane — under the QR — where a sticky
  // bar rests when the page is scrolled to its end.
  const layout = useCheckoutLayout();
  const barAtFoot = layout !== null && !layout.wide;
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2.5,
        [PIX_WIDE]: {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 4,
          alignItems: "stretch",
        },
      }}
    >
      <Box sx={{ minWidth: 0, [PIX_WIDE]: { order: 2 } }}>
        <CopyPanel pix={pix} onCopy={onCopy} inPanel={!barAtFoot} />
      </Box>
      <Box
        sx={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          [PIX_WIDE]: { order: 1 },
        }}
      >
        <QrPanel pix={pix} />
      </Box>
      {barAtFoot ? <CopyButton onCopy={onCopy} /> : null}
    </Box>
  );
}
