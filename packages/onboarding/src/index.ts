export { OnboardingProvider, useOnboarding } from "./onboarding-context";
export { GuidedSection, type GuidedSectionProps } from "./guided-section";
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
