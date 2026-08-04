import type { ReactNode } from 'react';

/** A modal's position in the stack: the top panel, the one behind it, or hidden. */
export type ModalPanelRole = 'primary' | 'secondary' | 'background';

/** The breakpoint the panel's width is capped at, or `false` for uncapped. */
export type PanelMaxWidth = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;

export interface StackedModalProps {
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
