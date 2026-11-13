/**
 * The emitter profile and its issuing points — what moved INTO this package
 * from the host's tax profile (FUT-2231's decision block): the company data,
 * the address, the regime, the environment, the document policy, who signs,
 * the certificate (as ciphertext), the CSC (as ciphertext) and the series.
 *
 * Keyed by an opaque `ownerId` the host maps to its own tenant. What stays in
 * the host: the link to its tenant, where the settings screen sits, the CNPJ
 * lookup, the accountant, and the plan-driven DEFAULT of `documentPolicy`
 * (this package knows no plans, so it takes the value and never invents it).
 */

import type { TaxRegime } from "../engine/types";
import type { Address, IssuerTaxRegime } from "../sale/types";
import type { SefazEnvironment } from "../sidecar/types";
import type { FiscalDocumentModel } from "./types";

/**
 * - `ISSUED_HERE`: this package issues the store's documents.
 * - `ISSUED_ELSEWHERE`: the store issues in its own system and the host
 *   records the access key it types.
 * - `NONE`: no document.
 */
export type DocumentPolicy = "ISSUED_HERE" | "ISSUED_ELSEWHERE" | "NONE";
export const DOCUMENT_POLICIES: readonly DocumentPolicy[] = ["ISSUED_HERE", "ISSUED_ELSEWHERE", "NONE"];

/**
 * Who signs. `STORE_CERTIFICATE`: the store's own A1, held encrypted through
 * the host's cipher. `PLATFORM`: the platform signing on the store's behalf
 * (LC 214/2025 art. 22 §12) — declared, answering `NOT_SUPPORTED` until it is
 * decided how that signature works (FUT-2229 q4). Its own field from the start,
 * so enabling it is an adapter, not a migration.
 */
export type SigningIdentityKind = "STORE_CERTIFICATE" | "PLATFORM";
export const SIGNING_IDENTITY_KINDS: readonly SigningIdentityKind[] = ["STORE_CERTIFICATE", "PLATFORM"];

export interface EmitterProfile {
  readonly ownerId: string;
  /** 14 characters; the 2026 alphanumeric CNPJ is accepted. */
  readonly cnpj: string;
  /** IE digits, or `ISENTO`. */
  readonly stateRegistration: string;
  readonly municipalRegistration: string | null;
  readonly cnae: string | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  /** `CRT` on the document. */
  readonly taxRegime: IssuerTaxRegime;
  /** The IBS/CBS engine's regime, and the day it took effect (the Simples option is by semester). */
  readonly regime: TaxRegime;
  readonly regimeEffectiveFrom: string;
  /** LC 214/2025 arts. 273–276 apply to the store's prepared food. */
  readonly restaurantRegime: boolean;
  readonly address: Address & { readonly postalCode: string };
  readonly environment: SefazEnvironment;
  readonly documentPolicy: DocumentPolicy;
  readonly signingIdentity: SigningIdentityKind;
  /** The `.pfx` bytes (base64) through the host's cipher. Never in clear, never on the wire. */
  readonly certificateCiphertext: string | null;
  readonly certificatePasswordCiphertext: string | null;
  readonly certificateExpiresAt: string | null;
  readonly cscId: string | null;
  /** The CSC token through the host's cipher. */
  readonly cscCiphertext: string | null;
  /** The store's consent to `PLATFORM` signing (art. 22 §12). */
  readonly consentRecordedAt: string | null;
  readonly updatedAt: string;
}

/**
 * Where documents are issued from: an opaque id the host maps (a register, the
 * online store). A register has an ONLINE and a CONTINGENCY series; a point
 * that never goes offline has no contingency series. The package owns every
 * series' counter; no host keeps a second one.
 */
export interface IssuingPoint {
  readonly id: string;
  readonly ownerId: string;
  readonly model: FiscalDocumentModel;
  readonly onlineSeries: number;
  readonly contingencySeries: number | null;
  readonly createdAt: string;
}

/** The profile as the HTTP surface answers it: no ciphertext leaves the server. */
export type EmitterProfileView = Omit<
  EmitterProfile,
  "certificateCiphertext" | "certificatePasswordCiphertext" | "cscCiphertext"
> & { readonly hasCertificate: boolean; readonly hasCsc: boolean };

export function viewOf(profile: EmitterProfile): EmitterProfileView {
  const { certificateCiphertext, certificatePasswordCiphertext, cscCiphertext, ...rest } = profile;
  return {
    ...rest,
    hasCertificate: certificateCiphertext !== null && certificatePasswordCiphertext !== null,
    hasCsc: cscCiphertext !== null && profile.cscId !== null,
  };
}
