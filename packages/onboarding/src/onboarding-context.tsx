"use client";

import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";

import type {
  OnboardingSavePatch,
  OnboardingStateSnapshot,
  OnboardingStatus,
  OnboardingStore,
} from "./types";

/**
 * Reusable onboarding-progress provider. Holds a feature's persisted state
 * client-side and mutates it through an injected {@link OnboardingStore},
 * optimistically updating then reconciling to the store's authoritative return.
 * Persistence tech (Prisma server actions, tRPC, REST…) is the app's choice —
 * this component only needs `store.save` / `store.dismiss`.
 */

interface OnboardingContextValue {
  state: OnboardingStateSnapshot;
  /** An in-flight persist is running. */
  pending: boolean;
  /** Advance to `step` (defaults status to `in_progress`), merging `data`. */
  setStep: (
    step: string,
    opts?: { status?: OnboardingStatus; data?: Record<string, unknown> },
  ) => void;
  /** Mark the feature completed (optionally merging final `data`). */
  complete: (data?: Record<string, unknown>) => void;
  /** Mark the feature dismissed (the user closed the onboarding). */
  dismiss: () => void;
  /** Wipe progress back to a clean first-run (dev-only affordance). */
  reset: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function emptyState(featureKey: string): OnboardingStateSnapshot {
  return { featureKey, status: "not_started", step: null, data: {}, startedAt: null, completedAt: null };
}

export function OnboardingProvider({
  featureKey,
  store,
  initialState,
  children,
}: {
  featureKey: string;
  store: OnboardingStore;
  initialState: OnboardingStateSnapshot | null;
  children: ReactNode;
}): React.JSX.Element {
  const [state, setState] = useState<OnboardingStateSnapshot>(
    initialState ?? emptyState(featureKey),
  );
  const [pending, startTransition] = useTransition();

  const persist = useCallback(
    (patch: OnboardingSavePatch) => {
      // Optimistic: reflect immediately, reconcile to store truth.
      setState((prev) => ({
        ...prev,
        status: patch.status,
        step: patch.step !== undefined ? patch.step : prev.step,
        data: { ...prev.data, ...(patch.data ?? {}) },
      }));
      startTransition(async () => {
        try {
          setState(await store.save(patch));
        } catch {
          // Keep the optimistic state; the next server read reconciles.
        }
      });
    },
    [store],
  );

  const setStep = useCallback<OnboardingContextValue["setStep"]>(
    (step, opts) => persist({ status: opts?.status ?? "in_progress", step, data: opts?.data }),
    [persist],
  );

  const complete = useCallback<OnboardingContextValue["complete"]>(
    (data) => persist({ status: "completed", data }),
    [persist],
  );

  const dismiss = useCallback<OnboardingContextValue["dismiss"]>(() => {
    setState((prev) => ({ ...prev, status: "dismissed" }));
    startTransition(async () => {
      try {
        setState(await store.dismiss());
      } catch {
        /* keep optimistic */
      }
    });
  }, [store]);

  const reset = useCallback<OnboardingContextValue["reset"]>(() => {
    setState(emptyState(featureKey)); // optimistic clean first-run
    startTransition(async () => {
      try {
        setState(await store.reset());
      } catch {
        /* keep optimistic */
      }
    });
  }, [store, featureKey]);

  const value: OnboardingContextValue = { state, pending, setStep, complete, dismiss, reset };
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
}
