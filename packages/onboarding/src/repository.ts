import type { OnboardingStateSnapshot, OnboardingStatePatch, OnboardingStatus } from "./types";

/**
 * Optional Prisma helper for the common case. The consuming app has an
 * `OnboardingState` model (see the package README for the required shape); this
 * factory turns any Prisma-like client into the read/write functions, so apps
 * don't re-implement the data-merge + timestamp logic. Structurally typed over
 * only the delegate methods used, so it never imports a project's generated
 * client — pass `getPrisma` that returns your client (a single cast is fine).
 */

const COMPOSITE_KEY = "userId_clientId_featureKey" as const;

interface OnboardingRow {
  featureKey: string;
  status: string;
  step: string | null;
  data: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface OnboardingProgressRowRaw extends OnboardingRow {
  userId: string;
  clientId: string;
  updatedAt: Date;
}

interface WhereByKey {
  where: { [COMPOSITE_KEY]: { userId: string; clientId: string; featureKey: string } };
}

interface UpsertArgs extends WhereByKey {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

interface FindManyArgs {
  where: { clientId: string; featureKey: string; status: string };
  orderBy: { updatedAt: "desc" };
}

interface DeleteManyArgs {
  where: { userId: string; clientId: string; featureKey: string };
}

/** The minimal Prisma surface the repository needs. */
export interface OnboardingPrisma {
  onboardingState: {
    findUnique(args: WhereByKey): Promise<OnboardingRow | null>;
    upsert(args: UpsertArgs): Promise<OnboardingRow>;
    findMany(args: FindManyArgs): Promise<OnboardingProgressRowRaw[]>;
    deleteMany(args: DeleteManyArgs): Promise<{ count: number }>;
  };
}

/** A mid-integration row for reach-out views. */
export interface OnboardingProgressRow extends OnboardingStateSnapshot {
  userId: string;
  clientId: string;
  updatedAt: Date;
}

function asDataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSnapshot(row: OnboardingRow): OnboardingStateSnapshot {
  return {
    featureKey: row.featureKey,
    status: row.status as OnboardingStatus,
    step: row.step,
    data: asDataObject(row.data),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function nextStatus(existing: OnboardingRow | null, patch: OnboardingStatePatch): OnboardingStatus {
  const priorStatus = existing?.status as OnboardingStatus | undefined;
  return patch.status ?? priorStatus ?? "in_progress";
}

function resolveTimestamps(
  existing: OnboardingRow | null,
  status: OnboardingStatus,
): { startedAt: Date | null; completedAt: Date | null } {
  const priorStartedAt = existing?.startedAt ?? null;
  const priorCompletedAt = existing?.completedAt ?? null;
  const startedAt = priorStartedAt ?? (status === "not_started" ? null : new Date());
  const completedAt = status === "completed" ? priorCompletedAt ?? new Date() : priorCompletedAt;
  return { startedAt, completedAt };
}

/** Derive the persisted fields for an upsert: merged data + timestamp stamping. */
function resolveUpsertFields(
  existing: OnboardingRow | null,
  patch: OnboardingStatePatch,
): { status: OnboardingStatus; data: Record<string, unknown>; startedAt: Date | null; completedAt: Date | null } {
  const status = nextStatus(existing, patch);
  const data = { ...asDataObject(existing?.data), ...(patch.data ?? {}) };
  return { status, data, ...resolveTimestamps(existing, status) };
}

export interface OnboardingRepository {
  getOnboardingState(
    userId: string,
    clientId: string,
    featureKey: string,
  ): Promise<OnboardingStateSnapshot | null>;
  upsertOnboardingState(
    userId: string,
    clientId: string,
    featureKey: string,
    patch: OnboardingStatePatch,
  ): Promise<OnboardingStateSnapshot>;
  listOnboardingByStatus(
    clientId: string,
    featureKey: string,
    status: OnboardingStatus,
  ): Promise<OnboardingProgressRow[]>;
  /** Wipe a user's progress on a feature (dev reset / uninstall). */
  deleteOnboardingState(userId: string, clientId: string, featureKey: string): Promise<void>;
}

/** Build the onboarding repository over a lazily-resolved Prisma client. */
export function createOnboardingRepository(
  getPrisma: () => Promise<OnboardingPrisma>,
): OnboardingRepository {
  return {
    async getOnboardingState(userId, clientId, featureKey) {
      const prisma = await getPrisma();
      const row = await prisma.onboardingState.findUnique({
        where: { [COMPOSITE_KEY]: { userId, clientId, featureKey } },
      });
      return row ? toSnapshot(row) : null;
    },

    async upsertOnboardingState(userId, clientId, featureKey, patch) {
      const prisma = await getPrisma();
      const existing = await prisma.onboardingState.findUnique({
        where: { [COMPOSITE_KEY]: { userId, clientId, featureKey } },
      });
      const { status, data, startedAt, completedAt } = resolveUpsertFields(existing, patch);
      const row = await prisma.onboardingState.upsert({
        where: { [COMPOSITE_KEY]: { userId, clientId, featureKey } },
        create: { userId, clientId, featureKey, status, step: patch.step ?? null, data, startedAt, completedAt },
        update: {
          status,
          ...(patch.step !== undefined ? { step: patch.step } : {}),
          data,
          startedAt,
          completedAt,
        },
      });
      return toSnapshot(row);
    },

    async listOnboardingByStatus(clientId, featureKey, status) {
      const prisma = await getPrisma();
      const rows = await prisma.onboardingState.findMany({
        where: { clientId, featureKey, status },
        orderBy: { updatedAt: "desc" },
      });
      return rows.map((row) => ({
        ...toSnapshot(row),
        userId: row.userId,
        clientId: row.clientId,
        updatedAt: row.updatedAt,
      }));
    },

    async deleteOnboardingState(userId, clientId, featureKey) {
      const prisma = await getPrisma();
      await prisma.onboardingState.deleteMany({ where: { userId, clientId, featureKey } });
    },
  };
}
