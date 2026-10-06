import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { useCheckoutCopy } from "./copy-context";
import { CheckIcon, ContentCopyIcon, CreditCardIcon, QrCodeIcon, ScheduleIcon } from "./icons";
import { Emphasized, PIX_WIDE, PixQr } from "./pix-parts";
import type { PixAfterCopyCopy } from "./screens-copy";
import type { PixCharge } from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * The PIX pane after a copy (the 2026-10-06 Pix redesign): the buyer has left
 * for their bank app and comes back to a screen that says what happens next —
 * a three-step checklist with the one they are on in bold — instead of the
 * code they already have.
 *
 * Every Pix gets it; whether the BANK or the STORE confirms changes only the
 * words (`PixAfterCopyCopy`). Wide, a smaller QR stays on the right for a
 * buyer who would rather scan after all; narrow, "Ver QR code" goes back to
 * the pane on its QR tab.
 */

type StepState = "done" | "current" | "pending";

function StepMark({ state, index }: { state: StepState; index: number }): JSX.Element {
  const size = { width: 26, height: 26, [PIX_WIDE]: { width: 28, height: 28 } };
  if (state === "done") {
    return (
      <Box sx={{ ...size, flex: "none", borderRadius: "50%", bgcolor: "success.main", color: "success.contrastText", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CheckIcon sx={{ fontSize: 16 }} />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        ...size,
        flex: "none",
        boxSizing: "border-box",
        borderRadius: "50%",
        border: "2px solid",
        borderColor: state === "current" ? "primary.main" : "divider",
        color: state === "current" ? "primary.main" : "text.secondary",
        fontSize: "0.75rem",
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {index}
    </Box>
  );
}

function Step({ state, index, children }: { state: StepState; index: number; children: ReactNode }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box component="li" data-testid={`pix-after-copy-step-${index}`} data-state={state} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <StepMark state={state} index={index} />
      <Text variant="body" size="sm" weight={state === "current" ? "bold" : undefined} color={state === "current" ? undefined : "secondary"} as="span">
        {children}
      </Text>
    </Box>
  );
}

/** The checklist. Step 2's wording follows the layout (an app, or internet banking too). */
function Checklist({ words, deadline }: { words: PixAfterCopyCopy; deadline: string }): JSX.Element {
  return (
    <Box
      component="ol"
      sx={{ m: 0, p: 2, listStyle: "none", border: "1px solid", borderColor: "divider", borderRadius: 1.5, display: "flex", flexDirection: "column", gap: 1.75, [PIX_WIDE]: { py: 2.25, px: 2.5, gap: 2 } }}
    >
      <Step state="done" index={1}>{words.stepCopied}</Step>
      <Step state="current" index={2}>
        <Box component="span" sx={{ [PIX_WIDE]: { display: "none" } }}>{words.stepPay(false)}</Box>
        <Box component="span" sx={{ display: "none", [PIX_WIDE]: { display: "inline" } }}>{words.stepPay(true)}</Box>
      </Step>
      <Step state="pending" index={3}>{words.stepConfirm(deadline)}</Step>
    </Box>
  );
}

/** The clock, the title and the sentence: a centred stack narrow, a row wide. */
function Heading({ words, totalLabel }: { words: PixAfterCopyCopy; totalLabel: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.25, textAlign: "center", [PIX_WIDE]: { flexDirection: "row", gap: 2, textAlign: "left" } }}>
      <Box sx={{ flex: "none", width: 64, height: 64, borderRadius: "50%", bgcolor: "action.selected", color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", [PIX_WIDE]: { width: 56, height: 56 } }}>
        <ScheduleIcon sx={{ fontSize: 30 }} />
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {/* The screen's title outranks the checklist: 22px, 28px wide (the prototype's scale). */}
        <Box sx={{ "& > *": { fontSize: "1.375rem", lineHeight: 1.25 }, [PIX_WIDE]: { "& > *": { fontSize: "1.75rem" } } }}>
          <Text variant="heading" size="md" weight="bold" as="h2" style={{ margin: 0 }} data-testid="pix-after-copy-title">
            {words.title}
          </Text>
        </Box>
        <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }}>
          <Box component="span" sx={{ [PIX_WIDE]: { display: "none" } }}>{words.body(totalLabel, false)}</Box>
          <Box component="span" sx={{ display: "none", [PIX_WIDE]: { display: "inline" } }}>
            <Emphasized text={words.body(totalLabel, true)} />
          </Box>
        </Text>
      </Box>
    </Box>
  );
}

