/**
 * The SQL half of contingency blocks (FUT-4717), over the package's migration
 * (`fiscal_contingency_blocks`, `fiscal_contingency_voids`):
 *
 * - a block is ONE `UPDATE … SET next_number = next_number + size` on the
 *   series' counter row (the row `issueOffline` draws from), and its insert,
 *   in one transaction: the row lock serialises it with every other draw;
 * - a signed note is its document and its event, in one transaction; the
 *   unique indexes on the key and the number make a second copy a `CONFLICT`.
 */

import { FiscalDocumentError } from "./errors";
import type { ContingencyBlock, ContingencyBlockState, ContingencyBlockStore } from "./ports";
import type { FiscalPrismaClient, FiscalSqlClient } from "./sql-store";
import { DOCUMENT_COLUMNS, type Row, documentOf, documentValues, placeholder } from "./sql-rows";
import type { FiscalDocument, FiscalDocumentEvent } from "./types";

/**
 * Advance a contingency series' counter by a block. `$1` CNPJ, `$2`
 * environment, `$3` model, `$4` series, `$5` issuing point, `$6` size. No row:
 * not that point's contingency series; past the ceiling: the counter's CHECK.
 */
export const FISCAL_RESERVE_BLOCK_SQL = `UPDATE "fiscal_number_counters"
SET "next_number" = "next_number" + $6::integer, "updated_at" = CURRENT_TIMESTAMP
WHERE "issuer_cnpj" = $1 AND "environment" = $2 AND "model" = $3 AND "series" = $4 AND "issuing_point_id" = $5
  AND "series_kind" = 'CONTINGENCY'
RETURNING "next_number" - $6::integer AS "first"`;

const rows = (client: FiscalSqlClient, query: string, ...values: unknown[]) => client.$queryRawUnsafe<Row[]>(query, ...values);

function violates(error: unknown, constraint: string): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? "")}` : String(error);
  return text.includes(constraint);
}

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(value instanceof Date ? value : `${String(value).replace(" ", "T")}Z`).toISOString());

function blockOf(row: Row): ContingencyBlock {
  return {
    id: String(row["id"]),
    ownerId: String(row["owner_id"]),
    issuingPointId: String(row["issuing_point_id"]),
    issuerCnpj: String(row["issuer_cnpj"]),
    environment: row["environment"] as ContingencyBlock["environment"],
    model: "NFCE",
    series: Number(row["series"]),
    from: Number(row["first_number"]),
    to: Number(row["last_number"]),
    holder: String(row["holder"]),
    fate: row["fate"] as ContingencyBlock["fate"],
    usedUpTo: row["used_up_to"] === null ? null : Number(row["used_up_to"]),
    reservedAt: iso(row["reserved_at"]) ?? "",
    closedAt: iso(row["closed_at"]),
    settledAt: iso(row["settled_at"]),
  };
}

const INSERT_BLOCK = `INSERT INTO "fiscal_contingency_blocks"
  ("id", "owner_id", "issuing_point_id", "issuer_cnpj", "environment", "model", "series", "first_number", "last_number", "holder", "reserved_at")
