import { Box } from "@mui/material";
import type { JSX } from "react";

import { CreditCardIcon, PixIcon } from "./icons";
import type { PaymentMethod } from "./types";
import { useCheckoutComponents } from "./ui";

interface MethodOption {
  value: PaymentMethod;
  label: string;
  description: string;
  icon: JSX.Element;
}

const OPTIONS: MethodOption[] = [
  { value: "PIX", label: "PIX", description: "Aprovação imediata", icon: <PixIcon /> },
  { value: "CARD", label: "Cartão", description: "Crédito à vista", icon: <CreditCardIcon /> },
];

/** Text/icon color for a tile's state — one place, so the ternaries stay flat. */
function tileColor(unavailable: boolean, selected: boolean, muted: string): string {
  if (unavailable) return "text.disabled";
  return selected ? "primary.main" : muted;
}

/** One selectable (or disabled) payment-method tile of the segmented control. */
function MethodTile({
  option,
  selected,
  unavailable,
  onSelect,
}: {
  option: MethodOption;
  selected: boolean;
  unavailable: boolean;
  onSelect: () => void;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const cursor = unavailable ? "not-allowed" : "pointer";
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={unavailable}
      onClick={unavailable ? undefined : onSelect}
      data-testid={`checkout-method-${option.value}`}
      sx={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 1,
        p: 1.25,
        cursor,
        borderRadius: 2,
        border: "2px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.selected" : "background.paper",
        color: tileColor(unavailable, selected, "text.primary"),
        opacity: unavailable ? 0.6 : 1,
        textAlign: "left",
        transition: "border-color 0.15s, background-color 0.15s",
        "& *": { cursor },
        "&:hover": { borderColor: unavailable ? "divider" : "primary.main" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
      }}
    >
      <Box sx={{ display: "flex", color: tileColor(unavailable, selected, "text.secondary") }}>
        {option.icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Text variant="body" size="sm" weight="semibold" as="span">
          {option.label}
        </Text>
        <Text variant="caption" size="xs" color="secondary" as="p">
          {unavailable ? "Indisponível nesta loja" : option.description}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * PIX / Card payment-method picker as a compact two-button segmented control.
 * Each option is a real focusable `<button role="radio">` (keyboard + AT
 * operable), selected-state shown by the button fill itself — so there's no radio
 * dot taking space and the two always sit side by side.
 *
 * `offered` derives the options from the chain's declared capabilities
 * (FUT-698): a provider that cannot PIX must not offer PIX — the charge walk
 * would refuse the method after the buyer already chose it. `null` (config
 * still loading / fetch blip) fails OPEN and offers everything: the server
 * still fails the charge closed.
 *
 * `cardUnavailable` DISABLES the card option with a caption saying so
 * (FUT-697): a provider with no browser card path must not take the buyer to a
 * form that fails at the last click — and a tile that silently vanished would
 * leave an unexplained one-option "choice". The caller preselects the sole
 * remaining method, so no extra tap is demanded either.
 */
function visibleOptions(offered: PaymentMethod[] | null): MethodOption[] {
  return OPTIONS.filter((option) => offered === null || offered.includes(option.value));
}

export function MethodPicker({
  value,
  onChange,
  cardUnavailable = false,
  offered = null,
}: {
  /** The chosen method, or `null` before the buyer has picked one. */
  value: PaymentMethod | null;
  onChange: (method: PaymentMethod) => void;
  /** True ⇒ the store's active provider has no card path here; disable the tile. */
  cardUnavailable?: boolean;
  /** Methods the store's chain can charge, or `null` while unknown (fail open). */
  offered?: PaymentMethod[] | null;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const options = visibleOptions(offered);
  return (
    <Box>
      <Text variant="body" size="sm" weight="bold" as="p" style={{ marginBottom: 8 }}>
        Forma de pagamento
      </Text>
      <Box
        role="radiogroup"
        aria-label="Forma de pagamento"
        data-testid="checkout-method"
        sx={{ display: "flex", gap: 1 }}
      >
        {options.map((option) => {
          const unavailable = option.value === "CARD" && cardUnavailable;
          return (
            <MethodTile
              key={option.value}
              option={option}
              selected={option.value === value && !unavailable}
              unavailable={unavailable}
              onSelect={() => onChange(option.value)}
            />
          );
        })}
      </Box>
    </Box>
  );
}
