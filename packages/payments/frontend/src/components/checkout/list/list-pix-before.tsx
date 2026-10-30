import { Box, useTheme } from "@mui/material";
import type { JSX, KeyboardEvent, MouseEvent, ReactNode } from "react";

import { usePaymentStale } from "../cart-changed";
import { useCheckoutCopy } from "../copy-context";
import { Emphasized, PixQr, StaleVeil } from "../pix-parts";
import type { PixCharge } from "../types";
import { useCheckoutComponents } from "../ui";

import type { PaymentListMode } from "./context";

/**
 * The list's Pix BEFORE the copy (`./list-pix.tsx`): the code in a tinted
 * block that copies on a tap, how to pay with it, the QR behind its link on a
 * phone and beside the code on a computer, and the way back to the list.
 *
 * The side-by-side switch is a container query on the pane's own width, never
 * the window's (the 512px column a computer gives the checkout is still wider
 * than any phone's).
 */
const WIDE = "@container listpix (min-width: 460px)";

/** Select the code and copy it — a tap on it is the bar's button. */
function selectAll(target: HTMLElement): void {
  try {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.selectAllChildren(target);
  } catch {
    // Selecting is a courtesy; the copy below is what matters.
  }
}

function TappableCode({ pix, label, onCopy }: { pix: PixCharge; label: string; onCopy: () => void }): JSX.Element {
  const stale = usePaymentStale();
  const { Text } = useCheckoutComponents();
  const press = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    selectAll(event.currentTarget);
    onCopy();
  };
  // Under the veil the code is not a control at all — no role, no Tab stop,
  // nothing a tap does (ADR 0121: the veil covers it, so it may not be one).
  const control = stale
    ? {}
    : {
        role: "button",
        tabIndex: 0,
        "aria-label": label,
        onClick: press,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            press(event);
          }
        },
      };
  return (
    <StaleVeil stale={stale}>
      <Box
        {...control}
        data-testid="list-pix-code"
        sx={{ cursor: stale ? "default" : "pointer", bgcolor: "action.hover", borderRadius: 2, p: 1.25, wordBreak: "break-all" }}
      >
        <Text variant="code" size="xs" as="span">
          {pix.copyPaste}
        </Text>
      </Box>
    </StaleVeil>
  );
}

function TextLink({ onClick, testId, children }: { onClick: () => void; testId: string; children: ReactNode }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ alignSelf: "flex-start", ml: -1, "& button": { textDecoration: "underline", textUnderlineOffset: (t) => t.spacing(0.375), minHeight: (t) => t.spacing(5) } }}>
      <Button variant="text" color="primary" size="md" onClick={onClick} dataTestId={testId}>
        {children}
      </Button>
    </Box>
  );
}

/**
 * Where the QR sits: under its link on a phone (the code, how to pay and the
 * link first, then the QR, then the way back), beside the code on a computer,
 * where it is always open. One grid, so the QR is drawn once at either width.
 */
const BEFORE_COPY_GRID = {
  display: "grid",
  gap: 1,
  gridTemplateColumns: "minmax(0, 1fr)",
  gridTemplateAreas: '"code" "qr" "rest"',
  [WIDE]: { columnGap: 2, gridTemplateColumns: "auto minmax(0, 1fr)", gridTemplateAreas: '"qr code" "qr rest"', alignItems: "start" },
} as const;

export function BeforeCopy({ mode, pix, onCopy, onChangeMethod, footer }: {
  mode: PaymentListMode;
  pix: PixCharge;
  onCopy: () => void;
  onChangeMethod: () => void;
  footer: ReactNode;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = mode.list.copy.pixFace;
  const qrAlt = useCheckoutCopy().screens.pix.qrAlt;
  // The prototype's 150px QR, on the theme's spacing scale (the QR draws in px).
  const qrSize = Number.parseFloat(useTheme().spacing(18.75));
  const stale = usePaymentStale();
  return (
    <Box sx={{ containerType: "inline-size", containerName: "listpix" }}>
      <Box sx={BEFORE_COPY_GRID}>
        <Box sx={{ gridArea: "code", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <TappableCode pix={pix} label={copy.copyCode} onCopy={onCopy} />
          <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }} data-testid="list-pix-how">
            <Emphasized text={copy.howToPay(pix.confirmation === "MANUAL")} />
          </Text>
          <Box sx={{ [WIDE]: { display: "none" } }}>
            <TextLink onClick={() => mode.setQrOpen(!mode.qrOpen)} testId="list-pix-toggle-qr">
              {mode.qrOpen ? copy.hideQr : copy.showQr}
            </TextLink>
          </Box>
        </Box>
        <Box
          data-testid="list-pix-qr"
          sx={{ gridArea: "qr", display: mode.qrOpen ? "flex" : "none", flexWrap: "wrap", alignItems: "center", gap: 1.5, [WIDE]: { display: "block" } }}
        >
          <Box sx={{ flex: "none" }}>
            <StaleVeil stale={stale}>
              <PixQr payload={pix.copyPaste} size={qrSize} alt={qrAlt} />
            </StaleVeil>
          </Box>
          {/* Beside the QR while it has room for a few words a line, under it on the narrowest phone. */}
          <Box sx={{ flex: "1 1 auto", minWidth: 0, width: (t) => t.spacing(15), [WIDE]: { display: "none" } }}>
            <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }}>
              {copy.qrCaption}
            </Text>
          </Box>
        </Box>
        <Box sx={{ gridArea: "rest", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <TextLink onClick={onChangeMethod} testId="list-pix-change-method">
            {copy.changeMethod}
          </TextLink>
          {footer}
        </Box>
      </Box>
    </Box>
  );
}

