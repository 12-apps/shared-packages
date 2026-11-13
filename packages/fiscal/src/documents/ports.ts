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

/**
 * Which counter a new document draws from. SEFAZ numbers by the issuer's
 * CNPJ, the model and the series, so the counter is keyed by them: one CNPJ
 * can serve several owners, and they share its series.
 */
export interface NumberRequest {
  readonly ownerId: string;
  readonly issuerCnpj: string;
  readonly issuingPointId: string;
  readonly environment: SefazEnvironment;
  readonly model: FiscalDocumentModel;
  readonly seriesKind: SeriesKind;
  readonly series: number;
}

/**
 * The rows. `createPrismaFiscalStore` (`./sql-store`) is the package's own
 * implementation over the host's Prisma client; `createMemoryFiscalStore`
 * the reference for tests. Every method that writes is one transaction:
 *
 * - `createDocument` draws the next number of the series AND inserts the
 *   document built from it, together — a refused insert gives the number
 *   back, so the sequence has no gap a failed write made. With `replace`, the
 *   document it replaces is advanced in the SAME transaction, before the
 *   insert, so a crash can never leave both live. A second LIVE document for
 *   the same (owner, subject, model) is refused with `SUBJECT_HAS_DOCUMENT`
 *   (`isLive`), and nothing is drawn;
 * - `saveTransition` writes the document and appends its event, and refuses
 *   (`false`) when the stored row's `updatedAt` or `status` is no longer the
 *   one the transition started from, so two workers never both advance it.
 */
export interface FiscalStore {
  getProfile(ownerId: string): Promise<EmitterProfile | null>;
  saveProfile(profile: EmitterProfile): Promise<void>;
  getIssuingPoint(ownerId: string, issuingPointId: string): Promise<IssuingPoint | null>;
  listIssuingPoints(ownerId: string): Promise<IssuingPoint[]>;
  /**
   * Creates the point and its counters under the issuer's CNPJ, in both
   * environments, starting at `firstNumber` (a store moving from another
   * system continues its sequence). A series another point holds is refused.
   */
  createIssuingPoint(
    point: IssuingPoint,
    issuerCnpj: string,
    firstNumber: { readonly online: number; readonly contingency: number },
  ): Promise<void>;
  createDocument(
    request: NumberRequest,
    build: (number: number) => FiscalDocument,
    replace?: { readonly previous: FiscalDocument; readonly transition: Transition },
  ): Promise<FiscalDocument>;
  getDocument(ownerId: string, documentId: string): Promise<FiscalDocument | null>;
  /** The subject's documents of a model, oldest first. */
  listBySubject(ownerId: string, subjectId: string, model: FiscalDocumentModel): Promise<FiscalDocument[]>;
  listEvents(documentId: string): Promise<FiscalDocumentEvent[]>;
  saveTransition(previous: FiscalDocument, transition: Transition): Promise<boolean>;
  /**
   * Documents the sweep owes a step, across owners, whose `nextAttemptAt` has
   * come: `PENDING` or `SUBMITTED`, and those whose `numberVoid` is still owed.
   * Never one waiting for a person. Ordered by `nextAttemptAt`, so a row that
   * keeps failing moves back and never pins the head. At most `limit`.
   */
  listDue(input: { readonly now: string; readonly limit: number }): Promise<FiscalDocument[]>;
  /** `CONTINGENCY` documents owed a transmission, the same way. */
  listContingency(input: { readonly now: string; readonly limit: number }): Promise<FiscalDocument[]>;
  /** `CONTINGENCY` documents signed before `signedBefore` whose deadline warning has not gone out. */
  listContingencyDeadline(input: { readonly signedBefore: string; readonly limit: number }): Promise<FiscalDocument[]>;
  /** Profiles whose certificate expires before `before`, across owners. */
  listExpiringCertificates(before: string): Promise<EmitterProfile[]>;
}

/**
 * DECLARED, NOT IMPLEMENTED (FUT-4717): what an offline register needs from
 * the package that owns every number. A register that cannot reach the server
 * signs on a block of its contingency series reserved in advance; back
 * online, it hands in what it signed, and the known rest of a finished block
 * is voided — an unknown range never is. The interface is named now so the
 * register's ticket builds against it; nothing in this release calls it.
 */
export interface ContingencyBlockSource {
  /** Reserve the next `size` numbers of the point's contingency series for one register. */
  reserveBlock(input: { readonly ownerId: string; readonly issuingPointId: string; readonly size: number }): Promise<{
    readonly series: number;
    readonly from: number;
    readonly to: number;
  }>;
  /** Record an XML the register signed offline as a CONTINGENCY document of the block. */
  recordSigned(input: { readonly ownerId: string; readonly subjectId: string; readonly signedXml: string }): Promise<FiscalDocument>;
  /** The block is finished: void the numbers known unused (`sequenceUsed` tells which were). */
  closeBlock(input: { readonly ownerId: string; readonly series: number; readonly from: number; readonly sequenceUsed: number }): Promise<void>;
}
