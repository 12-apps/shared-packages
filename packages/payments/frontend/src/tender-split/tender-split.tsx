'use client';

import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMemo, useState } from 'react';

import type { TenderSplitCopy } from './copy';
import {
  readTenderSplit,
  withPicked,
  withTyped,
  withoutPicked,
  type TenderPick,
  type TenderSplitAnswer,
  type TenderSplitState,
} from './math';
import { PickedTender, TenderChoice, type TenderOption } from './tender-card';

/**
 * "How was it paid?" for money taken in person — one screen whatever the mix.
 *
 * The tenders are cards. Tapping one picks it and it takes the bill; tapping a
 * second splits the bill between the two, a third in three, the leftover cent
 * going to the last one tapped. Typing into a card fixes that amount, and the
 * cards still automatic share what it leaves; only removing the card lets a
 * typed amount go (the rule, and what is sent, are in `./math`). A bar above
 * says how much is recorded and how much is missing, and the confirm names the
 * same figure, so it is never a disabled button with no reason on it.
 *
 * The component knows no store and no language: the host passes its tenders
 * (names, glyphs, which one gives change), the words, and the locale and
 * currency every amount is formatted in. It renders no dialog chrome either —
 * a host puts it inside its own dialog, sheet or page.
 */
export interface TenderSplitProps<T extends string> {
  readonly tenders: readonly TenderOption<T>[];
  /** The bill, in whole cents of `currency`. */
  readonly totalCents: number;
  readonly copy: TenderSplitCopy;
  /** BCP 47 tag every amount is formatted in, e.g. `pt-BR`. */
  readonly locale: string;
  /** ISO 4217 code, e.g. `BRL`. */
  readonly currency: string;
  readonly onConfirm: (answer: TenderSplitAnswer<T>) => void;
  /** Omit to render no cancel control. */
  readonly onCancel?: () => void;
  /** Prefix of every test id — `<id>-option-<tender>`, `<id>-confirm`, … */
  readonly dataTestId?: string;
}

export function TenderSplit<T extends string>({
  tenders,
  totalCents,
  copy,
  locale,
  currency,
  onConfirm,
  onCancel,
  dataTestId = 'tender-split',
}: TenderSplitProps<T>) {
  const [picks, setPicks] = useState<TenderPick<T>[]>([]);
  const money = useMemo(() => moneyFormats(locale, currency), [locale, currency]);
  const changing = useMemo(
    () => new Set(tenders.filter((tender) => tender.givesChange === true).map((t) => t.id)),
    [tenders],
  );
  const state = readTenderSplit(picks, totalCents, (tender) => changing.has(tender));
  return (
    <Stack spacing={2} data-testid={dataTestId}>
      <Progress state={state} totalCents={totalCents} copy={copy} money={money} testId={dataTestId} />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
        {tenders.map((tender) => {
          const pick = picks.find((candidate) => candidate.tender === tender.id);
          return pick === undefined ? (
            <TenderChoice
              key={tender.id}
              tender={tender}
              testId={`${dataTestId}-option-${tender.id}`}
              onPick={() => setPicks((current) => withPicked(current, tender.id))}
            />
          ) : (
            <PickedTender
              key={tender.id}
              tender={tender}
              value={pick.typed ?? money.amount(state.amounts.get(tender.id) ?? 0)}
              shared={pick.typed === null}
              currencySign={money.sign}
              copy={copy}
              testId={`${dataTestId}-picked-${tender.id}`}
              onType={(typed) => setPicks((current) => withTyped(current, tender.id, typed))}
              onRemove={() => setPicks((current) => withoutPicked(current, tender.id))}
            />
          );
        })}
      </Box>
      {state.changeCents > 0 ? (
        <ChangeLine cents={state.changeCents} copy={copy} money={money} testId={dataTestId} />
      ) : null}
      <Actions
        label={confirmText(state, totalCents, copy, money)}
        onConfirm={state.answer === null ? null : () => onConfirm(state.answer!)}
        onCancel={onCancel}
        copy={copy}
        testId={dataTestId}
      />
    </Stack>
  );
}

