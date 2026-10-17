import { Box } from "@mui/material";
import { useEffect, useRef, type JSX } from "react";

import { formatCpf, onlyDigits, validateCpf } from "../../../card";
import { fieldSatisfied } from "../buyer-fields";
import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo, CheckoutCustomerField } from "../types";
import { useCheckoutComponents } from "../ui";

import { usePaymentListMode } from "./context";
import type { PaymentListCopy } from "./types";

/**
 * The buyer's own details the chosen option needs, asked INSIDE it and ABOVE
 * the card fields (M11): only the ones the store's chain requires for this
 * method and the buyer arrived without — the hand-off provider's mobile (K4).
 * The CPF is no longer one of them: it is asked once, at the top of Pagamento
 * (`./cpf-top.tsx`, FUT-3685).
 *
 * When the last of them is complete, `onComplete` fires once — the card
 * option moves the focus to "Número do cartão" with it, so the buyer's next
 * keystroke lands where the next thing to type is.
 */

type Copy = PaymentListCopy["buyer"];

function nameOf(field: CheckoutCustomerField, copy: Copy): string {
  const names: Record<CheckoutCustomerField["key"], string> = {
    taxId: copy.cpf,
    phone: copy.phone,
    name: copy.name,
    email: copy.email,
  };
  return names[field.key];
}

/** The sentence under a field the buyer has started and not finished. */
export function complaintOf(field: CheckoutCustomerField, value: string, copy: Copy, cpfInvalid: (v: string) => string | undefined): string | undefined {
  if (!value.trim() || fieldSatisfied(field, value)) return undefined;
  if (field.key === "taxId") return onlyDigits(value).length < 11 ? copy.cpfIncomplete : cpfInvalid(value);
  if (field.key === "phone") return copy.phoneIncomplete;
  return undefined;
}

export const PLACEHOLDERS: Partial<Record<CheckoutCustomerField["key"], string>> = {
  taxId: "000.000.000-00",
  phone: "(00) 00000-0000",
};

/** Call `onComplete` once each time `complete` turns true — the focus moves on to what is next. */
export function useOnComplete(complete: boolean, onComplete: (() => void) | undefined): void {
  const was = useRef(complete);
  const latest = useRef(onComplete);
  latest.current = onComplete;
  useEffect(() => {
    if (complete && !was.current) latest.current?.();
    was.current = complete;
  }, [complete]);
}

export function BuyerInline({
  asked,
  buyer,
  onBuyerChange,
  copy,
  provider,
  onComplete,
  withConsent = true,
}: {
  asked: readonly CheckoutCustomerField[];
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  copy: Copy;
  /** The store's provider, named in the "why" — `null` when it published no name. */
  provider: string | null;
  onComplete?: () => void;
  /** Offer "Salvar meus dados…" here — not when the top of Pagamento already does (FUT-3685). */
  withConsent?: boolean;
}): JSX.Element | null {
  const { Checkbox, Input, Text } = useCheckoutComponents();
  const consent = usePaymentListMode()?.consent;
  const cardCopy = useCheckoutCopy().card;
  useOnComplete(asked.every((field) => fieldSatisfied(field, buyer[field.key])), onComplete);
  if (asked.length === 0) return null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {asked.map((field) => {
        const value = buyer[field.key] ?? "";
        const complaint = complaintOf(field, value, copy, (v) => validateCpf(v, cardCopy.fields));
        // The label sits ABOVE the field, whole — "CPF (o PagBank pede para
        // pagar pelo app)" (FN:182) — and a native <label> around both names
        // the input with it; a floating label would cut the reason short.
        return (
          <Box key={field.key} component="label" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Text variant="body" size="sm" as="span">
              {nameOf(field, copy)}{" "}
              <Text variant="body" size="sm" color="secondary" as="span">
                {copy.why(provider)}
              </Text>
            </Text>
          <Input
            type={field.key === "phone" ? "tel" : "text"}
            inputMode={field.key === "taxId" ? "numeric" : undefined}
            variant="outlined"
            size="md"
            fullWidth
            required
            placeholder={PLACEHOLDERS[field.key]}
            value={value}
            error={Boolean(complaint)}
            helperText={complaint}
            onChange={(event) =>
              onBuyerChange({
                ...buyer,
                [field.key]: field.key === "taxId" ? formatCpf(event.target.value) : event.target.value,
              })
            }
            data-testid={`list-buyer-${field.key}`}
          />
          </Box>
        );
      })}
      {consent && withConsent ? (
        <Checkbox
          label={consent.label}
          checked={consent.checked}
          onChange={(_event, checked) => consent.onChange(checked)}
          data-testid="list-save-profile"
        />
      ) : null}
    </Box>
  );
}
