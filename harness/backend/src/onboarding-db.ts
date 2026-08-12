/**
 * The `OnboardingPrisma` seam, backed by a REAL Postgres (12-23).
 *
 * The same arrangement `rbac-db.ts` gives the RBAC surface, on one table: PGlite is
 * a real Postgres, the table is created by the PACKAGE'S OWN migration applied out
 * of the installed tarball, and the delegate is duck-typed against the seam the
 * package defines structurally so a host can fill it with Prisma. Prisma is what a
 * real host passes; hand-written SQL is what this harness passes, and the point of
 * the seam is that the routes cannot tell.
 *
 * The seam's four argument shapes are CLOSED (documented in the package's
 * `repository.ts`), which is what makes a finite translation like this possible.
 * Anything outside them should fail loudly here rather than silently returning
 * everything.
 */
import type { PGlite } from '@electric-sql/pglite';

/** The row shape the seam's delegates return. */
interface OnboardingRow {
  featureKey: string;
  status: string;
  step: string | null;
  data: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  userId: string;
  clientId: string;
  updatedAt: Date;
}

interface RawRow {
  feature_key: string;
  status: string;
  step: string | null;
  data: unknown;
  started_at: Date | null;
  completed_at: Date | null;
  user_id: string;
  client_id: string;
  updated_at: Date;
}

function toRow(raw: RawRow): OnboardingRow {
  return {
    featureKey: raw.feature_key,
    status: raw.status,
    step: raw.step,
    data: raw.data,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    userId: raw.user_id,
    clientId: raw.client_id,
    updatedAt: raw.updated_at,
  };
}

const COLUMNS = `feature_key, status, step, data, started_at, completed_at, user_id, client_id, updated_at`;

/** A composite-key `where`, as the package writes it. */
interface KeyWhere {
  where: { userId_clientId_featureKey: { userId: string; clientId: string; featureKey: string } };
}

interface UpsertArgs extends KeyWhere {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

interface FindManyArgs {
  where: { clientId: string; featureKey: string; status: string };
  orderBy: { updatedAt: 'desc' };
}

interface DeleteManyArgs {
  where: { userId: string; clientId: string; featureKey: string };
}

/** Read a field out of the package's create/update payload. */
function field<T>(payload: Record<string, unknown>, name: string, fallback: T): T | null {
  return name in payload ? (payload[name] as T) : fallback;
}

export function onboardingDb(pg: PGlite) {
  const findUnique = async ({ where }: KeyWhere): Promise<OnboardingRow | null> => {
    const { userId, clientId, featureKey } = where.userId_clientId_featureKey;
    const { rows } = await pg.query<RawRow>(
      `SELECT ${COLUMNS} FROM onboarding_states
       WHERE user_id = $1 AND client_id = $2 AND feature_key = $3`,
      [userId, clientId, featureKey],
    );
    return rows[0] ? toRow(rows[0]) : null;
  };

  return {
    onboardingState: {
      findUnique,

      async upsert({ where, create, update }: UpsertArgs): Promise<OnboardingRow> {
        const { userId, clientId, featureKey } = where.userId_clientId_featureKey;
        const existing = await findUnique({ where });
        const payload = existing ? update : create;
        // `step` is only present on the payload when the caller meant to change it
        // (the package distinguishes "unset" from "set to null"), so an absent key
        // keeps whatever is stored.
        const step = field(payload, 'step', existing?.step ?? null);
        await pg.query(
          `INSERT INTO onboarding_states
             (id, user_id, client_id, feature_key, status, step, data, started_at, completed_at, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())
           ON CONFLICT (user_id, client_id, feature_key) DO UPDATE SET
             status = EXCLUDED.status,
             step = EXCLUDED.step,
             data = EXCLUDED.data,
             started_at = EXCLUDED.started_at,
             completed_at = EXCLUDED.completed_at,
             updated_at = NOW()`,
          [
            userId,
            clientId,
            featureKey,
            payload.status,
            step,
            JSON.stringify(payload.data ?? {}),
            payload.startedAt ?? null,
            payload.completedAt ?? null,
          ],
        );
        const row = await findUnique({ where });
        if (!row) throw new Error('onboarding upsert wrote nothing');
        return row;
      },

      async findMany({ where, orderBy }: FindManyArgs): Promise<OnboardingRow[]> {
        if (orderBy.updatedAt !== 'desc') {
          // The seam documents exactly one ordering; anything else means the
          // package grew a query shape this translation has not been taught.
          throw new Error(`unsupported orderBy: ${JSON.stringify(orderBy)}`);
        }
        const { rows } = await pg.query<RawRow>(
          `SELECT ${COLUMNS} FROM onboarding_states
           WHERE client_id = $1 AND feature_key = $2 AND status = $3
           ORDER BY updated_at DESC`,
          [where.clientId, where.featureKey, where.status],
        );
        return rows.map(toRow);
      },

      async deleteMany({ where }: DeleteManyArgs): Promise<{ count: number }> {
        const result = await pg.query(
          `DELETE FROM onboarding_states
           WHERE user_id = $1 AND client_id = $2 AND feature_key = $3`,
          [where.userId, where.clientId, where.featureKey],
        );
        return { count: result.affectedRows ?? 0 };
      },
    },
  };
}
