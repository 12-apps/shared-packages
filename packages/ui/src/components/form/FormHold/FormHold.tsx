'use client';

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';

/**
 * Holding a form while something it depends on is still running — a photo
 * uploading, typically.
 *
 * A field registers its work with {@link useFormHold}; every control that must
 * wait reads {@link useFormBusy}. It is a CONTEXT, not a `<fieldset disabled>`,
 * on purpose: a drawer or sheet a form opens renders through a portal, outside
 * the `<form>`'s DOM, where a fieldset does not reach but React context does.
 *
 * What busy holds is what reads it: the `total-form` fields, a submit `Button`
 * and `SubmitButton`, and any host control that opts in. A plain `Button` is NOT
 * held, so navigation — close, back, tabs — stays live while the form waits.
 *
 * Providers nest: a hold inside an inner provider also holds every provider
 * around it, and an inner provider is busy while an outer one is.
 */

export interface FormHoldContextValue {
  /** Register (`held: true`) or release a key. */
  setHeld: (key: string, held: boolean) => void;
  /** True while any key holds this provider or one around it. */
  busy: boolean;
}

const FormHoldContext = createContext<FormHoldContextValue | null>(null);

/** Registers `key` in `scope` while `held`; released on change and unmount. */
function useHoldIn(scope: FormHoldContextValue | null, key: string, held: boolean): void {
  const setHeld = scope?.setHeld;
  useEffect(() => {
    if (!setHeld || !held) return undefined;
    setHeld(key, true);
    return () => setHeld(key, false);
  }, [setHeld, key, held]);
}

/**
 * The state behind a provider: which keys hold it. For a component that must
 * read its own `busy` where it renders the provider (`FormContainer`'s submit
 * handler, `SettingCard`'s Save); everyone else uses {@link FormHoldProvider}.
 */
export function useFormHoldRoot(): FormHoldContextValue {
  const parent = useContext(FormHoldContext);
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());

  const setHeld = useCallback((key: string, held: boolean) => {
    setKeys((previous) => {
      if (previous.has(key) === held) return previous;
      const next = new Set(previous);
      if (held) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const ownBusy = keys.size > 0;
  // Upward: this whole provider is one key of the one around it. Only its OWN
  // holds travel up, so an outer hold coming back down cannot loop.
  useHoldIn(parent, useId(), ownBusy);

  const busy = ownBusy || (parent?.busy ?? false);
  return useMemo(() => ({ setHeld, busy }), [setHeld, busy]);
}

export interface FormHoldProviderProps {
  children: React.ReactNode;
}

/** A hold scope of its own, for a host form that is not a `FormContainer`. */
export function FormHoldProvider({ children }: FormHoldProviderProps): React.ReactElement {
  const value = useFormHoldRoot();
  return <FormHoldScope value={value}>{children}</FormHoldScope>;
}

/** Renders a root's value as the context. Internal to the components that own a root. */
export function FormHoldScope({
  value,
  children,
}: {
  value: FormHoldContextValue;
  children: React.ReactNode;
}): React.ReactElement {
  return <FormHoldContext.Provider value={value}>{children}</FormHoldContext.Provider>;
}

/**
 * Hold the nearest form while `held` is true: `useFormHold('photo', uploading)`.
 * Released when `held` turns false and when the caller unmounts. Outside any
 * provider it does nothing.
 *
 * @param key - Unique within the form; two fields holding under one key release each other.
 */
export function useFormHold(key: string, held: boolean): void {
  useHoldIn(useContext(FormHoldContext), key, held);
}

/** True while anything holds the nearest form. `false` outside any provider. */
export function useFormBusy(): boolean {
  return useContext(FormHoldContext)?.busy ?? false;
}
