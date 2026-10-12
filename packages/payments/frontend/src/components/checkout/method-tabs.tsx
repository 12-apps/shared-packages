import { Box } from "@mui/material";
import type { JSX, KeyboardEvent } from "react";

import { useCheckoutCopy } from "./copy-context";
import { CreditCardIcon, PixIcon } from "./icons";
import type { PaymentMethod } from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * The Pagamento step's method selector as TABS (FUT-3525): folder tabs over
 * the payment panel on a computer, a pill with two equal segments on a phone.
 *
 * Tabs rather than the radio tiles of {@link MethodPicker} because what the
 * choice changes is the panel right under it — the Pix pane or the card form
 * — and the folder shape draws exactly that: the chosen tab opens into its
 * panel. Pix and Cartão are always the same width.
 *
 * Everything else is the tiles' behaviour, kept: selecting raises the order
 * (the step's auto-raise), a store without a card path disables that tab and
 * says why under it, and the test ids are `checkout-method-<METHOD>`.
 */

type MethodTabsShape = "folder" | "pill";

interface MethodTab {
  value: PaymentMethod;
  label: string;
  icon: JSX.Element;
}

/**
 * The DOM id of a method's tab, which its panel names in `aria-labelledby`.
 * Built on the step's own `useId`, so two flows on one page (a stories grid,
 * a host's preview) never share one.
 */
export function methodTabId(idBase: string, method: PaymentMethod): string {
  return `${idBase}-method-tab-${method}`;
}

/** The DOM id of the panel every method tab controls. */
export function methodPanelId(idBase: string): string {
  return `${idBase}-method-panel`;
}

/** What a tab's label is drawn in: muted when it cannot be chosen, the brand colour when it is. */
function tabColor(selected: boolean, unavailable: boolean): string {
  if (unavailable) return "text.disabled";
  return selected ? "primary.main" : "text.primary";
}

const TAB_COMMON = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 1.25,
  font: "inherit",
  fontWeight: 700,
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
} as const;

/** The phone's segment: half of a pill, raised when chosen. */
function pillSx(selected: boolean) {
  return {
    flex: 1,
    minHeight: 48,
    border: 0,
    borderRadius: 999,
    bgcolor: selected ? "background.paper" : "transparent",
    boxShadow: selected ? 1 : "none",
  } as const;
}

/** The computer's folder tab: open at the bottom into the panel when chosen. */
function folderSx(selected: boolean, unavailable: boolean) {
  return {
    flex: "0 1 180px",
    minWidth: 0,
    minHeight: 52,
    px: 3,
    mb: "-1px",
    border: "1px solid",
    borderColor: "divider",
    borderTopWidth: selected ? 4 : 1,
    borderTopColor: selected ? "primary.main" : "divider",
    borderBottomColor: selected ? "background.paper" : "divider",
    borderRadius: "8px 8px 0 0",
    bgcolor: selected ? "background.paper" : "action.hover",
    "&:hover": unavailable || selected ? {} : { bgcolor: "action.selected" },
  } as const;
}

function tabSx(shape: MethodTabsShape, selected: boolean, unavailable: boolean) {
  const state = {
    color: tabColor(selected, unavailable),
    cursor: unavailable ? "not-allowed" : "pointer",
    opacity: unavailable ? 0.6 : 1,
  };
  const own = shape === "pill" ? pillSx(selected) : folderSx(selected, unavailable);
  return { ...TAB_COMMON, ...state, ...own };
}

function listSx(shape: MethodTabsShape) {
  if (shape === "pill") {
    return {
      display: "flex",
      p: 0.5,
      gap: 0.5,
      bgcolor: "action.hover",
      borderRadius: 999,
    } as const;
  }
  return {
    display: "flex",
    gap: 0.75,
    pl: 0.25,
    borderBottom: "1px solid",
    borderColor: "divider",
  } as const;
}

/** Where each key moves from position `at` among `count` enabled tabs (the ARIA tabs pattern). */
const KEY_STEPS: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

/** ←/→ move between the enabled tabs and select; Home and End jump. */
function nextMethod(key: string, enabled: PaymentMethod[], current: PaymentMethod | null): PaymentMethod | null {
  const step = KEY_STEPS[key];
  if (!step || enabled.length === 0) return null;
  const at = current ? enabled.indexOf(current) : -1;
  return enabled[step(at, enabled.length)] ?? null;
}

