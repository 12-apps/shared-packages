'use client';

/**
 * The legacy `CheckoutPayment` step's PRESENTATION — the PIX panel, the card
 * form, the saved-card list and the two method cards.
 *
 * Split from `CheckoutPayment.tsx` when the copy port (FUT-760) pushed that
 * file past the size gate, along the seam it already had: everything here
 * takes props and renders, and nothing here holds a client, a charge or an
 * effect. The container keeps those.
 */

import {
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import type { ClientChargeView, Money } from '@12-apps/payments-backend';

import type { ClientPaymentsConfig } from '../client';

import type {
  CheckoutPaymentCopy,
  LegacyCardCopy,
  LegacyMethodCopy,
  LegacyMoneyCopy,
  LegacyPixCopy,
} from './checkout-payment-copy';
import type { CardFormValues, SavedCardOption } from './checkout-payment-types';

/**
 * The amount, in the host's locale and the store's currency.
 *
 * The locale is the host's say (FUT-760) — it decides the decimal mark, the
 * grouping and where the symbol sits. The currency is not: it rides on the
 * `Money` the host already passes, and is a fact about the charge.
 */
export function formatAmount(amount: Money, copy: LegacyMoneyCopy): string {
  return (amount.amountCents / 100).toLocaleString(copy.amountLocale, {
    style: 'currency',
    currency: amount.currency,
  });
}

export function PixPanel({ charge, copy }: { charge: ClientChargeView; copy: LegacyPixCopy }) {
  const [copied, setCopied] = useState(false);
  if (!charge.pix) return null;
  return (
    <Stack spacing={1} alignItems="flex-start">
      {charge.pix.qrImageUrl ? (
        <Box component="img" src={charge.pix.qrImageUrl} alt={copy.qrAlt} sx={{ width: 220 }} />
      ) : null}
      <TextField fullWidth multiline size="small" label={copy.copyPasteLabel} value={charge.pix.qrText} />
      <Button
        size="small"
        onClick={() => {
          void navigator.clipboard.writeText(charge.pix?.qrText ?? '').then(() => setCopied(true));
        }}
      >
        {copied ? copy.copiedAction : copy.copyAction}
      </Button>
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size={16} />
        <Typography variant="body2">{copy.awaiting}</Typography>
      </Stack>
    </Stack>
  );
}

function CardPanel({
  disabled,
  onSubmit,
  copy,
}: {
  disabled: boolean;
  onSubmit: (values: CardFormValues) => void;
  copy: LegacyCardCopy;
}) {
  const [values, setValues] = useState<CardFormValues>({ number: '', holder: '', expiry: '', cvv: '' });
  const field = (key: keyof CardFormValues, label: string, width?: number) => (
    <TextField
      size="small"
      label={label}
      value={values[key]}
      sx={width ? { width } : undefined}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
    />
  );
  return (
    <Stack spacing={2}>
      {field('number', copy.numberLabel)}
      {field('holder', copy.holderLabel)}
      <Stack direction="row" spacing={2}>
        {field('expiry', copy.expiryLabel, 140)}
        {field('cvv', copy.cvvLabel, 100)}
      </Stack>
      <Button variant="contained" disabled={disabled} onClick={() => onSubmit(values)}>
        {copy.payAction}
      </Button>
    </Stack>
  );
}

interface CardSectionProps {
  amount: Money;
  savedCards: SavedCardOption[];
  disabled: boolean;
  onNewCard: (values: CardFormValues) => void;
  onSavedCard: (card: SavedCardOption) => void;
  copy: CheckoutPaymentCopy;
}

/** "Pague com cartão": saved cards as radios + "Novo cartão" fallback. */
function CardSection({
  amount,
  savedCards,
  disabled,
  onNewCard,
  onSavedCard,
  copy,
}: CardSectionProps) {
  const [selected, setSelected] = useState(savedCards[0]?.savedCardToken ?? 'new');
  const chosen = savedCards.find((c) => c.savedCardToken === selected);
  if (savedCards.length === 0) {
    return <CardPanel disabled={disabled} onSubmit={onNewCard} copy={copy.card} />;
  }
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{copy.card.heading}</Typography>
      <RadioGroup value={selected} onChange={(_, v) => setSelected(v)}>
        {savedCards.map((card) => (
          <FormControlLabel
            key={card.savedCardToken}
            value={card.savedCardToken}
            control={<Radio />}
            label={copy.card.savedCard(card.brand, card.last4, card.expiry)}
          />
        ))}
        <FormControlLabel value="new" control={<Radio />} label={copy.card.newCard} />
      </RadioGroup>
      {chosen ? (
        <Button variant="contained" disabled={disabled} onClick={() => onSavedCard(chosen)}>
          {copy.money.payAction(formatAmount(amount, copy.money))}
        </Button>
      ) : (
        <CardPanel disabled={disabled} onSubmit={onNewCard} copy={copy.card} />
      )}
    </Stack>
  );
}

interface MethodChooserProps {
  config: ClientPaymentsConfig;
  amount: Money;
  savedCards: SavedCardOption[];
  loading: boolean;
  startPix: () => void;
  startCard: (values: CardFormValues) => void;
  startSavedCard: (card: SavedCardOption) => void;
  copy: CheckoutPaymentCopy;
}

/** One "Forma de pagamento" option card (PIX / Cartão). */
function MethodCard(props: { title: string; subtitle: string; selected: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outlined"
      onClick={props.onClick}
      sx={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', borderWidth: props.selected ? 2 : 1 }}
    >
      <Stack alignItems="flex-start">
        <Typography variant="subtitle2">{props.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {props.subtitle}
        </Typography>
      </Stack>
    </Button>
  );
}

/** Pre-charge phase: "Forma de pagamento" method cards, then the flow. */
export function MethodChooser(props: MethodChooserProps) {
  const { config, amount, savedCards, loading, startPix, startCard, startSavedCard, copy } = props;
  const words: LegacyMethodCopy = copy.method;
  const [method, setMethod] = useState<'PIX' | 'CARD'>('PIX');
  if (config.tokenization === 'REDIRECT') {
    return (
      <Button variant="contained" disabled={loading} onClick={startPix}>
        {words.continueToPaymentAction}
      </Button>
    );
  }
  return (
    <>
      <Typography variant="subtitle2">{words.groupLabel}</Typography>
      <Stack direction="row" spacing={2}>
        <MethodCard title={words.pixTitle} subtitle={words.pixSubtitle} selected={method === 'PIX'} onClick={() => setMethod('PIX')} />
        <MethodCard title={words.cardTitle} subtitle={words.cardSubtitle} selected={method === 'CARD'} onClick={() => setMethod('CARD')} />
      </Stack>
      {method === 'PIX' ? (
        <Button variant="contained" disabled={loading} onClick={startPix}>
          {words.generatePixAction}
        </Button>
      ) : (
        <CardSection
          amount={amount}
          savedCards={savedCards}
          disabled={loading}
          onNewCard={startCard}
          onSavedCard={startSavedCard}
          copy={copy}
        />
      )}
    </>
  );
}

