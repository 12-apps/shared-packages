/**
 * `createPrismaFiscalStore` — the package's own {@link FiscalStore}, over the
 * host's Prisma client and the package's migration. A host passes its client
 * and nothing else: the numbering invariants live here, not in each host.
 *
 * - The draw and the insert are ONE transaction (`FISCAL_NEXT_NUMBER_SQL`):
 *   the counter's row lock serialises concurrent draws, and a refused insert
 *   gives the number back.
 * - Going offline replaces the online document in that same transaction,
 *   before the insert, so a crash leaves exactly one live document.
 * - The per-subject guard is the partial unique index
 *   `fiscal_documents_live_subject_key`: a second live document is refused as
 *   `SUBJECT_HAS_DOCUMENT`, and nothing is drawn.
 * - A transition is saved only over the row it started from (`updated_at` and
 *   `status`), with its event, in one transaction.
 *
 * It speaks raw SQL through the client's `$queryRawUnsafe` /
 * `$executeRawUnsafe` / `$transaction`, so it needs no generated model types
 * and works on the host's client whatever else its schema holds.
 */

import { FiscalDocumentError } from "./errors";
import type { Transition } from "./machine";
import type { FiscalStore, NumberRequest } from "./ports";
import { FISCAL_NEXT_NUMBER_SQL } from "./sql";
import {
  DOCUMENT_COLUMNS,
  PROFILE_COLUMNS,
  type Row,
  documentOf,
  documentValues,
  eventOf,
  placeholder,
  pointOf,
  profileOf,
  profilePlaceholder,
  profileValues,
} from "./sql-rows";
import type { FiscalDocument } from "./types";

/** The two raw-SQL methods of a Prisma client (or of its transaction client). */
export interface FiscalSqlClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/** A Prisma client: the raw-SQL methods and an interactive transaction. */
export interface FiscalPrismaClient extends FiscalSqlClient {
  $transaction<T>(run: (tx: FiscalSqlClient) => Promise<T>): Promise<T>;
}

const rows = (client: FiscalSqlClient, query: string, ...values: unknown[]) => client.$queryRawUnsafe<Row[]>(query, ...values);

const INSERT_DOCUMENT = `INSERT INTO "fiscal_documents" (${DOCUMENT_COLUMNS.map((c) => `"${c}"`).join(", ")})
VALUES (${DOCUMENT_COLUMNS.map((c, i) => placeholder(c, i + 1)).join(", ")})`;

const MUTABLE = DOCUMENT_COLUMNS.filter((c) => c !== "id" && c !== "created_at");
// $1 the id, $2... the mutable columns, then the row the transition started from.
const UPDATE_DOCUMENT = [
  `UPDATE "fiscal_documents" SET ${MUTABLE.map((c, i) => `"${c}" = ${placeholder(c, i + 2)}`).join(", ")}`,
  `WHERE "id" = $1 AND "updated_at" = $${MUTABLE.length + 2}::timestamp(3) AND "status" = $${MUTABLE.length + 3}`,
  `RETURNING "id"`,
].join("\n");

function updateValues(document: FiscalDocument, previous: FiscalDocument): unknown[] {
  const all = documentValues(document);
  const mutable = MUTABLE.map((column) => all[DOCUMENT_COLUMNS.indexOf(column)]);
  return [document.id, ...mutable, previous.updatedAt, previous.status];
}

const INSERT_EVENT = `INSERT INTO "fiscal_document_events" ("id", "document_id", "kind", "from_status", "to_status", "at", "error_class", "code", "answer")
VALUES ($1, $2, $3, $4, $5, $6::timestamp(3), $7, $8, $9::jsonb)`;

const UPSERT_PROFILE = `INSERT INTO "fiscal_emitter_profiles" (${PROFILE_COLUMNS.map((c) => `"${c}"`).join(", ")})
VALUES (${PROFILE_COLUMNS.map((c, i) => profilePlaceholder(c, i + 1)).join(", ")})
ON CONFLICT ("owner_id") DO UPDATE SET ${PROFILE_COLUMNS.filter((c) => c !== "owner_id").map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")}`;