/** One tab. A store that cannot take a card keeps the tab, disabled, with the reason in its name. */
function MethodTabButton({
  tab,
  idBase,
  shape,
  selected,
  unavailable,
  focusable,
  reason,
  onSelect,
}: {
  tab: MethodTab;
  idBase: string;
  shape: MethodTabsShape;
  selected: boolean;
  unavailable: boolean;
  focusable: boolean;
  reason: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      role="tab"
      id={methodTabId(idBase, tab.value)}
      aria-selected={selected}
      aria-controls={methodPanelId(idBase)}
      aria-label={unavailable ? `${tab.label}, ${reason}` : undefined}
      aria-disabled={unavailable || undefined}
      tabIndex={focusable ? 0 : -1}
      data-testid={`checkout-method-${tab.value}`}
      onClick={unavailable ? undefined : onSelect}
      sx={tabSx(shape, selected, unavailable)}
    >
      <Box sx={{ display: "flex" }}>{tab.icon}</Box>
      {tab.label}
    </Box>
  );
}

/** Why the card tab is disabled, under the tabs (a screen reader has it in the tab's name). */
function UnavailableReason({ shape, text }: { shape: MethodTabsShape; text: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box aria-hidden data-testid="method-reason-CARD" sx={{ textAlign: shape === "pill" ? "right" : "left", px: 1 }}>
      <Text variant="caption" size="xs" color="secondary" as="p" style={{ margin: 0 }}>
        {text}
      </Text>
    </Box>
  );
}

export function MethodTabs({
  idBase,
  shape,
  value,
  onChange,
  cardUnavailable = false,
  offered = null,
}: {
  /** The step's `useId`, which the tab and panel ids are built on. */
  idBase: string;
  shape: MethodTabsShape;
  /** The chosen method, or `null` before the buyer has picked one. */
  value: PaymentMethod | null;
  onChange: (method: PaymentMethod) => void;
  /** True ⇒ the store's active provider has no card path here; disable that tab. */
  cardUnavailable?: boolean;
  /** Methods the store's chain can charge, or `null` while unknown (fail open). */
  offered?: PaymentMethod[] | null;
}): JSX.Element {
  const copy = useCheckoutCopy().screens.method;
  const tabs: MethodTab[] = [
    { value: "PIX" as const, label: copy.pixLabel, icon: <PixIcon fontSize="small" /> },
    { value: "CARD" as const, label: copy.cardLabel, icon: <CreditCardIcon fontSize="small" /> },
  ].filter((tab) => offered === null || offered.includes(tab.value));
  const isUnavailable = (method: PaymentMethod): boolean => method === "CARD" && cardUnavailable;
  const enabled = tabs.map((tab) => tab.value).filter((method) => !isUnavailable(method));
  // With nothing chosen yet, the first enabled tab is the one Tab lands on.
  const focusable = value && enabled.includes(value) ? value : enabled[0];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const next = nextMethod(event.key, enabled, value);
    if (!next) return;
    event.preventDefault();
    // Selecting raises an order, so a key that lands on the tab already
    // chosen (Home on the first, an arrow with one enabled tab) does nothing.
    if (next !== value) onChange(next);
    document.getElementById(methodTabId(idBase, next))?.focus();
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box role="tablist" aria-label={copy.groupLabel} data-testid="checkout-method" onKeyDown={onKeyDown} sx={listSx(shape)}>
        {tabs.map((tab) => (
          <MethodTabButton
            key={tab.value}
            tab={tab}
            idBase={idBase}
            shape={shape}
            selected={tab.value === value && !isUnavailable(tab.value)}
            unavailable={isUnavailable(tab.value)}
            focusable={tab.value === focusable}
            reason={copy.unavailableHere}
            onSelect={() => onChange(tab.value)}
          />
        ))}
      </Box>
      {cardUnavailable && tabs.some((tab) => tab.value === "CARD") ? <UnavailableReason shape={shape} text={copy.unavailableHere} /> : null}
    </Box>
  );
}
