import type { ReactNode } from 'react';

/** A modal's position in the stack: the top panel, the one behind it, or hidden. */
export type ModalPanelRole = 'primary' | 'secondary' | 'background';

/** The breakpoint the panel's width is capped at, or `false` for uncapped. */
export type PanelMaxWidth = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;

/**
 * How much of the viewport the top panel takes from `sm` up. `wide` is for a
 * dense editor that lays out two columns inside the panel, which the default
 * 60vw starves on a laptop.
 */
export type PanelSize = 'default' | 'wide';
/**
 * An exact width for the top panel, for a screen whose owner set one: the
 * panel takes `min(share, maxPx)` of the viewport, and the whole screen when
 * the viewport is narrower than `fullBelowPx`. It replaces `size` and
 * `maxWidth`. Everything here reads the VIEWPORT, never the panel, so nothing
 * inside the panel can feed back into the width that laid it out.
 */
export interface PanelWidth {
  /** The viewport share, as a CSS length (`'72vw'`). */
  share: string;
  /** The cap, in px; converted to rem like every other size here. */
  maxPx: number;
  /** Under this viewport width (px) the panel takes the whole screen. */
  fullBelowPx?: number;
}

export interface StackedModalProps {
  /** The back arrow's accessible name — it carries a glyph only. REQUIRED. */
  backLabel: string;
  /** Controls the visibility of the modal */
  open: boolean;
  /** Callback fired when the component requests to be closed */
  onClose: () => void;
  /** Enable glass morphism effect */
  glass?: boolean;
  /** Title displayed in the modal navigation bar */
  navigationTitle?: string | ReactNode;
  /**
   * Drops the header's ✕ so the navigation bar is a breadcrumb only. For panels
   * whose CONTENT owns the dismiss (a sticky action bar with its own close):
   * two ✕ a few pixels apart are the same action twice with nothing to tell
   * them apart. Never hides the BACK arrow of a stacked panel — that one is a
   * different action, and it is the only way out of depth ≥2.
   */
  hideClose?: boolean;
  /**
   * Draws no navigation bar at all, for a ROOT panel whose content carries its
   * own header — the ✕ and the panel's name in one sticky bar. A bar above it
   * holding only a breadcrumb is a second header on a screen that already has
   * one, and on a phone it costs the first 64px of the viewport.
   *
   * Pass `aria-labelledby` with it, naming the content header's title: the bar
   * is what names the dialog otherwise (a dev warning says so). Applies to the
   * ROOT panel only — a stacked panel's back arrow lives in the bar and is the
   * only way out — and the root stays bar-less while a child is open over it.
   */
  hideHeader?: boolean;
  /** Modal content */
  children?: ReactNode;
  /** Actions to display in the modal header (desktop) or footer (mobile) */
  actions?: ReactNode;
  /** Unique identifier for the modal in the stack */
  modalId?: string;
  /** Whether the modal can be closed by clicking outside */
  closeOnClickOutside?: boolean;
  /** Whether the modal can be closed by pressing the escape key */
  closeOnEsc?: boolean;
  /** Show loading skeleton overlay */
  loading?: boolean;
  /** Text to display during loading state */
  loadingText?: string;
  /** Make modal full screen */
  fullScreen?: boolean;
  /** Maximum width of the modal */
  maxWidth?: PanelMaxWidth;
  /** Viewport share of the top panel — `wide` gives a dense editor more room */
  size?: PanelSize;
  /** An exact width for the top panel; replaces `size` and `maxWidth` (see `PanelWidth`). */
  panelWidth?: PanelWidth;
  /** Disable the backdrop click behavior */
  disableBackdrop?: boolean;
  /** Disable focus trap functionality */
  disableFocusTrap?: boolean;
  /** Keep the modal mounted when closed */
  keepMounted?: boolean;
  /** ARIA labelledby attribute */
  'aria-labelledby'?: string;
  /** ARIA describedby attribute */
  'aria-describedby'?: string;
  /** Enable right-to-left language support */
  rtl?: boolean;
  /** Base test ID for testing purposes - will be used to generate testIds for all sub-elements */
  dataTestId?: string;
}

export interface ModalInfo {
  /** Unique identifier for the modal */
  id: string;
  /** Z-index value for stacking */
  zIndex: number;
  /** Role in the modal stack */
  role: ModalPanelRole;
}

export interface ModalStackContextValue {
  /** Current modal stack */
  stack: ModalInfo[];
  /** Add a modal to the stack */
  pushModal: (modalId: string) => void;
  /** Remove a modal from the stack */
  popModal: (modalId?: string) => void;
  /** Clear all modals from the stack */
  clearStack: () => void;
  /** Current depth of the modal stack */
  currentDepth: number;
  /** Check if a modal is in the stack */
  isModalInStack: (modalId: string) => boolean;
  /** Get the role of a modal in the stack */
  getModalRole: (modalId: string) => ModalPanelRole | null;
}
