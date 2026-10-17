import { Box } from "@mui/material";
import { useEffect, useRef, type JSX } from "react";

import { formatCpf, validateCpf } from "../../../card";
import { fieldSatisfied } from "../buyer-fields";
import { useCheckoutCopy } from "../copy-context";
import { useCheckoutLayout } from "../payment-step-layout";
import type { BuyerInfo, CheckoutCustomerField } from "../types";
import { useCheckoutComponents } from "../ui";

import { PLACEHOLDERS, complaintOf, useOnComplete } from "./buyer-inline";
import { usePaymentListMode } from "./context";
import type { PaymentListCopy } from "./types";

/** The prototype's 280px CPF field on a computer (L7), on the theme's spacing scale. */
const FIELD_WIDE_MAX = 35;

/**
 * The CPF at the TOP of Pagamento, above the wallets (FUT-3685, C3, C4, E1,
 * L7): "CPF", the provider's reason under it ("o PagBank pede para pagar pelo
 * app"), the field — masked, checked by its digits — and "Salvar meus dados
 * para a próxima compra". Asked once, for every online way to pay the list
 * offers (R2); full width on a phone, ~280px on a computer.
 *
 * When the CPF is complete, `onComplete` fires once — the list moves the focus
 * to "Número do cartão" when a card typed now is chosen.
 */
export function CpfTop({ field, buyer, onBuyerChange, copy, provider, onComplete, focusOnMount = false }: {
  field: CheckoutCustomerField;
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  copy: PaymentListCopy["buyer"];
  provider: string | null;
  onComplete?: () => void;
  /** Opened by "Alterar" on the payer line: the field takes the focus as it appears. */
  focusOnMount?: boolean;
}): JSX.Element {
  const { Checkbox, Input, Text } = useCheckoutComponents();
  const consent = usePaymentListMode()?.consent;
  const fieldCopy = useCheckoutCopy().card.fields;
  const wide = useCheckoutLayout()?.wide ?? false;
  // The CPF the store already holds, when the host passed it, shown masked and editable.
  const value = formatCpf(buyer.taxId ?? "");
  useOnComplete(value.trim() !== "" && fieldSatisfied(field, value), onComplete);
  const scope = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusOnMount) scope.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [focusOnMount]);
  const complaint = complaintOf(field, value, copy, (typed) => validateCpf(typed, fieldCopy));
  return (
    <Box ref={scope} data-testid="list-cpf" sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {/* A native <label> around the words and the field names the input with both. */}
      <Box component="label" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
          <Text variant="body" size="sm" as="span">
            {copy.cpf}
          </Text>
          <Text variant="body" size="sm" color="secondary" as="span">
            {copy.cpfHint(provider)}
          </Text>
        </Box>
        <Box sx={{ width: "100%", maxWidth: (t) => (wide ? t.spacing(FIELD_WIDE_MAX) : "none") }}>
          <Input
            type="text"
            inputMode="numeric"
            variant="outlined"
            size="md"
            fullWidth
            required={field.required}
            placeholder={PLACEHOLDERS.taxId}
            value={value}
            error={Boolean(complaint)}
            helperText={complaint}
            onChange={(event) => onBuyerChange({ ...buyer, taxId: formatCpf(event.target.value) })}
            data-testid="list-buyer-taxId"
          />
        </Box>
      </Box>
      {consent ? (
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
