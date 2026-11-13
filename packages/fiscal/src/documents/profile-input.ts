/**
 * Reading the emitter profile and the certificate upload off a request body:
 * every field required (an absent value is `null`), unknown keys refused, and
 * every refusal a {@link FiscalDocumentError} `INVALID_INPUT` naming the
 * field — never its value, since the certificate upload carries secrets.
 */

import type { TaxRegime } from "../engine/types";
import type { Address, IssuerTaxRegime, Uf } from "../sale/types";
import type { SefazEnvironment } from "../sidecar/types";
import { FiscalDocumentError } from "./errors";
import { DOCUMENT_POLICIES, type DocumentPolicy, SIGNING_IDENTITY_KINDS, type SigningIdentityKind } from "./profile";
import { FISCAL_DOCUMENT_MODELS, type FiscalDocumentModel } from "./types";

/** The profile fields a host writes; the secrets arrive through their own calls. */
export interface EmitterProfileInput {
  readonly cnpj: string;
  readonly stateRegistration: string;
  readonly municipalRegistration: string | null;
  readonly cnae: string | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly taxRegime: IssuerTaxRegime;
  readonly regime: TaxRegime;
  readonly regimeEffectiveFrom: string;
  readonly restaurantRegime: boolean;
  readonly address: Address & { readonly postalCode: string };
  readonly environment: SefazEnvironment;
  readonly documentPolicy: DocumentPolicy;
  readonly signingIdentity: SigningIdentityKind;
  readonly cscId: string | null;
  /** The CSC token in clear, encrypted on arrival; `null` keeps the stored one. */
  readonly cscToken: string | null;
  readonly consentRecordedAt: string | null;
}

export interface CertificateUpload {
  readonly pfxBase64: string;
  readonly password: string;
}

export interface IssuingPointInput {
  readonly id: string;
  readonly model: FiscalDocumentModel;
  readonly onlineSeries: number;
  readonly contingencySeries: number | null;
  readonly firstOnlineNumber: number;
  readonly firstContingencyNumber: number;
}

type Body = Record<string, unknown>;

const UFS: readonly Uf[] = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];
const TAX_REGIMES: readonly IssuerTaxRegime[] = ["SIMPLES", "SIMPLES_EXCESS", "NORMAL", "MEI"];
const ENGINE_REGIMES: readonly TaxRegime[] = ["SIMPLES", "SIMPLES_IBS_CBS_REGULAR", "REGIME_REGULAR", "MEI", "NAO_CONTRIBUINTE"];
const ENVIRONMENTS: readonly SefazEnvironment[] = ["homologacao", "producao"];

function invalid(field: string, why: string): never {
  throw new FiscalDocumentError("INVALID_INPUT", `${field} ${why}.`);
}

function objectOf(value: unknown, field: string, keys: readonly string[]): Body {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field, "must be an object");
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) invalid(field, `has unknown keys: ${unknown.join(", ")}`);
  const missing = keys.filter((key) => !(key in value));
  if (missing.length > 0) invalid(field, `is missing: ${missing.join(", ")}`);
  return value as Body;
}

function text(body: Body, key: string, pattern = /^.{1,200}$/s): string {
  const value = body[key];
  if (typeof value !== "string" || !pattern.test(value)) invalid(key, "is not valid");
  return value;
}

function nullableText(body: Body, key: string, pattern?: RegExp): string | null {
  return body[key] === null ? null : text(body, key, pattern);
}

function oneOf<T extends string>(body: Body, key: string, values: readonly T[]): T {
  const value = body[key];
  if (typeof value !== "string" || !values.includes(value as T)) invalid(key, `must be one of ${values.join(", ")}`);
  return value as T;
}

function integer(body: Body, key: string, min: number, max: number): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid(key, `must be an integer from ${min} to ${max}`);
  return value;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ADDRESS_KEYS = ["street", "number", "complement", "district", "municipalityIbge", "municipalityName", "uf", "postalCode", "phone"];

