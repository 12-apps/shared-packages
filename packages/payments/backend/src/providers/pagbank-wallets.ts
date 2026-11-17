import type { ApplePayActivation, ApplePayCsr, ResolvedCredentials } from '../core/types';

import { type PagBankFile, pagbankFileRequest } from './pagbank-http';

/**
 * PagBank's Apple Pay certificate round-trip (FUT-472) — the enrolment a
 * merchant account needs BEFORE an `APPLE_PAY` wallet charge can authorize:
 *
 *   1. `POST /wallets/apple-pay/csr` here → PagBank answers a `.csr`;
 *   2. the merchant submits that CSR in the Apple Developer portal and
 *      downloads a `.cer` (outside any code path);
 *   3. `POST /wallets/apple-pay/cer` here → PagBank activates the integration.
 *
 * Both calls ride `pagbankFileRequest` — same bearer auth, same environment
 * routing, same pre-send-only retry as every PagBank call, but sent with
 * `Accept: *\/*`: the CSR endpoint answers the FILE (`application/pkcs10`)
 * and refuses `Accept: application/json` with 406 (FUT-5196, production
 * 2026-11-17). Both parse DEFENSIVELY: PagBank
 * documents the endpoints but publishes NO response schema for either, so
 * nothing below assumes a field name. The CSR is recognized by its PEM
 * armour wherever it appears; activation is read off the HTTP outcome (a
 * non-2xx throws inside `pagbankRequest`), and both answers retain `raw` for
 * the operator who has to finish an enrolment by hand when recognition fails.
 *
 * Stub credentials return deterministic fakes and touch no network, the same
 * contract every adapter operation honours.
 */

/** The PEM armour that identifies a CSR wherever the response buries it. */
const CSR_PEM = /-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/;

/** A deterministic CSR for stub mode — recognizably fake, structurally real. */
const STUB_CSR =
  '-----BEGIN CERTIFICATE REQUEST-----\nSTUB\n-----END CERTIFICATE REQUEST-----';

/**
 * The first PEM CSR found anywhere in the response — a bare string body, or
 * any string field at any depth of an object body. Depth-first over a
 * schema-less payload beats guessing one field name and being wrong forever.
 */
function findCsr(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === 'string') return CSR_PEM.exec(value)?.[0] ?? null;
  if (!value || typeof value !== 'object') return null;
  for (const child of Object.values(value)) {
    const found = findCsr(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The PEM armour of DER bytes, 64 base64 characters per line. */
function derToPem(base64: string): string {
  const lines = base64.match(/.{1,64}/g) ?? [];
  return ['-----BEGIN CERTIFICATE REQUEST-----', ...lines, '-----END CERTIFICATE REQUEST-----'].join('\n');
}

/** A DER CSR starts with an ASN.1 SEQUENCE in long form (`0x30 0x81`/`0x82`). */
function isDer(bytes: Uint8Array): boolean {
  return bytes[0] === 0x30 && (bytes[1] === 0x81 || bytes[1] === 0x82);
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * What a file answer says, as a value `findCsr` can search: the body's text,
 * parsed when it is JSON; a DER body as the base64 it would be armoured from.
 */
function bodyOf(file: PagBankFile): unknown {
  if (file.bytes.length === 0) return undefined;
  if (isDer(file.bytes)) return base64Of(file.bytes);
  const text = new TextDecoder().decode(file.bytes);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The CSR in an answer: PEM wherever it is buried, else a bare base64 DER
 * (`MII…`, what a PEM body looks like without its armour) given its armour.
 */
function csrOf(raw: unknown): string | null {
  const pem = findCsr(raw);
  if (pem) return pem;
  if (typeof raw !== 'string') return null;
  const bare = raw.replace(/\s+/g, '');
  return /^MII[A-Za-z0-9+/]+={0,2}$/.test(bare) ? derToPem(bare) : null;
}

/** Step 1: mint the CSR the merchant submits to Apple. */
export async function requestApplePayCsr(
  credentials: ResolvedCredentials,
): Promise<ApplePayCsr> {
  if (credentials.stub) return { csr: STUB_CSR, raw: { stub: true } };
  const raw = bodyOf(await pagbankFileRequest('/wallets/apple-pay/csr', credentials, { method: 'POST' }));
  return { csr: csrOf(raw), raw };
}

/**
 * The `.cer`'s bytes. Apple hands out DER, which reaches us base64-encoded;
 * a PEM (`-----BEGIN CERTIFICATE-----`) is already text and goes as it is.
 */
function certificateBytes(certificate: string): Uint8Array<ArrayBuffer> | string {
  if (certificate.includes('-----BEGIN')) return certificate;
  const binary = atob(certificate.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Step 3: hand Apple's `.cer` back to PagBank; activates the integration. */
export async function activateApplePayCertificate(
  certificate: string,
  credentials: ResolvedCredentials,
): Promise<ApplePayActivation> {
  if (credentials.stub) return { activated: true, raw: { stub: true } };
  // "Criar e pagar um pedido com Apple Pay" uploads the FILE, as the form
  // field `cer` (`--form 'cer=@"arquivo.cer"'`), not a JSON body (FUT-3757).
  const form = new FormData();
  form.append('cer', new Blob([certificateBytes(certificate)]), 'apple_pay.cer');
  const raw = bodyOf(await pagbankFileRequest('/wallets/apple-pay/cer', credentials, { method: 'POST', form }));
  // `pagbankFileRequest` throws on every non-2xx, so reaching here IS activation
  // as far as the wire can say.
  return { activated: true, raw };
}
