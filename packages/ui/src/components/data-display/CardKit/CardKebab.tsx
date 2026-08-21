'use client';

import type { JSX } from 'react';

import { Button } from '../../form/Button';
import { DropdownMenu, type DropdownMenuItem } from '../../navigation/DropdownMenu';

/**
 * The "⋮" trigger every row and card menu opens from.
 *
 * One component rather than a `DropdownMenu` per entity, so the kebab looks and
 * behaves identically in the card, in the list row and in the table row. The
 * entity's menu owns its own popups; this is the trigger and the item list.
 */
export function CardKebab({
  items,
  menuLabel,
  dataTestId,
}: {
  items: DropdownMenuItem[];
  /**
   * The trigger's accessible name — required, and with no default.
   *
   * It is the only text this component renders, and a screen reader announces
   * it verbatim. A default here would be a word in the origin's language that
   * reads as finished to the next adopter right up until somebody using a
   * screen reader meets it.
   */
  menuLabel: string;
  dataTestId?: string;
}): JSX.Element {
  return (
    <DropdownMenu
      size="sm"
      items={items}
      trigger={
        <Button variant="text" size="sm" aria-label={menuLabel} dataTestId={dataTestId}>
          ⋮
        </Button>
      }
    />
  );
}
