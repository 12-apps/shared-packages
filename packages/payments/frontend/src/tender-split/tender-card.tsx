'use client';

import { Box, ButtonBase, IconButton, InputBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { FocusEvent, ReactNode } from 'react';

import type { TenderSplitCopy } from './copy';

/**
 * One tender the host takes in person.
 *
 * `label` and `icon` are the host's own words and glyph: which tenders a store
 * takes and what it calls them is its catalogue, never this package's.
 * `givesChange` marks the tender that may be typed above the bill, the excess
 * being change handed back — cash, in every host so far.
 */
export interface TenderOption<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly givesChange?: boolean;
}

const CARD_RADIUS = 1.5;

/** A tender nobody picked yet: one tap picks it. */
export function TenderChoice<T extends string>({
  tender,
  testId,
  onPick,
}: {
  tender: TenderOption<T>;
  testId: string;
  onPick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onPick}
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 0.75,
        p: 1.5,
        minHeight: 74,
        textAlign: 'left',
        borderRadius: CARD_RADIUS,
        border: 1.5,
        borderColor: 'divider',
        color: 'text.primary',
        transition: 'border-color .12s, background-color .12s',
        '&:hover': { borderColor: 'primary.main' },
        '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <TenderHeading tender={tender} />
    </ButtonBase>
  );
}

/**
 * A picked tender: its amount, typed or shared, and the one control that
 * lets a typed amount go.
 */
export function PickedTender<T extends string>({
  tender,
  value,
  shared,
  currencySign,
  copy,
  testId,
  onType,
  onRemove,
}: {
  tender: TenderOption<T>;
  value: string;
  shared: boolean;
  currencySign: string;
  copy: TenderSplitCopy;
  testId: string;
  onType: (typed: string) => void;
  onRemove: () => void;
}) {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1.5,
        minWidth: 0,
        borderRadius: CARD_RADIUS,
        border: 1.5,
        borderColor: 'primary.main',
        bgcolor: alpha(theme.palette.primary.main, 0.08),
      })}
    >
      <TenderHeading tender={tender} />
      <IconButton
        size="small"
        aria-label={copy.remove(tender.label)}
        onClick={onRemove}
        data-testid={`${testId}-remove`}
        sx={{ position: 'absolute', top: 4, right: 4, color: 'text.secondary' }}
      >
        ×
      </IconButton>
      <InputBase
        value={value}
        onChange={(event) => onType(event.target.value)}
        onFocus={(event: FocusEvent<HTMLInputElement>) => event.target.select()}
        inputProps={{
          inputMode: 'decimal',
          'aria-label': copy.amountLabel(tender.label),
          'data-testid': `${testId}-amount`,
        }}
        startAdornment={
          <Typography variant="caption" color="text.secondary" noWrap sx={{ mr: 0.5 }}>
            {shared ? `${currencySign} ${copy.sharedHint}` : currencySign}
          </Typography>
        }
        sx={{
          borderBottom: 1.5,
          borderColor: 'divider',
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          '&.Mui-focused': { borderColor: 'primary.main' },
          '& input': { textAlign: 'right', py: 0.375, minWidth: 0 },
        }}
      />
    </Box>
  );
}

function TenderHeading<T extends string>({ tender }: { tender: TenderOption<T> }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 3, minWidth: 0 }}>
      {tender.icon === undefined ? null : (
        <Box component="span" aria-hidden sx={{ display: 'flex', color: 'primary.main' }}>
          {tender.icon}
        </Box>
      )}
      <Typography component="span" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
        {tender.label}
      </Typography>
    </Box>
  );
}