function addressOf(value: unknown): Address & { readonly postalCode: string } {
  const body = objectOf(value, "address", ADDRESS_KEYS);
  return {
    street: text(body, "street"),
    number: text(body, "number", /^.{1,60}$/),
    complement: nullableText(body, "complement"),
    district: text(body, "district"),
    municipalityIbge: text(body, "municipalityIbge", /^\d{7}$/),
    municipalityName: text(body, "municipalityName"),
    uf: oneOf(body, "uf", UFS),
    postalCode: text(body, "postalCode", /^\d{8}$/),
    phone: nullableText(body, "phone", /^\d{6,14}$/),
  };
}

const PROFILE_KEYS = [
  "cnpj", "stateRegistration", "municipalRegistration", "cnae", "legalName", "tradeName", "taxRegime", "regime",
  "regimeEffectiveFrom", "restaurantRegime", "address", "environment", "documentPolicy", "signingIdentity", "cscId",
  "cscToken", "consentRecordedAt",
];

export function parseProfileInput(value: unknown): EmitterProfileInput {
  const body = objectOf(value, "profile", PROFILE_KEYS);
  if (typeof body["restaurantRegime"] !== "boolean") invalid("restaurantRegime", "must be a boolean");
  return {
    cnpj: text(body, "cnpj", /^[0-9A-Z]{12}\d{2}$/),
    stateRegistration: text(body, "stateRegistration", /^(\d{2,14}|ISENTO)$/),
    municipalRegistration: nullableText(body, "municipalRegistration", /^[0-9A-Za-z]{1,15}$/),
    cnae: nullableText(body, "cnae", /^\d{7}$/),
    legalName: text(body, "legalName", /^.{2,60}$/s),
    tradeName: nullableText(body, "tradeName", /^.{1,60}$/s),
    taxRegime: oneOf(body, "taxRegime", TAX_REGIMES),
    regime: oneOf(body, "regime", ENGINE_REGIMES),
    regimeEffectiveFrom: text(body, "regimeEffectiveFrom", DATE),
    restaurantRegime: body["restaurantRegime"],
    address: addressOf(body["address"]),
    environment: oneOf(body, "environment", ENVIRONMENTS),
    documentPolicy: oneOf(body, "documentPolicy", DOCUMENT_POLICIES),
    signingIdentity: oneOf(body, "signingIdentity", SIGNING_IDENTITY_KINDS),
    cscId: nullableText(body, "cscId", /^\d{1,6}$/),
    cscToken: nullableText(body, "cscToken", /^[0-9A-Za-z]{16,36}$/),
    consentRecordedAt: nullableText(body, "consentRecordedAt", INSTANT),
  };
}

export function parseCertificateUpload(value: unknown): CertificateUpload {
  const body = objectOf(value, "certificate", ["pfxBase64", "password"]);
  return {
    pfxBase64: text(body, "pfxBase64", /^[A-Za-z0-9+/]{100,}={0,2}$/),
    password: text(body, "password", /^.{1,200}$/s),
  };
}

export function parseIssuingPointInput(value: unknown): IssuingPointInput {
  const body = objectOf(value, "issuingPoint", [
    "id", "model", "onlineSeries", "contingencySeries", "firstOnlineNumber", "firstContingencyNumber",
  ]);
  const onlineSeries = integer(body, "onlineSeries", 0, 889);
  const contingencySeries = body["contingencySeries"] === null ? null : integer(body, "contingencySeries", 0, 889);
  if (contingencySeries === onlineSeries) invalid("contingencySeries", "must differ from onlineSeries");
  return {
    id: text(body, "id", /^[A-Za-z0-9_-]{1,64}$/),
    model: oneOf(body, "model", FISCAL_DOCUMENT_MODELS),
    onlineSeries,
    contingencySeries,
    firstOnlineNumber: integer(body, "firstOnlineNumber", 1, 999_999_999),
    firstContingencyNumber: integer(body, "firstContingencyNumber", 1, 999_999_999),
  };
}
