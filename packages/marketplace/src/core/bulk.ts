import {
  listMarketplaceIntegrations,
  saveMarketplaceIntegration,
  type MarketplaceIntegrationView,
  type SaveMarketplaceIntegrationInput,
} from "./integration";
import { upsertLink, type MarketplaceMenuLinkView } from "./menu-links";
import type { EngineContext, MarketplaceAuditEntry, MarketplaceDb } from "./ports";

/**
 * The bulk writes: one call, many rows, all-or-nothing.
 *
 * Every row is validated first (cross-row duplicates, unknown providers, a
 * catalog id that is not the store's, an archive of nothing) and every problem
 * is returned with its path; any problem writes nothing. Then ONE transaction
 * writes every row, or none. `validateOnly` validates and writes nothing.
 * Idempotent on the natural key: a connection is `(store, provider)`, a SKU
 * link `(store, provider, externalSku)`.
 */

/** Why a bulk row was refused. Vocabulary, not copy. */
export type BulkProblemCode =
  | "DUPLICATE"
  | "UNKNOWN_PROVIDER"
  | "NOTHING_TO_UPDATE"
  | "NOT_FOUND"
  | "CATALOG_ITEM_NOT_FOUND";

export interface BulkProblem {
  path: (string | number)[];
  code: BulkProblemCode;
}

export type BulkResult<T> =
  | { kind: "saved"; validateOnly: boolean; rows: T[] }
  | { kind: "refused"; problems: BulkProblem[] };

/** One connection row: an upsert of its settings, an archive, or an unarchive. */
export type IntegrationRowInput =
  | ({ operation?: "upsert" } & Omit<SaveMarketplaceIntegrationInput, "clientId">)
  | { operation: "archive" | "unarchive"; provider: string; reason?: string | null };

/** One SKU link: map it to a catalog id, or unmap it with `menuItemId: null`. */
export interface MenuLinkRowInput {
  provider: string;
  externalSku: string;
  externalName?: string;
  menuItemId: string | null;
}

/** The key of each row seen twice, as problems. */
function duplicates<T>(rows: readonly T[], keyOf: (row: T) => string, list: string, field: string): BulkProblem[] {
  const seen = new Set<string>();
  return rows.flatMap((row, index) => {
    const key = keyOf(row);
    if (!seen.has(key)) {
      seen.add(key);
      return [];
    }
    return [{ path: [list, index, field], code: "DUPLICATE" as const }];
  });
}

function unknownProviders(ctx: EngineContext, rows: readonly { provider: string }[], list: string): BulkProblem[] {
  return rows.flatMap((row, index) =>
    ctx.registry.has(row.provider) ? [] : [{ path: [list, index, "provider"], code: "UNKNOWN_PROVIDER" as const }],
  );
}

const SETTING_KEYS = ["enabled", "environment", "externalMerchantId", "autoAccept", "ackSlaSeconds", "credentials"] as const;

function integrationRowProblems(
  row: IntegrationRowInput,
  index: number,
  existing: ReadonlySet<string>,
): BulkProblem[] {
  if (row.operation === "archive" || row.operation === "unarchive") {
    return existing.has(row.provider) ? [] : [{ path: ["integrations", index, "provider"], code: "NOT_FOUND" }];
  }
  const settings = row as Partial<Record<(typeof SETTING_KEYS)[number], unknown>>;
  const changes = SETTING_KEYS.some((key) => settings[key] !== undefined);
  return changes ? [] : [{ path: ["integrations", index], code: "NOTHING_TO_UPDATE" }];
}

/** Thrown inside the transaction to roll a `validateOnly` call back. */
class ValidateOnly extends Error {
  constructor() {
    super("validate only");
  }
}

/** Run `write` in one transaction; a `validateOnly` call is rolled back. */
async function inTransaction<T>(ctx: EngineContext, validateOnly: boolean, write: (db: MarketplaceDb) => Promise<T>): Promise<T | null> {
  let written: T | null = null;
  try {
    await ctx.ports.transaction(async (db) => {
      written = await write(db);
      if (validateOnly) throw new ValidateOnly();
    });
  } catch (error) {
    if (!(error instanceof ValidateOnly)) throw error;
  }
  return written;
}

