import type { JSX } from 'react';

import { CardKebab, rowActionsToMenuItems } from '@12-apps/ui/data-display/CardKit';
import type { RowAction } from '@12-apps/ui/data-display/DataViews';

import type { TeamRow } from './team-grid-config';

/**
 * A roster row's ⋮ menu, shared by the table row and the card so the two can
 * never drift into offering different actions for the same person.
 *
 * The actions themselves are threaded in rather than built here: every one of
 * them opens a screen-level concern (the role dialog, a confirm popup, a
 * mutation), and a menu that owned them would need the screen's whole state.
 * Renders NOTHING when no action applies — an owner-protected member gets no
 * kebab rather than a kebab that opens onto an empty list.
 */
export function TeamActionsMenu({
  row,
  rowActions,
  menuLabel,
}: {
  row: TeamRow;
  rowActions: RowAction<TeamRow>[];
  /** The kebab's accessible name — announced verbatim by a screen reader. */
  menuLabel: string;
}): JSX.Element | null {
  // Each entry carries a test id derived from the ACTION's stable id, never
  // from its label: a label is host copy, so a spec clicking one would be
  // pinned to a single adopter's words — which is exactly what the packaged
  // journeys exist not to be.
  const items = rowActionsToMenuItems(rowActions, row).map((item) => ({
    ...item,
    dataTestId: `team-action-${item.id}`,
  }));
  if (items.length === 0) return null;
  return (
    <CardKebab menuLabel={menuLabel} items={items} dataTestId={`team-actions-${row.userId}`} />
  );
}
