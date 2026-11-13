/**
 * The ports a host implements for the document module. None has a default:
 * where the bytes live, how a secret is encrypted, what a sale is and where
 * the rows are stored are the host's answers, asked for by name.
 */

import type { SaleForDocument } from "../sale/types";
import type { SefazEnvironment } from "../sidecar/types";
import type { EmitterProfile, IssuingPoint } from "./profile";
import type { FiscalDocument, FiscalDocumentEvent, FiscalDocumentModel, SeriesKind } from "./types";
import type { Transition } from "./machine";

/**
 * Encrypts the certificate, its password and the CSC at rest — the
 * `{ encrypt, decrypt }` shape `@12-apps/payments-backend` takes. Synchronous
 * or not, as the host's cipher is.
 */
export interface Cipher {
  encrypt(plaintext: string): string | Promise<string>;
  decrypt(ciphertext: string): string | Promise<string>;
}

/** Where the XMLs live (object storage, retained as the law asks: five years). */
export interface DocumentStorage {
  put(key: string, body: string, contentType: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

/**
 * The host's sale in the package's neutral shape — everything but what the
 * package fills: the issuer (from the profile), the series and number (from
 * its counter), the key code and the issue time.
 */
export type SaleDraft = Omit<SaleForDocument, "series" | "number" | "keyCode" | "issuer" | "issuedAt">;

export interface SaleSource {
  saleFor(input: { readonly ownerId: string; readonly subjectId: string; readonly model: FiscalDocumentModel }): Promise<SaleDraft>;
}

/** Which counter a new document draws from. */
export interface NumberRequest {
  readonly ownerId: string;
  readonly issuingPointId: string;
  readonly environment: SefazEnvironment;
  readonly model: FiscalDocumentModel;
  readonly seriesKind: SeriesKind;
  readonly series: number;
}

/**
 * The rows. Every method that writes is one transaction in the host:
 *
 * - `createDocument` draws the next number of the series AND inserts the
 *   document built from it, together — a refused insert gives the number
 *   back, so the sequence has no gap a failed write made
 *   (`FISCAL_NEXT_NUMBER_SQL` is the draw, over the package's migration);
 * - `saveTransition` writes the document and appends its event, and refuses
 *   (`false`) when the stored row's `updatedAt` is no longer the one the
 *   transition started from, so two workers never both advance a document.
 */
export interface FiscalStore {
  getProfile(ownerId: string): Promise<EmitterProfile | null>;
  saveProfile(profile: EmitterProfile): Promise<void>;
  getIssuingPoint(ownerId: string, issuingPointId: string): Promise<IssuingPoint | null>;
  listIssuingPoints(ownerId: string): Promise<IssuingPoint[]>;
  /** Creates the point and its counters, starting at `firstNumber` (a store moving from another system continues its sequence). */
  createIssuingPoint(point: IssuingPoint, firstNumber: { readonly online: number; readonly contingency: number }): Promise<void>;
  createDocument(request: NumberRequest, build: (number: number) => FiscalDocument): Promise<FiscalDocument>;
  getDocument(ownerId: string, documentId: string): Promise<FiscalDocument | null>;
  /** The subject's documents of a model, oldest first. */
  listBySubject(ownerId: string, subjectId: string, model: FiscalDocumentModel): Promise<FiscalDocument[]>;
  listEvents(documentId: string): Promise<FiscalDocumentEvent[]>;
  saveTransition(previous: FiscalDocument, transition: Transition): Promise<boolean>;
  /**
   * Documents the sweep owes a step, across owners, untouched since
   * `staleBefore`: `PENDING` or `SUBMITTED`, and those whose `numberVoid` is
   * `LOOKUP_FIRST`, `INUTILIZE` or `CANCEL`. Oldest first, at most `limit`.
   */
  listDue(input: { readonly staleBefore: string; readonly limit: number }): Promise<FiscalDocument[]>;
  /** `CONTINGENCY` documents owed a transmission, across owners, oldest first, at most `limit`. */
  listContingency(input: { readonly limit: number }): Promise<FiscalDocument[]>;
  /** Profiles whose certificate expires before `before`, across owners. */
  listExpiringCertificates(before: string): Promise<EmitterProfile[]>;
}