const OWED = `("status" IN ('PENDING', 'SUBMITTED') OR "number_void" IN ('LOOKUP_FIRST', 'INUTILIZE', 'CANCEL'))`;

/** A unique-index or CHECK violation, recognised by its constraint's name in whatever error the client raised. */
function violates(error: unknown, constraint: string): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? "")}` : String(error);
  return text.includes(constraint);
}

async function saveRow(tx: FiscalSqlClient, previous: FiscalDocument, { document, event }: Transition): Promise<boolean> {
  const updated = await rows(tx, UPDATE_DOCUMENT, ...updateValues(document, previous));
  if (updated.length === 0) return false;
  await tx.$executeRawUnsafe(
    INSERT_EVENT,
    globalThis.crypto.randomUUID(),
    event.documentId,
    event.kind,
    event.fromStatus,
    event.toStatus,
    event.at,
    event.errorClass,
    event.code,
    event.answer === null ? null : JSON.stringify(event.answer),
  );
  return true;
}

async function draw(tx: FiscalSqlClient, request: NumberRequest): Promise<number> {
  try {
    const [row] = await rows(tx, FISCAL_NEXT_NUMBER_SQL, request.issuerCnpj, request.environment, request.model, request.series, request.issuingPointId);
    if (row === undefined) {
      throw new FiscalDocumentError("NOT_FOUND", `no counter for series ${request.series} on issuing point ${request.issuingPointId}.`);
    }
    return Number(row["number"]);
  } catch (error) {
    if (violates(error, "fiscal_number_counters_next_number_check")) {
      throw new FiscalDocumentError("SERIES_EXHAUSTED", `series ${request.series} has no number left.`);
    }
    throw error;
  }
}

async function insertDocument(tx: FiscalSqlClient, document: FiscalDocument): Promise<void> {
  try {
    await tx.$executeRawUnsafe(INSERT_DOCUMENT, ...documentValues(document));
  } catch (error) {
    if (violates(error, "fiscal_documents_live_subject_key")) {
      throw new FiscalDocumentError("SUBJECT_HAS_DOCUMENT", `subject ${document.subjectId} already has a live ${document.model}.`);
    }
    throw error;
  }
}

async function openCounters(tx: FiscalSqlClient, point: { id: string; model: string }, issuerCnpj: string, series: number, kind: string, first: number) {
  for (const environment of ["homologacao", "producao"]) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "fiscal_number_counters" ("issuer_cnpj", "environment", "model", "series", "issuing_point_id", "series_kind", "next_number")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      issuerCnpj, environment, point.model, series, point.id, kind, first,
    );
  }
}

type ProfileMethods = Pick<FiscalStore, "getProfile" | "saveProfile" | "getIssuingPoint" | "listIssuingPoints" | "createIssuingPoint" | "listExpiringCertificates">;

function profileMethods(db: FiscalPrismaClient): ProfileMethods {
  return {
    async getProfile(ownerId) {
      const [row] = await rows(db, `SELECT * FROM "fiscal_emitter_profiles" WHERE "owner_id" = $1`, ownerId);
      return row === undefined ? null : profileOf(row);
    },
    async saveProfile(profile) {
      await db.$executeRawUnsafe(UPSERT_PROFILE, ...profileValues(profile));
    },
    async getIssuingPoint(ownerId, id) {
      const [row] = await rows(db, `SELECT * FROM "fiscal_issuing_points" WHERE "id" = $1 AND "owner_id" = $2`, id, ownerId);
      return row === undefined ? null : pointOf(row);
    },
    async listIssuingPoints(ownerId) {
      return (await rows(db, `SELECT * FROM "fiscal_issuing_points" WHERE "owner_id" = $1 ORDER BY "created_at", "id"`, ownerId)).map(pointOf);
    },
    createIssuingPoint: (point, issuerCnpj, firstNumber) => createIssuingPoint(db, point, issuerCnpj, firstNumber),
    async listExpiringCertificates(before) {
      return (
        await rows(db, `SELECT * FROM "fiscal_emitter_profiles" WHERE "certificate_expires_at" < $1::timestamp(3) ORDER BY "owner_id"`, before)
      ).map(profileOf);
    },
  };
}

async function createIssuingPoint(db: FiscalPrismaClient, ...[point, issuerCnpj, firstNumber]: Parameters<FiscalStore["createIssuingPoint"]>): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "fiscal_issuing_points" ("id", "owner_id", "model", "online_series", "contingency_series", "created_at")
         VALUES ($1, $2, $3, $4, $5, $6::timestamp(3))`,
        point.id, point.ownerId, point.model, point.onlineSeries, point.contingencySeries, point.createdAt,
      );
      await openCounters(tx, point, issuerCnpj, point.onlineSeries, "ONLINE", firstNumber.online);
      if (point.contingencySeries !== null) {
        await openCounters(tx, point, issuerCnpj, point.contingencySeries, "CONTINGENCY", firstNumber.contingency);
      }
    });
  } catch (error) {
    if (violates(error, "fiscal_number_counters_pkey")) {
      throw new FiscalDocumentError("INVALID_INPUT", `a series of issuing point ${point.id} already belongs to another issuing point.`);
    }
    if (violates(error, "fiscal_issuing_points_pkey")) throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} exists.`);
    throw error;
  }
}

function documentMethods(db: FiscalPrismaClient): Omit<FiscalStore, keyof ProfileMethods> {
  const documents = async (query: string, ...values: unknown[]) => (await rows(db, query, ...values)).map(documentOf);
  return {
    createDocument: (request, build, replace) =>
      db.$transaction(async (tx) => {
        if (replace !== undefined && !(await saveRow(tx, replace.previous, replace.transition))) {
          throw new FiscalDocumentError("CONFLICT", `document ${replace.previous.id} moved before it was replaced.`);
        }
        const document = build(await draw(tx, request));
        await insertDocument(tx, document);
        return document;
      }),
    async getDocument(ownerId, id) {
      const [document] = await documents(`SELECT * FROM "fiscal_documents" WHERE "id" = $1 AND "owner_id" = $2`, id, ownerId);
      return document ?? null;
    },
    listBySubject: (ownerId, subjectId, model) =>
      documents(
        `SELECT * FROM "fiscal_documents" WHERE "owner_id" = $1 AND "subject_id" = $2 AND "model" = $3 ORDER BY "created_at", "id"`,
        ownerId, subjectId, model,
      ),
    async listEvents(documentId) {
      return (await rows(db, `SELECT * FROM "fiscal_document_events" WHERE "document_id" = $1 ORDER BY "seq"`, documentId)).map(eventOf);
    },
    saveTransition: (previous, transition) => db.$transaction((tx) => saveRow(tx, previous, transition)),
    listDue: ({ now, limit }) =>
      documents(
        `SELECT * FROM "fiscal_documents" WHERE "attention" = false AND "next_attempt_at" <= $1::timestamp(3) AND ${OWED}
         ORDER BY "next_attempt_at", "id" LIMIT $2`,
        now, limit,
      ),
    listContingency: ({ now, limit }) =>
      documents(
        `SELECT * FROM "fiscal_documents" WHERE "attention" = false AND "next_attempt_at" <= $1::timestamp(3) AND "status" = 'CONTINGENCY'
         ORDER BY "next_attempt_at", "id" LIMIT $2`,
        now, limit,
      ),
    listContingencyDeadline: ({ signedBefore, limit }) =>
      documents(
        `SELECT * FROM "fiscal_documents" WHERE "status" = 'CONTINGENCY' AND "deadline_warned_at" IS NULL
           AND ("contingency" ->> 'since')::timestamptz < $1::timestamptz
         ORDER BY "created_at", "id" LIMIT $2`,
        signedBefore, limit,
      ),
  };
}

export function createPrismaFiscalStore(config: { readonly prisma: FiscalPrismaClient }): FiscalStore {
  const db = config?.prisma;
  if (typeof db?.$transaction !== "function" || typeof db.$queryRawUnsafe !== "function") {
    throw new TypeError("createPrismaFiscalStore needs prisma: the host's Prisma client.");
  }
  return { ...profileMethods(db), ...documentMethods(db) };
}
