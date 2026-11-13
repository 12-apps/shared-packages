/**
 * Rows of the package's tables (`prisma/migrations`) to the records the
 * service holds, and back. Raw SQL through the host's Prisma client answers
 * snake_case columns, `Date` for a timestamp, a parsed object for a JSONB
 * column, and a `bigint` or a string for a BIGSERIAL; every one is read here.
 */

import type { EmitterProfile, IssuingPoint } from "./profile";
import type { FiscalDocument, FiscalDocumentEvent } from "./types";

export type Row = Record<string, unknown>;

/** A timestamp column as ISO 8601 UTC; the columns are UTC by the Prisma convention. */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(" ", "T")}${/Z|[+-]\d{2}:?\d{2}$/.test(String(value)) ? "" : "Z"}`);
  return date.toISOString();
}

function requiredIso(value: unknown): string {
  return iso(value) ?? "";
}

/** A DATE column as `YYYY-MM-DD`. */
function day(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** The document's columns, in the order `documentValues` writes them. */
export const DOCUMENT_COLUMNS = [
  "id", "owner_id", "issuer_cnpj", "subject_id", "issuing_point_id", "model", "environment", "series_kind", "series",
  "number", "key_code", "status", "sale", "totals", "buyer_tax_id", "access_key", "protocol", "status_code",
  "status_reason", "last_error_class", "outcome_unknown", "issued_at", "authorized_at", "contingency", "cancelled_at",
  "cancel_reason", "cancel_protocol", "replaced_by_id", "number_void", "xml_key", "event_xml_key", "attempts",
  "failures", "next_attempt_at", "attention", "deadline_warned_at", "created_at", "updated_at",
] as const;

const JSON_COLUMNS = new Set(["sale", "totals", "contingency"]);
const TIME_COLUMNS = new Set(["next_attempt_at", "deadline_warned_at", "created_at", "updated_at"]);

/** The SQL placeholder of a column, with the cast its type needs. */
export function placeholder(column: string, index: number): string {
  if (JSON_COLUMNS.has(column)) return `$${index}::jsonb`;
  if (TIME_COLUMNS.has(column)) return `$${index}::timestamp(3)`;
  return `$${index}`;
}

export function documentValues(d: FiscalDocument): unknown[] {
  return [
    d.id, d.ownerId, d.issuerCnpj, d.subjectId, d.issuingPointId, d.model, d.environment, d.seriesKind, d.series,
    d.number, d.keyCode, d.status, JSON.stringify(d.sale), JSON.stringify(d.totals), d.buyerTaxId, d.accessKey,
    d.protocol, d.statusCode, d.statusReason, d.lastErrorClass, d.outcomeUnknown, d.issuedAt, d.authorizedAt,
    d.contingency === null ? null : JSON.stringify(d.contingency), d.cancelledAt, d.cancelReason, d.cancelProtocol,
    d.replacedById, d.numberVoid, d.xmlKey, d.eventXmlKey, d.attempts, d.failures, d.nextAttemptAt, d.attention,
    d.deadlineWarnedAt, d.createdAt, d.updatedAt,
  ];
}

export function documentOf(row: Row): FiscalDocument {
  return {
    id: String(row["id"]),
    ownerId: String(row["owner_id"]),
    issuerCnpj: String(row["issuer_cnpj"]),
    subjectId: String(row["subject_id"]),
    issuingPointId: String(row["issuing_point_id"]),
    model: row["model"] as FiscalDocument["model"],
    environment: row["environment"] as FiscalDocument["environment"],
    seriesKind: row["series_kind"] as FiscalDocument["seriesKind"],
    series: Number(row["series"]),
    number: Number(row["number"]),
    keyCode: String(row["key_code"]),
    status: row["status"] as FiscalDocument["status"],
    sale: json(row["sale"]),
    totals: json(row["totals"]),
    buyerTaxId: text(row["buyer_tax_id"]),
    accessKey: text(row["access_key"]),
    protocol: text(row["protocol"]),
    statusCode: text(row["status_code"]),
    statusReason: text(row["status_reason"]),
    lastErrorClass: text(row["last_error_class"]) as FiscalDocument["lastErrorClass"],
    outcomeUnknown: row["outcome_unknown"] === true,
    issuedAt: String(row["issued_at"]),
    authorizedAt: text(row["authorized_at"]),
    contingency: row["contingency"] === null ? null : json(row["contingency"]),
    cancelledAt: text(row["cancelled_at"]),
    cancelReason: text(row["cancel_reason"]),
    cancelProtocol: text(row["cancel_protocol"]),
    replacedById: text(row["replaced_by_id"]),
    numberVoid: text(row["number_void"]) as FiscalDocument["numberVoid"],
    xmlKey: text(row["xml_key"]),
    eventXmlKey: text(row["event_xml_key"]),
    attempts: Number(row["attempts"]),
    failures: Number(row["failures"]),
    nextAttemptAt: iso(row["next_attempt_at"]),
    attention: row["attention"] === true,
    deadlineWarnedAt: iso(row["deadline_warned_at"]),
    createdAt: requiredIso(row["created_at"]),
    updatedAt: requiredIso(row["updated_at"]),
  };
}

export function eventOf(row: Row): FiscalDocumentEvent {
  return {
    documentId: String(row["document_id"]),
    kind: row["kind"] as FiscalDocumentEvent["kind"],
    fromStatus: row["from_status"] as FiscalDocumentEvent["fromStatus"],
    toStatus: row["to_status"] as FiscalDocumentEvent["toStatus"],
    at: requiredIso(row["at"]),
    errorClass: text(row["error_class"]) as FiscalDocumentEvent["errorClass"],
    code: text(row["code"]),
    answer: row["answer"] === null ? null : json(row["answer"]),
  };
}

export const PROFILE_COLUMNS = [
  "owner_id", "cnpj", "state_registration", "municipal_registration", "cnae", "legal_name", "trade_name", "tax_regime",
  "regime", "regime_effective_from", "restaurant_regime", "address", "environment", "document_policy",
  "signing_identity", "certificate_ciphertext", "certificate_password_ciphertext", "certificate_expires_at", "csc_id",
  "csc_ciphertext", "consent_recorded_at", "updated_at",
] as const;

export function profilePlaceholder(column: string, index: number): string {
  if (column === "address") return `$${index}::jsonb`;
  if (column === "regime_effective_from") return `$${index}::date`;
  if (column.endsWith("_at")) return `$${index}::timestamp(3)`;
  return `$${index}`;
}

export function profileValues(p: EmitterProfile): unknown[] {
  return [
    p.ownerId, p.cnpj, p.stateRegistration, p.municipalRegistration, p.cnae, p.legalName, p.tradeName, p.taxRegime,
    p.regime, p.regimeEffectiveFrom, p.restaurantRegime, JSON.stringify(p.address), p.environment, p.documentPolicy,
    p.signingIdentity, p.certificateCiphertext, p.certificatePasswordCiphertext, p.certificateExpiresAt, p.cscId,
    p.cscCiphertext, p.consentRecordedAt, p.updatedAt,
  ];
}

export function profileOf(row: Row): EmitterProfile {
  return {
    ownerId: String(row["owner_id"]),
    cnpj: String(row["cnpj"]),
    stateRegistration: String(row["state_registration"]),
    municipalRegistration: text(row["municipal_registration"]),
    cnae: text(row["cnae"]),
    legalName: String(row["legal_name"]),
    tradeName: text(row["trade_name"]),
    taxRegime: row["tax_regime"] as EmitterProfile["taxRegime"],
    regime: row["regime"] as EmitterProfile["regime"],
    regimeEffectiveFrom: day(row["regime_effective_from"]),
    restaurantRegime: row["restaurant_regime"] === true,
    address: json(row["address"]),
    environment: row["environment"] as EmitterProfile["environment"],
    documentPolicy: row["document_policy"] as EmitterProfile["documentPolicy"],
    signingIdentity: row["signing_identity"] as EmitterProfile["signingIdentity"],
    certificateCiphertext: text(row["certificate_ciphertext"]),
    certificatePasswordCiphertext: text(row["certificate_password_ciphertext"]),
    certificateExpiresAt: iso(row["certificate_expires_at"]),
    cscId: text(row["csc_id"]),
    cscCiphertext: text(row["csc_ciphertext"]),
    consentRecordedAt: iso(row["consent_recorded_at"]),
    updatedAt: requiredIso(row["updated_at"]),
  };
}

export function pointOf(row: Row): IssuingPoint {
  return {
    id: String(row["id"]),
    ownerId: String(row["owner_id"]),
    model: row["model"] as IssuingPoint["model"],
    onlineSeries: Number(row["online_series"]),
    contingencySeries: row["contingency_series"] === null ? null : Number(row["contingency_series"]),
    createdAt: requiredIso(row["created_at"]),
  };
}
