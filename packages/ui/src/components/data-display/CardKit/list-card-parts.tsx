'use client';

import type { JSX, ReactNode } from 'react';

import { Box } from '../../../mui/Box';

import type { CardFactProps, CardLedgerLine } from './CardKit.types';

/**
 * THE SHARED FURNITURE OF AN EXPANDED LIST-CARD BODY.
 *
 * `BaseListCard` says nothing about what goes inside a row's expanded area — it
 * spans the rails and stops, because the design belongs to the consumer. Right
 * for the card; wrong as the place where every entity in an admin app invents
 * its own two-column layout, its own label/value pair and its own ledger.
 *
 * So the four shapes that actually repeat live here, once. Nothing here knows a
 * domain: they take `ReactNode` and lay it out.
 */

/** The expanded body's two-column split: detail on the left, a ledger right. */
export function DetailColumns({ left, right }: { left: ReactNode; right: ReactNode }): JSX.Element {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
      <Box sx={{ minWidth: 0 }}>{left}</Box>
      <Box sx={{ minWidth: 0 }}>{right}</Box>
    </Box>
  );
}

/**
 * One labelled fact inside an expanded body.
 *
 * Horizontal, not stacked: the body is already a wide area with room for a
 * label beside its value, and stacking them there would ape the summary rails
 * above without their alignment.
 */
export function Fact({ label, value }: CardFactProps): JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 13, py: 0.25 }}>
      <Box component="span" sx={{ color: 'text.secondary', flexShrink: 0 }}>
        {label}
      </Box>
      <Box component="span" sx={{ minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>
        {value}
      </Box>
    </Box>
  );
}

/**
 * A money ledger: rows of label/amount, then a ruled total.
 *
 * The total is separated by a RULE rather than by weight alone, because a
 * subtotal and a total in one column with only bold between them is the classic
 * misread — the eye lands on whichever number is larger.
 *
 * The figures arrive pre-formatted. This is a layout, and a component that
 * formatted money would be choosing a locale on the consumer's behalf.
 */
export function Ledger({
  lines,
  total,
}: {
  lines: CardLedgerLine[];
  total: { label: string; value: ReactNode };
}): JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {lines.map((line) => (
        <Box
          key={line.label}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 13,
            color: line.tone === 'info' ? 'info.main' : 'text.secondary',
          }}
        >
          <Box component="span">{line.label}</Box>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {line.value}
          </Box>
        </Box>
      ))}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 700,
          borderTop: 1,
          borderColor: 'divider',
          pt: 0.5,
          mt: 0.5,
        }}
      >
        <Box component="span">{total.label}</Box>
        <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {total.value}
        </Box>
      </Box>
    </Box>
  );
}

/** A heading inside the expanded body, for a section that needs naming. */
export function BodyHeading({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box
      sx={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: 'text.disabled',
        mb: 0.5,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * A wrapping run of small items — permission names, role names, target ids.
 *
 * The whole reason several entities earn a list card at all: a `string[]` has no
 * honest table cell. Truncated to "3 items" it says nothing; printed in full it
 * destroys the column. Here it simply wraps.
 */
export function TagList({
  items,
  empty,
}: {
  items: readonly string[];
  /** What to show for an empty run — the consumer's sentence, no default. */
  empty: string;
}): JSX.Element {
  if (items.length === 0) {
    return <Box sx={{ fontSize: 13, color: 'text.disabled' }}>{empty}</Box>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {items.map((item) => (
        <Box
          key={item}
          component="span"
          sx={{
            fontSize: 12,
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            bgcolor: 'action.hover',
            color: 'text.secondary',
            fontFamily: 'monospace',
          }}
        >
          {item}
        </Box>
      ))}
    </Box>
  );
}
