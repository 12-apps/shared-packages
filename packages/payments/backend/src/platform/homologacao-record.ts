/**
 * The platform's homologação OUTCOME record (FUT-483, packaged by FUT-573) —
 * the durable answer to "is the platform homologated?", one record per
 * provider.
 *
 * Why a record and not a doc or a ticket comment: the question gates real
 * money (production charges answer `403 ACCESS_DENIED` until the provider
 * clears the platform), so the answer must be readable by the product — the
 * platform screen renders it — and must survive people. ABSENCE of the record
 * is the honest fourth state, "não solicitada", which is why it is displayed
 * but never writable.
 *
 * Storage is a port ({@link HomologationRecordStore}), like every other store
 * in this package: the host wires its own table, tests wire memory. What the
 * service owns is the part that must not fork per host — the derived
 * timestamps and the blank-string hygiene.
 */

/** The statuses a record can hold; absence of the record is "não solicitada". */
export const HOMOLOGATION_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type PlatformHomologationStatus = (typeof HOMOLOGATION_STATUSES)[number];

/** One provider's recorded outcome. */
export interface PlatformHomologationRecord {
  provider: string;
  status: PlatformHomologationStatus;
  /** The submission's own reference (form card / support ticket), if any. */
  protocol: string | null;
  notes: string | null;
  /** FIRST-submission time; survives every later save. */
  submittedAt: Date | null;
  /** When a verdict (APPROVED/REJECTED) was first recorded; null while pending. */
  decidedAt: Date | null;
  /** Which operator said so — an identity string, no FK implied. */
  updatedBy: string | null;
  updatedAt: Date;
}

/** What a save carries — the form replaces the whole record, deliberately. */
export interface SaveHomologationInput {
  status: PlatformHomologationStatus;
  protocol?: string | null;
  notes?: string | null;
}

/** Where records live — one per provider. The host supplies the persistence. */
export interface HomologationRecordStore {
  get(provider: string): Promise<PlatformHomologationRecord | null>;
  /** Insert-or-replace by `record.provider`. */
  save(record: PlatformHomologationRecord): Promise<PlatformHomologationRecord>;
}

/** Read + save with the derived stamps applied — what a host route mounts. */
export interface HomologationRecordService {
  /** One provider's record; null means "não solicitada". */
  read(provider: string): Promise<PlatformHomologationRecord | null>;
  /** Record the outcome; `updatedBy` is the operator's identity (e.g. email). */
  save(
    provider: string,
    input: SaveHomologationInput,
    updatedBy: string,
  ): Promise<PlatformHomologationRecord>;
}

/**
 * The timestamps a save derives rather than accepts:
 *   - `submittedAt` is FIRST-submission time and survives every later save —
 *     recording the verdict must not erase when the form went in;
 *   - `decidedAt` stamps when a verdict (APPROVED/REJECTED) is first recorded,
 *     is kept while the verdict stands, and clears if the operator moves the
 *     record back to SUBMITTED (a re-submission after a refusal).
 */
function derivedStamps(
  existing: PlatformHomologationRecord | null,
  status: PlatformHomologationStatus,
  now: Date,
): { submittedAt: Date | null; decidedAt: Date | null } {
  const submittedAt = existing?.submittedAt ?? (status === 'SUBMITTED' ? now : null);
  if (status === 'SUBMITTED') return { submittedAt, decidedAt: null };
  const decidedAt = existing?.status === status ? (existing.decidedAt ?? now) : now;
  return { submittedAt, decidedAt };
}

/** Blank-string form fields normalize to NULL, so "" never masquerades as data. */
function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The record service over any store. `clock` exists for tests; production
 * callers omit it.
 */
export function createHomologationRecordService(
  store: HomologationRecordStore,
  clock: () => Date = () => new Date(),
): HomologationRecordService {
  return {
    read: (provider) => store.get(provider),
    async save(provider, input, updatedBy) {
      const existing = await store.get(provider);
      const now = clock();
      const stamps = derivedStamps(existing, input.status, now);
      return store.save({
        provider,
        status: input.status,
        protocol: normalized(input.protocol),
        notes: normalized(input.notes),
        submittedAt: stamps.submittedAt,
        decidedAt: stamps.decidedAt,
        updatedBy,
        updatedAt: now,
      });
    },
  };
}

/** In-memory store for tests and hosts without a database. */
export function createMemoryHomologationRecordStore(): HomologationRecordStore & {
  rows: Map<string, PlatformHomologationRecord>;
} {
  const rows = new Map<string, PlatformHomologationRecord>();
  return {
    rows,
    get: async (provider) => rows.get(provider) ?? null,
    save: async (record) => {
      rows.set(record.provider, record);
      return record;
    },
  };
}