export interface PixAfterCopyProps {
  pix: PixCharge;
  words: PixAfterCopyCopy;
  totalLabel: string;
  deadline: string;
  justCopied: boolean;
  onCopyAgain: () => void;
  onShowQr: () => void;
  onPreferCard?: () => void;
  /** The poll's line ("Verificando…", or the stalled panel that replaces it). */
  footer: ReactNode;
}

/** The narrow layout's two secondaries side by side; wide, the card link joins the row. */
function Actions({ justCopied, onCopyAgain, onShowQr, onPreferCard }: Pick<PixAfterCopyProps, "justCopied" | "onCopyAgain" | "onShowQr" | "onPreferCard">): JSX.Element {
  const { Button } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25, "& button": { minHeight: 48, height: "100%" }, [PIX_WIDE]: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, "& button": { height: "auto" } } }}>
      {/* Narrow, a grid cell; wide, its own width beside the link (the prototype's row). */}
      <Box sx={{ minWidth: 0, [PIX_WIDE]: { flex: "none", "& > *": { width: "auto" } } }}>
        <Button variant="outline" color="neutral" size="md" fullWidth icon={<ContentCopyIcon fontSize="small" />} onClick={onCopyAgain} dataTestId="pix-copy-again">
          {justCopied ? copy.copiedAction : copy.copyAgainAction}
        </Button>
      </Box>
      <Box sx={{ display: "contents", [PIX_WIDE]: { display: "none" } }}>
        <Button variant="outline" color="neutral" size="md" fullWidth icon={<QrCodeIcon fontSize="small" />} onClick={onShowQr} dataTestId="pix-show-qr">
          {copy.showQrAction}
        </Button>
      </Box>
      {onPreferCard ? (
        <Box sx={{ display: "none", [PIX_WIDE]: { display: "block" } }}>
          <Button variant="text" color="primary" size="md" icon={<CreditCardIcon fontSize="small" />} onClick={onPreferCard} dataTestId="pix-prefer-card-wide">
            {copy.preferCardAction}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

export function PixAfterCopy(props: PixAfterCopyProps): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  const { pix, words, totalLabel, deadline, onPreferCard, footer } = props;
  return (
    <Box data-testid="pix-after-copy" sx={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-start" }}>
      <Box sx={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Heading words={words} totalLabel={totalLabel} />
        <Checklist words={words} deadline={deadline} />
        <Actions {...props} />
        {footer}
        {onPreferCard ? (
          <Box sx={{ display: "flex", justifyContent: "center", [PIX_WIDE]: { display: "none" } }}>
            <Button variant="text" color="primary" size="md" icon={<CreditCardIcon fontSize="small" />} onClick={onPreferCard} dataTestId="pix-prefer-card">
              {copy.preferCardAction}
            </Button>
          </Box>
        ) : null}
      </Box>
      <Box sx={{ display: "none", [PIX_WIDE]: { display: "flex" }, flex: "1 1 240px", minWidth: 0, flexDirection: "column", alignItems: "center", gap: 1.5, p: 2.5, borderRadius: 1.75, border: "1px solid", borderColor: "divider", bgcolor: "action.hover" }}>
        <Text variant="body" size="xs" weight="bold" color="secondary" as="p" style={{ margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {copy.notPaidYet}
        </Text>
        <PixQr payload={pix.copyPaste} size={168} alt={copy.qrAlt} />
        <Text variant="body" size="xs" color="secondary" as="p" style={{ margin: 0, textAlign: "center" }}>
          {copy.scanFromPhone}
        </Text>
      </Box>
    </Box>
  );
}