VALUES ($1, $2, $3, $4, $5, 'NFCE', $6, $7, $8, $9, $10::timestamp(3))`;

const INSERT_DOCUMENT = `INSERT INTO "fiscal_documents" (${DOCUMENT_COLUMNS.map((c) => `"${c}"`).join(", ")})
VALUES (${DOCUMENT_COLUMNS.map((c, i) => placeholder(c, i + 1)).join(", ")})`;

const INSERT_EVENT = `INSERT INTO "fiscal_document_events" ("id", "document_id", "kind", "from_status", "to_status", "at", "error_class", "code", "answer")
VALUES ($1, $2, $3, $4, $5, $6::timestamp(3), $7, $8, $9::jsonb)`;

async function reserve(db: FiscalPrismaClient, input: Parameters<ContingencyBlockStore["reserveContingencyBlock"]>[0]): Promise<ContingencyBlock> {
  const { request, size, id, holder, at } = input;
  try {
    return await db.$transaction(async (tx) => {
      const [row] = await rows(tx, FISCAL_RESERVE_BLOCK_SQL, request.issuerCnpj, request.environment, request.model, request.series, request.issuingPointId, size);
      if (row === undefined) {
        throw new FiscalDocumentError("NOT_FOUND", `no contingency counter for series ${request.series} on issuing point ${request.issuingPointId}.`);
      }
      const first = Number(row["first"]);
      await tx.$executeRawUnsafe(
        INSERT_BLOCK, id, request.ownerId, request.issuingPointId, request.issuerCnpj, request.environment, request.series, first, first + size - 1, holder, at,
      );
      const [stored] = await rows(tx, `SELECT * FROM "fiscal_contingency_blocks" WHERE "id" = $1`, id);
      return blockOf(stored ?? {});
    });
  } catch (error) {
    if (violates(error, "fiscal_number_counters_next_number_check") || violates(error, "fiscal_contingency_blocks_range_check")) {
      throw new FiscalDocumentError("SERIES_EXHAUSTED", `series ${request.series} has no ${size} numbers left.`);
    }
    throw error;
  }
}

async function insertSigned(db: FiscalPrismaClient, document: FiscalDocument, event: FiscalDocumentEvent): Promise<FiscalDocument> {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(INSERT_DOCUMENT, ...documentValues(document));
      await tx.$executeRawUnsafe(
        INSERT_EVENT, globalThis.crypto.randomUUID(), event.documentId, event.kind, event.fromStatus, event.toStatus, event.at,
        event.errorClass, event.code, JSON.stringify(event.answer),
      );
    });
    return document;
  } catch (error) {
    if (violates(error, "fiscal_documents_live_subject_key")) {
      throw new FiscalDocumentError("SUBJECT_HAS_DOCUMENT", `subject ${document.subjectId} already has a live ${document.model}.`);
    }
    if (violates(error, "fiscal_documents_access_key_key") || violates(error, "fiscal_documents_number_key")) {
      throw new FiscalDocumentError("CONFLICT", `key ${document.accessKey ?? ""} or number ${document.number} is recorded already.`);
    }
    throw error;
  }
}

/** The blocks, each with its documented numbers and voided ranges: two reads. */
async function withState(db: FiscalPrismaClient, blocks: readonly ContingencyBlock[]): Promise<ContingencyBlockState[]> {
  if (blocks.length === 0) return [];
  const ids = blocks.map((block) => block.id);
  const documented = await rows(
    db,
    `SELECT b."id" AS "block_id", d."number" FROM "fiscal_contingency_blocks" b
       JOIN "fiscal_documents" d ON d."issuer_cnpj" = b."issuer_cnpj" AND d."environment" = b."environment" AND d."model" = b."model"
        AND d."series" = b."series" AND d."number" BETWEEN b."first_number" AND b."last_number"
     WHERE b."id" = ANY($1::text[]) ORDER BY d."number"`,
    ids,
  );
  const voids = await rows(db, `SELECT * FROM "fiscal_contingency_voids" WHERE "block_id" = ANY($1::text[]) ORDER BY "first_number"`, ids);
  return blocks.map((block) => ({
    ...block,
    documented: documented.filter((row) => row["block_id"] === block.id).map((row) => Number(row["number"])),
    voided: voids.filter((row) => row["block_id"] === block.id).map((row) => ({ from: Number(row["first_number"]), to: Number(row["last_number"]) })),
  }));
}

/** One keyset page of the blocks a filter selects, ordered by `(reserved_at, id)`, with their state. */
async function list(db: FiscalPrismaClient, input: Parameters<ContingencyBlockStore["listContingencyBlocks"]>[0]): Promise<ContingencyBlockState[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    values.push(value);
    where.push(clause(values.length));
  };
  if (input.ownerId !== undefined) add((n) => `"owner_id" = $${n}`, input.ownerId);
  if (input.holder !== undefined) add((n) => `"holder" = $${n}`, input.holder);
  if (input.fates !== undefined) add((n) => `"fate" = ANY($${n}::text[])`, [...input.fates]);
  if (input.reservedBefore !== undefined) add((n) => `"reserved_at" < $${n}::timestamp(3)`, input.reservedBefore);
  if (input.unsettledOnly === true) where.push(`"settled_at" IS NULL`);
  if (input.after !== undefined) {
    values.push(input.after.reservedAt, input.after.id);
    where.push(`("reserved_at", "id") > ($${values.length - 1}::timestamp(3), $${values.length})`);
  }
  values.push(input.limit);
  const blocks = (
    await rows(
      db,
      `SELECT * FROM "fiscal_contingency_blocks" ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
       ORDER BY "reserved_at", "id" LIMIT $${values.length}`,
      ...values,
    )
  ).map(blockOf);
  return withState(db, blocks);
}

export function blockMethods(db: FiscalPrismaClient): ContingencyBlockStore {
  return {
    reserveContingencyBlock: (input) => reserve(db, input),
    async findContingencyBlock(input) {
      const [row] = await rows(
        db,
        `SELECT * FROM "fiscal_contingency_blocks"
         WHERE "owner_id" = $1 AND "issuer_cnpj" = $2 AND "environment" = $3 AND "model" = 'NFCE' AND "series" = $4
           AND $5::integer BETWEEN "first_number" AND "last_number"`,
        input.ownerId, input.issuerCnpj, input.environment, input.series, input.number,
      );
      return row === undefined ? null : ((await withState(db, [blockOf(row)]))[0] ?? null);
    },
    listContingencyBlocks: (input) => list(db, input),
    async closeContingencyBlock({ id, fate, usedUpTo, at }) {
      const updated = await rows(
        db,
        `UPDATE "fiscal_contingency_blocks" SET "fate" = $2, "used_up_to" = $3, "closed_at" = $4::timestamp(3)
         WHERE "id" = $1 AND "fate" = 'OPEN' RETURNING "id"`,
        id, fate, usedUpTo, at,
      );
      return updated.length > 0;
    },
    async settleContingencyBlock({ id, at }) {
      await db.$executeRawUnsafe(`UPDATE "fiscal_contingency_blocks" SET "settled_at" = $2::timestamp(3) WHERE "id" = $1`, id, at);
    },
    async recordContingencyVoid({ id, blockId, range, protocol, eventXmlKey, at }) {
      const inserted = await rows(
        db,
        `INSERT INTO "fiscal_contingency_voids" ("id", "block_id", "first_number", "last_number", "protocol", "event_xml_key", "voided_at")
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp(3)) ON CONFLICT ("block_id", "first_number") DO NOTHING RETURNING "id"`,
        id, blockId, range.from, range.to, protocol, eventXmlKey, at,
      );
      return inserted.length > 0;
    },
    async getDocumentByAccessKey(ownerId, accessKey) {
      const [row] = await rows(db, `SELECT * FROM "fiscal_documents" WHERE "owner_id" = $1 AND "access_key" = $2`, ownerId, accessKey);
      return row === undefined ? null : documentOf(row);
    },
    recordSignedDocument: (document, event) => insertSigned(db, document, event),
  };
}
