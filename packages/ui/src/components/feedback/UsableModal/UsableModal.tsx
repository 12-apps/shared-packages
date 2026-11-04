import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { lazy, Suspense, useState, type ComponentType } from 'react';

import { recoverChunk } from './recover-chunk';
import type { UsableModalLayout, UsableModalProps, UsableModalSurfaceProps } from './UsableModal.types';

type Surface = 'modal' | 'sheet';

/**
 * Each surface is its own chunk (the package builds with `splitting: true`), so
 * a phone never downloads `StackedModal` and a computer never downloads `Sheet`.
 * A chunk a deploy replaced is retried, then the page reloads once onto the
 * current build (`./recover-chunk`) — never the host's error boundary.
 */
const StackedSurface = lazy(
  recoverChunk(async (): Promise<{ default: ComponentType<UsableModalSurfaceProps> }> => ({
    default: (await import('./UsableModal.modal')).UsableModalStacked,
  })),
);
const SheetSurface = lazy(
  recoverChunk(async (): Promise<{ default: ComponentType<UsableModalSurfaceProps> }> => ({
    default: (await import('./UsableModal.sheet')).UsableModalSheet,
  })),
);

/** The surface the viewport asks for now: a sheet below `sm`, a stacked modal from `sm` up. */
function useViewportSurface(layout: UsableModalLayout): Surface {
  const theme = useTheme();
  // `noSsr`: the first render already knows the width, so a phone never mounts
  // (and never fetches) the stacked modal for one frame before the sheet.
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  if (layout !== 'auto') return layout;
  return phone ? 'sheet' : 'modal';
}

/**
 * The surface is chosen when the modal OPENS and kept until it closes: a phone
 * turned to landscape, or a window narrowed past `sm`, mid-task, does not swap
 * the surface and throw away what the person typed. The next opening asks the
 * viewport again.
 */
function useOpenedSurface(open: boolean, layout: UsableModalLayout): Surface | null {
  const viewport = useViewportSurface(layout);
  const [surface, setSurface] = useState<Surface | null>(open ? viewport : null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSurface(viewport);
  }
  return surface;
}

/**
 * A modal that is a `StackedModal` on a computer and a bottom `Sheet` on a
 * phone, behind one API: title, body, a pinned footer, and the ways out.
 *
 * Nothing is fetched until the first open: until then it renders nothing.
 * After it, the surface stays mounted and is handed `open`, so it runs its own
 * close — the slide-out, and the stacked modal leaving its stack. While the
 * chunk loads the screen shows no placeholder: a modal that blinks a spinner
 * before its content is worse than one that appears a frame later.
 */
export function UsableModal({ layout = 'auto', ...props }: UsableModalProps): React.JSX.Element | null {
  const surface = useOpenedSurface(props.open, layout);
  if (surface === null) return null;
  const Shown = surface === 'sheet' ? SheetSurface : StackedSurface;
  return (
    <Suspense fallback={null}>
      <Shown {...props} />
    </Suspense>
  );
}
