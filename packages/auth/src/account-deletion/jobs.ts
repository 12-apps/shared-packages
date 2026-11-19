import type { AccountDeletionService } from "./service";

/**
 * The job, as a definition the host hands its own job runner
 * (`@12-apps/jobs`' `defineJob({ ...accountDeletionJob(service), queue, … })`):
 * an hourly sweep that sends what the outbox owes, the due reminders, and runs
 * the due purges. Each failure goes to the config's `onError` (default
 * `console.error`) and is retried by the next pass. The
 * work is `service.sweep`, idempotent and safe to call directly, so a dev
 * driver with no schedules — or a test — runs the same code.
 */
export interface AccountDeletionJob {
  readonly name: "auth.account-deletion-sweep";
  readonly schedule: { readonly pattern: string; readonly timezone: string };
  readonly handle: () => Promise<{ mailed: number; purged: number; failed: number }>;
}

export function accountDeletionJob(service: AccountDeletionService): AccountDeletionJob {
  return {
    name: "auth.account-deletion-sweep",
    schedule: { pattern: "23 * * * *", timezone: "UTC" },
    handle: () => service.sweep(),
  };
}
