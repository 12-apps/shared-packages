import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { useEffect, useRef, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useCheckoutComponents } from "../ui";

import { useSummaryColumnTarget } from "./summary-column";
import { CHARGE_WINDOW_MS } from "./use-list-charge";

/** The prototype's 52px action and 44px secondary, on the theme's spacing scale. */
const ACTION_HEIGHT = 6.5;
const SECONDARY_HEIGHT = 5.5;

/** A block the host handed that draws nothing takes no row, and so no gap (FUT-3711). */
const NO_EMPTY_ROW = { "&:empty": { display: "none" } } as const;

/** Read by a screen reader, drawn nowhere. */
const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** Focus the first button under `scope` — the slot owns the element, so it is found, not referenced. */
function focusButtonIn(scope: HTMLElement | null): void {
  scope?.querySelector<HTMLButtonElement>("button")?.focus();
}

/**
 * The one list's bar (FUT-3591 #7, M12), top to bottom: the host's line
 * (items and delivery fee), the host's online-only extras (store credit), who
 * is paying, the ONE action — or what replaced it — and why it is held.
 *
 * Drawn through the host's `ActionBar` slot, which is what pins it to the
 * bottom of the screen: the storefront passes its sticky action bar. On a
 * computer (FUT-3685, L4) the same content goes into the "Resumo do pedido"
 * column instead, and there is no bar at the bottom.
 *
 * ONE live region, always mounted, says what changes under the button — the
 * reason it is held, the charge under way, the wait — because a region that
 * mounts with its text already in it is announced by nobody.
 */
export function ListBar({ summary, extras, payer, reason, live, children }: {
  summary?: ReactNode;
  extras?: ReactNode;
  payer?: ReactNode;
  /** Why the action is held, under it. */
  reason?: string | null;
  /** What the region announces when there is no reason: the bar's own sentence. */
  live?: string | null;
  /** The action, or the charge bar, or the wait. */
  children: ReactNode;
}): JSX.Element | null {
  const { ActionBar, Text } = useCheckoutComponents();
  const column = useSummaryColumnTarget();
  const content = (
    <Box data-testid={column ? "list-pay-bar" : undefined} sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }}>
      {/* The context line in the secondary ink in the column, as in the bar — the column inherits whatever the host's element is inked in. */}
      {summary ? <Box data-testid="list-bar-summary" sx={{ ...NO_EMPTY_ROW, ...(column ? { color: "text.secondary" } : {}) }}>{summary}</Box> : null}
      {extras ? <Box data-testid="list-bar-extras" sx={NO_EMPTY_ROW}>{extras}</Box> : null}
      {payer}
      {children}
      {/* Out of the flow while it has nothing to show: an empty row still took a gap under the button. */}
      <Box role="status" aria-live="polite" data-testid="list-bar-live" sx={reason ? undefined : VISUALLY_HIDDEN}>
        {reason ? (
          <Text variant="body" size="sm" color="danger" as="p" style={{ margin: 0 }} data-testid="list-blocked-reason">
            {reason}
          </Text>
        ) : (
          <Box component="span">{live ?? ""}</Box>
        )}
      </Box>
    </Box>
  );
  if (column) return column.element ? createPortal(content, column.element) : null;
  return <ActionBar dataTestId="list-pay-bar">{content}</ActionBar>;
}

/** "Pagar" on the left, "R$ 22,00" on the right — the prototype's 52px bar of a button. */
export function ActionButton({ label, total, disabled, loading, onClick, focusOnMount = false }: {
  label: string;
  total: string | null;
  disabled: boolean;
  loading?: boolean;
  onClick: () => void;
  /** Take the focus as it appears — back from a cancelled charge, where the focus was on Cancelar. */
  focusOnMount?: boolean;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  const scope = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusOnMount) focusButtonIn(scope.current);
  }, [focusOnMount]);
  return (
    <Box ref={scope} sx={{ "& button": { minHeight: (t) => t.spacing(ACTION_HEIGHT) }, "& button, & button *": { fontWeight: 600 } }}>
      <Button variant="solid" color="primary" size="lg" fullWidth disabled={disabled} loading={loading} onClick={onClick} dataTestId="list-pay">
        {/* The amount never breaks ("R$ / 27,00"); the label may wrap, at the left. An action with
            no amount ("Copiar código Pix") is centred (C20). */}
        <Box component="span" sx={{ display: "flex", justifyContent: total ? "space-between" : "center", alignItems: "center", gap: 1, width: "100%" }}>
          <Box component="span" sx={{ minWidth: 0, textAlign: total ? "left" : "center" }}>{label}</Box>
          {total ? <Box component="span" sx={{ flex: "none", whiteSpace: "nowrap" }}>{total}</Box> : null}
        </Box>
      </Button>
    </Box>
  );
}

const fill = keyframes`from { width: 0; } to { width: 100%; }`;

/**
 * The card's 5-second bar, in the button's own place (FUT-3592 #2): the
 * sentence in white on the primary colour, a darker fill growing left to
 * right, and "Cancelar" under it while there is still nothing sent — which
 * takes the focus as it appears, since the button that had it is gone. `full`
 * draws it filled, with no Cancelar — the charge is on its way.
 */
export function ChargeBar({ text, full, cancelLabel, onCancel }: {
  text: string;
  full: boolean;
  cancelLabel: string;
  onCancel: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  const cancelScope = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!full) focusButtonIn(cancelScope.current);
  }, [full]);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        data-testid="list-charge-bar"
        data-full={full ? "true" : "false"}
        // White on the primary's DARK shade, and on a darker fill still, in
        // either theme: `primary.contrastText` turns dark in a dark theme and
        // falls under 4.5:1 on the fill (E13 says white).
        sx={{ position: "relative", minHeight: (t) => t.spacing(ACTION_HEIGHT), borderRadius: 2, bgcolor: "primary.dark", overflow: "hidden", display: "flex", alignItems: "center", px: 2.25 }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            insetBlock: 0,
            left: 0,
            bgcolor: "common.black",
            opacity: 0.3,
            width: full ? "100%" : 0,
            animation: full ? "none" : `${fill} ${CHARGE_WINDOW_MS}ms linear forwards`,
          }}
        />
        {/* One line, whatever the column's width: a sentence that wrapped inside the
            52px bar ran over its edges (FUT-3685 review). The live region reads it whole. */}
        <Box component="span" sx={{ position: "relative", minWidth: 0, color: "common.white", typography: "body1", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {text}
        </Box>
      </Box>
      {full ? null : (
        <Box ref={cancelScope} sx={{ "& button": { minHeight: (t) => t.spacing(SECONDARY_HEIGHT) } }}>
          <Button variant="outline" color="primary" size="lg" fullWidth onClick={onCancel} dataTestId="list-charge-cancel">
            {cancelLabel}
          </Button>
        </Box>
      )}
    </Box>
  );
}

/** A muted, inert line in the action's place — "Aguardando o pagamento do Pix…" (the bar's live region says it). */
export function WaitingLine({ text }: { text: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      data-testid="list-waiting"
      sx={{ minHeight: (t) => t.spacing(SECONDARY_HEIGHT), borderRadius: 2, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", px: 1 }}
    >
      <Text variant="body" size="sm" color="secondary" as="span">
        {text}
      </Text>
    </Box>
  );
}
