import { describe, expect, it } from 'vitest';

import type { PaymentsGateway } from '../../core/gateway';
import { PT_BR_PIX_MANUAL_COPY } from '../../providers/pix-manual/pt-BR';
import { pixManualProvider } from '../../providers/pixmanual';
import { call, setupCheckoutWorld } from './harness';

/**
 * `POST /release` over a charge only the STORE can settle (Pix manual).
 *
 * The buyer's "não paguei" and a staff "Confirmar" can land in the same
 * second. The release reads the charge (PENDING), then voids it — and the
 * staff confirm may win in between. The void must not undo that PAID, and the
 * release must not let a paid payable go.
 */

/** The world's own gateway, reachable from the lazy getter once it is built. */
interface Late {
  gateway: PaymentsGateway | null;
}

/** A gateway whose void is preceded by a staff confirm — the race, made deterministic. */
function confirmedJustBeforeTheVoid(late: Late): PaymentsGateway {
  return new Proxy({} as PaymentsGateway, {
    get(_target, key: keyof PaymentsGateway) {
      const real = late.gateway;
      if (!real) throw new Error('gateway read before the world was built');
      if (key !== 'cancelCharge') return real[key];
      return async (...args: Parameters<PaymentsGateway['cancelCharge']>) => {
        const [merchant, provider, id] = args;
        await real.confirmManualCharge(merchant, provider, id);
        return real.cancelCharge(...args);
      };
    },
  });
}

function manualWorld(late?: Late) {
  return setupCheckoutWorld({
    chain: [{ name: 'pixmanual', adapter: pixManualProvider(PT_BR_PIX_MANUAL_COPY) }],
    ...(late ? { config: { gateway: () => confirmedJustBeforeTheVoid(late) } } : {}),
  });
}

/** The charge the create call attached to the payable, as the store holds it now. */
async function storedCharge(world: ReturnType<typeof manualWorld>) {
  const attached = world.correlation.pending[0]?.charge;
  if (!attached) throw new Error('the create call attached no charge');
  return world.charges.findByProviderChargeId(attached.provider, attached.providerChargeId);
}

describe('POST /release over a Pix the store confirms', () => {
  it('voids a charge nobody confirmed and lets the payable go', async () => {
    const world = manualWorld();
    await call(world.routes, 'POST', '/', {});

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.body.data).toBe('RELEASED');
    expect((await storedCharge(world))?.snapshot.status).toBe('CANCELED');
  });

  it('SETTLES a payable the store confirmed between the read and the void', async () => {
    const late: Late = { gateway: null };
    const world = manualWorld(late);
    late.gateway = world.gateway;
    await call(world.routes, 'POST', '/', {});

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.body.data).toBe('SETTLED');
    expect(world.correlation.abandons).toEqual([]);
    expect(world.correlation.settlements).toHaveLength(1);
    expect((await storedCharge(world))?.snapshot.status).toBe('PAID');
  });
});
