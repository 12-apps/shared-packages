/**
 * The SERVER half of `@12-apps/onboarding`: the progress endpoints
 * (`createApiOnboarding`), the repository, and the types around them, with no
 * React in the module graph.
 *
 * The React-free split exists because the package root is a barrel that also
 * exports `OnboardingProvider` and `GuidedSection`, and `GuidedSection` imports
 * `@12-apps/ui/form/Button` → `@mui/material/styles`. A bundler tree-shook that
 * away for a server that only wanted `createOnboardingRepository`; the Hono
 * server (FUT-665) runs the TypeScript directly under Node's ESM loader, which
 * evaluates the whole barrel and dies on MUI's CJS named exports before the
 * first route is ever mounted.
 *
 * Same split `@12-apps/mcp` and `@12-apps/report-builder` already use: `.` for the
 * shared core, `./react` for components, `./server` for the Node-only side, and
 * `./hono` for the framework adapter over these descriptors.
 */
export {
  createOnboardingRepository,
  type OnboardingPrisma,
  type OnboardingRepository,
  type OnboardingProgressRow,
} from "../repository";

export { createApiOnboarding, type ApiOnboarding } from "./create-api-onboarding";

export {
  messagesOf,
  OnboardingApiError,
  type OnboardingActor,
  type OnboardingMessages,
  type OnboardingRequest,
  type OnboardingResponse,
  type OnboardingRoute,
  type OnboardingServerConfig,
} from "./context";

export type {
  OnboardingSavePatch,
  OnboardingStatePatch,
  OnboardingStateSnapshot,
  OnboardingStatus,
} from "../types";
