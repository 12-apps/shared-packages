import type { ReactNode } from "react";

/**
 * Core, framework-agnostic types for the reusable onboarding system.
 *
 * The package deliberately knows nothing about HOW progress is persisted: the
 * UI + hook talk to an injected {@link OnboardingStore}, so a consuming app can
 * back it with Prisma server actions, tRPC, REST, or localStorage. A Prisma
 * helper (`createOnboardingRepository`) is shipped for the common case.
 */

export type OnboardingStatus = "not_started" | "in_progress" | "completed" | "dismissed";

/** A serializable snapshot of a user's progress on one feature. */
export interface OnboardingStateSnapshot {
  featureKey: string;
  status: OnboardingStatus;
  /** The step the user stopped on — the resume point. */
  step: string | null;
  /** Opaque per-feature payload (e.g. `{ selectedHost: "claude" }`). */
  data: Record<string, unknown>;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** A change applied to a user's progress. `data` is shallow-merged. */
export interface OnboardingStatePatch {
  status?: OnboardingStatus;
  step?: string | null;
  data?: Record<string, unknown>;
}

/** What {@link OnboardingProvider} calls to persist a change. */
export interface OnboardingSavePatch {
  status: OnboardingStatus;
  step?: string | null;
  data?: Record<string, unknown>;
}

/**
 * The persistence contract the consuming app implements — the seam that keeps
 * this package portable. Returns the authoritative snapshot after each write.
 */
export interface OnboardingStore {
  save(patch: OnboardingSavePatch): Promise<OnboardingStateSnapshot>;
  dismiss(): Promise<OnboardingStateSnapshot>;
  /**
   * Wipe the persisted progress back to a clean first-run. Intended for a
   * DEV-only reset affordance — implementations should gate this to non-prod.
   */
  reset(): Promise<OnboardingStateSnapshot>;
}

/** Navigation handed to each guided step's `render`. */
export interface GuidedNav {
  /** The step currently shown. */
  activeStepId: string;
  /** Merged per-feature payload persisted so far. */
  data: Record<string, unknown>;
  /** A persist is in flight. */
  pending: boolean;
  /** Jump to a specific step, optionally merging `data`. */
  goTo: (stepId: string, data?: Record<string, unknown>) => void;
  /** Advance to the next step, or complete the flow if this is the last. */
  next: (data?: Record<string, unknown>) => void;
  /** Go back one step (no-op on the first). */
  back: () => void;
  /** Mark the whole flow completed. */
  complete: (data?: Record<string, unknown>) => void;
  /** Return to the landing/hero (dismiss the in-progress flow — re-startable). */
  restart: () => void;
}

export interface GuidedStep {
  id: string;
  label: string;
  /** The content shown while this step is active. */
  render: (nav: GuidedNav) => ReactNode;
}
