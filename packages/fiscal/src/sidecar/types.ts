/**
 * The wire contract of the fiscal service (`sidecar/` in this package): a
 * stateless HTTP door in front of sped-nfe. JSON in, JSON out.
 *
 * Stateless means every call carries what it needs: the signing certificate
 * (an A1 `.pfx` as base64 and its password) and, for an NFC-e, the CSC. The
 * service keeps nothing between calls, writes nothing to disk and never logs
 * any of the three.
 */

import type { SaleForDocument } from "../sale/types";

/** The path segment of a document model: `nfe` is model 55, `nfce` model 65. */
export type DocumentModelPath = "nfe" | "nfce";

/** The SEFAZ environment (`tpAmb` 2 and 1). */
export type SefazEnvironment = "homologacao" | "producao";

/** The A1 certificate, per call. */
export interface SigningCertificate {
  /** The `.pfx` (PKCS#12) bytes, base64. */
  readonly pfxBase64: string;
  readonly password: string;
}

/** The NFC-e's Código de Segurança do Contribuinte and its id. */
export interface Csc {
  readonly id: string;
  readonly token: string;
}

interface Authenticated {
  readonly environment: SefazEnvironment;
  readonly certificate: SigningCertificate;
}

/**
 * `POST /<model>/issue`: builds, signs and transmits. `csc` is required for
 * `nfce` and refused for `nfe`.
 */
export interface IssueRequest extends Authenticated {
  readonly csc: Csc | null;
  readonly document: SaleForDocument;
}

/** Why and since when the caixa issues offline (`dhCont`, `xJust`). */
export interface ContingencyEntry {
  /** ISO 8601 with the UTC offset. */
  readonly since: string;
  /** 15–256 characters. */
  readonly reason: string;
}

/** `POST /nfce/sign-contingency`: builds and signs with `tpEmis = 9`; does NOT transmit. */
export interface SignContingencyRequest extends IssueRequest {
  readonly contingency: ContingencyEntry;
}

/** `POST /<model>/transmit`: an already signed XML (from `/nfce/sign-contingency`, say). */
export interface TransmitRequest extends Authenticated {
  readonly signedXml: string;
}

/** `POST /<model>/cancel`: the UF and the issuer come from the access key. */
export interface CancelRequest extends Authenticated {
  readonly accessKey: string;
  /** The authorisation protocol (`nProt`). */
  readonly protocol: string;
  /** 15–255 characters. */
  readonly reason: string;
}

/** `POST /<model>/lookup`. */
export interface LookupRequest extends Authenticated {
  readonly accessKey: string;
}

/** `POST /inutilize`: voids a range of unused numbers. */
export interface InutilizeRequest extends Authenticated {
  readonly model: DocumentModelPath;
  readonly uf: string;
  readonly cnpj: string;
  /** The year of the numbers, four digits. */
  readonly year: number;
  readonly series: number;
  readonly from: number;
  readonly to: number;
  /** 15–255 characters. */
  readonly reason: string;
}

/** What SEFAZ answered, as the service read it. */
export interface SefazAnswer {
  /** `cStat`. */
  readonly statusCode: string;
  /** `xMotivo`. */
  readonly statusReason: string;
  /** The SOAP body SEFAZ returned, verbatim. */
  readonly sefazReply: string;
}

/** `/issue` and `/transmit`: the document is authorised. */
export interface AuthorizedDocument extends SefazAnswer {
  readonly status: "AUTHORIZED";
  readonly accessKey: string;
  readonly protocol: string;
  /** `dhRecbto` of the protocol. */
  readonly authorizedAt: string;
  readonly signedXml: string;
  /** The `nfeProc`: the signed XML with its protocol, what is stored and rendered. */
  readonly authorizedXml: string;
}

/** `/nfce/sign-contingency`. */
export interface ContingencySignedDocument {
  readonly status: "SIGNED";
  readonly accessKey: string;
  /** Carries `tpEmis = 9` and the QR code; transmit it later through `/nfce/transmit`. */
  readonly signedXml: string;
}

/** `/cancel`. */
export interface CancelledDocument extends SefazAnswer {
  readonly status: "CANCELLED";
  readonly accessKey: string;
  /** The event's protocol. */
  readonly protocol: string;
  readonly registeredAt: string;
  /** The `procEventoNFe`. */
  readonly eventXml: string;
}

/** `/lookup`: what SEFAZ knows of the key. `NOT_FOUND` is an answer, not an error. */
export interface LookedUpDocument extends SefazAnswer {
  readonly status: "AUTHORIZED" | "CANCELLED" | "DENIED" | "NOT_FOUND";
  readonly accessKey: string;
  readonly protocol: string | null;
}

/** `/inutilize`. */
export interface InutilizedRange extends SefazAnswer {
  readonly status: "INUTILIZED";
  readonly protocol: string;
  readonly registeredAt: string;
  /** The signed request with its reply (`procInutNFe`). */
  readonly inutilizationXml: string;
}

/**
 * How a failed call is classified — the issuer port's own classes:
 *
 * - `REJECTED`: SEFAZ refused the document or the event; `code` is its `cStat`.
 *   A denial of use (110, 301, 302) is a rejection too: the number is spent.
 * - `RETRYABLE`: try the same call again later. The outcome may be unknown (a
 *   timeout after sending): look the key up before re-issuing.
 * - `CONTINGENCY`: SEFAZ is unavailable; an NFC-e goes offline (`tpEmis = 9`).
 * - `AUTH`: the certificate is unreadable, the password wrong, the certificate
 *   expired, or SEFAZ refused it.
 * - `INVALID`: the request itself is malformed (the schema, a missing CSC, an
 *   XML the layout refuses). Fix the input; never retry it as is.
 */
export type SidecarErrorClass = "REJECTED" | "RETRYABLE" | "CONTINGENCY" | "AUTH" | "INVALID";

export const SIDECAR_ERROR_CLASSES: readonly SidecarErrorClass[] = [
  "REJECTED",
  "RETRYABLE",
  "CONTINGENCY",
  "AUTH",
  "INVALID",
];

/** The body of every non-2xx answer. */
export interface SidecarErrorBody {
  readonly error: {
    readonly class: SidecarErrorClass;
    /** The SEFAZ `cStat` for `REJECTED` (and for a SEFAZ-side `AUTH` or `CONTINGENCY`); `null` otherwise. */
    readonly code: string | null;
    readonly message: string;
    /** Per-field problems of an `INVALID` request. */
    readonly details: readonly string[];
    /** When the call got as far as building and signing: keep it, the key is now spoken for. */
    readonly accessKey: string | null;
    readonly signedXml: string | null;
    readonly sefazReply: string | null;
  };
}

/** `GET /health`. */
export interface SidecarHealth {
  readonly status: "ok";
  /** The libraries the service runs, by name, with the version installed. */
  readonly libraries: Readonly<Record<string, string>>;
  /** The schema package the NF-e layout is validated against. */
  readonly nfeSchemas: string;
}
