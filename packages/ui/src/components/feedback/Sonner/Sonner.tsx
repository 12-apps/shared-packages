import {
  Box,
  Portal } from '@mui/material';
import React, { createContext, useCallback, useContext, useRef,useState, useMemo } from 'react';

import type { SonnerContextType, SonnerItem,SonnerProps } from './Sonner.types';

const SonnerContext = createContext<SonnerContextType | null>(null);

const DEFAULT_DURATION_MS = 4000;

const buildToastItem = (
  toast: Omit<SonnerProps, 'id'>,
  id: string,
  type?: SonnerProps['type'],
): SonnerItem => ({
  ...toast,
  id,
  type: type || toast.type || 'default',
  createdAt: Date.now(),
  visible: true });

// Persistent toasts and `duration: 0` stay until dismissed explicitly.
const scheduleAutoDismiss = (
  toast: Omit<SonnerProps, 'id'>,
  id: string,
  dismiss: (id?: string) => void,
) => {
  if (toast.persistent || toast.duration === 0) return;

  window.setTimeout(() => dismiss(id), toast.duration ?? DEFAULT_DURATION_MS);
};

const EXIT_TRANSITION_MS = 300;

type SonnerPromiseOptions<T> = {
  loading: React.ReactNode;
  success: React.ReactNode | ((data: T) => React.ReactNode);
  error: React.ReactNode | ((error: Error) => React.ReactNode);
};

const resolveMessage = <T,>(
  message: React.ReactNode | ((value: T) => React.ReactNode),
  value: T,
): React.ReactNode => (typeof message === 'function' ? message(value) : message);

// Shows a pinned loading toast for the life of a promise, then swaps it for a
// success or error one. Takes the shortcuts it needs rather than reaching for
// context, so it is testable on its own.
const trackPromiseWithToasts = async <T,>(
  promiseToResolve: Promise<T>,
  options: SonnerPromiseOptions<T>,
  toasts: {
    loading: (message: React.ReactNode) => string;
    success: (message: React.ReactNode) => string;
    error: (message: React.ReactNode) => string;
    dismiss: (id?: string) => void;
  },
): Promise<T> => {
  const toastId = toasts.loading(options.loading);

  try {
    const data = await promiseToResolve;
    toasts.dismiss(toastId);
    toasts.success(resolveMessage(options.success, data));
    return data;
  } catch (err) {
    toasts.dismiss(toastId);
    toasts.error(resolveMessage(options.error, err instanceof Error ? err : new Error(String(err))));
    throw err;
  }
};

export const SonnerProvider: React.FC<{
  children: React.ReactNode;
  /**
   * The dismiss button's accessible name, for every toast this provider
   * raises. REQUIRED and mounted ONCE — the shortcut helpers
   * (`sonner.success(…)`) take a message and nothing else by design, so the
   * word cannot be a per-call argument without changing what they are for.
   */
  dismissLabel: string;
}> = ({ children, dismissLabel }) => {
  const [toasts, setToasts] = useState<SonnerItem[]>([]);
  const toastCounter = useRef(0);

  // Hide first, then drop after the exit transition. Passing no id targets every
  // toast; the two branches only differ in which toasts they match, so that is
  // the only thing that varies here.
  const dismiss = useCallback((id?: string) => {
    const matches = (toast: SonnerItem) => id === undefined || toast.id === id;

    setToasts((prev) =>
      prev.map((toast) => (matches(toast) ? { ...toast, visible: false } : toast)),
    );

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => !matches(toast)));
    }, EXIT_TRANSITION_MS);
  }, []);

  const addToast = useCallback(
    (toast: Omit<SonnerProps, 'id'>, type?: SonnerProps['type']): string => {
      const id = `sonner-${++toastCounter.current}`;
      setToasts((prev) => [...prev, buildToastItem(toast, id, type)]);
      scheduleAutoDismiss(toast, id, dismiss);
      return id;
    },
    [dismiss],
  );

  // The six shortcuts differ only by the type they tag and, for loading, by
  // pinning persistent. Built from one factory rather than six near-identical
  // useCallback blocks.
  const makeShortcut = useCallback(
    (type: SonnerProps['type'], extra?: Partial<SonnerProps>) =>
      (message: React.ReactNode, options?: Partial<SonnerProps>) =>
        addToast({ dismissLabel, ...options, ...extra, title: message }, type),
    [addToast],
  );

  const toast = useMemo(() => makeShortcut('default'), [makeShortcut]);
  const success = useMemo(() => makeShortcut('success'), [makeShortcut]);
  const error = useMemo(() => makeShortcut('error'), [makeShortcut]);
  const warning = useMemo(() => makeShortcut('warning'), [makeShortcut]);
  const info = useMemo(() => makeShortcut('info'), [makeShortcut]);
  const loading = useMemo(
    () => makeShortcut('loading', { persistent: true }),
    [makeShortcut],
  );

  const promise = useCallback(
    <T,>(promiseToResolve: Promise<T>, options: SonnerPromiseOptions<T>): Promise<T> =>
      trackPromiseWithToasts(promiseToResolve, options, { loading, success, error, dismiss }),
    [loading, success, error, dismiss],
  );

  const contextValue: SonnerContextType = {
    toast,
    success,
    error,
    warning,
    info,
    loading,
    dismiss,
    promise };

  // Register this context globally for imperative API
  useRegisterGlobalToast(contextValue);

  return (
    <SonnerContext.Provider value={contextValue}>
      {children}
      <SonnerToaster toasts={toasts} onDismiss={dismiss} />
    </SonnerContext.Provider>
  );
};

