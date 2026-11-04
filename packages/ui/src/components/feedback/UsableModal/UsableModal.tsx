import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { lazy, Suspense } from 'react';

import type { UsableModalLayout, UsableModalProps } from './UsableModal.types';

/**
 * Each surface is its own chunk (the package builds with `splitting: true`), so
 * a phone never downloads `StackedModal` and a computer never downloads `Sheet`.
 */
const StackedSurface = lazy(async () => ({ default: (await import('./UsableModal.modal')).UsableModalStacked }));
const SheetSurface = lazy(async () => ({ default: (await import('./UsableModal.sheet')).UsableModalSheet }));

/** The surface the viewport asks for: a sheet below `sm`, a stacked modal from `sm` up. */
function useSurface(layout: UsableModalLayout): 'modal' | 'sheet' {
  const theme = useTheme();
  // `noSsr`: the first render already knows the width, so a phone never mounts
  // (and never fetches) the stacked modal for one frame before the sheet.
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  if (layout !== 'auto') return layout;
  return phone ? 'sheet' : 'modal';
}

/**
 * A modal that is a `StackedModal` on a computer and a bottom `Sheet` on a
 * phone, behind one API: title, body, a pinned footer, and the ways out.
 *
 * Nothing is fetched until it opens: a closed modal renders nothing, and the
 * surface's chunk loads on the first open. While it loads the screen shows no
 * placeholder — a modal that blinks a spinner before its content is worse than
 * one that appears a frame later.
 */
export function UsableModal({ layout = 'auto', ...props }: UsableModalProps): React.JSX.Element | null {
  const surface = useSurface(layout);
  if (!props.open) return null;
  return <Suspense fallback={null}>{surface === 'sheet' ? <SheetSurface {...props} /> : <StackedSurface {...props} />}</Suspense>;
}
