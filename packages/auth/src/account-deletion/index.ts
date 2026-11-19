import { accountDeletionJob, type AccountDeletionJob } from "./jobs";
import { createAccountDeletionRoutes, type AccountDeletionRoutes } from "./routes";
import { createAccountDeletionService, type AccountDeletionService } from "./service";
import type { AccountDeletionConfig } from "./types";

/** Everything the feature hands its host: the routes, the service and the job. */
export interface AccountDeletion extends AccountDeletionService {
  readonly routes: AccountDeletionRoutes;
  readonly job: AccountDeletionJob;
}

/** Deleting one's own account, from one config (also reached as `createApiAuth({ accountDeletion })`). */
export function createAccountDeletion(config: AccountDeletionConfig): AccountDeletion {
  const service = createAccountDeletionService(config);
  return { ...service, routes: createAccountDeletionRoutes(service, config), job: accountDeletionJob(service) };
}

export { accountDeletionMail, purgeDateWords, ACCOUNT_DELETION_COPY, PT_BR_ACCOUNT_DELETION, EN_US_ACCOUNT_DELETION } from "./copy";
export type { AccountDeletionCopy, AccountDeletionRefusals } from "./copy";
export { deletionReportSchema, scheduleDeletionBody, cancelDeletionBody } from "./routes";
export type { AccountDeletionRoutes } from "./routes";
export type { AccountDeletionJob } from "./jobs";
export type { AccountDeletionService, CancelOutcome, ScheduleOutcome, SweepSummary } from "./service";
export { isOpenWhilePending, standingOf, SESSION_EPOCH_CLAIM, SIGNED_IN_AT_CLAIM } from "./standing";
export type { SessionIdentity, SessionStanding } from "./standing";
export { dueReminder, isFreshSignIn, purgeDateOf, purgeDue } from "./schedule-math";
export type * from "./types";
