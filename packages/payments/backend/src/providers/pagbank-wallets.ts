import type { ApplePayActivation, ApplePayCsr, ResolvedCredentials } from '../core/types';

import { pagbankRequest } from './pagbank-http';

/**
 * PagBank's Apple Pay certificate round-trip (FUT-472) — the enrolment a
 * merchant account needs BEFORE an `APPLE_PAY` wallet charge can authorize:
 *
 *   1. `POST /wallets/apple-pay/csr` here → PagBank answers a `.csr`;
 *   2. the merchant submits that CSR in the Apple Developer portal and
 *      downloads a `.cer` (outside any code path);
 *   3. `POST /wallets/apple-pay/cer` here → PagBank activates the integration.
 *
 * Both calls ride `pagbankRequest` — same bearer auth, same environment
 * routing, same pre-send-only retry — and both parse DEFENSIVELY: PagBank
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

/** Step 1: mint the CSR the merchant submits to Apple. */
export async function requestApplePayCsr(
  credentials: ResolvedCredentials,
): Promise<ApplePayCsr> {
  if (credentials.stub) return { csr: STUB_CSR, raw: { stub: true } };
  const raw = await pagbankRequest<unknown>('/wallets/apple-pay/csr', credentials, {
    method: 'POST',
  });
  return { csr: findCsr(raw), raw };
}

/** Step 3: hand Apple's `.cer` back to PagBank; activates the integration. */
export async function activateApplePayCertificate(
  certificate: string,
  credentials: ResolvedCredentials,
): Promise<ApplePayActivation> {
  if (credentials.stub) return { activated: true, raw: { stub: true } };
  // The request schema is as unpublished as the response's; `certificate` is
  // the endpoint's own noun (`…/apple-pay/cer`). To be confirmed against the
  // sandbox once the platform holds a real `.cer` — an external prerequisite
  // (Apple Developer account, Merchant ID, domain verification).
  const raw = await pagbankRequest<unknown>('/wallets/apple-pay/cer', credentials, {
    method: 'POST',
    body: { certificate },
  });
  // `pagbankRequest` throws on every non-2xx, so reaching here IS activation
  // as far as the wire can say.
  return { activated: true, raw };
}
