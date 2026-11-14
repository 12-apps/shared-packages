import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import type { MessagingPrismaDb } from "../core/prisma-store";

/**
 * The store's `MessagingPrismaDb` over REAL Postgres (PGlite), translating the
 * exact Prisma subset `createPrismaMessagingStore` writes — equality, `null`,
 * `in`, `lt`, `lte`, the compound unique keys, `increment`, `orderBy`, `take`,
 * `select` — into SQL against the shipped migration. A query the translator
 * does not know throws, so the store cannot quietly grow past what this suite
 * proves.
 */

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-random-data, test-flakiness/no-unmocked-fs --
   This file IS a database adapter for the store-on-Postgres suite: SQL is its
   subject, ids are what the real client would generate, and the committed
   migration files are what it applies. */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const TABLES = {
  messagingConnection: { table: "messaging_connections", updatedAt: true },
  messagingInboxDelivery: { table: "messaging_inbox_deliveries", updatedAt: false },
  messagingConversation: { table: "messaging_conversations", updatedAt: true },
  messagingMessage: { table: "messaging_messages", updatedAt: false },
} as const;

const COMPOUND_KEYS: Record<string, readonly string[]> = {
  channel_bodyHash: ["channel", "bodyHash"],
  channel_externalAccountId: ["channel", "externalAccountId"],
  tenantId_channel_contactId: ["tenantId", "channel", "contactId"],
  channel_externalId: ["channel", "externalId"],
};

const snake = (name: string): string => name.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
const camel = (name: string): string => name.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);
const param = (value: unknown): unknown => (isPlain(value) || Array.isArray(value) ? JSON.stringify(value) : value);

class Sql {
  params: unknown[] = [];
  bind(value: unknown): string {
    this.params.push(param(value));
    return `$${this.params.length}`;
  }
}

const OPERATORS: Record<string, (sql: Sql, column: string, operand: unknown) => string> = {
  in: (sql, column, operand) => `${column} IN (${(operand as unknown[]).map((item) => sql.bind(item)).join(", ") || "NULL"})`,
  lt: (sql, column, operand) => `${column} < ${sql.bind(operand)}`,
  lte: (sql, column, operand) => `${column} <= ${sql.bind(operand)}`,
  gte: (sql, column, operand) => `${column} >= ${sql.bind(operand)}`,
  not: (sql, column, operand) => (operand === null ? `${column} IS NOT NULL` : `${column} IS DISTINCT FROM ${sql.bind(operand)}`),
};

function conditionSql(sql: Sql, column: string, condition: unknown): string[] {
  if (condition === null) return [`${column} IS NULL`];
  if (!isPlain(condition)) return [`${column} = ${sql.bind(condition)}`];
  return Object.entries(condition).map(([operator, operand]) => {
    const build = OPERATORS[operator];
    if (!build) throw new Error(`pglite-db: unsupported operator ${operator}`);
    return build(sql, column, operand);
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

function shape(row: Row, select: Record<string, boolean> | undefined): Row {
  const out = Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value]));
  return select ? Object.fromEntries(Object.keys(select).map((key) => [key, out[key]])) : out;
}

function uniqueViolation(error: unknown): never {
  if ((error as { code?: string }).code === "23505") throw Object.assign(new Error("unique"), { code: "P2002" });
  throw error;
}

interface Args {
  where?: Where;
  data?: Row;
  orderBy?: Record<string, string>;
  take?: number;
  select?: Record<string, boolean>;
}

function delegate(pg: PGlite, table: string, updatedAt: boolean) {
  const findMany = async (args: Args = {}): Promise<Row[]> => {
    const sql = new Sql();
    const order = args.orderBy ? ` ORDER BY ${Object.entries(args.orderBy).map(([key, dir]) => `${snake(key)} ${dir}`).join(", ")}` : "";
    const limit = args.take ? ` LIMIT ${args.take}` : "";
    const result = await pg.query<Row>(`SELECT * FROM ${table} ${whereSql(sql, args.where)}${order}${limit}`, sql.params);
    return result.rows.map((row) => shape(row, args.select));
  };
  const updateMany = async ({ where, data = {} }: Args): Promise<{ count: number }> => {
    const sql = new Sql();
    const sets = Object.entries(data).map(([key, value]) =>
      isPlain(value) && "increment" in value
        ? `${snake(key)} = ${snake(key)} + ${sql.bind(value.increment)}`
        : `${snake(key)} = ${sql.bind(value)}`,
    );
    if (updatedAt) sets.push("updated_at = now()");
    try {
      const result = await pg.query(`UPDATE ${table} SET ${sets.join(", ")} ${whereSql(sql, where)} RETURNING id`, sql.params);
      return { count: result.rows.length };
    } catch (error) {
      return uniqueViolation(error);
    }
  };
  const deleteMany = async ({ where }: Args): Promise<{ count: number }> => {
    const sql = new Sql();
    const result = await pg.query(`DELETE FROM ${table} ${whereSql(sql, where)} RETURNING id`, sql.params);
    return { count: result.rows.length };
  };
  const first = async (args: Args = {}) => (await findMany({ ...args, take: 1 }))[0] ?? null;
  return {
    findMany: (args: unknown) => findMany(args as Args),
    findFirst: (args: unknown) => first(args as Args),
    findUnique: (args: unknown) => first(args as Args),
    updateMany: (args: unknown) => updateMany(args as Args),
    deleteMany: (args: unknown) => deleteMany(args as Args),
    update: async (args: unknown) => {
      const { where, select } = args as Args;
      await updateMany(args as Args);
      return first({ ...(where ? { where } : {}), ...(select ? { select } : {}) });
    },
    create: async (args: unknown) => {
      const { data = {}, select } = args as Args;
      const row: Row = { id: randomUUID(), ...data, ...(updatedAt ? { updatedAt: new Date() } : {}) };
      const sql = new Sql();
      const values = Object.values(row).map((value) => sql.bind(value)).join(", ");
      try {
        const result = await pg.query<Row>(
          `INSERT INTO ${table} (${Object.keys(row).map(snake).join(", ")}) VALUES (${values}) RETURNING *`,
          sql.params,
        );
        return shape(result.rows[0]!, select);
      } catch (error) {
        return uniqueViolation(error);
      }
    },
  };
}

/** A fresh in-memory Postgres with every shipped migration applied. */
export async function migratedPglite(): Promise<PGlite> {
  const pg = new PGlite();
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const dir of readdirSync(migrations).sort()) {
    await pg.exec(readFileSync(new URL(`${dir}/migration.sql`, migrations), "utf8"));
  }
  return pg;
}

/** The four delegates over one PGlite. */
export function pgliteDb(pg: PGlite): MessagingPrismaDb {
  return Object.fromEntries(
    Object.entries(TABLES).map(([name, { table, updatedAt }]) => [name, delegate(pg, table, updatedAt)]),
  ) as unknown as MessagingPrismaDb;
}
