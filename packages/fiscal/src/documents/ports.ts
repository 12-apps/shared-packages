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

/** A run of numbers of one series, both ends included. */
export interface NumberRange {
  readonly from: number;
  readonly to: number;
}

/**
 * - `OPEN`: the holder may still sign on it.
 * - `CLOSED`: the holder said it is done with it and how far it got (`usedUpTo`).
 * - `ABANDONED`: the holder is gone (a new install took its place): what it
 *   signed above the highest number it handed in is unknown, never voided.
 */
export type ContingencyBlockFate = "OPEN" | "CLOSED" | "ABANDONED";

export const CONTINGENCY_BLOCK_FATES: readonly ContingencyBlockFate[] = ["OPEN", "CLOSED", "ABANDONED"];

/**
 * Numbers of an issuing point's contingency series reserved for one holder
 * (the host's opaque id of a register that may go offline) to sign on with no
 * server. Drawn from the series' ONE counter — the counter the server's own
 * contingency (`issueOffline`, going offline after a silent SEFAZ) draws from
 * — so nothing else is ever numbered inside a block.
 */
export interface ContingencyBlock extends NumberRange {
  readonly id: string;
  readonly ownerId: string;
  readonly issuingPointId: string;
  readonly issuerCnpj: string;
  readonly environment: SefazEnvironment;
  readonly model: "NFCE";
  readonly series: number;
  readonly holder: string;
  readonly fate: ContingencyBlockFate;
  /** The highest number the holder said it used when it closed the block (`from - 1`: none); `null` otherwise. */
  readonly usedUpTo: number | null;
  readonly reservedAt: string;
  readonly closedAt: string | null;
  /** When every number of the block was accounted for (a document, or voided); `null` while one is not. */
  readonly settledAt: string | null;
}

/** A block, with the numbers recorded on it and the ranges voided at SEFAZ. */
export interface ContingencyBlockState extends ContingencyBlock {
  /** Numbers inside the block that carry a document, ascending. */
  readonly documented: readonly number[];
  readonly voided: readonly NumberRange[];
}

/**
 * A range of a block with no document: KNOWN unused (voided by
 * `voidKnownGaps`) or UNKNOWN (flagged for the store, never voided).
 */
export interface ContingencyGap extends NumberRange {
  readonly blockId: string;
  readonly ownerId: string;
  readonly issuingPointId: string;
  readonly issuerCnpj: string;
  readonly environment: SefazEnvironment;
  readonly series: number;
  readonly holder: string;
  readonly reservedAt: string;
}

/**
 * The rows behind contingency blocks (FUT-4717). Both of the package's stores
 * implement it (`createPrismaFiscalStore`, `createMemoryFiscalStore`); a host
 * with its own `FiscalStore` and without these gets `NOT_SUPPORTED` from the
 * block methods of the service, and everything else as before.
 *
 * - `reserveContingencyBlock` advances the series' counter by `size` and
 *   records the block, in one transaction (no row back: not that point's
 *   contingency series; past 999 999 999: `SERIES_EXHAUSTED`).
 * - `recordSignedDocument` inserts a document and its event together; a
 *   second live document of the subject is `SUBJECT_HAS_DOCUMENT`, a key or
 *   number recorded already is `CONFLICT`.
 * - `closeContingencyBlock` moves an OPEN block only (`false` otherwise).
 * - `recordContingencyVoid` records a voided range once (`false` when the
 *   range was recorded before).
 */
export interface ContingencyBlockStore {
  reserveContingencyBlock(input: {
    readonly request: NumberRequest;
    readonly size: number;
    readonly id: string;
    readonly holder: string;
    readonly at: string;
  }): Promise<ContingencyBlock>;
  /** The block holding `number` of the series, whoever holds it, with its documents and voids. */
  findContingencyBlock(input: {
    readonly ownerId: string;
    readonly issuerCnpj: string;
    readonly environment: SefazEnvironment;
    readonly series: number;
    readonly number: number;
  }): Promise<ContingencyBlockState | null>;
  /**
   * One page of the blocks a filter selects, ordered by `(reservedAt, id)`;
   * `after` is the last block of the previous page (keyset): the caller reads
   * pages until one comes back empty.
   */
  listContingencyBlocks(input: {
    readonly ownerId?: string;
    readonly holder?: string;
    readonly fates?: readonly ContingencyBlockFate[];
    readonly reservedBefore?: string;
    /** Leave out the blocks whose every number is accounted for. */
    readonly unsettledOnly?: boolean;
    readonly after?: { readonly reservedAt: string; readonly id: string };
    readonly limit: number;
  }): Promise<ContingencyBlockState[]>;
  closeContingencyBlock(input: {
    readonly id: string;
    readonly fate: "CLOSED" | "ABANDONED";
    readonly usedUpTo: number | null;
    readonly at: string;
  }): Promise<boolean>;
  settleContingencyBlock(input: { readonly id: string; readonly at: string }): Promise<void>;
  recordContingencyVoid(input: {
    readonly id: string;
    readonly blockId: string;
    readonly range: NumberRange;
    readonly protocol: string | null;
    readonly eventXmlKey: string | null;
    readonly at: string;
  }): Promise<boolean>;
  getDocumentByAccessKey(ownerId: string, accessKey: string): Promise<FiscalDocument | null>;
  recordSignedDocument(document: FiscalDocument, event: FiscalDocumentEvent): Promise<FiscalDocument>;
}

/**
 * What an offline register needs from the package that owns every number
 * (FUT-4717), implemented by `createFiscalDocuments` over a store that is
 * also a {@link ContingencyBlockStore}. A register that cannot reach the
 * server signs on a block of its contingency series reserved in advance; back
 * online, it hands in what it signed, and the known rest of a finished block
 * is voided — an unknown range never is.
 */
export interface ContingencyBlockSource {
  /** Reserve the next `size` (default 50) numbers of the point's contingency series for one holder. */
  reserveBlock(input: {
    readonly ownerId: string;
    readonly issuingPointId: string;
    readonly holder: string;
    readonly size?: number;
  }): Promise<ContingencyBlock>;
  /**
   * Record an XML the holder signed offline as the subject's `CONTINGENCY`
   * document, owed a transmission now. Idempotent on the access key.
   * `sale`: the sale as the host knows it; absent, the host's `SaleSource`
   * answers it.
   */
  recordSigned(input: {
    readonly ownerId: string;
    readonly subjectId: string;
    readonly signedXml: string;
    readonly holder: string;
    readonly sale?: SaleDraft;
  }): Promise<FiscalDocument>;
  /**
   * The holder is done with the block: `sequenceUsed` is the highest number
   * it used (`from - 1`: none). The numbers above it are known unused.
   */
  closeBlock(input: {
    readonly ownerId: string;
    readonly holder: string;
    readonly series: number;
    readonly from: number;
    readonly sequenceUsed: number;
  }): Promise<ContingencyBlock>;
}
