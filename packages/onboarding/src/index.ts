export { OnboardingProvider, useOnboarding } from "./onboarding-context";
export { GuidedSection, type GuidedSectionProps } from "./guided-section";
// The `createWeb*` factory the wiring contract's `surface` capability names —
// the three-line assembly every host repeated, with the featureKey coupling
// closed over once. See `./create-web-onboarding`.
export {
  createWebOnboarding,
  type WebOnboarding,
  type WebOnboardingConfig,
} from "./create-web-onboarding";
// The store bound to the package's OWN endpoints (12-23) — so the URL, the body
// shape and the date revival are facts the package states once, rather than each
// host restating them next to a surface it cannot see.
export {
  createOnboardingApiStore,
  fetchOnboardingState,
  type OnboardingApiStoreConfig,
} from "./api-store";
export {
  createOnboardingRepository,
  type OnboardingPrisma,
  type OnboardingRepository,
  type OnboardingProgressRow,
} from "./repository";
export type {
  GuidedNav,
  GuidedStep,
  OnboardingSavePatch,
  OnboardingStatePatch,
  OnboardingStateSnapshot,
  OnboardingStatus,
  OnboardingStore,
} from "./types";
