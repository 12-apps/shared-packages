'use client';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import Box from '@mui/material/Box/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import Menu from '@mui/material/Menu/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import React, { useState } from 'react';

import { HeaderButton } from '../HeaderButton';
import type { HeaderActionItem, HeaderActionsProps } from './HeaderActions.types';

/** Drop the gated-away entries, so everything below can count what is left. */
function present(
  actions: HeaderActionsProps['actions'],
): HeaderActionItem[] {
  return actions.filter(
    (action): action is HeaderActionItem => Boolean(action) && (action as HeaderActionItem).visible !== false,
  );
}

/**
 * The page header's actions, as ONE control that scales with how many there
 * are: nothing, a button, or a button plus an overflow menu.
 *
 * | actions | renders |
 * |---|---|
 * | 0 | nothing at all — not an empty box, and not a menu with no items |
 * | 1 | that action, as an ordinary `HeaderButton` |
 * | n | the FIRST as a button; the other n−1 inside one dropdown |
 *
 * ## Why the first one stays a button
 *
 * A header whose every action lives behind a menu costs two clicks for the
 * thing the page is FOR — "Novo produto" on a catalog, "Nova categoria" on the
 * categories list. Folding it in with the exports and the reorder screens
 * would treat a merchant's daily action as equal to the one they use monthly.
 * So the array is in PRIORITY order and index 0 keeps its button; everything
 * after it is secondary by the caller's own declaration.
 *
 * ## Why this takes a list and not children
 *
 * The 0/1/n decision is only decidable over data. A component handed JSX can
 * count `React.Children`, but it cannot tell a gated-away action from an
 * absent one, cannot read a label to put in a menu row, and cannot re-render
 * a `<Button>` as a `<MenuItem>` without reaching into its props. Every
 * caller in the estate had therefore hand-written the row, which is how four
 * equally-weighted buttons ended up wrapping the line on a catalog page.
 *
 * ## One element, so the spacing is the component's and not the mount's
 *
 * It renders an `inline-flex` box rather than a fragment. A fragment inherits
 * whatever gap its parent happens to set, and the two mounts here set
 * different ones — a `Dashboard.Header` spaces its children, a
 * `Dashboard.Action` slot does not, which is why the pair of buttons in that
 * slot sat flush against each other. The gap belongs to the control.
 *
 * ## The ids survive the move
 *
 * An action that overflows keeps its `dataTestId` on its `MenuItem`. It is a
 * different element in a different place, and it must still answer to the same
 * selector: otherwise adding a fifth action to a header silently breaks the
 * suite of the action that got pushed out, which is the last place anyone
 * would look.
 */
export function HeaderActions({
  actions,
  moreLabel,
  collapseBelow = 'md',
  testIdPrefix = 'header-actions',
}: HeaderActionsProps): React.JSX.Element | null {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const items = present(actions);
  const open = Boolean(anchorEl);

  // Before the early return would be a conditional hook; after it is the only
  // legal place. Nothing below runs for an empty list anyway.
  const [primary, ...overflow] = items;
  if (!primary) return null;

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <HeaderButton
        text={primary.text}
        icon={primary.icon}
        onClick={primary.onClick}
        disabled={primary.disabled}
        variant={primary.variant}
        color={primary.color}
        collapseBelow={collapseBelow}
        dataTestId={primary.dataTestId ?? primary.id}
      />
      {overflow.length > 0 && (
        <>
          <HeaderButton
            text={moreLabel}
            icon={<MoreHorizIcon fontSize="small" />}
            endIcon={<ExpandMoreIcon fontSize="small" />}
            onClick={(event) => setAnchorEl(event.currentTarget)}
            collapseBelow={collapseBelow}
            aria-haspopup="menu"
            aria-expanded={open}
            dataTestId={`${testIdPrefix}-more-trigger`}
          />
          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            data-testid={`${testIdPrefix}-more-menu`}
          >
            {overflow.map((action) => (
              <MenuItem
                key={action.id}
                disabled={action.disabled}
                onClick={() => {
                  setAnchorEl(null);
                  action.onClick?.();
                }}
                data-testid={action.dataTestId ?? action.id}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>{action.icon}</ListItemIcon>
                <ListItemText>{action.text}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
}
