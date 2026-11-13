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

/**
 * `/issue` and `/transmit`: SEFAZ's final answer on the document.
 *
 * - `AUTHORIZED` (100, 120, 150).
 * - `DENIED` (110, 301, 302, 303): a denial of use. The number is SPENT and
 *   the denial is kept like an authorisation (its `authorizedXml` carries the
 *   denial protocol); it is not a rejection, which leaves the number free.
 *
 * A retried call answers the same: SEFAZ's "already authorised" (204) and
 * "already denied" (205), and a request sent with no answer, are settled by
 * looking the key up, so a retry never turns an authorised document into an error.
 */
export interface IssuedDocument extends SefazAnswer {
  readonly status: "AUTHORIZED" | "DENIED";
  readonly accessKey: string;
  readonly protocol: string;
  /** `dhRecbto` of the protocol. */
  readonly authorizedAt: string;
  readonly signedXml: string;
  /** The `nfeProc`: the signed XML with its protocol (of authorisation or of denial), what is stored. */
  readonly authorizedXml: string;
}

/** `/nfce/sign-contingency`. */
export interface ContingencySignedDocument {
  readonly status: "SIGNED";
  readonly accessKey: string;
  /** Carries `tpEmis = 9` and the QR code; transmit it later through `/nfce/transmit`. */
  readonly signedXml: string;
}

/**
 * `/cancel`. A retried cancel (SEFAZ's 218 "already cancelled" or 573
 * "duplicate event", or a cancel sent with no answer) is settled by looking
 * the key up, and answers CANCELLED with what the lookup carries: the event's
 * protocol and XML when SEFAZ returns them, `null` when it does not.
 */
export interface CancelledDocument extends SefazAnswer {
  readonly status: "CANCELLED";
  readonly accessKey: string;
  /** The event's protocol. */
  readonly protocol: string | null;
  readonly registeredAt: string | null;
  /** The `procEventoNFe`. */
  readonly eventXml: string | null;
}

/** `/lookup`: what SEFAZ knows of the key. `NOT_FOUND` is an answer, not an error. */
export interface LookedUpDocument extends SefazAnswer {
  readonly status: "AUTHORIZED" | "CANCELLED" | "DENIED" | "NOT_FOUND";
  readonly accessKey: string;
  readonly protocol: string | null;
}

/**
 * `/inutilize`. A retried inutilização (563, "a request for the same range
 * already exists") answers INUTILIZED too, with `protocol` and
 * `inutilizationXml` `null`: the range is void at SEFAZ, and SEFAZ offers no
 * query that would return the first protocol.
 */
export interface InutilizedRange extends SefazAnswer {
  readonly status: "INUTILIZED";
  readonly protocol: string | null;
  readonly registeredAt: string | null;
  /** The signed request with its reply (`procInutNFe`). */
  readonly inutilizationXml: string | null;
}

/**
 * How a failed call is classified — the issuer port's own classes:
 *
 * - `REJECTED`: SEFAZ refused the document or the event; `code` is its `cStat`.
 *   The number is NOT spent (a denial is not an error: it answers `DENIED`).
 * - `RETRYABLE`: try the same call again later. When `outcomeUnknown` is true
 *   the request went out and neither it nor the lookup that would settle it
 *   was answered: look the key up before sending it again.
 * - `CONTINGENCY`: SEFAZ is unavailable. For an NFC-e being issued, nothing
 *   reached SEFAZ (or the lookup after an unanswered request could not reach
 *   it): go offline through `/nfce/sign-contingency`. For an NF-e (model 55)
 *   the service has no offline path (no SVC, no EPEC): treat it as RETRYABLE.
 * - `AUTH`: the certificate is unreadable, the password wrong, the certificate
 *   expired, or SEFAZ refused it.
 * - `INVALID`: the request itself is malformed (the schema, a missing CSC, an
 *   XML the layout refuses, a document the layout version cannot express).
 *   Fix the input; never retry it as is.
 * - `INTERNAL`: a defect of the service. A retry would only repeat it.
 */
export type SidecarErrorClass = "REJECTED" | "RETRYABLE" | "CONTINGENCY" | "AUTH" | "INVALID" | "INTERNAL";

export const SIDECAR_ERROR_CLASSES: readonly SidecarErrorClass[] = [
  "REJECTED",
  "RETRYABLE",
  "CONTINGENCY",
  "AUTH",
  "INVALID",
  "INTERNAL",
];

/** The body of every non-2xx answer. */
export interface SidecarErrorBody {
  readonly error: {
    readonly class: SidecarErrorClass;
    /**
     * The SEFAZ `cStat` when SEFAZ answered (always for `REJECTED`); for
     * `INVALID`, a named code where one applies (`NT_2026_008_NOT_SUPPORTED`:
     * a document issued on or after 2027-01-01, which needs NT 2026.008's
     * `vProdLiq`); `null` otherwise.
     */
    readonly code: string | null;
    readonly message: string;
    /** Per-field problems of an `INVALID` request. */
    readonly details: readonly string[];
    /** When the call got as far as building and signing: keep it, the key is now spoken for. */
    readonly accessKey: string | null;
    readonly signedXml: string | null;
    readonly sefazReply: string | null;
    /** The request went out and its outcome is still unknown: look the key up before sending it again. */
    readonly outcomeUnknown: boolean;
  };
}

/** `GET /health`. */
export interface SidecarHealth {
  readonly status: "ok";
  /** The libraries the service runs, by name, with the version installed. */
  readonly libraries: Readonly<Record<string, string>>;
  /** The schema package the NF-e layout is validated against. */
  readonly nfeSchemas: string;
  /** Whether SEFAZ's server certificate is verified; `false` only with `FISCAL_SEFAZ_TLS_VERIFY=off`. */
  readonly sefazTlsVerify: boolean;
}