function ChangeLine({
  cents,
  copy,
  money,
  testId,
}: {
  cents: number;
  copy: TenderSplitCopy;
  money: MoneyFormats;
  testId: string;
}) {
  return (
    <Box
      data-testid={`${testId}-change`}
      sx={(theme) => ({
        display: 'flex',
        justifyContent: 'space-between',
        px: 1.5,
        py: 1,
        borderRadius: 1,
        bgcolor: alpha(theme.palette.success.main, 0.12),
        color: 'success.main',
        fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
      })}
    >
      <span>{copy.changeLabel}</span>
      <span>{money.full(cents)}</span>
    </Box>
  );
}

/** Cancel (when the host handles it) and the confirm that names the figure. */
function Actions({
  label,
  onConfirm,
  onCancel,
  copy,
  testId,
}: {
  label: string;
  onConfirm: (() => void) | null;
  onCancel: (() => void) | undefined;
  copy: TenderSplitCopy;
  testId: string;
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: onCancel ? 'space-between' : 'flex-end', gap: 1 }}>
      {onCancel ? (
        <Button variant="text" color="inherit" onClick={onCancel} data-testid={`${testId}-cancel`}>
          {copy.cancel}
        </Button>
      ) : null}
      <Button
        variant="contained"
        disabled={onConfirm === null}
        onClick={onConfirm ?? undefined}
        data-testid={`${testId}-confirm`}
      >
        {label}
      </Button>
    </Box>
  );
}

interface MoneyFormats {
  /** An amount with its currency sign — "R$ 82,00". */
  full: (cents: number) => string;
  /** An amount as it sits in a field — "82,00". */
  amount: (cents: number) => string;
  /** The currency sign alone — "R$". */
  sign: string;
}

function moneyFormats(locale: string, currency: string): MoneyFormats {
  const full = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const amount = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = full.formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency;
  return {
    full: (cents) => full.format(cents / 100),
    amount: (cents) => amount.format(cents / 100),
    sign,
  };
}

function Progress<T extends string>({
  state,
  totalCents,
  copy,
  money,
  testId,
}: {
  state: TenderSplitState<T>;
  totalCents: number;
  copy: TenderSplitCopy;
  money: MoneyFormats;
  testId: string;
}) {
  const covered = state.outcome === 'READY';
  const percent = totalCents > 0 ? Math.min(100, (state.launchedCents / totalCents) * 100) : 0;
  return (
    <Stack spacing={0.75}>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={covered ? 'success' : 'primary'}
        aria-label={copy.progressLabel}
        sx={{ height: 8, borderRadius: 999 }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" color="text.secondary" data-testid={`${testId}-launched`}>
          {copy.launchedLabel} <b>{money.full(state.launchedCents)}</b>
        </Typography>
        <RestLabel state={state} copy={copy} money={money} testId={testId} />
      </Box>
    </Stack>
  );
}

function RestLabel<T extends string>({
  state,
  copy,
  money,
  testId,
}: {
  state: TenderSplitState<T>;
  copy: TenderSplitCopy;
  money: MoneyFormats;
  testId: string;
}) {
  const id = `${testId}-rest`;
  if (state.outcome === 'READY') {
    return (
      <Typography variant="caption" color="success.main" fontWeight={500} data-testid={id}>
        {copy.coveredLabel}
      </Typography>
    );
  }
  if (state.restCents < 0) {
    return (
      <Typography variant="caption" color="error" data-testid={id}>
        {copy.over(money.full(-state.restCents))}
      </Typography>
    );
  }
  return (
    <Typography variant="caption" color="text.secondary" data-testid={id}>
      {copy.missingLabel} <b>{money.full(state.restCents)}</b>
    </Typography>
  );
}

function confirmText<T extends string>(
  state: TenderSplitState<T>,
  totalCents: number,
  copy: TenderSplitCopy,
  money: MoneyFormats,
): string {
  switch (state.outcome) {
    case 'EMPTY':
      return copy.pickFirst;
    case 'INVALID':
      return copy.invalid;
    case 'SHORT':
      return copy.missing(money.full(state.restCents));
    case 'OVER':
      return copy.over(money.full(-state.restCents));
    case 'READY':
      return copy.confirm(money.full(totalCents));
  }
}
