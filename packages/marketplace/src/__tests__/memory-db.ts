import type { MarketplaceDb } from "../core/ports";

/**
 * An in-memory stand-in for the four Prisma delegates the engine uses — just
 * the query subset the engine actually writes (equality, `in`, `not`, `lt`,
 * compound unique keys, `increment`), so a test reads real rows back instead
 * of asserting on mock call shapes. Unique indexes are enforced the way the
 * migration enforces them, with Prisma's `P2002` code.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** The compound unique keys Prisma names, and the columns behind each. */
const COMPOUND_KEYS: Record<string, readonly string[]> = {
  provider_eventId: ["provider", "eventId"],
  clientId_provider: ["clientId", "provider"],
  clientId_provider_externalSku: ["clientId", "provider", "externalSku"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (!isPlainObject(condition)) return same(value ?? null, condition);
  if ("in" in condition) return (condition.in as unknown[]).some((item) => same(value, item));
  if ("not" in condition) return !same(value ?? null, condition.not);
  if ("lt" in condition) return (value as number | Date) < (condition.lt as number | Date);
  throw new Error(`memory-db: unsupported condition ${JSON.stringify(condition)}`);
}

function expandWhere(where: Where): Where {
  const out: Where = {};
  for (const [key, value] of Object.entries(where)) {
    const columns = COMPOUND_KEYS[key];
    if (columns && isPlainObject(value)) {
      for (const column of columns) out[column] = value[column];
    } else out[key] = value;
  }
  return out;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(expandWhere(where)).every(([key, condition]) => matchesCondition(row[key], condition));
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (isPlainObject(value) && "increment" in value) {
      row[key] = (row[key] as number) + (value.increment as number);
    } else row[key] = value;
  }
}

class UniqueViolation extends Error {
  code = "P2002";
}

interface TableSpec {
  defaults: () => Row;
  unique: readonly (readonly string[])[];
}

/** One table: rows plus the unique indexes the migration declares. */
export class MemoryTable {
  rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly name: string,
    private readonly spec: TableSpec,
  ) {}

  private assertUnique(candidate: Row, except?: Row): void {
    for (const columns of this.spec.unique) {
      const clash = this.rows.find(
        (row) => row !== except && columns.every((column) => same(row[column], candidate[column])),
      );
      if (clash) throw new UniqueViolation(`${this.name}: unique (${columns.join(", ")})`);
    }
  }

  private orderRows(rows: Row[], orderBy: unknown): Row[] {
    if (!isPlainObject(orderBy)) return rows;
    const [[key, direction]] = Object.entries(orderBy) as [[string, "asc" | "desc"]];
    const sign = direction === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = a[key] instanceof Date ? (a[key] as Date).getTime() : (a[key] as number | string);
      const right = b[key] instanceof Date ? (b[key] as Date).getTime() : (b[key] as number | string);
      return left < right ? -sign : left > right ? sign : 0;
    });
  }

  async findMany(args: unknown): Promise<unknown[]> {
    const { where, orderBy, take } = (args ?? {}) as { where?: Where; orderBy?: unknown; take?: number };
    const found = this.orderRows(this.rows.filter((row) => matches(row, where)), orderBy);
    return found.slice(0, take ?? found.length).map((row) => ({ ...row }));
  }

  async findFirst(args: unknown): Promise<unknown> {
    return (await this.findMany(args))[0] ?? null;
  }

  async findUnique(args: unknown): Promise<unknown> {
    return this.findFirst(args);
  }

  async create(args: unknown): Promise<unknown> {
    const { data } = args as { data: Row };
    this.seq += 1;
    const row: Row = { id: `${this.name}-${this.seq}`, ...this.spec.defaults(), ...data };
    this.assertUnique(row);
    this.rows.push(row);
    return { ...row };
  }

  async update(args: unknown): Promise<unknown> {
    const { where, data } = args as { where: Where; data: Row };
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (!row) throw new Error(`${this.name}: no row to update`);
    applyData(row, data);
    return { ...row };
  }

  async updateMany(args: unknown): Promise<{ count: number }> {
    const { where, data } = args as { where: Where; data: Row };
    const hit = this.rows.filter((row) => matches(row, where));
    for (const row of hit) applyData(row, data);
    return { count: hit.length };
  }

  async upsert(args: unknown): Promise<unknown> {
    const { where, create, update } = args as { where: Where; create: Row; update: Row };
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (!row) return this.create({ data: create });
    applyData(row, update);
    return { ...row };
  }

  async deleteMany(args: unknown): Promise<{ count: number }> {
    const { where } = args as { where: Where };
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, where));
    return { count: before - this.rows.length };
  }
}

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/** The four tables, with the defaults and uniques of the shipped migration. */
export function createMemoryDb() {
  const tables = {
    marketplaceIntegration: new MemoryTable("integration", {
      defaults: () => ({
        enabled: false,
        environment: "SANDBOX",
        externalMerchantId: null,
        autoAccept: false,
        ackSlaSeconds: 300,
        status: "UNVERIFIED",
        lastEventAt: null,
        lastVerifiedAt: null,
      }),
      unique: [["clientId", "provider"]],
    }),
    marketplaceMenuLink: new MemoryTable("link", {
      defaults: () => ({ externalName: null, menuItemId: null, lastSeenAt: EPOCH }),
      unique: [["clientId", "provider", "externalSku"]],
    }),
    marketplaceInboxEvent: new MemoryTable("inbox", {
      defaults: () => ({
        status: "PENDING",
        attempts: 0,
        error: null,
        receivedAt: EPOCH,
        processedAt: null,
      }),
      unique: [["provider", "eventId"]],
    }),
    marketplaceAcceptance: new MemoryTable("acceptance", {
      defaults: () => ({
        externalDisplayId: null,
        deliveredBy: null,
        status: "AWAITING",
        acknowledgeBy: null,
        acknowledgedAt: null,
        externalDueAt: null,
        commissionCents: null,
        confirmedAt: null,
        confirmFailedAt: null,
        cancellationStatus: null,
        cancellationReasonCode: null,
        createdAt: EPOCH,
      }),
      unique: [["orderId"], ["provider", "externalOrderId"]],
    }),
  };
  const db: MarketplaceDb = tables;
  return { db, tables };
}

export type MemoryDb = ReturnType<typeof createMemoryDb>;
