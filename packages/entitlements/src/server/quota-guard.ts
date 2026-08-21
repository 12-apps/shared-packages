/**
 * Atomic quota enforcement for creates that must NEVER overrun their ceiling —
 * seats, locations, and any future quota where a soft overage is unacceptable.
 *
 * The route-level `requireQuota` produces the friendly 402 with the upsell,
 * but it is a check-then-act: two concurrent creates can both read `used = 9`
 * against a ceiling of 10 and both pass. This helper is the other half — the
 * count re-runs INSIDE a SERIALIZABLE transaction alongside the insert, so the
 * count-then-insert pair is conflict-detectable and the loser of a race aborts
 * instead of both committing and leaving the tenant over plan.
 *
 * The database arrives through a STRUCTURAL seam (`$transaction` with an
 * isolation level) so any Prisma-shaped client satisfies it without this
 * package depending on Prisma.
 */

/** The one method this guard needs from a database client. */
export interface SerializableTransactor<Tx> {
  $transaction<T>(
    body: (tx: Tx) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ): Promise<T>;
}

/**
 * Thrown when the re-count finds the ceiling already spent — a concurrent
 * create won the slot between the route check and now. Map to **402** with the
 * message as the body.
 */
export class QuotaRecountError extends Error {
  readonly status = 402 as const;
  constructor(message: string) {
    super(message);
    this.name = 'QuotaRecountError';
    Object.setPrototypeOf(this, QuotaRecountError.prototype);
  }
}

/**
 * Thrown when the database aborts the loser of a serialization race
 * (SQLSTATE 40001). The honest answer is "try again", not a 500 — map to
 * **409**. The message is REQUIRED — it used to default to one product's
 * Portuguese; `createWithinQuota` fills it from its own required
 * `raceMessage`.
 */
export class QuotaRaceError extends Error {
  readonly status = 409 as const;
  constructor(message: string) {
    super(message);
    this.name = 'QuotaRaceError';
    Object.setPrototypeOf(this, QuotaRaceError.prototype);
  }
}

/**
 * Run `body` in a serializable transaction, first re-checking that one more
 * unit of the feature still fits under `limit` using the SAME counter the
 * engine's decision used — counted through the transaction client, which is
 * what makes the check atomic with the insert.
 *
 * `limit` is what the route's `requireQuota` decision reported: a number,
 * `"unlimited"`, or `null` for a boolean feature. Only a finite number is ever
 * re-checked — the other two cannot be overrun.
 *
 * Throws {@link QuotaRecountError} (→ 402) when the re-count refuses, and
 * {@link QuotaRaceError} (→ 409) when the transaction loses a serialization
 * race. Any error thrown by `body` passes through untouched.
 */
export async function createWithinQuota<T, Tx>(
  options: {
    db: SerializableTransactor<Tx>;
    tenantId: string;
    limit: number | 'unlimited' | null;
    /** The registry counter, counted through the TRANSACTION client. */
    count: (tx: Tx, tenantId: string) => Promise<number>;
    /** The 402 body when the re-count refuses, e.g. "Você atingiu o limite do seu plano." */
    message: string;
    /**
     * The 409 body when the transaction loses a serialization race —
     * REQUIRED, the host's words, like `message` above. pt-BR hosts pass
     * `PT_BR_ENTITLEMENTS_MESSAGES.quotaRaceRetry`; the removed default was
     * that same sentence, compiled in.
     */
    raceMessage: string;
  },
  body: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await options.db.$transaction(
      async (tx) => {
        if (typeof options.limit === 'number') {
          const used = await options.count(tx, options.tenantId);
          if (used >= options.limit) {
            throw new QuotaRecountError(options.message);
          }
        }
        return body(tx);
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    if (error instanceof QuotaRecountError) throw error;
    if (isSerializationFailure(error)) throw new QuotaRaceError(options.raceMessage);
    throw error;
  }
}

/** A Postgres serialization failure (SQLSTATE 40001), Prisma-surfaced or raw. */
export function isSerializationFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  return code === 'P2034' || code === '40001' || message.includes('could not serialize');
}
