import type { SxProps, Theme } from '@mui/material/styles/index.js';

/**
 * A caller's paper props, MERGED over the variant's rather than replacing them
 * (FUT-2613).
 *
 * MUI reaches the paper through two props, and both used to replace ours whole:
 * `PaperProps` (spread after ours) and `slotProps.paper` (which MUI itself puts
 * over `PaperProps`). A caller asking for one class, or one `sx` tweak, lost
 * the variant's radius, width, background and the paper's test id with it.
 *
 * Only the keys the merge reads are typed here; every other key the caller
 * passed rides the spread through untouched.
 */
interface PaperSlotValue {
  sx?: SxProps<Theme>;
  className?: string;
  'data-testid'?: string;
}

/** A paper slot as MUI takes it: an object, or a function of the owner state. */
type PaperSlot<O> = PaperSlotValue | ((ownerState: O) => PaperSlotValue);

/** Our look first, then whatever `sx` the caller adds — so the caller's escape hatch still wins. */
function sxList(caller: SxProps<Theme> | undefined): readonly unknown[] {
  if (caller === undefined) return [];
  return Array.isArray(caller) ? caller : [caller];
}

function mergeOver(
  look: SxProps<Theme>,
  testId: string | undefined,
  legacy: PaperSlotValue | undefined,
  slot: PaperSlotValue | undefined,
): PaperSlotValue {
  // MUI's own order: `slotProps.paper` over `PaperProps`.
  const caller: PaperSlotValue = { ...legacy, ...slot };
  return {
    ...caller,
    sx: [look, ...sxList(legacy?.sx), ...sxList(slot?.sx)] as SxProps<Theme>,
    // A key the caller set to `undefined` does not erase the dialog's id.
    'data-testid': caller['data-testid'] ?? testId,
  };
}

/**
 * The one paper slot to hand MUI: the variant's `look`, then `PaperProps`, then
 * `slotProps.paper`. A function slot stays a function, so MUI still calls it
 * with its owner state and its result merges the same way.
 *
 * `testId` names the paper unless the caller's props name it; the drawer passes
 * none, because its id already sits on the Drawer root.
 */
export function mergedPaperSlot<O>(
  look: SxProps<Theme>,
  testId: string | undefined,
  legacy: PaperSlotValue | undefined,
  slot: PaperSlot<O> | undefined,
): PaperSlot<O> {
  if (typeof slot === 'function') {
    return (ownerState: O) => mergeOver(look, testId, legacy, slot(ownerState));
  }
  return mergeOver(look, testId, legacy, slot);
}
