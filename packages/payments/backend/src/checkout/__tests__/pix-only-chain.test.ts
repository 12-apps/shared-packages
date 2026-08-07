import { describe, expect, it } from 'vitest';

import { usesHostedCheckout } from '../config';
import type { BuyerCheckoutConfig, BuyerProviderLink } from '../types';

import { call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * FUT-747 — "hosted" is a CARD question, asked per method.
 *
 * A provider that only does PIX has nothing to tokenize: PIX is a QR the
 * provider mints, not a PAN the browser encrypts, so declaring
 * `tokenization: 'NONE'` is the honest answer and the only alternative is
 * misreporting a capability to dodge a host branch — the per-provider
 * special-casing FUT-557 / FUT-562 exist to prevent.
 *
 * Asked globally over the chain, the predicate read that honest `NONE` as
 * "nobody tokenizes in the browser ⇒ this checkout is hosted", routed the PIX
 * charge into hosted-CARD handling, and threw on the missing link of a charge
 * that was carrying a perfectly good QR. The store could take no PIX at all —
 * and PIX-only is the simplest configuration a store can have.
 *
 * The FUT-563 rule is untouched by the separation and is re-pinned here from
 * the mount's side: a REDIRECT provider COMMITS the walk the moment it mints a
 * payable link, whichever method asked for it.
 */

/** A PIX-only acquirer: one method, and no instrument to mint for it. */
const pixOnly = {
  name: 'alpha',
  adapter: testAdapter('alpha', { methods: ['PIX'], tokenization: 'NONE' }),
};

/** A hosted page — takes both methods, on its own site. */
const hostedPage = {
  name: 'beta',
  adapter: testAdapter('beta', { tokenization: 'REDIRECT', hosted: true }),
};

/** An ordinary acquirer with a browser card form. */
const cardAcquirer = {
  name: 'gamma',
  adapter: testAdapter('gamma', { tokenization: 'PUBLIC_KEY' }),
};

function link(over: Partial<BuyerProviderLink>): BuyerProviderLink {
  return {
    provider: 'p',
    tokenization: 'PUBLIC_KEY',
    publicKey: null,
    mockTokenization: false,
    methods: ['PIX', 'CARD'],
    customerSchema: [],
    // Declares no screen (FUT-596) — these cases are about the capability
    // reads, which is exactly the path an undeclared provider takes.
    checkoutScreen: null,
    ...over,
  };
}

function config(chain: readonly BuyerProviderLink[]): BuyerCheckoutConfig {
  const head = chain[0];
  return {
    provider: head?.provider ?? null,
    tokenization: head?.tokenization ?? null,
    publicKey: null,
    mockTokenization: false,
    methods: [...new Set(chain.flatMap((entry) => [...entry.methods]))],
    chain,
  };
}

describe('the hosted question is asked per METHOD', () => {
  it('never answers hosted for PIX — a PIX charge has no instrument to mint', () => {
    // Not even for a chain that IS entirely hosted. Whether a PIX buyer lands
    // on a provider's page is a fact about the charge the walk raised, read off
    // that snapshot's link (FUT-563), and answering it from the config up front
    // is the same mistake in the other direction.
    expect(usesHostedCheckout(config([link({ tokenization: 'REDIRECT' })]), 'PIX')).toBe(false);
    expect(usesHostedCheckout(config([link({ tokenization: 'NONE' })]), 'PIX')).toBe(false);
  });

  it('answers hosted for CARD only when no card-capable entry tokenizes here', () => {
    const hosted = config([link({ provider: 'beta', tokenization: 'REDIRECT' })]);
    expect(usesHostedCheckout(hosted, 'CARD')).toBe(true);

    const mixed = config([
      link({ provider: 'beta', tokenization: 'REDIRECT' }),
      link({ provider: 'gamma', tokenization: 'PUBLIC_KEY' }),
    ]);
    expect(usesHostedCheckout(mixed, 'CARD')).toBe(false);
  });

  it('ignores a PIX-only entry when asking about CARD', () => {
    // The same subset the walk itself attempts: `resolveProvider` skips a
    // provider whose capabilities exclude the method, so an entry that cannot
    // take a card is not entitled to a vote on the card surface.
    const pixThenHosted = config([
      link({ provider: 'alpha', tokenization: 'PUBLIC_KEY', methods: ['PIX'] }),
      link({ provider: 'beta', tokenization: 'REDIRECT' }),
    ]);

    expect(usesHostedCheckout(pixThenHosted, 'CARD')).toBe(true);
  });

  it('answers false when nothing takes a card at all, empty chain included', () => {
    // There is no card surface to choose. A card charge raised here is refused
    // by the exhausted walk, in its own words — not by a missing hosted link.
    expect(usesHostedCheckout(config([link({ tokenization: 'NONE', methods: ['PIX'] })]), 'CARD'))
      .toBe(false);
    expect(usesHostedCheckout(config([]), 'CARD')).toBe(false);
  });
});

describe('a PIX-only chain that tokenizes nothing', () => {
  it('raises the PIX charge and answers with its payload', async () => {
    const world = setupCheckoutWorld({ chain: [pixOnly] });

    const created = await call(world.routes, 'POST', '/', {});

    expect(created.status).toBe(200);
    // The buyer is NOT handed over: there is no page to hand them to.
    expect((created.body.data as Record<string, unknown>).hostedCheckoutUrl).toBeUndefined();
    const [stored] = world.charges.all();
    expect(stored?.snapshot.method).toBe('PIX');
    expect(stored?.snapshot.pix?.qrText).toContain('stub-pix');
    // Attached as the payable's live charge, so the webhook and the poll can
    // settle it — the whole reason a QR is worth minting.
    expect(world.correlation.pending).toHaveLength(1);
  });

  it('reuses that live code on a re-tap instead of minting a second one', async () => {
    const world = setupCheckoutWorld({ chain: [pixOnly] });

    await call(world.routes, 'POST', '/', {});
    await call(world.routes, 'POST', '/', {});

    expect(world.charges.all()).toHaveLength(1);
  });

  it('still offers PIX alone on the published config', async () => {
    const world = setupCheckoutWorld({ chain: [pixOnly] });

    const { body } = await call(world.routes, 'GET', '/config');
    const data = body.data as { methods: string[]; chain: { tokenization: string }[] };

    expect(data.methods).toEqual(['PIX']);
    expect(data.chain.map((entry) => entry.tokenization)).toEqual(['NONE']);
  });
});

describe('separating the two paths leaves the surfaces as they were', () => {
  it('hands a CARD buyer over when no acquirer can tokenize here', async () => {
    const world = setupCheckoutWorld({ chain: [hostedPage], payable: { method: 'CARD' } });

    const created = await call(world.routes, 'POST', '/', {});

    expect((created.body.data as Record<string, unknown>).hostedCheckoutUrl).toContain(
      '/checkout/',
    );
    expect(world.charges.all()).toHaveLength(1);
  });

  it('shows the card form for a mixed chain, raising nothing at create', async () => {
    const world = setupCheckoutWorld({
      chain: [hostedPage, cardAcquirer],
      payable: { method: 'CARD' },
    });

    const created = await call(world.routes, 'POST', '/', {});

    // The browser mints one instrument per entry and posts `/charge` next; a
    // charge raised HERE would hand the buyer over before the chain the
    // merchant configured could ever be walked.
    expect(created.status).toBe(200);
    expect((created.body.data as Record<string, unknown>).hostedCheckoutUrl).toBeUndefined();
    expect(world.charges.all()).toHaveLength(0);
  });

  it('COMMITS the walk on a PIX charge that failed over onto a hosted page', async () => {
    // FUT-563, from the mount's side: the buyer asked for a QR and the walk
    // landed somewhere that mints a link instead. The answer follows the charge
    // that exists, and the link is payable from now on — so a re-tap must hand
    // back that same link rather than raise a second payable charge.
    const world = setupCheckoutWorld({
      chain: [
        { name: 'alpha', adapter: testAdapter('alpha', { tokenization: 'NONE', refuses: true }) },
        hostedPage,
      ],
    });

    const first = await call(world.routes, 'POST', '/', {});
    const second = await call(world.routes, 'POST', '/', {});

    const url = (first.body.data as Record<string, unknown>).hostedCheckoutUrl;
    expect(typeof url).toBe('string');
    expect((second.body.data as Record<string, unknown>).hostedCheckoutUrl).toBe(url);
    expect(world.charges.all()).toHaveLength(1);
  });
});
