'use client';

import { Alert, Stack, TextField, ToggleButton, Typography, type Theme } from '@mui/material';
import { useState, type JSX } from 'react';

import { ActionButton, ChoiceRow } from './choice-actions';
import type { ElsewhereCopy } from './copy';
import { ELSEWHERE_REFERENCE_MAX } from './flow-moves';
import type { Elsewhere } from './flow-types';
import type { TerminalMethod } from './port';

/**
 * State 6 (approved frame 6-B): while the terminal cannot be used, the leg is
 * recorded as a MANUAL leg — charged on another machine, or a Pix checked by
 * hand — and the form says it is manual. The card method is preselected from
 * the leg and the reference is optional. Not a dangerous act: the frame asks
 * no PIN. In a store that issues a fiscal note for a manual Pix, a line says so.
 *
 * The host shows it only from a leg's `other-machine` / `manual-pix` exit,
 * which the flow offers only while the terminal cannot be used.
 */
export interface ElsewhereFormProps {
  readonly via: Elsewhere['via'];
  /** The leg's amount, formatted by the host. */
  readonly money: string;
  /** The leg's method, preselected. */
  readonly preselected: string | null;
  /** The card methods' names, as the host's catalogue words them. */
  readonly methodName: (method: 'CREDIT' | 'DEBIT') => string;
  /** The store issues a fiscal note when a manual Pix is recorded. */
  readonly issuesFiscalNote?: boolean;
  readonly copy: ElsewhereCopy;
  readonly onConfirm: (elsewhere: Elsewhere, method?: TerminalMethod) => void;
  readonly onBack: () => void;
  readonly dataTestId?: string;
}

const CARD_METHODS = ['CREDIT', 'DEBIT'] as const;
type CardMethod = (typeof CARD_METHODS)[number];

const cardMethodOf = (method: string | null): CardMethod => (method === 'DEBIT' ? 'DEBIT' : 'CREDIT');

/**
 * A card method's option: the label as the host wrote it (sentence case, never
 * the theme's UPPERCASE), at the touch size of the charge's buttons. The ink
 * is the body text's on both options, so it holds AA on the selected tint too;
 * the chosen one is marked by a primary border, the bold weight and
 * `aria-pressed`, never by colour alone.
 */
const METHOD_SX = {
  textTransform: 'none',
  minHeight: (theme: Theme) => theme.spacing(6),
  color: 'text.primary',
  '&.Mui-selected, &.Mui-selected:hover': {
    color: 'text.primary',
    fontWeight: 700,
    borderColor: 'primary.main',
    boxShadow: (theme: Theme) => `inset 0 0 0 1px ${theme.palette.primary.main}`,
  },
} as const;

export function ElsewhereForm(props: ElsewhereFormProps): JSX.Element {
  const { via, money, preselected, methodName, issuesFiscalNote = false, copy, onConfirm, onBack, dataTestId = 'terminal-elsewhere' } = props;
  const [method, setMethod] = useState<CardMethod>(cardMethodOf(preselected));
  const [reference, setReference] = useState('');
  const machine = via === 'OTHER_MACHINE';
  const confirm = (): void => {
    const typed = reference.trim();
    const elsewhere: Elsewhere = typed === '' ? { via } : { via, reference: typed };
    if (machine) onConfirm(elsewhere, method);
    else onConfirm(elsewhere);
  };
  return (
    <Stack spacing={1.5} data-testid={dataTestId} data-via={via}>
      <Typography component="p" sx={{ fontWeight: 700 }}>
        {machine ? copy.otherMachineTitle : copy.manualPixTitle}
      </Typography>
      <Typography variant="body2" component="p" color="text.secondary" data-testid={`${dataTestId}-manual-note`}>
        {copy.manualNote}
      </Typography>
      {machine ? (
        <ChoiceRow label={copy.methodLabel} dataTestId={`${dataTestId}-method`}>
          {CARD_METHODS.map((option) => (
            <ToggleButton
              key={option}
              value={option}
              color="primary"
              size="small"
              selected={method === option}
              onChange={() => setMethod(option)}
              sx={METHOD_SX}
              data-testid={`${dataTestId}-method-${option}`}
            >
              {methodName(option)}
            </ToggleButton>
          ))}
        </ChoiceRow>
      ) : null}
      {machine ? (
        <TextField
          label={copy.referenceLabel}
          helperText={copy.referenceHint}
          value={reference}
          onChange={(event) => setReference(event.target.value.slice(0, ELSEWHERE_REFERENCE_MAX))}
          inputProps={{ 'data-testid': `${dataTestId}-reference`, maxLength: ELSEWHERE_REFERENCE_MAX }}
          size="small"
          fullWidth
        />
      ) : null}
      {!machine && issuesFiscalNote ? (
        <Alert severity="info" data-testid={`${dataTestId}-fiscal-note`}>
          {copy.fiscalNoteLine}
        </Alert>
      ) : null}
      <ChoiceRow dataTestId={`${dataTestId}-actions`}>
        <ActionButton rank="primary" onClick={confirm} data-testid={`${dataTestId}-confirm`}>
          {copy.confirm(money)}
        </ActionButton>
        <ActionButton rank="secondary" onClick={onBack} data-testid={`${dataTestId}-back`}>
          {copy.back}
        </ActionButton>
      </ChoiceRow>
    </Stack>
  );
}
