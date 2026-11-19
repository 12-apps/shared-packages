import type { AccountDeletionConfig, AccountStateDb, AccountStateRow } from "./types";

/** What every part of the deletion reads: the config, the table, and how a failure is told. */
export interface DeletionContext {
  readonly config: AccountDeletionConfig;
  readonly table: () => Promise<AccountStateDb["authAccountState"]>;
  readonly read: (userId: string) => Promise<AccountStateRow | null>;
  readonly freshMs: number;
  readonly freshProviders: ReadonlySet<string>;
  /** Tell the host of a failure the package keeps going past. */
  readonly reportError: (error: unknown, act: string, userId: string) => void;
  /** Run a host hook whose failure must not undo, or skip, what follows it. */
  readonly tryHook: (act: string, userId: string, run: () => Promise<void>) => Promise<void>;
}

const DEFAULT_FRESH_MS = 10 * 60_000;

export function createDeletionContext(config: AccountDeletionConfig): DeletionContext {
  const table = async () => (await config.getDb()).authAccountState;
  const reportError = (error: unknown, act: string, userId: string): void => {
    if (config.onError) config.onError(error, { act, userId });
    else console.error(`[account-deletion] ${act} failed for ${userId}`, error);
  };
  return {
    config,
    table,
    read: async (userId) => (await table()).findUnique({ where: { userId } }),
    freshMs: config.freshSignInMs ?? DEFAULT_FRESH_MS,
    freshProviders: new Set(config.freshSignInProviders ?? ["google"]),
    reportError,
    tryHook: async (act, userId, run) => {
      try {
        await run();
      } catch (error) {
        reportError(error, act, userId);
      }
    },
  };
}
