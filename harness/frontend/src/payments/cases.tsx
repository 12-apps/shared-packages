/**
 * The shapes every checkout page repeats (FUT-743).
 *
 * A page in this folder is meant to be its STORE and nothing else — the
 * declaration of what the merchant connected, and one sentence saying why that
 * is worth a page. Everything else (mount the flow, render the probe, key the
 * case so switching to it starts clean) is the same three lines each time, so
 * it lives here once.
 *
 * The provider builders below are the same idea for the chain: `mintable` and
 * `hostedPage` name the two shapes that matter to a BROWSER — one it can mint
 * an instrument for and one it cannot — so a page states the fact rather than
 * repeating a literal whose `tokenization` value has to be read carefully to
 * know which kind it is.
 */
import type { ReactNode } from 'react';

import type { HarnessProvider } from './adapter';
import { HarnessFlow, type HarnessHost } from './host';
import type { HarnessCase } from './panel';
import { WireProbe } from './probe';
import type { HarnessStoreSpec } from './store';

/** A provider the browser can mint an instrument for: our card form is shown. */
export function mintable(
  name: string,
  methods: HarnessProvider['methods'],
  extra: Partial<HarnessProvider> = {},
): HarnessProvider {
  return {
    name,
    tokenization: 'PUBLIC_KEY',
    methods,
    publicKey: `pk_harness_${name}`,
    // Server-granted stub permission. Without it the card form refuses a card
    // it has no way to mint, which is the silence the FUT-697 bug lived in.
    stub: true,
    ...extra,
  };
}

/**
 * A provider that settles on ITS OWN page.
 *
 * `hosted` decides what it answers a charge with; `tokenization: 'REDIRECT'` is
 * what it DECLARES. They are set together here because a chain that declares
 * one and answers the other is not a store, it is a bug in the fixture.
 */
export function hostedPage(
  name: string,
  methods: HarnessProvider['methods'],
  extra: Partial<HarnessProvider> = {},
): HarnessProvider {
  return { name, tokenization: 'REDIRECT', methods, hosted: true, stub: true, ...extra };
}

/** The mounted checkout plus its wire probe — what a page's body almost always is. */
export function MountedCheckout({
  spec,
  host,
  label,
  before,
}: {
  spec: HarnessStoreSpec;
  host?: HarnessHost;
  label: string;
  /** Rendered above the flow, for a page that needs its own controls. */
  before?: ReactNode;
}): ReactNode {
  return (
    <HarnessFlow spec={spec} host={host}>
      {(flows, world) => (
        <>
          {before}
          <flows.Checkout />
          <WireProbe world={world} label={label} />
        </>
      )}
    </HarnessFlow>
  );
}

/** One case of a multi-store page, mounting the checkout for its own store. */
export function checkoutCase(
  id: string,
  label: string,
  spec: HarnessStoreSpec,
  host?: HarnessHost,
): HarnessCase {
  return { id, label, render: () => <MountedCheckout spec={spec} host={host} label={id} /> };
}
