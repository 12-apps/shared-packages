import { Box } from "@mui/material";
import { useEffect, useRef, useState, type JSX } from "react";

import { taxIdDigits, taxIdKind, validateCpfOrCnpj } from "../../../card";
import { fieldSatisfied } from "../buyer-fields";
import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo, CheckoutCustomerField } from "../types";
import { useCheckoutComponents } from "../ui";

import { complaintOf, inputAttributesOf, placeholderOf, taxIdField, useOnComplete } from "./buyer-inline";
import { usePaymentListMode } from "./context";
import type { PaymentListCopy } from "./types";

/** The prototype's 280px CPF field on a computer (L7), on the theme's spacing scale. */
const FIELD_WIDE_MAX = 35;

/**
 * The list's own width from which the field stops at ~280px (FUT-3711): twice
 * the field. Read off the list's container, not the window or the flow's
 * frame — a host laying out its own two columns puts the list in a ~680px
 * column, under the frame's 900px "wide", and the field still has to stop.
 */
const FIELD_CAP_FROM_PX = 560;

/**
 * Whether the document is complete enough to move the buyer on (FUT-4080).
 *
 * A CNPJ's first 11 digits can themselves be a valid CPF (`11222355000141`),
 * so a CPF reached by TYPING may be a CNPJ on its way: moving the focus then
 * would send the rest of the CNPJ into the card number. So the field moves on
 * only for what cannot grow: a valid CNPJ (14 digits, the most it keeps), or a
 * valid CPF that arrived whole in one change — pasted or autofilled. A CPF
 * typed digit by digit stays put, and the buyer taps the next field.
 */
function useTaxIdAdvance(
  field: CheckoutCustomerField,
  value: string,
  onComplete: (() => void) | undefined,
): { arrivedWhole: boolean; onTyped: (next: string) => void } {
  const [arrivedWhole, setArrivedWhole] = useState(false);
  const satisfied = value.trim() !== "" && fieldSatisfied(field, value);
  const kind = taxIdKind(value);
  useOnComplete(satisfied && (kind === "CNPJ" || (kind === "CPF" && arrivedWhole)), onComplete);
  // Two digits or more in one change is a paste or an autofill, not a keystroke.
  return { arrivedWhole, onTyped: (next) => setArrivedWhole(taxIdDigits(next).length - taxIdDigits(value).length > 1) };
}

/** A CNPJ's length — the most digits the document keeps — and a CPF's. */
const CNPJ_DIGITS = 14;
const CPF_DIGITS = 11;

/**
 * Whether the field's complaint shows now (FUT-4106). While the buyer is in
 * the field, a value under 14 digits is a CPF or a CNPJ on its way, and red
 * from the first digit only scolds them for not having finished. So it is
 * judged once they leave the field, at 14 digits (the most it keeps), or when
 * a whole CPF or CNPJ arrives in one change — a paste or an autofill, judged
 * at once, which keeps the recovery after one. Eleven typed digits are not a
 * trigger: a CNPJ's first eleven are usually not a valid CPF.
 */
export function taxIdJudged(input: { focused: boolean; digits: number; arrivedWhole: boolean }): boolean {
  const { focused, digits, arrivedWhole } = input;
  if (!focused || digits >= CNPJ_DIGITS) return true;
  return arrivedWhole && digits === CPF_DIGITS;
}

/**
 * The document at the TOP of Pagamento, above the wallets (FUT-3685, C3, C4,
 * E1, L7): "CPF ou CNPJ" (FUT-4080), the provider's reason under it ("o PagBank pede para pagar pelo
 * app"), the field — masked, checked by its digits — and "Salvar meus dados
 * para a próxima compra". Asked once, for every online way to pay the list
 * offers (R2); full width on a phone, ~280px on a computer.
 *
 * The field takes a CPF or a CNPJ, masked by its length — a buyer paying with
 * a company card gives its CNPJ — and keeps plain digits in the buyer state.
 *
 * When the document is complete and cannot grow ({@link useTaxIdAdvance}), `onComplete` fires once — the list moves the focus
 * to "Número do cartão" when a card typed now is chosen.
 */
export function CpfTop({ field, buyer, onBuyerChange, copy, provider, onComplete, focusOnMount = false, onKeepSaved }: {
  field: CheckoutCustomerField;
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  copy: PaymentListCopy["buyer"];
  provider: string | null;
  onComplete?: () => void;
  /** Opened by "Alterar" on the payer line: the field takes the focus as it appears. */
  focusOnMount?: boolean;
  /** Opened over a document on file: "Manter o documento salvo" closes it and keeps that one. */
  onKeepSaved?: () => void;
}): JSX.Element {
  const { Button, Checkbox, Input, Text } = useCheckoutComponents();
  const consent = usePaymentListMode()?.consent;
  const fieldCopy = useCheckoutCopy().card.fields;
  // The document the store already holds, when the host passed it, shown
  // masked — as a CNPJ when it is one — and editable.
  const value = taxIdField.shown(buyer.taxId ?? "");
  const { arrivedWhole, onTyped } = useTaxIdAdvance(field, value, onComplete);
  const [focused, setFocused] = useState(false);
  const scope = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusOnMount) scope.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [focusOnMount]);
  const judged = taxIdJudged({ focused, digits: taxIdDigits(value).length, arrivedWhole });
  const complaint = judged ? complaintOf(field, value, copy, (typed) => validateCpfOrCnpj(typed, fieldCopy)) : undefined;
  return (
    <Box ref={scope} data-testid="list-cpf" sx={{ display: "flex", flexDirection: "column", gap: 1.5, containerType: "inline-size" }}>
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
        <Box data-testid="list-cpf-field" sx={(t) => ({ width: "100%", [`@container (min-width: ${FIELD_CAP_FROM_PX}px)`]: { maxWidth: t.spacing(FIELD_WIDE_MAX) } })}>
          <Input
            {...inputAttributesOf("taxId")}
            inputMode="numeric"
            variant="outlined"
            size="md"
            fullWidth
            required={field.required}
            placeholder={placeholderOf("taxId", copy)}
            value={value}
            error={Boolean(complaint)}
            helperText={complaint}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              onTyped(event.target.value);
              onBuyerChange({ ...buyer, taxId: taxIdField.kept(event.target.value) });
            }}
            data-testid="list-buyer-taxId"
          />
        </Box>
      </Box>
      {onKeepSaved && copy.keepSavedCpf ? (
        // Flush with the field's left edge, in the neutral ink of a link that keeps
        // what is on file — the brand's primary read as an error on a red-brown theme.
        <Box sx={{ alignSelf: "flex-start", "& button": { textDecoration: "underline", px: 0, py: 0, minWidth: 0, minHeight: (t) => t.spacing(3) } }}>
          <Button variant="text" color="neutral" size="sm" onClick={onKeepSaved} dataTestId="list-cpf-keep">
            {copy.keepSavedCpf}
          </Button>
        </Box>
      ) : null}
      {consent ? (
        // Flush with the field: the box's own 9px ring and the label's negative inset
        // (MUI's, under every kit built on it) pushed the words right until they wrapped on a phone.
        <Box data-testid="list-save-profile-row" sx={{ "& .MuiFormControlLabel-root": { ml: 0, mr: 0 }, "& .MuiFormControlLabel-root .MuiCheckbox-root": { p: 0, mr: 1 } }}>
          <Checkbox
            label={consent.label}
            checked={consent.checked}
            onChange={(_event, checked) => consent.onChange(checked)}
            data-testid="list-save-profile"
          />
        </Box>
      ) : null}
    </Box>
  );
}
