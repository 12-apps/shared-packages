import type { FC, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ModalInfo, ModalPanelRole, ModalStackContextValue } from './StackedModal.types';

/** MUI Dialog default z-index; each panel in the stack sits 10 above the last. */
const BASE_Z_INDEX = 1300;
const Z_INDEX_STEP = 10;

const noop = (): void => {
  /** do nothing */
};

const ModalStackContext = createContext<ModalStackContextValue>({
  stack: [],
  pushModal: noop,
  popModal: noop,
  clearStack: noop,
  currentDepth: 0,
  isModalInStack: () => false,
  getModalRole: () => null,
});

export const useModalStack = (): ModalStackContextValue => {
  const context = useContext(ModalStackContext);
  if (!context) {
    throw new Error('useModalStack must be used within a ModalStackProvider');
  }
  return context;
};

/** Top of the stack drives the view; the one behind it recedes; the rest are hidden. */
const roleAt = (index: number, depth: number): ModalPanelRole => {
  if (index === depth - 1) return 'primary';
  if (index === depth - 2) return 'secondary';
  return 'background';
};

/** Re-derive every role from stack position — the one place roles are assigned. */
const withRoles = (stack: ModalInfo[]): ModalInfo[] =>
  stack.map((modal, index) => ({ ...modal, role: roleAt(index, stack.length) }));

/**
 * Locks body scroll while any modal is open, restoring whatever the page had
 * before. Owned by the provider rather than each modal, so nested panels can't
 * fight over the same style.
 */
const useBodyScrollLock = (locked: boolean): void => {
  const originalOverflow = useRef<string>('');

  useEffect(() => {
    const restore = (): void => {
      if (!originalOverflow.current) return;
      document.body.style.overflow = originalOverflow.current;
      originalOverflow.current = '';
    };

    if (locked) {
      if (!originalOverflow.current) {
        originalOverflow.current = document.body.style.overflow || '';
      }
      document.body.style.overflow = 'hidden';
    } else {
      restore();
    }

    return restore;
  }, [locked]);
};

export const ModalStackProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [stack, setStack] = useState<ModalInfo[]>([]);

  useBodyScrollLock(stack.length > 0);

  const pushModal = useCallback((modalId: string) => {
    setStack((prev) => {
      if (prev.some((m) => m.id === modalId)) return prev;
      const entry: ModalInfo = {
        id: modalId,
        zIndex: BASE_Z_INDEX + prev.length * Z_INDEX_STEP,
        role: 'primary',
      };
      return withRoles([...prev, entry]);
    });
  }, []);

  const popModal = useCallback((modalId?: string) => {
    setStack((prev) =>
      withRoles(modalId ? prev.filter((m) => m.id !== modalId) : prev.slice(0, -1)),
    );
  }, []);

  const clearStack = useCallback(() => setStack([]), []);

  const isModalInStack = useCallback(
    (modalId: string) => stack.some((m) => m.id === modalId),
    [stack],
  );

  const getModalRole = useCallback(
    (modalId: string) => stack.find((m) => m.id === modalId)?.role ?? null,
    [stack],
  );

  const value = useMemo(
    () => ({
      stack,
      pushModal,
      popModal,
      clearStack,
      currentDepth: stack.length,
      isModalInStack,
      getModalRole,
    }),
    [stack, pushModal, popModal, clearStack, isModalInStack, getModalRole],
  );

  return <ModalStackContext.Provider value={value}>{children}</ModalStackContext.Provider>;
};
