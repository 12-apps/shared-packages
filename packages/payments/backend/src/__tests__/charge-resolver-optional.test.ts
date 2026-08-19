import { describe, expect, it, vi } from 'vitest';

import type { PaymentsGateway } from '../core/gateway';
import type { MerchantRef } from '../core/types';
import type { PaymentsRequestContext } from '../http/handlers';
import { createPaymentsHttp, type PaymentsHttpDeps } from '../http/handlers';

/**
 * AN UNWIRED CHECKOUT KEEPS 404ING (FUT-760), the same contract
 * `resolveVaultRequests` and `setupContextFor` already hold.
 *
 * `resolveChargeRequest` was required, and that cost every host something even
 * when it served no buyer checkout. A mount with a `prefix` prepends those
 * segments to every incoming path, so a mount scoped to the admin credential
 * lifecycle can never match the `charges` row — the handler is unreachable,
 * and the host was still obliged to build a `ChargeInput` for it. Building one
 * means minting the per-attempt reference and idempotency key by hand, which
 * is precisely the rule `createChargeRaiser` exists to keep in one place; a
 * second copy of it, written for a handler nobody serves, is a copy that can
 * drift unnoticed.
 *
 * So it is optional now. A host that DOES mount checkout passes it and nothing
 * changes; a host that does not omits it and the endpoint answers 404 rather
 * than charging through a half-built input.
 */

/**
 * One container per case, never destructured: `charge` is configured after
 * construction, and a loose binding to it is shared mutable state as far as
 * the flakiness gate is concerned.
 */
function harness(
  resolveChargeRequest?: PaymentsHttpDeps['resolveChargeRequest'],
  raised?: unknown,
) {
  const charge = vi.fn(async () => raised);
  const gateway = { charge } as unknown as PaymentsGateway;
  return {
    charge,
    http: createPaymentsHttp({
      gateway,
      settings: {} as never,
      charges: {} as never,
      resolveChargeRequest,
    } as PaymentsHttpDeps),
  };
}

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const CTX = { merchant: MERCHANT } as PaymentsRequestContext;
const request = () =>
  new Request('https://host/charges', { method: 'POST', body: JSON.stringify({ method: 'PIX' }) });

describe('createCharge without a host resolver', () => {
  it('answers 404 and never reaches the gateway', async () => {
    const unwired = harness();

    const response = await unwired.http.createCharge(request(), CTX);

    expect(response.status).toBe(404);
    // The point of the 404: no charge is raised from an input nobody built.
    expect(unwired.charge).not.toHaveBeenCalled();
  });

  it('still charges through the resolver when a host wires one', async () => {
    const resolved = {
      reference: 'ord_1--0',
      amount: { amountCents: 1000, currency: 'BRL' },
      method: 'PIX' as const,
      customer: { name: 'Ana' },
      idempotencyKey: 'ord_1:0',
    };
    const wired = harness(async () => resolved as never, {
      snapshot: {
        provider: 'pagbank',
        providerChargeId: 'CHAR_1',
        status: 'PENDING',
        amount: resolved.amount,
        method: 'PIX',
      },
    });

    const response = await wired.http.createCharge(request(), CTX);

    expect(response.status).toBe(201);
    // The HOST's input reaches the gateway verbatim — the browser's draft
    // contributes no amount and no reference.
    expect(wired.charge).toHaveBeenCalledWith(MERCHANT, resolved);
  });
});
