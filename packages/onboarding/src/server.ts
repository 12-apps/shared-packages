/**
 * The SERVER half of `@12-apps/onboarding`: the progress repository and the types
 * around it, with no React in the module graph.
 *
 * It exists because the package root is a barrel that also exports
 * `OnboardingProvider` and `GuidedSection`, and `GuidedSection` imports
 * `@12-apps/ui/form/Button` → `@mui/material/styles`. A bundler tree-shook that
 * away for a server that only wanted `createOnboardingRepository`; the Hono
 * server (FUT-665) runs the TypeScript directly under Node's ESM loader, which
 * evaluates the whole barrel and dies on MUI's CJS named exports before the
 * first route is ever mounted.
 *
 * Same split `@12-apps/mcp` and `@12-apps/report-builder` already use: `.` for the
 * shared core, `./react` for components, `./server` for the Node-only side.
 */
export {
  createOnboardingRepository,
  type OnboardingPrisma,
  type OnboardingRepository,
  type OnboardingProgressRow,
} from "./repository";

export type {
  OnboardingSavePatch,
  OnboardingStatePatch,
  OnboardingStateSnapshot,
  OnboardingStatus,
} from "./types";
