/**
 * The Issuer port: what the document service asks of whoever talks to SEFAZ.
 * The first (and today only) adapter is the fiscal service in this package's
 * `sidecar/` folder (`./sidecar`). A call never throws for a failure the
 * service classified: it answers `{ ok: false, error }` with the service's
 * class (`REJECTED`, `RETRYABLE`, `CONTINGENCY`, `AUTH`, `INVALID`,
 * `INTERNAL`), and the document service maps that onto the state machine.
 *
 * The certificate and the CSC travel with each call (the service is
 * stateless) inside {@link SigningMaterial}, built by the signing identity
 * for this one call and dropped with it.
 */

import type { FiscalDocumentModel } from "../documents/types";
import type { SaleForDocument } from "../sale/types";
import type {
  CancelledDocument,
  ContingencyEntry,
  ContingencySignedDocument,
  Csc,
  InutilizedRange,
  IssuedDocument,
  LookedUpDocument,
  SefazEnvironment,
  SidecarErrorBody,
  SidecarHealth,
  SigningCertificate,
} from "../sidecar/types";

/** What signs one call: the A1 and, for an NFC-e, the CSC. Never stored, never logged. */
export interface SigningMaterial {
  readonly certificate: SigningCertificate;
  readonly csc: Csc | null;
}

/** A failed call, classified. The service's error body, verbatim. */
export type IssuerFailure = SidecarErrorBody["error"];

export type IssuerOutcome<T> = { readonly ok: true; readonly answer: T } | { readonly ok: false; readonly error: IssuerFailure };

interface Call {
  readonly environment: SefazEnvironment;
  readonly signing: SigningMaterial;
}

export interface IssueCall extends Call {
  readonly model: FiscalDocumentModel;
  readonly document: SaleForDocument;
}

export interface SignContingencyCall extends Call {
  readonly document: SaleForDocument;
  readonly contingency: ContingencyEntry;
}

export interface TransmitCall extends Call {
  readonly model: FiscalDocumentModel;
  readonly signedXml: string;
}

export interface CancelCall extends Call {
  readonly model: FiscalDocumentModel;
  readonly accessKey: string;
  readonly protocol: string;
  readonly reason: string;
}

export interface LookupCall extends Call {
  readonly model: FiscalDocumentModel;
  readonly accessKey: string;
}

export interface InutilizeCall extends Call {
  readonly model: FiscalDocumentModel;
  readonly uf: string;
  readonly cnpj: string;
  readonly year: number;
  readonly series: number;
  readonly from: number;
  readonly to: number;
  readonly reason: string;
}

export interface Issuer {
  /** Build, sign and transmit. `AUTHORIZED` or `DENIED`. */
  issue(call: IssueCall): Promise<IssuerOutcome<IssuedDocument>>;
  /** NFC-e only: build and sign offline (`tpEmis = 9`); nothing is sent. */
  signContingency(call: SignContingencyCall): Promise<IssuerOutcome<ContingencySignedDocument>>;
  /** Send an already signed XML (a contingency document). */
  transmit(call: TransmitCall): Promise<IssuerOutcome<IssuedDocument>>;
  cancel(call: CancelCall): Promise<IssuerOutcome<CancelledDocument>>;
  lookup(call: LookupCall): Promise<IssuerOutcome<LookedUpDocument>>;
  inutilize(call: InutilizeCall): Promise<IssuerOutcome<InutilizedRange>>;
  health(): Promise<SidecarHealth>;
}

/** The path segment of a model on the service's routes. */
export function modelPath(model: FiscalDocumentModel): "nfe" | "nfce" {
  return model === "NFE" ? "nfe" : "nfce";
}
