import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import type { JSX, ReactNode } from "react";

import { useCheckoutComponents } from "../ui";

import { CHARGE_WINDOW_MS } from "./use-list-charge";

/**
 * The one list's bar (FUT-3591 #7, M12), top to bottom: the host's line
 * (items and delivery fee), the host's online-only extras (store credit), who
 * is paying, the ONE action — or what replaced it — and why it is held.
 *
 * Drawn through the host's `ActionBar` slot, which is what pins it to the
 * bottom of the screen: the storefront passes its sticky action bar.
 */
export function ListBar({ summary, extras, payer, reason, children }: {
  summary?: ReactNode;
  extras?: ReactNode;
  payer?: ReactNode;
  /** Why the action is held, under it. */
  reason?: string | null;
  /** The action, or the charge bar, or the wait. */
  children: ReactNode;
}): JSX.Element {
  const { ActionBar, Text } = useCheckoutComponents();
  return (
    <ActionBar dataTestId="list-pay-bar">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }}>
        {summary ? <Box data-testid="list-bar-summary">{summary}</Box> : null}
        {extras ? <Box data-testid="list-bar-extras">{extras}</Box> : null}
        {payer}
        {children}
        {reason ? (
          <Text variant="caption" size="sm" color="danger" as="p" style={{ margin: 0 }} data-testid="list-blocked-reason">
            {reason}
          </Text>
        ) : null}
      </Box>
    </ActionBar>
  );
}

/** "Pagar" on the left, "R$ 22,00" on the right — the prototype's 52px bar of a button. */
export function ActionButton({ label, total, disabled, loading, onClick }: {
  label: string;
  total: string | null;
  disabled: boolean;
  loading?: boolean;
  onClick: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ "& button": { minHeight: 52 }, "& button, & button *": { fontWeight: 600 } }}>
      <Button variant="solid" color="primary" size="lg" fullWidth disabled={disabled} loading={loading} onClick={onClick} dataTestId="list-pay">
        <Box component="span" sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, width: "100%" }}>
          <span>{label}</span>
          {total ? <span>{total}</span> : null}
        </Box>
      </Button>
    </Box>
  );
}

const fill = keyframes`from { width: 0; } to { width: 100%; }`;

/**
 * The card's 5-second bar, in the button's own place (FUT-3592 #2): the
 * sentence in white on the primary colour, a darker fill growing left to
 * right, and "Cancelar" under it while there is still nothing sent. `full`
 * draws it filled, with no Cancelar — the charge is on its way.
 */
export function ChargeBar({ text, full, cancelLabel, onCancel }: {
  text: string;
  full: boolean;
  cancelLabel: string;
  onCancel: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        role="status"
        data-testid="list-charge-bar"
        data-full={full ? "true" : "false"}
        sx={{ position: "relative", minHeight: 52, borderRadius: 2, bgcolor: "primary.main", overflow: "hidden", display: "flex", alignItems: "center", px: 2.25 }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            insetBlock: 0,
            left: 0,
            bgcolor: "primary.dark",
            width: full ? "100%" : 0,
            animation: full ? "none" : `${fill} ${CHARGE_WINDOW_MS}ms linear forwards`,
          }}
        />
        <Box component="span" sx={{ position: "relative", color: "primary.contrastText", fontWeight: 600, typography: "body1" }}>
          {text}
        </Box>
      </Box>
      {full ? null : (
        <Button variant="outline" color="primary" size="lg" fullWidth onClick={onCancel} dataTestId="list-charge-cancel">
          {cancelLabel}
        </Button>
      )}
    </Box>
  );
}

/** A muted, inert line in the action's place — "Aguardando o pagamento do Pix…". */
export function WaitingLine({ text }: { text: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      role="status"
      data-testid="list-waiting"
      sx={{ minHeight: 44, borderRadius: 2, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", px: 1 }}
    >
      <Text variant="body" size="sm" color="secondary" as="span">
        {text}
      </Text>
    </Box>
  );
}
