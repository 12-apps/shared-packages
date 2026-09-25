import type { SxProps, Theme } from '@mui/material/styles/index.js';

/**
 * A caller's slot props, MERGED over the Dialog's own rather than replacing
 * them — for the paper (FUT-2613) and the backdrop (FUT-2672).
 *
 * MUI reaches each slot through two props, and both used to replace ours
 * whole: the deprecated `PaperProps`/`BackdropProps` (spread after ours) and
 * `slotProps.paper`/`slotProps.backdrop` (which MUI itself puts over the
 * deprecated one). A caller asking for one class, or one `sx` tweak, lost the
 * variant's radius, width, background and the paper's test id with it — or,
 * on the backdrop, the scrim and the `glass` blur.
 *
 * Only the keys the merge reads are typed here; every other key the caller
 * passed rides the spread through untouched.
 */
interface SlotValue {
  sx?: SxProps<Theme>;
  className?: string;
}

interface PaperSlotValue extends SlotValue {
  'data-testid'?: string;
}

/** A slot as MUI takes it: an object, or a function of the owner state. */
type Slot<V, O> = V | ((ownerState: O) => V);

/** Our look first, then whatever `sx` the caller adds — so the caller's escape hatch still wins. */
function sxList(caller: SxProps<Theme> | undefined): readonly unknown[] {
  if (caller === undefined) return [];
  return Array.isArray(caller) ? caller : [caller];
}

function mergeOver<V extends SlotValue>(
  look: SxProps<Theme>,
  legacy: V | undefined,
  slot: V | undefined,
): V {
  // MUI's own order: `slotProps.<slot>` over the deprecated `<Slot>Props`.
  return {
    ...legacy,
    ...slot,
    sx: [look, ...sxList(legacy?.sx), ...sxList(slot?.sx)] as SxProps<Theme>,
  } as V;
}

/**
 * The one slot to hand MUI: the Dialog's `look`, then the deprecated prop,
 * then `slotProps.<slot>`, each value passed through `finish`. A function slot
 * stays a function, so MUI still calls it with its owner state and its result
 * merges the same way.
 */
function mergedSlot<V extends SlotValue, O>(
  look: SxProps<Theme>,
  legacy: V | undefined,
  slot: Slot<V, O> | undefined,
  finish: (merged: V) => V = (merged) => merged,
): Slot<V, O> {
  if (typeof slot === 'function') {
    return (ownerState: O) => finish(mergeOver(look, legacy, slot(ownerState)));
  }
  return finish(mergeOver(look, legacy, slot));
}

/**
 * The paper slot: the variant's `look`, then `PaperProps`, then
 * `slotProps.paper`.
 *
 * `testId` names the paper unless the caller's props name it; the drawer passes
 * none, because its id already sits on the Drawer root.
 */
export function mergedPaperSlot<O>(
  look: SxProps<Theme>,
  testId: string | undefined,
  legacy: PaperSlotValue | undefined,
  slot: Slot<PaperSlotValue, O> | undefined,
): Slot<PaperSlotValue, O> {
  return mergedSlot(look, legacy, slot, (merged) => ({
    ...merged,
    // A key the caller set to `undefined` does not erase the dialog's id.
    'data-testid': merged['data-testid'] ?? testId,
  }));
}

/**
 * The backdrop slot: the scrim (`backdropSxOf`), then `BackdropProps`, then
 * `slotProps.backdrop`. Both renderers need it: MUI's `Dialog` would replace
 * our backdrop props with a caller's, and MUI's `Drawer` takes
 * `slotProps.backdrop` INSTEAD of `BackdropProps` whenever it is given — so
 * once the scrim rides `slotProps.backdrop`, a caller's `BackdropProps` would
 * silently drop unless it is folded in here.
 */
export function mergedBackdropSlot<O>(
  look: SxProps<Theme>,
  legacy: SlotValue | undefined,
  slot: Slot<SlotValue, O> | undefined,
): Slot<SlotValue, O> {
  return mergedSlot(look, legacy, slot);
}

/** What the transition slot's `onEntered` looks like on either renderer. */
interface TransitionSlotValue {
  onEntered?: (node: HTMLElement, isAppearing: boolean) => void;
}

/**
 * The transition slot: `onFocusEntered` (initial-focus, FUT-2696) runs
 * first, then the deprecated `TransitionProps`/`SlideProps`, then
 * `slotProps.transition` — so a caller's own `onEntered` still runs, and
 * still runs last, meaning it can move focus again if it wants to.
 *
 * No `sx`/`look` here: unlike the paper and the backdrop, the transition slot
 * carries no visual look of the Dialog's own to merge under a caller's.
 */
export function mergedTransitionSlot<O>(
  onFocusEntered: (node: HTMLElement, isAppearing: boolean) => void,
  legacy: TransitionSlotValue | undefined,
  slot: Slot<TransitionSlotValue, O> | undefined,
): Slot<TransitionSlotValue, O> {
  const compose = (merged: TransitionSlotValue): TransitionSlotValue => ({
    ...merged,
    onEntered: (node: HTMLElement, isAppearing: boolean) => {
      onFocusEntered(node, isAppearing);
      merged.onEntered?.(node, isAppearing);
    },
  });
  if (typeof slot === 'function') {
    return (ownerState: O) => compose({ ...legacy, ...slot(ownerState) });
  }
  return compose({ ...legacy, ...slot });
}