export const useSonner = (): SonnerContextType => {
  const context = useContext(SonnerContext);
  if (!context) {
    throw new Error('useSonner must be used within a SonnerProvider');
  }
  return context;
};

// A caller-supplied icon always wins; otherwise the type picks one.
import { SonnerToast } from './SonnerToast';

const SonnerToaster: React.FC<{
  toasts: SonnerItem[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  // Limit visible toasts to prevent overflow
  const MAX_VISIBLE_TOASTS = 5;
  const visibleToasts = toasts.slice(-MAX_VISIBLE_TOASTS);
  const hiddenCount = Math.max(0, toasts.length - MAX_VISIBLE_TOASTS);

  return (
    <Portal>
      <Box
        sx={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          overflowX: 'hidden' }}
      >
        {hiddenCount > 0 && (
          <Box
            sx={{
              p: 1,
              mb: 0.5,
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'text.secondary',
              pointerEvents: 'none' }}
          >
            +{hiddenCount} more
          </Box>
        )}
        {visibleToasts.map((toast) => (
          <Box key={toast.id} sx={{ pointerEvents: 'auto' }}>
            <SonnerToast {...toast} onDismiss={onDismiss} />
          </Box>
        ))}
      </Box>
    </Portal>
  );
};

// Global toast instance for imperative API
let globalToastContext: SonnerContextType | null = null;

// Hook to register the global context (used internally by SonnerProvider)
export const useRegisterGlobalToast = (context: SonnerContextType) => {
  React.useEffect(() => {
    globalToastContext = context;
    return () => {
      globalToastContext = null;
    };
  }, [context]);
};

// Create a production-ready toast instance for imperative usage
const createToastInstance = (): SonnerContextType => {
  const warnNoProvider = () => {
    // Use a more React-appropriate warning mechanism
    if (typeof window !== 'undefined' && window.console && window.console.warn) {
      window.console.warn('Sonner: No SonnerProvider found. Please wrap your app with SonnerProvider.');
    }
  };

  const methods: SonnerContextType = {
    toast: (message: React.ReactNode, options?: Partial<SonnerProps>) => {
      if (!globalToastContext) {
        warnNoProvider();
        return 'no-provider';
      }
      return globalToastContext.toast(message, options);
    },
    success: (message: React.ReactNode, options?: Partial<SonnerProps>) => {
      if (!globalToastContext) {
        warnNoProvider();
        return 'no-provider';
      }
      return globalToastContext.success(message, options);
    },
    error: (message: React.ReactNode, options?: Partial<SonnerProps>) => {
      if (!globalToastContext) {
        warnNoProvider();
        return 'no-provider';
      }
      return globalToastContext.error(message, options);
    },
    warning: (message: React.ReactNode, options?: Partial<SonnerProps>) => {
      if (!globalToastContext) {
        warnNoProvider();
        return 'no-provider';
      }
      return globalToastContext.warning(message, options);
    },
    info: (message: React.ReactNode, options?: Partial<SonnerProps>) => {
      if (!globalToastContext) {
        warnNoProvider();
        return 'no-provider';
      }
      return globalToastContext.info(message, options);
    },
    loading: (message: React.ReactNode, options?: Partial<SonnerProps>) => {
      if (!globalToastContext) {
        warnNoProvider();
        return 'no-provider';
      }
      return globalToastContext.loading(message, options);
    },
    dismiss: (id?: string) => {
      if (!globalToastContext) {
        warnNoProvider();
        return;
      }
      globalToastContext.dismiss(id);
    },
    promise: async <T,>(
      promiseToResolve: Promise<T>,
      options: {
        loading: React.ReactNode;
        success: React.ReactNode | ((data: T) => React.ReactNode);
        error: React.ReactNode | ((error: Error) => React.ReactNode);
      },
    ): Promise<T> => {
      if (!globalToastContext) {
        warnNoProvider();
        throw new Error('No SonnerProvider found');
      }
      return globalToastContext.promise(promiseToResolve, options);
    } };

  return methods;
};

// Export toast instance for imperative API usage
export const toast = createToastInstance();

// Export Toaster as alias for SonnerProvider for stories compatibility
export const Toaster: React.FC<{
  children?: React.ReactNode;
  position?: string;
  theme?: string;
  expand?: boolean;
  richColors?: boolean;
  closeButton?: boolean;
  dismissLabel: string;
}> = ({ children, dismissLabel }) => (
  <SonnerProvider dismissLabel={dismissLabel}>{children}</SonnerProvider>
);
