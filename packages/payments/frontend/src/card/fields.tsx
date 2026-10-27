import { Box } from "@mui/material";
import { useEffect, useRef, type JSX } from "react";

import { useCheckoutCopy } from "../components/checkout/copy-context";
import { useCheckoutComponents, type CheckoutInputHints } from "../components/checkout/ui";
import {
  StickyPayBar,
  useCheckoutLayout,
} from "../components/checkout/payment-step-layout";

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
import type { CardFieldCopy } from "./copy";
import { NEW_CARD, type CardDetails, type CardFieldErrors, type SavedCard } from "./types";

type SetCard = React.Dispatch<React.SetStateAction<CardDetails>>;
type SetErrors = React.Dispatch<React.SetStateAction<CardFieldErrors>>;

/**
 * The name is printed on the card in capitals: no auto-capitalised first
 * letter, no "corrected" surname, no spellcheck squiggle (FUT-4107). Through
 * `inputProps`, the one route that reaches the `<input>` in every binding.
 */
const HOLDER_INPUT_HINTS: CheckoutInputHints = {
  autoCapitalize: "characters",
  autoCorrect: "off",
  spellCheck: false,
};

/** What the four fields' judgements depend on: their values and, for the CVV, the brand. */
type Judged = Pick<CardDetails, "number" | "holder" | "expiry" | "cvv"> & { brand: CardBrand };

/**
 * A field already red is re-judged when its value changes (FUT-4102).
 *
 * The fields are judged on blur and on submit only, so a value written with
 * no blur — autofill, a password manager, a paste into another field — left an
 * earlier error standing beside a now-valid value. Only a field that HOLDS an
 * error is re-judged: an empty field the shopper has not left stays unjudged,
 * as before. The CVV is also re-judged when the brand moves, since its length
 * is the brand's.
 */
function useRejudgeRedFields(
  judged: Judged,
  copy: CardFieldCopy,
  setFieldErrors: SetErrors,
): void {
  const { number, holder, expiry, cvv, brand } = judged;
  const last = useRef<Judged>(judged);
  useEffect(() => {
    const prev = last.current;
    last.current = { number, holder, expiry, cvv, brand };
    const moved = {
      number: number !== prev.number,
      holder: holder !== prev.holder,
      expiry: expiry !== prev.expiry,
      cvv: cvv !== prev.cvv || brand !== prev.brand,
    };
    if (!moved.number && !moved.holder && !moved.expiry && !moved.cvv) return;
    setFieldErrors((errors) => {
      const next: CardFieldErrors = { ...errors };
      if (moved.number && errors.number) next.number = validateCardNumber(number, copy);
      if (moved.holder && errors.holder) next.holder = validateHolder(holder, copy);
      if (moved.expiry && errors.expiry) next.expiry = validateExpiry(expiry, copy);
      if (moved.cvv && errors.cvv) next.cvv = validateCvv(cvv, copy, brand);
      const changed = (Object.keys(next) as (keyof CardFieldErrors)[]).some((key) => next[key] !== errors[key]);
      return changed ? next : errors;
    });
  }, [number, holder, expiry, cvv, brand, copy, setFieldErrors]);
}

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
          description: copy.savedCardExpiry(String(saved.expMonth).padStart(2, "0"), saved.expYear),
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
    // Side by side while "Validade (MM/AA)" fits whole; stacked below that
    // (a phone's Pagamento card, FUT-3525) rather than cut to "Validade (MM/…".
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, "& > *": { flex: "1 1 170px" } }}>
      <Input
        label={copy.expiryLabel}
        type="text"
        inputMode="numeric"
        placeholder={copy.expiryPlaceholder}
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
  useRejudgeRedFields(
    { number: card.number, holder: card.holder, expiry: card.expiry, cvv: card.cvv, brand },
    copy,
    setFieldErrors,
  );
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
        inputProps={HOLDER_INPUT_HINTS}
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

/**
 * The primary "Pagar" action.
 *
 * On the Pagamento step it is the step's pay bar (FUT-3525): pinned to the
 * bottom of the viewport with the total beside it on a phone, in the form on
 * a computer. Composed anywhere else it keeps the look it always had —
 * pinned to the bottom on a small screen, in the form on a wide one.
 */
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
  const inStep = useCheckoutLayout() !== null;
  const button = (
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
  );
  if (inStep)
    return <StickyPayBar dataTestId="card-pay-bar">{button}</StickyPayBar>;
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
      {button}
    </Box>
  );
}
