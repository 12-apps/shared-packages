/**
 * The profile half of the document service: the emitter profile, the
 * certificate upload and the issuing points. A secret is encrypted through the
 * host's cipher the moment it arrives, and only its ciphertext is stored.
 */

import type { FiscalContext, FiscalDocumentsConfig } from "./context";
import { FiscalDocumentError } from "./errors";
import type { Cipher } from "./ports";
import type { CertificateUpload, EmitterProfileInput, IssuingPointInput } from "./profile-input";
import type { EmitterProfile, IssuingPoint } from "./profile";

/** What the host learns from an A1 without this package parsing PKCS#12. */
export interface CertificateFacts {
  /** `notAfter`, ISO 8601. */
  readonly expiresAt: string;
}

export interface FiscalDocumentsServiceConfig extends FiscalDocumentsConfig {
  /** Encrypts the certificate, its password and the CSC on arrival. */
  readonly cipher: Cipher;
  /**
   * Reads the expiry out of an uploaded A1; throws when the file does not
   * open with the password. The host's: Node's crypto cannot open every A1
   * (most issued before 2023 use RC2-40), and this package adds no parser.
   */
  readonly readCertificate: (certificate: CertificateUpload) => Promise<CertificateFacts>;
}

export interface Deps {
  readonly ctx: FiscalContext;
  readonly config: FiscalDocumentsServiceConfig;
}

export async function saveProfile({ ctx, config }: Deps, ownerId: string, input: EmitterProfileInput): Promise<EmitterProfile> {
  const stored = await config.store.getProfile(ownerId);
  const { cscToken, ...fields } = input;
  const profile: EmitterProfile = {
    ...fields,
    ownerId,
    certificateCiphertext: stored?.certificateCiphertext ?? null,
    certificatePasswordCiphertext: stored?.certificatePasswordCiphertext ?? null,
    certificateExpiresAt: stored?.certificateExpiresAt ?? null,
    cscCiphertext: cscToken === null ? (stored?.cscCiphertext ?? null) : await config.cipher.encrypt(cscToken),
    updatedAt: ctx.nowIso(),
  };
  await config.store.saveProfile(profile);
  return profile;
}

export async function uploadCertificate({ ctx, config }: Deps, ownerId: string, certificate: CertificateUpload): Promise<EmitterProfile> {
  const stored = await ctx.requireProfile(ownerId);
  let facts: CertificateFacts;
  try {
    facts = await config.readCertificate(certificate);
  } catch {
    // The reader's own message may quote what it was given; this one never does.
    throw new FiscalDocumentError("INVALID_INPUT", "the certificate does not open with that password.");
  }
  const profile: EmitterProfile = {
    ...stored,
    certificateCiphertext: await config.cipher.encrypt(certificate.pfxBase64),
    certificatePasswordCiphertext: await config.cipher.encrypt(certificate.password),
    certificateExpiresAt: facts.expiresAt,
    updatedAt: ctx.nowIso(),
  };
  await config.store.saveProfile(profile);
  return profile;
}

export async function createIssuingPoint({ ctx, config }: Deps, ownerId: string, input: IssuingPointInput): Promise<IssuingPoint> {
  await ctx.requireProfile(ownerId);
  if (input.model === "NFE" && input.contingencySeries !== null) {
    throw new FiscalDocumentError("INVALID_INPUT", "an NF-e issuing point has no contingency series: the service has no offline NF-e path.");
  }
  const point: IssuingPoint = {
    id: input.id,
    ownerId,
    model: input.model,
    onlineSeries: input.onlineSeries,
    contingencySeries: input.contingencySeries,
    createdAt: ctx.nowIso(),
  };
  await config.store.createIssuingPoint(point, { online: input.firstOnlineNumber, contingency: input.firstContingencyNumber });
  return point;
}
