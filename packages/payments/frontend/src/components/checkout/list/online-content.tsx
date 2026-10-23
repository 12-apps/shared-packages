import { Box, Chip } from "@mui/material";
import { useRef, type JSX, type KeyboardEvent } from "react";

import { NEW_CARD, NewCardForm, detectBrand, onlyDigits } from "../../../card";
import { ChargeFailure } from "../card-view";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { BuyerInfo, CheckoutCustomerField } from "../types";

import { BuyerInline } from "./buyer-inline";
import { cardName } from "./choice";
import type { ListChargeFailure } from "./charge-runners";
import type { PaymentListCopy } from "./types";
import type { ListCard } from "./use-list-state";

/** Where an arrow, Home or End moves from `at` among `count` chips, or `null` for another key. */
function nextChip(key: string, at: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * The saved cards as chips — "Visa 4242", "Outro cartão" — the
 * storefront's chip look (the owner's "use the chips system is using today"):
 * MUI's own `Chip`, which the host's theme already dresses, filled in the
 * primary colour when chosen.
 *
 * One radio group, one Tab stop: only the checked chip (or the first) is
 * tabbable, and the arrows, Home and End move AND select, as radios do.
 */
function SavedChips({ card, copy }: { card: ListCard; copy: PaymentListCopy }): JSX.Element | null {
  const group = useRef<HTMLDivElement | null>(null);
  if (card.saved.length === 0) return null;
  const options = [...card.saved.map((saved) => ({ id: saved.id, label: cardName(copy, saved) })), { id: NEW_CARD, label: copy.otherCard }];
  const checked = options.findIndex((option) => option.id === card.selection);
  const stop = checked === -1 ? 0 : checked;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const to = nextChip(event.key, stop, options.length);
    const target = to === null ? undefined : options[to];
    if (to === null || !target) return;
    event.preventDefault();
    card.setSelection(target.id);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <Box ref={group} role="radiogroup" aria-label={copy.card.label} onKeyDown={onKeyDown} sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {options.map((option, index) => {
        const on = option.id === card.selection;
        return (
          <Chip
            key={option.id}
            label={option.label}
            clickable
            color={on ? "primary" : "default"}
            variant="filled"
            role="radio"
            aria-checked={on}
            tabIndex={index === stop ? 0 : -1}
            onClick={() => card.setSelection(option.id)}
            data-testid={option.id === NEW_CARD ? "list-card-new" : `list-card-${option.id}`}
            sx={{
              fontWeight: on ? 600 : 400,
              // The keyboard's place among the chips: the rows' own 2px ring (5.1 item 6).
              "&.Mui-focusVisible, &:focus-visible": { outline: (t) => `${t.spacing(0.25)} solid ${t.palette.primary.main}`, outlineOffset: (t) => t.spacing(0.25) },
            }}
          />
        );
      })}
    </Box>
  );
}

/**
 * Whether a chosen online row has anything to open — a row with nothing opens
 * no box (L5). The card opens nothing of its own when the host's balance pays
 * the whole amount: no card is charged, so none is asked for.
 */
export function opensContent(method: string, asked: readonly CheckoutCustomerField[], failure: ListChargeFailure | null, covered = false): boolean {
  return (method === "CARD" && !covered) || asked.length > 0 || failure !== null;
}

/** Move the focus to the card number — the next thing to type once the CPF is complete. */
function focusCardNumber(scope: HTMLElement | null): void {
  scope?.querySelector<HTMLInputElement>('input[data-testid="card-number"]')?.focus();
}

/**
 * The card's own fields: the saved cards, then the form for a new one. A debit
 * card (FUT-3754) is always typed — a saved card is charged as credit — and is
 * never offered for saving.
 */
function CardFields({ card, copy, debit }: { card: ListCard; copy: PaymentListCopy; debit: boolean }): JSX.Element {
  return (
    <>
      {debit ? null : <SavedChips card={card} copy={copy} />}
      {card.selection === NEW_CARD ? (
        <NewCardForm
          card={card.card}
          fieldErrors={card.fieldErrors}
          brand={detectBrand(onlyDigits(card.card.number))}
          saveCard={card.saveCard}
          setCard={card.setCard}
          setFieldErrors={card.setFieldErrors}
          onSaveCardChange={debit ? undefined : card.setSaveCard}
        />
      ) : null}
    </>
  );
}

/**
 * What opens inside a chosen ONLINE option, top to bottom (M11, FN:180-202):
 * the buyer's missing details, then — for the card — the saved-card chips and
 * the card fields, then a refusal of the last charge. No left indent: it all
 * starts where the row's own content starts.
 */
export function OnlineContent({
  method,
  asked,
  buyer,
  onBuyerChange,
  card,
  copy,
  provider,
  failure,
  covered = false,
  withConsent = true,
  debit = false,
}: {
  method: "PIX" | "CARD" | "GOOGLE_PAY" | "HAND_OFF";
  /** The debit card row (FUT-3754): no saved cards, and nothing to save. */
  debit?: boolean;
  asked: readonly CheckoutCustomerField[];
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  card: ListCard;
  copy: PaymentListCopy;
  provider: string | null;
  failure: ListChargeFailure | null;
  /** The host's balance pays the whole amount — no chips, no card fields. */
  covered?: boolean;
  /** Offer "Salvar meus dados…" beside the asked fields — not when the top of Pagamento does. */
  withConsent?: boolean;
}): JSX.Element {
  const scope = useRef<HTMLDivElement | null>(null);
  const isCard = method === "CARD" && !covered;
  return (
    <Box ref={scope} sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <BuyerInline
        asked={asked}
        buyer={buyer}
        onBuyerChange={onBuyerChange}
        copy={copy.buyer}
        provider={provider}
        onComplete={isCard ? () => focusCardNumber(scope.current) : undefined}
        withConsent={withConsent}
      />
      {isCard ? <CardFields card={card} copy={copy} debit={debit} /> : null}
      {failure ? <ChargeFailure message={failure.message} unresolved={failure.code === UNRESOLVED_CODE} /> : null}
    </Box>
  );
}
