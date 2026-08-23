import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutCopy } from "../components/checkout/copy-context";
import { useCheckoutComponents } from "../components/checkout/ui";

import {
  cvvLength,
  formatCardNumber,
  formatCvv,
  formatExpiry,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardBrand,
} from "./format";
import { NEW_CARD, type CardDetails, type CardFieldErrors, type SavedCard } from "./types";

type SetCard = React.Dispatch<React.SetStateAction<CardDetails>>;
type SetErrors = React.Dispatch<React.SetStateAction<CardFieldErrors>>;

/** Saved-cards radio list, with a trailing "Novo cartão" option. */
export function SavedCardsPicker({
  savedCards,
  selection,
  onSelect,
}: {
  savedCards: SavedCard[];
  selection: string;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { RadioGroup } = useCheckoutComponents();
  const copy = useCheckoutCopy().card.fields;
  return (
    <RadioGroup
      label={copy.savedCardsLabel}
      value={selection}
      onChange={(_event, next) => onSelect(next)}
      options={[
        ...savedCards.map((saved) => ({
          value: saved.id,
          label: `${saved.brand} •••• ${saved.last4}`,
          description: `Validade ${String(saved.expMonth).padStart(2, "0")}/${saved.expYear}`,
        })),
        { value: NEW_CARD, label: copy.newCard, description: copy.newCardDescription },
      ]}
      dataTestId="saved-cards"
    />
  );
}

/** The card-number field — carries the detected-brand adornment. */
function CardNumberInput({
  card,
  fieldErrors,
  brand,
  setCard,
  setFieldErrors,
}: {
  card: CardDetails;
  fieldErrors: CardFieldErrors;
  brand: CardBrand;
  setCard: SetCard;
  setFieldErrors: SetErrors;
}): JSX.Element {
  const { Input, Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().card.fields;
  return (
    <Input
      label={copy.numberLabel}
      type="text"
      inputMode="numeric"
      variant="outlined"
      size="md"
      fullWidth
      autoComplete="cc-number"
      placeholder="0000 0000 0000 0000"
      value={card.number}
      error={Boolean(fieldErrors.number)}
      helperText={fieldErrors.number}
      endAdornment={
        brand !== "Unknown" ? (
          <Text variant="caption" size="xs" color="secondary" as="span">
            {brand}
          </Text>
        ) : undefined
      }
      onChange={(event) => setCard((prev) => ({ ...prev, number: formatCardNumber(event.target.value) }))}
      onBlur={() => setFieldErrors((prev) => ({ ...prev, number: validateCardNumber(card.number, copy) }))}
      data-testid="card-number"
    />
  );
}

/** The side-by-side expiry + CVV fields. */
function ExpiryCvvFields({
  card,
  fieldErrors,
  brand,
  setCard,
  setFieldErrors,
}: {
  card: CardDetails;
  fieldErrors: CardFieldErrors;
  brand: CardBrand;
  setCard: SetCard;
  setFieldErrors: SetErrors;
}): JSX.Element {
  const { Input } = useCheckoutComponents();
  const copy = useCheckoutCopy().card.fields;
  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      <Input
        label={copy.expiryLabel}
        type="text"
        inputMode="numeric"
        placeholder="MM/AA"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="cc-exp"
        value={card.expiry}
        error={Boolean(fieldErrors.expiry)}
        helperText={fieldErrors.expiry}
        onChange={(event) => setCard((prev) => ({ ...prev, expiry: formatExpiry(event.target.value) }))}
        onBlur={() => setFieldErrors((prev) => ({ ...prev, expiry: validateExpiry(card.expiry, copy) }))}
        data-testid="card-expiry"
      />
      <Input
        label={copy.cvvLabel}
        type="text"
        inputMode="numeric"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="cc-csc"
        maxLength={cvvLength(brand)}
        value={card.cvv}
        error={Boolean(fieldErrors.cvv)}
        helperText={fieldErrors.cvv}
        onChange={(event) => setCard((prev) => ({ ...prev, cvv: formatCvv(event.target.value) }))}
        onBlur={() => setFieldErrors((prev) => ({ ...prev, cvv: validateCvv(card.cvv, copy, brand) }))}
        data-testid="card-cvv"
      />
    </Box>
  );
}

/**
 * New-card entry form: number, holder, expiry+CVV, and the save-card opt-in.
 *
 * The opt-in appears only when the caller can act on it. A one-off card — the
 * owner's, on the R$0,01 charge that proves their provider works — has nothing
 * to save it for, and offering a dead checkbox there would be a promise the
 * screen does not keep.
 */
export function NewCardForm({
  card,
  fieldErrors,
  brand,
  saveCard = false,
  setCard,
  setFieldErrors,
  onSaveCardChange,
}: {
  card: CardDetails;
  fieldErrors: CardFieldErrors;
  brand: CardBrand;
  saveCard?: boolean;
  setCard: SetCard;
  setFieldErrors: SetErrors;
  onSaveCardChange?: (checked: boolean) => void;
}): JSX.Element {
  const { Input, Checkbox } = useCheckoutComponents();
  const copy = useCheckoutCopy().card.fields;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <CardNumberInput
        card={card}
        fieldErrors={fieldErrors}
        brand={brand}
        setCard={setCard}
        setFieldErrors={setFieldErrors}
      />
      <Input
        label={copy.holderLabel}
        type="text"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="cc-name"
        value={card.holder}
        error={Boolean(fieldErrors.holder)}
        helperText={fieldErrors.holder}
        onChange={(event) => setCard((prev) => ({ ...prev, holder: event.target.value }))}
        onBlur={() => setFieldErrors((prev) => ({ ...prev, holder: validateHolder(card.holder, copy) }))}
        data-testid="card-holder"
      />
      <ExpiryCvvFields
        card={card}
        fieldErrors={fieldErrors}
        brand={brand}
        setCard={setCard}
        setFieldErrors={setFieldErrors}
      />
      {onSaveCardChange ? (
        <Checkbox
          label={copy.saveCard}
          checked={saveCard}
          onChange={(_event, checked) => onSaveCardChange(checked)}
          data-testid="save-card"
        />
      ) : null}
    </Box>
  );
}

/** Sticky primary "Pagar" action — pinned to the bottom of the viewport on mobile. */
export function CardPayBar({
  totalLabel,
  submitting,
  onPay,
}: {
  totalLabel: string;
  submitting: boolean;
  onPay: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box
      data-testid="card-pay-bar"
      sx={{
        position: { xs: "sticky", sm: "static" },
        bottom: 0,
        zIndex: 2,
        mx: { xs: -2, sm: 0 },
        px: { xs: 2, sm: 0 },
        py: { xs: 1.5, sm: 0 },
        bgcolor: "background.paper",
        borderTop: { xs: "1px solid", sm: "none" },
        borderColor: "divider",
      }}
    >
      <Button
        variant="solid"
        color="primary"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={submitting}
        onClick={onPay}
        dataTestId="card-pay"
      >
        Pagar {totalLabel}
      </Button>
    </Box>
  );
}
