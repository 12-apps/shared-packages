/**
 * THE WIRE PROBE (FUT-743) — what actually crossed, rendered into the page.
 *
 * A harness page proves integration only if a spec can see the integration.
 * Rendering "the checkout looks right" is what both repos already did while all
 * three FUT-740 criticals were live; what nobody could see was the BODY the
 * published client posted, the CPF that did or did not reach the provider, and
 * how many instruments the chain carried.
 *
 * So every page renders this. It reads the same `HarnessWorld` the mount writes
 * to and puts each fact behind its own `data-testid`, so an assertion is a
 * string comparison against the wire rather than a screenshot of a screen.
 * Nothing here interprets anything — a probe that normalized the body would be
 * able to hide exactly the defect it exists to expose.
 */
import { useEffect, useState, type JSX } from 'react';

import type { HarnessWorld } from './store';

/** Re-render whenever the world grows. Push, not poll: no timers in a spec. */
function useWorldTick(world: HarnessWorld): number {
  const [tick, setTick] = useState(0);
  useEffect(() => world.subscribe(() => setTick((current) => current + 1)), [world]);
  return tick;
}

/** One labelled fact, addressable on its own. */
function Fact({ id, value }: { id: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
      <span style={{ color: '#666', minWidth: 210 }}>{id}</span>
      <span data-testid={id} style={{ wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

/** `(none)` rather than an empty string, so an assertion cannot pass on absence. */
function joined(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : '(none)';
}

/** The last `POST /charge` body the published client sent, verbatim. */
function lastChargeBody(world: HarnessWorld): Record<string, unknown> | null {
  return world.requests.filter((request) => request.path.endsWith('/charge')).at(-1)?.body ?? null;
}

/**
 * `aurora:CARD:529.982.247-25:tok_abc` per charge a provider actually received.
 *
 * The instrument is printed with its KIND, because the two are resolved by
 * different code and only one of them can be wrong at a time: a freshly minted
 * `token`, or a `savedCardToken` the host's vault handed back for a saved id.
 * Collapsing them would let a reuse that silently became a fresh charge read as
 * a pass.
 */
function chargeLines(world: HarnessWorld): string[] {
  return world.seen.map((charge) => {
    const card = charge.card;
    // A wallet instrument prints its TYPE (`wallet:GOOGLE_PAY`), first because
    // it wins on the wire (FUT-471): the packaged journey asserts on this tag,
    // and a mount that stopped reading the flat wallet body degrades to
    // `(no-instrument)` here rather than to a green run.
    const instrument = card?.wallet
      ? `wallet:${card.wallet.type}`
      : card?.savedCardToken
        ? `vault:${card.savedCardToken}`
        : card?.token
          ? `tok:${card.token}`
          : '(no-instrument)';
    return `${charge.provider}:${charge.method}:${charge.customer?.taxId ?? '(no-taxId)'}:${instrument}`;
  });
}

/**
 * The `tokensByProvider` map's KEYS.
 *
 * FUT-563's rule is that the map is sent iff the SERVER-published chain has
 * more than one entry — never iff more than one instrument minted. A page
 * asserts the keys here and the received charges above, and the two together
 * are what catch a factory-level filter or de-duplication of the chain.
 */
function tokenProviders(body: Record<string, unknown> | null): string {
  const map = body?.tokensByProvider;
  if (!map || typeof map !== 'object') return '(absent)';
  return joined(Object.keys(map as Record<string, unknown>).sort());
}

export function WireProbe({ world, label }: { world: HarnessWorld; label?: string }): JSX.Element {
  useWorldTick(world);
  const body = lastChargeBody(world);
  return (
    <section
      data-testid="wire-probe"
      style={{ marginTop: 24, padding: 12, border: '1px dashed #999', borderRadius: 6 }}
    >
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: '#666', margin: '0 0 8px' }}>
        Wire probe{label ? ` · ${label}` : ''}
      </h3>
      <Fact id="wire-paths" value={joined(world.requests.map((r) => `${r.method} ${r.path}`))} />
      <Fact id="wire-charge-keys" value={body ? joined(Object.keys(body).sort()) : '(no-charge)'} />
      <Fact id="wire-charge-body" value={body ? JSON.stringify(body) : '(no-charge)'} />
      <Fact id="wire-tokens-by-provider" value={tokenProviders(body)} />
      <Fact id="provider-charge-count" value={String(world.seen.length)} />
      <Fact id="provider-charges" value={joined(chargeLines(world))} />
      <Fact id="provider-vaulted" value={joined(world.vaulted.map((v) => v.provider))} />
      <Fact id="host-navigated" value={joined(world.navigated)} />
    </section>
  );
}
