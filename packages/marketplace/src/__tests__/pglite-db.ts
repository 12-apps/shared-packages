import { randomUUID } from "node:crypto";

import type { PGlite, Transaction } from "@electric-sql/pglite";

import type { MarketplaceDb } from "../core/ports";

/**
 * The engine's `MarketplaceDb` over REAL Postgres (PGlite), translating the
 * exact Prisma subset the engine writes — equality, `in`, `not`, `lt`, `gte`,
 * the compound unique keys, `increment`, `orderBy`, `take` — into SQL. It lets
 * the engine's guarded writes run against the shipped migration's tables and
 * CHECKs instead of an in-memory stand-in.
 */

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-random-data, test-flakiness/no-global-state-mutation --
   This file IS a database adapter for the engine-on-Postgres suite: SQL is its
   subject, ids and `updated_at` are what the real client would generate, and
   `current` is the adapter's own transaction slot, local to one PGlite. */

type Queryable = Pick<PGlite, "query"> | Transaction;
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const TABLES = {
  marketplaceIntegration: "marketplace_integrations",
  marketplaceMenuLink: "marketplace_menu_links",
  marketplaceInboxEvent: "marketplace_inbox_events",
  marketplaceAcceptance: "marketplace_acceptances",
} as const;

const COMPOUND_KEYS: Record<string, readonly string[]> = {
  provider_eventId: ["provider", "eventId"],
  clientId_provider: ["clientId", "provider"],
  clientId_provider_externalSku: ["clientId", "provider", "externalSku"],
};

const snake = (name: string): string => name.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
const camel = (name: string): string => name.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase());

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

/** A value as a parameter: arrays and objects are JSON columns here. */
const param = (value: unknown): unknown => (Array.isArray(value) || isPlain(value) ? JSON.stringify(value) : value);

class Sql {
  params: unknown[] = [];
  bind(value: unknown): string {
    this.params.push(param(value));
    return `$${this.params.length}`;
  }
}

function conditionSql(sql: Sql, column: string, condition: unknown): string[] {
  if (condition === null) return [`${column} IS NULL`];
  if (!isPlain(condition)) return [`${column} = ${sql.bind(condition)}`];
  return Object.entries(condition).map(([operator, operand]) => {
    if (operator === "in") return `${column} IN (${(operand as unknown[]).map((item) => sql.bind(item)).join(", ") || "NULL"})`;
    if (operator === "not") return operand === null ? `${column} IS NOT NULL` : `(${column} IS NULL OR ${column} <> ${sql.bind(operand)})`;
    if (operator === "lt") return `${column} < ${sql.bind(operand)}`;
    if (operator === "gte") return `${column} >= ${sql.bind(operand)}`;
    throw new Error(`pglite-db: unsupported operator ${operator}`);
  });
}

function whereSql(sql: Sql, where: Where | undefined): string {
  const parts: string[] = [];
  for (const [key, condition] of Object.entries(where ?? {})) {
    const columns = COMPOUND_KEYS[key];
    if (columns && isPlain(condition)) {
      for (const column of columns) parts.push(...conditionSql(sql, snake(column), condition[column]));
    } else parts.push(...conditionSql(sql, snake(key), condition));
  }
  return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
}

function setSql(sql: Sql, data: Row): string {
  const sets = Object.entries(data).map(([key, value]) =>
    isPlain(value) && "increment" in value
      ? `${snake(key)} = ${snake(key)} + ${sql.bind(value.increment)}`
      : `${snake(key)} = ${sql.bind(value)}`,
  );
  return [...sets, "updated_at = now()"].join(", ");
}

const out = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value]));

function uniqueViolation(error: unknown): never {
  if ((error as { code?: string }).code === "23505") throw Object.assign(new Error("unique"), { code: "P2002" });
  throw error;
}

/** One delegate over one table. */
function delegate(conn: () => Queryable, table: string, hasUpdatedAt: boolean) {
  const stamp = (text: string) => (hasUpdatedAt ? text : text.replace(", updated_at = now()", ""));
  const findMany = async (args: unknown): Promise<unknown[]> => {
    const { where, orderBy, take } = (args ?? {}) as { where?: Where; orderBy?: Row; take?: number };
    const sql = new Sql();
    const order = orderBy ? ` ORDER BY ${Object.entries(orderBy).map(([key, dir]) => `${snake(key)} ${String(dir)}`).join(", ")}` : "";
    const limit = take ? ` LIMIT ${take}` : "";
    const result = await conn().query<Row>(`SELECT * FROM ${table} ${whereSql(sql, where)}${order}${limit}`, sql.params);
    return result.rows.map(out);
  };
  const create = async (args: unknown): Promise<unknown> => {
    const data = { id: randomUUID(), ...((args as { data: Row }).data), ...(hasUpdatedAt ? { updatedAt: new Date() } : {}) };
    const sql = new Sql();
    const columns = Object.keys(data).map(snake).join(", ");
    const values = Object.values(data).map((value) => sql.bind(value)).join(", ");
    try {
      return out((await conn().query<Row>(`INSERT INTO ${table} (${columns}) VALUES (${values}) RETURNING *`, sql.params)).rows[0]!);
    } catch (error) {
      return uniqueViolation(error);
    }
  };
  const updateMany = async (args: unknown): Promise<{ count: number }> => {
    const { where, data } = args as { where: Where; data: Row };
    const sql = new Sql();
    const set = stamp(setSql(sql, data));
    const result = await conn().query(`UPDATE ${table} SET ${set} ${whereSql(sql, where)} RETURNING id`, sql.params);
    return { count: result.rows.length };
  };
  return {
    findMany,
    findFirst: async (args: unknown) => (await findMany({ ...(args as object), take: 1 }))[0] ?? null,
    findUnique: async (args: unknown) => (await findMany({ ...(args as object), take: 1 }))[0] ?? null,
    create,
    updateMany,
    update: async (args: unknown) => {
      const { where } = args as { where: Where };
      await updateMany(args);
      return (await findMany({ where, take: 1 }))[0];
    },
    upsert: async (args: unknown) => {
      const { where, create: created, update } = args as { where: Where; create: Row; update: Row };
      const [found] = await findMany({ where, take: 1 });
      if (!found) return create({ data: created });
      if (Object.keys(update).length > 0) await updateMany({ where, data: update });
      return (await findMany({ where, take: 1 }))[0];
    },
    deleteMany: async (args: unknown) => {
      const sql = new Sql();
      const result = await conn().query(`DELETE FROM ${table} ${whereSql(sql, (args as { where: Where }).where)} RETURNING id`, sql.params);
      return { count: result.rows.length };
    },
  };
}

/** The four delegates over a connection, plus the transaction port. */
export function pgliteDb(pg: PGlite) {
  let current: Queryable = pg;
  const conn = () => current;
  const db = {
    marketplaceIntegration: delegate(conn, TABLES.marketplaceIntegration, true),
    marketplaceMenuLink: delegate(conn, TABLES.marketplaceMenuLink, true),
    marketplaceInboxEvent: delegate(conn, TABLES.marketplaceInboxEvent, false),
    marketplaceAcceptance: delegate(conn, TABLES.marketplaceAcceptance, true),
  } as unknown as MarketplaceDb;
  async function transaction<T>(fn: (tx: MarketplaceDb) => Promise<T>): Promise<T> {
    return pg.transaction(async (tx) => {
      current = tx;
      try {
        return await fn(db);
      } finally {
        current = pg;
      }
    });
  }
  return { db, transaction };
}
