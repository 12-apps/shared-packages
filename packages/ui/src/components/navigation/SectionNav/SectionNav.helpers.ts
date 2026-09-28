import type { SectionNavAction, SectionNavDestination, SectionNavMenu } from './SectionNav.types';

/** A count worth drawing: positive and finite. Zero and "unknown" draw nothing. */
export function shownCount(count: number | undefined): number | undefined {
  return count !== undefined && Number.isFinite(count) && count > 0 ? count : undefined;
}

/**
 * The "more" slot's badge: its entries' counts, rolled up.
 *
 * The same reason a folded sidebar parent shows its children's counts — the
 * sheet starts closed, so a count only visible once it is opened is one nobody
 * sees.
 */
export function menuCount(menu: SectionNavMenu | undefined): number | undefined {
  if (!menu) return undefined;
  const total = menu.groups
    .flatMap((group) => group.entries)
    .reduce((sum, entry) => sum + (shownCount(entry.badge) ?? 0), 0);
  return shownCount(total);
}

/** Is the viewer on one of this menu's entries? Then its slot reads as current. */
export function menuActive(menu: SectionNavMenu | undefined): boolean {
  return menu?.groups.some((group) => group.entries.some((entry) => entry.active === true)) ?? false;
}

/** What one bar slot holds, in left-to-right order. */
export type BarSlot =
  | { kind: 'destination'; destination: SectionNavDestination }
  | { kind: 'more' }
  | { kind: 'primary' };

/**
 * The bar's slots: the destinations, then `more`, with `primary` in the MIDDLE.
 *
 * The middle is where a thumb rests and where a raised button reads as the
 * one thing this bar is for. With four slots it lands between the second and
 * the third; with an odd count it takes the lower middle, so the heavier side
 * is the right one, under the thumb of a right-handed phone.
 */
export function barSlots(
  destinations: readonly SectionNavDestination[],
  hasMore: boolean,
  hasPrimary: boolean,
): BarSlot[] {
  const slots: BarSlot[] = destinations.map((destination) => ({ kind: 'destination', destination }));
  if (hasMore) slots.push({ kind: 'more' });
  if (hasPrimary) slots.splice(Math.floor(slots.length / 2), 0, { kind: 'primary' });
  return slots;
}

/** A primary that opens a sheet, as opposed to one that acts on tap. */
export function isMenu(primary: SectionNavMenu | SectionNavAction | undefined): primary is SectionNavMenu {
  return primary !== undefined && 'groups' in primary;
}

/**
 * How a destination reads. `current` is `aria-current="page"` and belongs to a
 * LINK only — an action slot that is ON reports `aria-pressed` instead. `lit`
 * is the look, and a `dimmed` slot is never lit: it says "not now".
 */
export function destinationState(destination: SectionNavDestination): { current: boolean; lit: boolean } {
  const active = destination.active === true;
  return { current: active && destination.href !== undefined, lit: active && destination.dimmed !== true };
}
