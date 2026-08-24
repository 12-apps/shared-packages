/**
 * The tables `@12-apps/billing` deliberately does NOT ship, and the three
 * ports that reach them.
 *
 * Its manifest states the absence and the reason: subscriptions, their cycles
 * and their stored instruments all carry foreign keys into the HOST's own
 * account table, and a package partial cannot declare a relation into a table
 * it does not own. So the schema stays the host's and reaches the package
 * through `./server`'s ports instead — "the graduation rule working as
 * intended: a model set graduates into a package when it has lost every
 * foreign key into host tables, and this one has not."
 *
 * That makes this the first adoption in the harness whose migration is the
 * HOST'S. Every other package here ships `prisma/migrations` and the harness
 * replays them; this one ships none, on purpose, and what follows is the shape
 * an adopter has to author. It is worth having in a consumer harness for
 * exactly that reason: if the ports and the tables they imply ever stop
 * lining up, there is nowhere else that would notice.
 *
 * ## What is NOT here
 *
 * Nothing card-shaped. The number goes from the cardholder's keyboard to the
 * provider's SDK to the provider; what lands in `billing_instruments` is an
 * opaque vault id plus the display metadata the provider chose to share. No
 * column below could hold a PAN, which is the same property the port's own
 * docblock claims for its method signatures.
 */
import type { PGlite } from '@electric-sql/pglite';
import type {
  InstrumentCard,
  SaveVaultedInstrument,
  StoredVaultPointer,
  SubscriptionVaultDirectory,
  VaultPointerStore,
  VaultTarget,
} from '@12-apps/billing/server';

import { Params, type SqlRunner } from './rbac-db-shared';

/**
 * The host's own schema.
 *
 * `owner_id` is this harness's stand-in for the account table every real
 * adopter joins to — the very foreign key that keeps these models out of the
 * package.
 */
export async function applyBillingSchema(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
      "id" TEXT PRIMARY KEY,
      "owner_id" TEXT NOT NULL,
      "plan_key" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      -- The provider's customer object, per provider. An owner who has been
      -- through two acquirers holds one row and two customer refs, which is
      -- why this is keyed rather than a single column.
      "customer_refs" JSONB NOT NULL DEFAULT '{}',
      "email" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_owner_id_key"
      ON "billing_subscriptions"("owner_id");

    CREATE TABLE IF NOT EXISTS "billing_instruments" (
      "id" TEXT PRIMARY KEY,
      "owner_id" TEXT NOT NULL,
      "subscription_id" TEXT NOT NULL
        REFERENCES "billing_subscriptions"("id") ON DELETE CASCADE,
      "provider" TEXT NOT NULL,
      "provider_customer_id" TEXT,
      "provider_instrument_id" TEXT NOT NULL,
      "brand" TEXT,
      "last4" TEXT,
      "exp_month" INTEGER,
      "exp_year" INTEGER,
      -- Which one a cycle is charged against. At most one per owner, enforced
      -- below rather than by convention: two defaults is a row nobody can
      -- answer "which card did we charge" from.
      "is_default" BOOLEAN NOT NULL DEFAULT false,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "billing_instruments_one_default"
      ON "billing_instruments"("owner_id") WHERE "is_default";

    CREATE INDEX IF NOT EXISTS "billing_instruments_owner_id_idx"
      ON "billing_instruments"("owner_id");
  `);
}

/**
 * `findTarget` — and the whole reason it is a port.
 *
 * The subscription id it returns is the anti-substitution check the provider
 * session is bound to, so it MUST come from the host's own guarded lookup and
 * never from the request. Scoping the query by `owner_id` is what makes that
 * true here; a host that took the id from the body would satisfy the type and
 * lose the property.
 */
export function subscriptionDirectory(sql: SqlRunner): SubscriptionVaultDirectory {
  return {
    async findTarget(ownerId: string, provider: string): Promise<VaultTarget | null> {
      const params = new Params();
      const { rows } = await sql.query<{
        id: string;
        email: string;
        name: string;
        customerRefs: Record<string, string>;
      }>(
        `SELECT id, email, name, customer_refs AS "customerRefs"
           FROM billing_subscriptions
          WHERE owner_id = ${params.add(ownerId)}`,
        params.values,
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        subscriptionId: row.id,
        // Per PROVIDER: reusing the ref keeps an account to one customer
        // object, so "replace my card" replaces rather than accumulating a
        // second customer whose card nothing points at.
        customerRef: row.customerRefs[provider] ?? null,
        customer: { name: row.name, email: row.email },
      };
    },
  };
}

/** The pointer rows, as the vault flow reads and drops them. */
export function instrumentStore(sql: SqlRunner): VaultPointerStore {
  return {
    async save(instrument: SaveVaultedInstrument): Promise<void> {
      // The new card becomes the one we charge, so the previous default stops
      // being one FIRST — the partial unique index above refuses the pair, and
      // an insert that raced it would fail loudly rather than leave two.
      const clear = new Params();
      await sql.query(
        `UPDATE billing_instruments SET is_default = false
          WHERE owner_id = ${clear.add(instrument.ownerId)} AND is_default`,
        clear.values,
      );
      const params = new Params();
      await sql.query(
        `INSERT INTO billing_instruments
           (id, owner_id, subscription_id, provider, provider_customer_id,
            provider_instrument_id, brand, last4, exp_month, exp_year, is_default)
         VALUES (gen_random_uuid()::text, ${params.add(instrument.ownerId)},
                 ${params.add(instrument.subscriptionId)}, ${params.add(instrument.provider)},
                 ${params.add(instrument.providerCustomerId ?? null)},
                 ${params.add(instrument.providerInstrumentId)},
                 ${params.add(instrument.brand ?? null)}, ${params.add(instrument.last4 ?? null)},
                 ${params.add(instrument.expMonth ?? null)}, ${params.add(instrument.expYear ?? null)},
                 true)`,
        params.values,
      );
    },

    async listPointers(ownerId: string): Promise<readonly StoredVaultPointer[]> {
      const params = new Params();
      // EVERY pointer, not the one on the screen. An owner can hold a card at
      // yesterday's acquirer as well as today's, and a removal that only saw
      // the visible one would leave a card on file the owner believes is gone
      // — chargeable again the day somebody switches acquirer back.
      const { rows } = await sql.query<StoredVaultPointer>(
        `SELECT id, provider,
                provider_customer_id AS "providerCustomerId",
                provider_instrument_id AS "providerInstrumentId"
           FROM billing_instruments
          WHERE owner_id = ${params.add(ownerId)}
          ORDER BY created_at ASC`,
        params.values,
      );
      return rows;
    },

    async forget(pointerId: string): Promise<void> {
      const params = new Params();
      await sql.query(
        `DELETE FROM billing_instruments WHERE id = ${params.add(pointerId)}`,
        params.values,
      );
    },

    async listCards(ownerId: string): Promise<readonly InstrumentCard[]> {
      const params = new Params();
      // The provider-side vault references are NOT selected. That is the whole
      // promise of this read: a screen cannot leak an identifier it was never
      // given, and the surest way to keep it is for the column never to be in
      // the query.
      const { rows } = await sql.query<InstrumentCard>(
        `SELECT provider, brand, last4,
                exp_month AS "expMonth", exp_year AS "expYear",
                is_default AS "isDefault"
           FROM billing_instruments
          WHERE owner_id = ${params.add(ownerId)}
          ORDER BY is_default DESC, created_at ASC`,
        params.values,
      );
      return rows;
    },
  };
}
