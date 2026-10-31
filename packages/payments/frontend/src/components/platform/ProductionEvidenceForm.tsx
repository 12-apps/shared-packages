'use client';

import { Box, Stack, TextField, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { HomologacaoProductionEvidenceCopy } from './copy';
import type { BuyerForm, CardForm } from './production-evidence-data';

/**
 * Step 2 of the PRODUCTION evidence card (FUT-4198): the real cardholder and
 * the two real cards, as plain fields. Nothing here validates or encrypts —
 * `production-evidence-data.ts` does — so this stays the drawing only.
 */

/**
 * Ten fields: 1, 2 or 5 per row, so no row is left half empty. By the FORM's
 * width, not the window's: with the Pix beside it a 1280 window leaves the
 * form too narrow for five labels.
 */
const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 1.5,
  '@container production-form (min-width: 440px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  '@container production-form (min-width: 860px)': { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' },
} as const;

const CARDS_SX = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 2,
  '@container production-form (min-width: 440px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
} as const;

const BOX_SX = { border: 1, borderColor: 'divider', borderRadius: 2.5, p: 1.75 } as const;

/** The buyer's fields, in the order the operator reads them. */
const BUYER_FIELDS = [
  ['name', 'name'],
  ['taxId', 'off'],
  ['email', 'email'],
  ['phone', 'tel'],
  ['postalCode', 'postal-code'],
  ['street', 'address-line1'],
  ['number', 'off'],
  ['complement', 'address-line2'],
  ['city', 'address-level2'],
  ['regionCode', 'address-level1'],
] as const satisfies readonly (readonly [keyof BuyerForm, string])[];

interface ProductionEvidenceFormProps {
  copy: HomologacaoProductionEvidenceCopy;
  buyer: BuyerForm;
  onBuyer: (next: BuyerForm) => void;
  credit: CardForm;
  onCredit: (next: CardForm) => void;
  debit: CardForm;
  onDebit: (next: CardForm) => void;
  disabled: boolean;
}

function CardFields({
  label,
  testId,
  card,
  onChange,
  copy,
  disabled,
  hint,
}: {
  label: string;
  testId: string;
  card: CardForm;
  onChange: (next: CardForm) => void;
  copy: HomologacaoProductionEvidenceCopy;
  disabled: boolean;
  hint?: string;
}): ReactNode {
  const field = (key: keyof CardForm, name: string, autoComplete: string) => (
    <TextField
      size="small"
      label={name}
      value={card[key]}
      disabled={disabled}
      onChange={(event) => onChange({ ...card, [key]: event.target.value })}
      inputProps={{ inputMode: 'numeric', autoComplete, 'data-testid': `${testId}-${key}` }}
      fullWidth
    />
  );
  return (
    <Stack spacing={1} sx={BOX_SX}>
      <Typography variant="body2" fontWeight={600}>
        {label}
      </Typography>
      {field('number', copy.cardFields.number, 'cc-number')}
      <Stack direction="row" spacing={1}>
        {field('expiry', copy.cardFields.expiry, 'cc-exp')}
        {field('securityCode', copy.cardFields.securityCode, 'cc-csc')}
      </Stack>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Stack>
  );
}

export function ProductionEvidenceForm(props: ProductionEvidenceFormProps): ReactNode {
  const { copy, buyer, onBuyer, disabled } = props;
  return (
    <Stack spacing={1.5} data-testid="production-evidence-form" sx={{ containerType: 'inline-size', containerName: 'production-form' }}>
      <Typography variant="body2" fontWeight={600}>
        {copy.buyerHeading}
      </Typography>
      <Box sx={GRID_SX}>
        {BUYER_FIELDS.map(([key, autoComplete]) => (
          <TextField
            key={key}
            size="small"
            label={copy.fields[key]}
            value={buyer[key]}
            disabled={disabled}
            onChange={(event) => onBuyer({ ...buyer, [key]: event.target.value })}
            inputProps={{ autoComplete, 'data-testid': `production-buyer-${key}` }}
            fullWidth
          />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {copy.buyerHint}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {copy.cardsHeading}
      </Typography>
      <Box sx={CARDS_SX}>
        <CardFields label={copy.credit} testId="production-credit" card={props.credit} onChange={props.onCredit} copy={copy} disabled={disabled} />
        <CardFields
          label={copy.debit}
          testId="production-debit"
          card={props.debit}
          onChange={props.onDebit}
          copy={copy}
          disabled={disabled}
          hint={copy.debitBlankHint}
        />
      </Box>
    </Stack>
  );
}
