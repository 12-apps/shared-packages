import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { createContext, useContext, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
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

/** "Escolha como pagar." and "Escolha como pagar" are the same words. */
function wordsOf(text: string): string {
  return text.trim().replace(/[\s.!?…:;]+$/u, "").toLocaleLowerCase();
}

/**
 * The reason the button is held already IS the button's own label (nothing
 * chosen: "Escolha como pagar" on the button, "Escolha como pagar." under it).
 * One message is enough: the helper is not drawn again, and the live region
 * still says it.
 */
export function repeatsLabel(reason: string | null | undefined, label: string | null | undefined): boolean {
  return Boolean(reason && label) && wordsOf(reason ?? "") === wordsOf(label ?? "");
}

/**
 * Whether the button's label is cut by its ellipsis. The button reports it, the
 * line under it reads it: a cut label always has its full words in that line,
 * so the instruction is whole somewhere (there is no hover on a phone, and no
 * tooltip on a disabled button in Firefox).
 */
const LabelCutContext = createContext<(cut: boolean) => void>(() => undefined);

/** Reports whether `node`'s text overflows it, and again whenever it is resized. */
function useLabelCut(node: React.RefObject<HTMLElement | null>, label: string): void {
  const report = useContext(LabelCutContext);
  useEffect(() => {
    const element = node.current;
    if (!element) return undefined;
    const measure = () => report(element.scrollWidth > element.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      report(false);
    };
  }, [node, label, report]);
}

/** Focus the first button under `scope` — the slot owns the element, so it is found, not referenced. */
function focusButtonIn(scope: HTMLElement | null): void {
  scope?.querySelector<HTMLButtonElement>("button")?.focus();
}

/**
 * The bar's ONE live region, always mounted: the reason the action is held,
 * drawn under it — unless it only repeats the button's own label, and that
 * label is whole (not cut), when it is announced and not drawn — or else what is under way. Out of the flow while it
 * has nothing to show: an empty row still took a gap under the button.
 */
function HeldReason({ reason, actionLabel, labelCut, live }: { reason?: string | null; actionLabel?: string | null; labelCut: boolean; live?: string | null }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const drawn = reason && (labelCut || !repeatsLabel(reason, actionLabel)) ? reason : null;
  return (
    <Box role="status" aria-live="polite" data-testid="list-bar-live" sx={drawn ? undefined : VISUALLY_HIDDEN}>
      {drawn ? (
        <Text variant="body" size="sm" color="danger" as="p" style={{ margin: 0 }} data-testid="list-blocked-reason">
          {drawn}
        </Text>
      ) : (
        <Box component="span">{live ?? reason ?? ""}</Box>
      )}
    </Box>
  );
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
export function ListBar({ summary, extras, payer, reason, actionLabel, live, children }: {
  summary?: ReactNode;
  extras?: ReactNode;
  payer?: ReactNode;
  /** Why the action is held, under it. */
  reason?: string | null;
  /** The action's own label: a reason that says the same is announced, not drawn twice. */
  actionLabel?: string | null;
  /** What the region announces when there is no reason: the bar's own sentence. */
  live?: string | null;
  /** The action, or the charge bar, or the wait. */
  children: ReactNode;
}): JSX.Element | null {
  const { ActionBar } = useCheckoutComponents();
  const column = useSummaryColumnTarget();
  const [labelCut, setLabelCut] = useState(false);
  const content = (
    <LabelCutContext.Provider value={setLabelCut}>
    <Box data-testid={column ? "list-pay-bar" : undefined} sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }}>
      {/* The context line in the secondary ink in the column, as in the bar — the column inherits whatever the host's element is inked in. */}
      {summary ? <Box data-testid="list-bar-summary" sx={{ ...NO_EMPTY_ROW, ...(column ? { color: "text.secondary" } : {}) }}>{summary}</Box> : null}
      {extras ? <Box data-testid="list-bar-extras" sx={NO_EMPTY_ROW}>{extras}</Box> : null}
      {payer}
      {children}
      <HeldReason reason={reason} actionLabel={actionLabel} labelCut={labelCut} live={live} />
    </Box>
    </LabelCutContext.Provider>
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
  const words = useRef<HTMLSpanElement | null>(null);
  useLabelCut(words, label);
  useEffect(() => {
    if (focusOnMount) focusButtonIn(scope.current);
  }, [focusOnMount]);
  return (
    <Box ref={scope} sx={{ "& button": { minHeight: (t) => t.spacing(ACTION_HEIGHT) }, "& button, & button *": { fontWeight: 600, letterSpacing: "normal" } }}>
      <Button variant="solid" color="primary" size="lg" fullWidth disabled={disabled} loading={loading} onClick={onClick} dataTestId="list-pay">
        {/* Neither the amount ("R$ / 27,00") nor the label breaks: a label too wide for the bar at
            320px is cut with an ellipsis rather than wrapped onto a second line, and is plain (the rule above
            gives label and amount one tracking). An action with no amount ("Copiar
            código Pix") is centred (C20). */}
        <Box component="span" sx={{ display: "flex", justifyContent: total ? "space-between" : "center", alignItems: "center", gap: 1, width: "100%" }}>
          <Box component="span" ref={words} title={label} sx={{ minWidth: 0, textAlign: total ? "left" : "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</Box>
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
