import type { ReactNode } from 'react';

import type { PanelSize, PanelWidth } from '../StackedModal/StackedModal.types';

/** Which surface draws the modal: chosen by the viewport, or fixed by the host. */
export type UsableModalLayout = 'auto' | 'modal' | 'sheet';

export interface UsableModalProps {
  /** Controls the visibility of the modal. */
  open: boolean;
  /** Fired by every way out: the ✕, Esc, the backdrop, a swipe down on the sheet. */
  onClose: () => void;
  /** Names the dialog: the stacked modal's bar, the sheet's header. */
  title: string;
  /** The body. It scrolls; the footer does not. */
  children?: ReactNode;
  /** The pinned action bar at the bottom of either surface — the screen's acts. */
  footer?: ReactNode;
  /** The ✕'s accessible name — it carries a glyph only. REQUIRED. */
  closeLabel: string;
  /** The stacked modal's back arrow, shown when it opens over another panel. REQUIRED. */
  backLabel: string;
  /**
   * `auto` (default): a bottom `Sheet` below the theme's `sm` breakpoint, a
   * `StackedModal` from `sm` up. `modal` and `sheet` fix one surface, for a host
   * that already knows (a test, a kiosk).
   */
  layout?: UsableModalLayout;
  /** The stacked modal's viewport share (`StackedModal`'s `size`). */
  size?: PanelSize;
  /** An exact width for the stacked modal (`StackedModal`'s `panelWidth`). */
  panelWidth?: PanelWidth;
  /** Base test id: the surface carries it, and `-footer` marks the action bar. */
  dataTestId?: string;
}

/** What each lazily loaded surface receives: the host's props, layout already decided. */
export type UsableModalSurfaceProps = Omit<UsableModalProps, 'layout'>;