async function writeIntegration(
  ctx: EngineContext,
  db: MarketplaceDb,
  clientId: string,
  row: IntegrationRowInput,
  now: Date,
): Promise<MarketplaceIntegrationView | null> {
  if (row.operation === "archive" || row.operation === "unarchive") {
    await db.marketplaceIntegration.updateMany({
      where: { clientId, provider: row.provider },
      data: { archivedAt: row.operation === "archive" ? now : null },
    });
    return null;
  }
  const settings: Omit<IntegrationRowInput, "operation"> & { operation?: unknown } = { ...row };
  delete settings.operation;
  return saveMarketplaceIntegration(ctx, { clientId, ...(settings as Omit<SaveMarketplaceIntegrationInput, "clientId">) }, db);
}

/**
 * Create, patch, archive or unarchive many connections at once. A connection
 * is never deleted: archiving is reversible, and each archive and unarchive is
 * an audit line through the host's `audit` port, written after the commit.
 */
export async function upsertIntegrations(
  ctx: EngineContext,
  input: { clientId: string; actorId: string | null; rows: readonly IntegrationRowInput[]; validateOnly?: boolean },
): Promise<BulkResult<MarketplaceIntegrationView>> {
  const existing = new Set(
    (await listMarketplaceIntegrations(ctx, input.clientId, { includeArchived: true })).map((row) => row.provider),
  );
  const problems = [
    ...duplicates(input.rows, (row) => row.provider, "integrations", "provider"),
    ...unknownProviders(ctx, input.rows, "integrations"),
    ...input.rows.flatMap((row, index) => integrationRowProblems(row, index, existing)),
  ];
  if (problems.length > 0) return { kind: "refused", problems };

  const validateOnly = input.validateOnly === true;
  const now = ctx.ports.clock.now();
  await inTransaction(ctx, validateOnly, async (db) => {
    for (const row of input.rows) await writeIntegration(ctx, db, input.clientId, row, now);
  });
  if (!validateOnly) await auditArchives(ctx, input, now);
  const providers = input.rows.map((row) => row.provider);
  const rows = validateOnly
    ? []
    : await listMarketplaceIntegrations(ctx, input.clientId, { providers, includeArchived: true });
  return { kind: "saved", validateOnly, rows };
}

async function auditArchives(
  ctx: EngineContext,
  input: { clientId: string; actorId: string | null; rows: readonly IntegrationRowInput[] },
  now: Date,
): Promise<void> {
  for (const row of input.rows) {
    if (row.operation !== "archive" && row.operation !== "unarchive") continue;
    const entry: MarketplaceAuditEntry = {
      clientId: input.clientId,
      actorId: input.actorId,
      action: row.operation === "archive" ? "marketplace.integration.archive" : "marketplace.integration.unarchive",
      provider: row.provider,
      reason: row.reason ?? null,
      at: now,
    };
    await ctx.ports.audit.record(entry);
  }
}

/** Map or unmap many SKUs at once; every catalog id must be the store's. */
export async function upsertMenuLinks(
  ctx: EngineContext,
  input: { clientId: string; rows: readonly MenuLinkRowInput[]; validateOnly?: boolean },
): Promise<BulkResult<MarketplaceMenuLinkView>> {
  const problems = [
    ...duplicates(input.rows, (row) => `${row.provider}\u0000${row.externalSku}`, "links", "externalSku"),
    ...unknownProviders(ctx, input.rows, "links"),
  ];
  for (const [index, row] of input.rows.entries()) {
    if (row.menuItemId !== null && !(await ctx.ports.order.catalogHas(input.clientId, row.menuItemId))) {
      problems.push({ path: ["links", index, "menuItemId"], code: "CATALOG_ITEM_NOT_FOUND" });
    }
  }
  if (problems.length > 0) return { kind: "refused", problems };

  const validateOnly = input.validateOnly === true;
  const written = await inTransaction(ctx, validateOnly, async (db) => {
    const rows: MarketplaceMenuLinkView[] = [];
    for (const row of input.rows) rows.push(await upsertLink(db, { clientId: input.clientId, ...row }));
    return rows;
  });
  return { kind: "saved", validateOnly, rows: written ?? [] };
}
