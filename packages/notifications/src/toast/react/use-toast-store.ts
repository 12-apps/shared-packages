import { useSyncExternalStore } from 'react';

import { defaultToastStore, type ToastItem, type ToastStore } from '../core';

/** The queue's current toasts, re-rendering on every change. */
export function useToastStore(store: ToastStore = defaultToastStore): readonly ToastItem[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
