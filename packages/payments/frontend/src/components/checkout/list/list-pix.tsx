import { Box } from "@mui/material";
import type { JSX, KeyboardEvent, MouseEvent, ReactNode } from "react";

import { usePaymentStale } from "../cart-changed";
import { useCheckoutCopy } from "../copy-context";
import { PixAfterCopy } from "../pix-after-copy";
import { PixQr, StaleVeil } from "../pix-parts";
import type { PixAfterCopyCopy } from "../screens-copy";
import type { CheckoutOrder, PixCharge } from "../types";
import { useCheckoutComponents } from "../ui";

import type { PaymentListMode } from "./context";
import { ListBar, ActionButton, WaitingLine } from "./list-bar";

/**
 * The Pix, in the one list (FUT-3592 #3): "Gerar Pix" already created the
 * order and the code, so the pane opens on the code itself.
 *
 * Before the copy — the code in a tinted block that copies on a tap (the same
 * as the bar's "Copiar código Pix"), "Válido até …", and two text links: the
 * QR for paying from another phone, and the way back to the list. On a
 * computer the QR stands beside the code instead. After the copy — ADR 0129's
 * face, as today, with the bar saying what it is waiting for.
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
  const press = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    if (stale) return;
    selectAll(event.currentTarget);
    onCopy();
  };
  return (
    <StaleVeil stale={stale}>
      <Box
        role="button"
        tabIndex={stale ? -1 : 0}
        aria-label={label}
        data-testid="list-pix-code"
        onClick={press}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            press(event);
          }
        }}
        sx={{ cursor: "pointer", bgcolor: "action.hover", borderRadius: 2, p: 1.25, fontFamily: "monospace", fontSize: "0.75rem", lineHeight: 1.5, wordBreak: "break-all" }}
      >
        {pix.copyPaste}
      </Box>
    </StaleVeil>
  );
}

function TextLink({ onClick, testId, children }: { onClick: () => void; testId: string; children: ReactNode }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ alignSelf: "flex-start", ml: -1, "& button": { textDecoration: "underline", textUnderlineOffset: "3px" } }}>
      <Button variant="text" color="primary" size="md" onClick={onClick} dataTestId={testId}>
        {children}
      </Button>
    </Box>
  );
}

function BeforeCopy({ mode, pix, time, onCopy, onChangeMethod, footer }: {
  mode: PaymentListMode;
  pix: PixCharge;
  time: string;
  onCopy: () => void;
  onChangeMethod: () => void;
  footer: ReactNode;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = mode.list.copy.pixFace;
  const qrAlt = useCheckoutCopy().screens.pix.qrAlt;
  const stale = usePaymentStale();
  return (
    <Box sx={{ containerType: "inline-size", containerName: "listpix" }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexDirection: "column", [WIDE]: { flexDirection: "row" } }}>
        <Box data-testid="list-pix-qr" sx={{ display: mode.qrOpen ? "block" : "none", alignSelf: "center", flex: "none", [WIDE]: { display: "block", alignSelf: "flex-start" } }}>
          <StaleVeil stale={stale}>
            <PixQr payload={pix.copyPaste} size={150} alt={qrAlt} />
          </StaleVeil>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <TappableCode pix={pix} label={copy.copyCode} onCopy={onCopy} />
          <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }} data-testid="list-pix-valid">
            {copy.validUntil(time)}
          </Text>
          <Box sx={{ [WIDE]: { display: "none" } }}>
            <TextLink onClick={() => mode.setQrOpen(!mode.qrOpen)} testId="list-pix-toggle-qr">
              {mode.qrOpen ? copy.hideQr : copy.showQr}
            </TextLink>
          </Box>
          <TextLink onClick={onChangeMethod} testId="list-pix-change-method">
            {copy.changeMethod}
          </TextLink>
          {footer}
        </Box>
      </Box>
    </Box>
  );
}

interface ListPixFaceProps {
  order: CheckoutOrder;
  pix: PixCharge;
  /** The code's expiry, in the host's locale. */
  time: string;
  afterCopy: boolean;
  words: PixAfterCopyCopy;
  justCopied: boolean;
  /** Copy, then show the after-copy face. */
  onCopy: () => void;
  onCopyAgain: () => void;
  /** Back from the after-copy face to the code, QR open. */
  onShowQr: () => void;
  onPreferCard?: () => void;
  /** The poll's stalled panel, when it has one. */
  footer: ReactNode;
}

/** Both faces of the list's Pix, and the bar under them. */
export function ListPixFace(props: ListPixFaceProps & { mode: PaymentListMode }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const { mode, order, pix, afterCopy } = props;
  const copy = mode.list.copy.pixFace;
  const stale = usePaymentStale();
  return (
    <Box data-testid="list-pix" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Text variant="body" size="md" weight="bold" as="p" style={{ margin: 0 }} data-testid="list-pix-title">
        {copy.title(order.totalLabel)}
      </Text>
      {afterCopy ? (
        <PixAfterCopy
          pix={pix}
          words={props.words}
          totalLabel={order.totalLabel}
          deadline={props.time}
          justCopied={props.justCopied}
          onCopyAgain={props.onCopyAgain}
          onShowQr={() => {
            mode.setQrOpen(true);
            props.onShowQr();
          }}
          onPreferCard={props.onPreferCard}
          footer={props.footer}
        />
      ) : (
        <BeforeCopy mode={mode} pix={pix} time={props.time} onCopy={props.onCopy} onChangeMethod={mode.onLeavePix} footer={props.footer} />
      )}
      <ListBar summary={mode.list.summary} reason={mode.list.hold?.reason ?? null}>
        {/* A step the host reopened above (Endereço) holds the bar too: no copy while it is open. */}
        {mode.list.hold ? (
          <ActionButton label={mode.list.hold.action} total={null} disabled onClick={() => undefined} />
        ) : afterCopy ? (
          <WaitingLine text={copy.waiting} />
        ) : (
          <ActionButton label={copy.copyCode} total={null} disabled={stale} onClick={props.onCopy} />
        )}
      </ListBar>
    </Box>
  );
}
