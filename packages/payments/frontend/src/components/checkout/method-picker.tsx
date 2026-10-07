import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutCopy } from "./copy-context";
import { CreditCardIcon, PixIcon } from "./icons";
import type { MethodPickerCopy } from "./screens-copy";
import type { PaymentMethod } from "./types";
import { useCheckoutComponents } from "./ui";

interface MethodOption {
  value: PaymentMethod;
  label: string;
  icon: JSX.Element;
}

function methodOptions(copy: MethodPickerCopy): MethodOption[] {
  return [
    { value: "PIX", label: copy.pixLabel, icon: <PixIcon fontSize="small" /> },
    { value: "CARD", label: copy.cardLabel, icon: <CreditCardIcon fontSize="small" /> },
  ];
}

function tileColor(unavailable: boolean, selected: boolean): string {
  if (unavailable) return "text.disabled";
  return selected ? "primary.main" : "text.primary";
}

/**
 * One method: its icon and its name on one line (the 2026-10-06 Pix
 * redesign). The line under the name went: it cost the phone a row above the
 * Pix code, and the name says enough. A tile the store cannot charge is
 * disabled, and the reason is part of its accessible name ("Cartão, …") as
 * well as the caption under it.
 */
function MethodTile({
  option,
  selected,
  unavailable,
  reason,
  onSelect,
}: {
  option: MethodOption;
  selected: boolean;
  unavailable: boolean;
  reason: string;
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
      aria-label={unavailable ? `${option.label}, ${reason}` : undefined}
      disabled={unavailable}
      onClick={unavailable ? undefined : onSelect}
      data-testid={`checkout-method-${option.value}`}
      sx={{
        width: "100%",
        minHeight: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        px: 1.5,
        cursor,
        borderRadius: 1.5,
        border: selected ? "2px solid" : "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.selected" : "background.paper",
        color: tileColor(unavailable, selected),
        opacity: unavailable ? 0.6 : 1,
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
      <Box sx={{ display: "flex" }}>{option.icon}</Box>
      <Text variant="body" size="sm" weight={selected ? "bold" : "semibold"} as="span">
        {option.label}
      </Text>
    </Box>
  );
}

function visibleOptions(copy: MethodPickerCopy, offered: PaymentMethod[] | null): MethodOption[] {
  return methodOptions(copy).filter((option) => offered === null || offered.includes(option.value));
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
  const copy = useCheckoutCopy().screens.method;
  const options = visibleOptions(copy, offered);
  return (
    <Box
      role="radiogroup"
      aria-label={copy.groupLabel}
      data-testid="checkout-method"
      sx={{ display: "grid", gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, gap: 1 }}
    >
      {options.map((option) => {
        const unavailable = option.value === "CARD" && cardUnavailable;
        const reasonId = `method-reason-${option.value}`;
        return (
          <Box key={option.value} sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
            <MethodTile
              option={option}
              selected={option.value === value && !unavailable}
              unavailable={unavailable}
              reason={copy.unavailableHere}
              onSelect={() => onChange(option.value)}
            />
            {unavailable ? (
              <Box aria-hidden data-testid={reasonId} sx={{ textAlign: "center" }}>
                <Text variant="caption" size="xs" color="secondary" as="p" style={{ margin: 0 }}>
                  {copy.unavailableHere}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
