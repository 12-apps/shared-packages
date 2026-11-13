/**
 * The SigningIdentity port: who signs a call. It turns a profile into the
 * {@link SigningMaterial} for ONE call to the issuer; the material is never
 * stored, logged or put in an error.
 *
 * - `STORE_CERTIFICATE` ships now: the store's own A1, decrypted through the
 *   host's {@link Cipher} at the moment of the call.
 * - `PLATFORM` is declared and answers `NOT_SUPPORTED` until FUT-2229
 *   question 4 says how the platform signs on a store's behalf.
 */

import type { SigningMaterial } from "../issuer/port";
import { FiscalDocumentError } from "./errors";
import type { Cipher } from "./ports";
import type { EmitterProfile, SigningIdentityKind } from "./profile";

export interface SigningIdentity {
  readonly kind: SigningIdentityKind;
  materialFor(profile: EmitterProfile): Promise<SigningMaterial>;
}

export type SigningIdentities = Readonly<Record<SigningIdentityKind, SigningIdentity>>;

export function createStoreCertificateIdentity(config: { readonly cipher: Cipher }): SigningIdentity {
  if (typeof config?.cipher?.decrypt !== "function") throw new TypeError("createStoreCertificateIdentity needs a cipher.");
  const { cipher } = config;
  return {
    kind: "STORE_CERTIFICATE",
    async materialFor(profile) {
      if (profile.certificateCiphertext === null || profile.certificatePasswordCiphertext === null) {
        throw new FiscalDocumentError("NOT_ISSUABLE", `owner ${profile.ownerId} has no certificate.`);
      }
      const [pfxBase64, password] = await Promise.all([
        cipher.decrypt(profile.certificateCiphertext),
        cipher.decrypt(profile.certificatePasswordCiphertext),
      ]);
      const csc =
        profile.cscId !== null && profile.cscCiphertext !== null
          ? { id: profile.cscId, token: await cipher.decrypt(profile.cscCiphertext) }
          : null;
      return { certificate: { pfxBase64, password }, csc };
    },
  };
}

export function createPlatformIdentity(): SigningIdentity {
  return {
    kind: "PLATFORM",
    async materialFor(profile) {
      throw new FiscalDocumentError(
        "NOT_SUPPORTED",
        `owner ${profile.ownerId} signs as PLATFORM, which is declared and not built yet (FUT-2229 q4).`,
      );
    },
  };
}

/** The two identities over one cipher: what a host passes as `signing`. */
export function createSigningIdentities(config: { readonly cipher: Cipher }): SigningIdentities {
  return { STORE_CERTIFICATE: createStoreCertificateIdentity(config), PLATFORM: createPlatformIdentity() };
}
