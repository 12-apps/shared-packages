/**
 * The two models of the database seam, beside `./db.ts` and in the
 * same doctrine: Prisma-shaped, structural, and CLOSED — the union of the
 * shapes the consent engine (`./consent.ts`) and the caps (`./caps.ts`)
 * actually pass, so a non-Prisma adapter has a finite surface to fill.
 */

// ---------------------------------------------------------------------------
// notification_channel_consents
// ---------------------------------------------------------------------------

/** A stored consent's state. `NONE` is never stored: it is the absence of a row. */
export type ChannelConsentStatus = 'PENDING' | 'CONFIRMED' | 'GRANDFATHERED' | 'OPTED_OUT';

/** How a stored consent was (or is being) given. */
export type ChannelConsentMethod = 'REPLY' | 'CODE' | 'GRANDFATHERED';

/**
 * One (user, paid channel): the number consent was asked or given for, and
 * the bookkeeping that makes asking safe (the code's HASH, never the code; the
 * resend window; the one grandfather ask).
 */
export interface ChannelConsentRow {
  id: string;
  /** The account, or `null` on a GUEST row: a number with no account that said stop. */
  userId: string | null;
  channel: string;
  /** E.164. Consent belongs to this NUMBER on this channel. */
  destination: string;
  status: ChannelConsentStatus;
  method: ChannelConsentMethod;
  codeHash: string | null;
  codeExpiresAt: Date | null;
  codeAttempts: number;
  /** Confirmation sends inside the window that started at `sendWindowStartedAt`. */
  sendCount: number;
  sendWindowStartedAt: Date | null;
  lastSentAt: Date | null;
  confirmedAt: Date | null;
  optedOutAt: Date | null;
  /** The consent RECORD a reply leaves: what was typed, the provider's id, when. */
  consentText: string | null;
  consentExternalId: string | null;
  consentAt: Date | null;
  /** When a grandfathered row was asked to confirm — once, ever. */
  askedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The consent filter — every shape the engine passes, and nothing more. The
 * nullable timestamp predicates (`null` or a bound) are what the conditional
 * writes (the resend slot, the one ask) carry as their precondition.
 */
export interface ChannelConsentWhere {
  id?: string | { in: string[] };
  userId?: string | null;
  channel?: string | { in: string[] };
  destination?: string;
  status?: ChannelConsentStatus | { in: ChannelConsentStatus[] };
  codeHash?: string;
  codeAttempts?: { lt: number };
  sendCount?: { lt: number };
  lastSentAt?: null | { lte: Date };
  sendWindowStartedAt?: null | { lte: Date } | { gt: Date };
  askedAt?: null;
}

export interface ChannelConsentCreateData {
  userId: string | null;
  channel: string;
  destination: string;
  status: ChannelConsentStatus;
  method: ChannelConsentMethod;
  /** Set only on a guest's STOP row, which is created opted out. */
  optedOutAt?: Date;
  consentExternalId?: string | null;
}

export interface ChannelConsentUpdateData {
  destination?: string;
  status?: ChannelConsentStatus;
  method?: ChannelConsentMethod;
  codeHash?: string | null;
  codeExpiresAt?: Date | null;
  codeAttempts?: number | { increment: number };
  sendCount?: number | { increment: number };
  sendWindowStartedAt?: Date | null;
  lastSentAt?: Date | null;
  confirmedAt?: Date | null;
  optedOutAt?: Date | null;
  consentText?: string | null;
  consentExternalId?: string | null;
  consentAt?: Date | null;
  askedAt?: Date | null;
}

export interface ChannelConsentDelegate {
  findUnique(args: {
    where: { userId_channel: { userId: string; channel: string } };
  }): Promise<ChannelConsentRow | null>;
  findMany(args: {
    where: ChannelConsentWhere;
    orderBy?: { createdAt: 'asc' };
    take?: number;
  }): Promise<ChannelConsentRow[]>;
  /** `skipDuplicates`: the unique (user, channel) key decides who created it. */
  createMany(args: {
    data: ChannelConsentCreateData[];
    skipDuplicates: true;
  }): Promise<{ count: number }>;
  /** Every state change: `where` carries the precondition, `count` says who won. */
  updateMany(args: {
    where: ChannelConsentWhere;
    data: ChannelConsentUpdateData;
  }): Promise<{ count: number }>;
  deleteMany(args: { where: ChannelConsentWhere }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// notification_send_counters
// ---------------------------------------------------------------------------

/** Whose budget a counter is: one person's day, or one tenant's month. */
export type SendCounterScope = 'recipient' | 'tenant';

export interface SendCounterKey {
  scope: SendCounterScope;
  subjectId: string;
  /** `YYYY-MM-DD` (recipient) or `YYYY-MM` (tenant), in the scope's zone. */
  period: string;
}

export interface SendCounterDelegate {
  /** Make sure the period's row exists (count 0). */
  createMany(args: { data: SendCounterKey[]; skipDuplicates: true }): Promise<{ count: number }>;
  /**
   * The atomic increment-below-cap (`count: { lt: cap }` in `where`), its
   * refund (`count: { gt: 0 }`), and the once-per-period notice
   * (`notifiedAt: null`). One statement each; `count` says whether it applied.
   */
  updateMany(args: {
    where: SendCounterKey & { count?: { lt: number } | { gt: number }; notifiedAt?: null };
    data: { count?: { increment: number } | { decrement: number }; notifiedAt?: Date };
  }): Promise<{ count: number }>;
}
