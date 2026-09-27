'use client';

import { Box, ButtonBase, IconButton, InputBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { FocusEvent, ReactNode } from 'react';

import { CloseIcon } from '../components/checkout/icons';
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
  /** The glyph on the card; `null` for a host that draws none. */
  readonly icon: ReactNode;
  readonly givesChange: boolean;
}

const CARD_RADIUS = 1.5;

/** A tender nobody picked yet: one tap picks it. */
export function TenderChoice<T extends string>({
  tender,
  testId,
  autoFocus,
  onPick,
}: {
  tender: TenderOption<T>;
  testId: string;
  /** The card just removed comes back as a choice and keeps the focus. */
  autoFocus: boolean;
  onPick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onPick}
      autoFocus={autoFocus}
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 0.75,
        p: 1.5,
        minHeight: 74,
        container: 'tender-card / inline-size',
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
  autoFocus,
  onType,
  onRemove,
}: {
  tender: TenderOption<T>;
  value: string;
  shared: boolean;
  currencySign: string;
  copy: TenderSplitCopy;
  testId: string;
  /** The card just picked takes the focus, so its amount can be typed at once. */
  autoFocus: boolean;
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
        container: 'tender-card / inline-size',
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
        sx={{ position: 'absolute', top: (t) => t.spacing(0.5), right: (t) => t.spacing(0.5), color: 'text.secondary' }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <AmountField
        label={copy.amountLabel(tender.label)}
        value={value}
        currencySign={currencySign}
        autoFocus={autoFocus}
        testId={`${testId}-amount`}
        onType={onType}
      />
      {/* Under the field rather than beside it, where a narrow card had no room
          for it and the amount both. */}
      {shared ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
          {copy.sharedHint}
        </Typography>
      ) : null}
    </Box>
  );
}

/** A picked card's amount: the currency sign in front, never squeezed. */
function AmountField({
  label,
  value,
  currencySign,
  autoFocus,
  testId,
  onType,
}: {
  label: string;
  value: string;
  currencySign: string;
  autoFocus: boolean;
  testId: string;
  onType: (typed: string) => void;
}) {
  return (
    <InputBase
      value={value}
      onChange={(event) => onType(event.target.value)}
      onFocus={(event: FocusEvent<HTMLInputElement>) => event.target.select()}
      autoFocus={autoFocus}
      inputProps={{
        inputMode: 'decimal',
        'aria-label': label,
        'data-testid': testId,
      }}
      startAdornment={
        // Never shrunk: squeezed by the amount beside it, the sign read "R."
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, flexShrink: 0 }}>
          {currencySign}
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
  );
}

/**
 * The glyph and the name. Side by side on a card with room; on a narrow one
 * (a 320px phone halves to ~88px) the glyph goes on top, beside the remove
 * control, so the name gets the whole width and breaks only between words.
 */
function TenderHeading<T extends string>({ tender }: { tender: TenderOption<T> }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.75,
        minWidth: 0,
        '@container tender-card (min-width: 120px)': {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 1,
          pr: 3,
        },
      }}
    >
      {tender.icon === null ? null : (
        <Box component="span" aria-hidden sx={{ display: 'flex', color: 'primary.main' }}>
          {tender.icon}
        </Box>
      )}
      <Typography component="span" sx={{ fontWeight: 500, overflowWrap: 'break-word' }}>
        {tender.label}
      </Typography>
    </Box>
  );
}
