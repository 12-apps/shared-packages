import { useMediaQuery, useTheme } from '@mui/material';
import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useModalStack } from './modal-stack';
import type { ModalPanelRole } from './StackedModal.types';

const FOCUSABLE = 'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
/** MUI Dialog's own default, used when the modal isn't registered in the stack yet. */
const FALLBACK_Z_INDEX = 1300;
/** Matches the panel's slide duration, so role swaps animate rather than jump. */
const ROLE_TRANSITION_MS = 300;

/** Keeps Tab cycling inside the open panel instead of escaping to the page behind. */
const useFocusTrap = (
  ref: RefObject<HTMLElement | null>,
  isActive: boolean,
  disabled?: boolean,
): void => {
  useEffect(() => {
    if (!isActive || disabled || !ref.current) return;

    const element = ref.current;
    const focusable = element.querySelectorAll(FOCUSABLE);
    const first = focusable[0] as HTMLElement | undefined;
    const last = focusable[focusable.length - 1] as HTMLElement | undefined;

    window.setTimeout(() => first?.focus(), 100);

    const handleTabKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const atEdge = e.shiftKey ? first : last;
      if (document.activeElement !== atEdge) return;
      e.preventDefault();
      (e.shiftKey ? last : first)?.focus();
    };

    element.addEventListener('keydown', handleTabKey);
    return () => element.removeEventListener('keydown', handleTabKey);
  }, [ref, isActive, disabled]);
};

/** Closes the panel on Escape — only while it is the top one. */
const useEscapeToClose = (active: boolean, onClose: () => void): void => {
  useEffect(() => {
    if (!active) return;

    const handleEsc = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [active, onClose]);
};

/** Holds the skeleton a beat past `loading` so the swap to content isn't a flash. */
const useSkeleton = (loading: boolean): boolean => {
  const [showSkeleton, setShowSkeleton] = useState(loading);

  useEffect(() => {
    if (loading) {
      setShowSkeleton(true);
      return;
    }
    const timer = window.setTimeout(() => setShowSkeleton(false), 200);
    return () => window.clearTimeout(timer);
  }, [loading]);

  return showSkeleton;
};

/** Registers the modal in the stack while open, and unregisters it after it slides out. */
const useStackRegistration = (open: boolean, modalId: string): void => {
  const { pushModal, popModal, isModalInStack } = useModalStack();
  const hasRegisteredRef = useRef(false);

  useEffect(() => {
    if (open && !hasRegisteredRef.current) {
      pushModal(modalId);
      hasRegisteredRef.current = true;
    } else if (!open) {
      hasRegisteredRef.current = false;
    }
  }, [open, modalId, pushModal]);

  useEffect(() => {
    if (open || !isModalInStack(modalId)) return;
    const timer = window.setTimeout(() => popModal(modalId), ROLE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open, modalId, popModal, isModalInStack]);
};

interface PanelChromeOptions {
  open?: boolean;
  modalId: string;
  loading?: boolean;
  closeOnEsc?: boolean;
  closeOnClickOutside?: boolean;
  disableFocusTrap?: boolean;
  onClose: () => void;
}

interface PanelChrome {
  dialogRef: RefObject<HTMLDivElement | null>;
  modalRole: ModalPanelRole;
  isAnimating: boolean;
  showSkeleton: boolean;
  zIndex: number;
  isMobile: boolean;
  canGoBack: boolean;
  handleBack: () => void;
  handleClose: (event: object, reason: 'backdropClick' | 'escapeKeyDown') => void;
}

/**
 * Everything the panel needs to render itself: its place in the stack, the
 * viewport it is on, and the handlers that dismiss it. Bundled into one hook so
 * the component stays a description of the markup.
 */
export const usePanelChrome = (options: PanelChromeOptions): PanelChrome => {
  const { open, modalId, loading, closeOnEsc, closeOnClickOutside, disableFocusTrap, onClose } =
    options;

  const dialogRef = useRef<HTMLDivElement>(null);
  const { currentDepth } = useModalStack();
  const { modalRole, isAnimating } = useModalRole(Boolean(open), modalId);
  const showSkeleton = useSkeleton(Boolean(loading));
  const zIndex = usePanelZIndex(modalId, FALLBACK_Z_INDEX);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isPrimary = modalRole === 'primary';
  const canGoBack = currentDepth > 1;

  useFocusTrap(dialogRef, Boolean(open) && isPrimary, disableFocusTrap);
  useEscapeToClose(Boolean(open && closeOnEsc) && isPrimary, onClose);

  const { handleBack, handleClose } = useCloseHandlers({
    isPrimary,
    closeOnClickOutside,
    closeOnEsc,
    canGoBack,
    onClose,
  });

  return {
    dialogRef,
    modalRole,
    isAnimating,
    showSkeleton,
    zIndex,
    isMobile,
    canGoBack,
    handleBack,
    handleClose,
  };
};

interface CloseHandlerOptions {
  /** Only the top panel responds to a backdrop click or Escape. */
  isPrimary: boolean;
  closeOnClickOutside?: boolean;
  closeOnEsc?: boolean;
  /** Deeper than one panel, so the leading control goes back rather than closing. */
  canGoBack: boolean;
  onClose: () => void;
}

/** The panel's dismissal handlers, honouring which gestures the caller allows. */
const useCloseHandlers = ({
  isPrimary,
  closeOnClickOutside,
  closeOnEsc,
  canGoBack,
  onClose,
}: CloseHandlerOptions): {
  handleBack: () => void;
  handleClose: (event: object, reason: 'backdropClick' | 'escapeKeyDown') => void;
} => ({
  handleBack: () => {
    if (canGoBack) onClose();
  },
  handleClose: (_event, reason) => {
    if (!isPrimary) return;
    if (reason === 'backdropClick' && !closeOnClickOutside) return;
    if (reason === 'escapeKeyDown' && !closeOnEsc) return;
    onClose();
  },
});

/** The z-index this panel was assigned when it joined the stack. */
const usePanelZIndex = (modalId: string, fallback: number): number => {
  const { stack } = useModalStack();
  return stack.find((m) => m.id === modalId)?.zIndex ?? fallback;
};

/**
 * This modal's role in the stack, plus whether it is mid-transition between two
 * roles (which drives the expand/contract animation).
 */
const useModalRole = (
  open: boolean,
  modalId: string,
): { modalRole: ModalPanelRole; isAnimating: boolean } => {
  const { stack } = useModalStack();
  const [modalRole, setModalRole] = useState<ModalPanelRole>('primary');
  const [isAnimating, setIsAnimating] = useState(false);

  useStackRegistration(open, modalId);

  useEffect(() => {
    if (!open) return;

    const newRole = stack.find((m) => m.id === modalId)?.role;
    if (!newRole || newRole === modalRole) return;

    setIsAnimating(true);
    setModalRole(newRole);
    const timer = window.setTimeout(() => setIsAnimating(false), ROLE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [stack, modalId, open, modalRole]);

  return { modalRole, isAnimating };
};
