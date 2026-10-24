import type { ReactNode } from 'react';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info' | 'promise';
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface ToastProps {
  id?: string;
  message: ReactNode;
  variant?: ToastVariant;
  duration?: number;
  persistent?: boolean;
  closable?: boolean;
  /** The close button's accessible name; defaults to `UI_LABELS['en-US'].common.close`;
   *  a host passes `CHROME_COPY[locale].dismissToast`. */
  closeLabel?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  promise?: {
    loading: string;
    success: string | ((data: unknown) => string);
    error: string | ((error: unknown) => string);
  };
  glass?: boolean;
  onClose?: (id: string) => void;
  dataTestId?: string;
}

export interface ToastContainerProps {
  /** Applied to every toast that sets no `closeLabel` of its own. */
  closeLabel?: string;
  position?: ToastPosition;
  maxToasts?: number;
  gap?: number;
  className?: string;
  dataTestId?: string;
}

export interface ToastItem extends ToastProps {
  id: string;
  timestamp: number;
}

export interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastProps, 'id'>) => string;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
  promise: <T>(
    promise: Promise<T>,
    options: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: unknown) => string);
    },
  ) => Promise<T>;
}
