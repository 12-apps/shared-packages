'use client';

import { Box } from '@mui/material';
import { useMemo } from 'react';

import type { CategorySelectCopy } from '../../../copy';

import { collectLeafIds } from './category-tree';
import type { CategorySelectState } from './useCategorySelect';

/** The panel's text-button treatment. */
const linkButtonSx = {
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  color: 'primary.main',
  cursor: 'pointer',
  fontWeight: 550,
  '&:hover': { textDecoration: 'underline' },
  '&:disabled': { color: 'text.disabled', cursor: 'default', textDecoration: 'none' },
} as const;

/**
 * Bulk actions for multi-select: mark everything, and fold everything.
 *
 * Both labels flip to their inverse once the action is spent ("Desmarcar tudo",
 * "Recolher tudo"), so the control always says what pressing it will do rather
 * than what state the list is in.
 */
export function CategoryQuickActions({
  state,
  dataTestId,
  copy,
}: {
  state: CategorySelectState;
  dataTestId: string;
  /** The words this control renders. REQUIRED — no default copy. */
  copy: CategorySelectCopy;
}): React.JSX.Element {
  const allLeafIds = useMemo(() => collectLeafIds(state.allGroups), [state.allGroups]);
  const everythingPicked = allLeafIds.length > 0 && state.draft.size >= allLeafIds.length;
  const allExpanded =
    state.allGroups.length > 0 &&
    state.allGroups.every((group) => state.isExpanded(group.category.id));

  return (
    <>
      <Box
        component="button"
        type="button"
        disabled={allLeafIds.length === 0}
        data-testid={`${dataTestId}-select-all`}
        sx={linkButtonSx}
        onClick={() => state.setDraft(everythingPicked ? new Set() : new Set(allLeafIds))}
      >
        {everythingPicked ? copy.deselectAll : copy.selectAll}
      </Box>
      <Box component="span" sx={{ color: 'divider' }}>
        ·
      </Box>
      <Box
        component="button"
        type="button"
        data-testid={`${dataTestId}-expand-all`}
        sx={linkButtonSx}
        onClick={() => state.setAllExpanded(!allExpanded)}
      >
        {allExpanded ? copy.collapseAll : copy.expandAll}
      </Box>
    </>
  );
}
