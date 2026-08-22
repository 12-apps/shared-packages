import { describe, expect, it } from 'vitest';

import { infinitePayProvider, STUB_OUTCOME_FIELD } from '../providers/infinitepay';
import { PT_BR_INFINITEPAY_COPY } from '../providers/pt-BR';

/**
 * What the SCRIPT is allowed to answer — FUT-684's third scenario.
 *
 * The stub exists so the activation journey can drive refusals a real account
 * cannot be asked for. That only works while it refuses what the real account
 * refuses. It used to answer `payment_check` for ANY reference, and that one
 * indulgence is what made a caller asking about the WRONG charge invisible:
 * the poll asked InfinitePay about the bare `verify-<provider>-<merchant>`
 * while `start` had minted `verify-<provider>-<merchant>--<attempt>`, so live
 * the browser could never confirm a paid activation — and 25 end-to-end
 * scenarios stayed green over it for a release, because the stub said PAID
 * either way.
 *
 *   Cenário (stub): reference errada não confirma
 *     Quando o poll pergunta por uma reference diferente da pendente
 *     Então o stub responde não-pago
 */
describe('infinitepay stub script — payment_check', () => {
  const scripted = (outcome: string) => ({
    environment: 'SANDBOX' as const,
    fields: { handle: '$loja', [STUB_OUTCOME_FIELD]: outcome },
    stub: true,
  });

  const ask = (reference: string, outcome = 'paid') =>
    infinitePayProvider(PT_BR_INFINITEPAY_COPY).findChargeByReference?.(reference, scripted(outcome), {});

  it('answers not-paid when asked about a reference that names no attempt', async () => {
    // The bare base. Both mint paths append an attempt id, so no charge was
    // ever created under this name and `payment_check` cannot find one.
    await expect(ask('verify-infinitepay-client-1')).resolves.toBeNull();
  });

  it('answers PAID for the attempt reference that was actually minted', async () => {
    await expect(ask('verify-infinitepay-client-1--k9x')).resolves.toMatchObject({
      status: 'PAID',
      reference: 'verify-infinitepay-client-1--k9x',
    });
  });

  it('refuses the bare base whatever the script says next', async () => {
    // Not just the paid script: an `expired` or `declined` answer for a charge
    // that does not exist would settle the attempt and clear the pending row,
    // which is a worse lie than "keep waiting".
    await expect(ask('verify-infinitepay-client-1', 'expired')).resolves.toBeNull();
    await expect(ask('verify-infinitepay-client-1', 'declined')).resolves.toBeNull();
  });

  /**
   * An ORDER reference is not an activation reference and carries no attempt
   * suffix of this shape — the guard must not swallow the shopper's charge,
   * which is what every checkout scenario polls for.
   */
  it('leaves a non-activation reference to the script', async () => {
    await expect(ask('order-123')).resolves.toMatchObject({ status: 'PAID' });
  });
});
