/**
 * THE SERVER-TRUTH PROBE for the merchant admin store.
 *
 * On every world notification it calls the PUBLISHED `settings.getSettings`
 * in-process and renders that view's own answers — never a reimplementation
 * of the view. Two chains are printed under different ids on purpose:
 * `admin-rotation` is `view.providerChain` (`inRotation`-filtered — what
 * checkout will walk) while `admin-enabled` is the `enabled` set by priority
 * (what the reorder UI renders), and the FUT-683 fixture is precisely a row
 * where the two disagree.
 *
 * `admin-stored-<p>-<ENV>` is read from the STORE, not from the view: the
 * masked view iterates `credentialSchema` alone, so OAuth token keys — written
 * straight into the blob by `completeConnect` — never appear in it. The store
 * is the only place they are visible, and the connect specs assert on exactly
 * those keys.
 *
 * Conventions as in `./probe.tsx`: one `data-testid` per fact, `(none)` rather
 * than an empty string, no interpretation of any value. The ONE transformation
 * performed here is rebasing wire paths against `admin-base-url` — documented
 * beside it, and lossless: the removed prefix is printed as its own fact, so
 * the absolute path is recoverable by concatenation.
 */
import { useEffect, useState, type JSX } from 'react';

import type { MerchantSettingsView, StoredProviderConfig } from '@12-apps/payments-backend';

import { MERCHANT } from './adapter';
import type { AdminWorld } from './admin-store';

interface ServerTruth {
  view: MerchantSettingsView | null;
  rows: StoredProviderConfig[];
}

/** Re-read server truth on every notification. Push, not poll: no timers. */
function useServerTruth(world: AdminWorld): ServerTruth {
  const [truth, setTruth] = useState<ServerTruth>({ view: null, rows: [] });
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void Promise.all([world.settings.getSettings(MERCHANT), world.store.list(MERCHANT)]).then(
        ([view, rows]) => {
          if (live) setTruth({ view, rows });
        },
      );
    };
    read();
    const unsubscribe = world.subscribe(read);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [world]);
  return truth;
}

/** `(none)` rather than empty, so an assertion cannot pass on absence. */
function listed(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : '(none)';
}

/**
 * Rebase one wire path against the case's baseUrl — the per-case nonce would
 * otherwise be baked into every assertion in a spec file. Lossless: the
 * prefix removed here is `admin-base-url`.
 */
function rebased(target: string, baseUrl: string): string {
  return target.startsWith(baseUrl) ? target.slice(baseUrl.length) : target;
}

/** `"<METHOD> <path> <status>"` per request; `-` while still in flight. */
function wirePaths(world: AdminWorld): string {
  return listed(
    world.requests.map(
      (entry) => `${entry.method} ${rebased(entry.path, world.baseUrl)} ${entry.status ?? '-'}`,
    ),
  );
}

/**
 * One NEWLINE-separated line per body-carrying request — newline because
 * bodies contain commas. `JSON.stringify` of the parsed body reproduces the
 * client's own serialization byte for byte (the client uses bare
 * `JSON.stringify`, and parse→stringify preserves key order).
 */
function wireBodies(world: AdminWorld): string {
  const lines = world.requests
    .filter((entry) => entry.body !== null)
    .map((entry) => `${entry.method} ${rebased(entry.path, world.baseUrl)} ${JSON.stringify(entry.body)}`);
  return lines.length > 0 ? lines.join('\n') : '(none)';
}

/** What `chainOf` renders: the `enabled` set, by priority. */
function enabledChain(view: MerchantSettingsView | null): string {
  return listed(
    (view?.configs ?? [])
      .filter((config) => config.enabled)
      .slice()
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))
      .map((config) => config.provider),
  );
}

/** The stored blob's keys for one environment — where OAuth tokens show. */
function storedKeys(row: StoredProviderConfig | null, environment: 'SANDBOX' | 'PRODUCTION'): string {
  return listed(Object.keys(row?.environments[environment] ?? {}).sort());
}

function providerFacts(name: string, truth: ServerTruth): [string, string][] {
  const config = truth.view?.configs.find((entry) => entry.provider === name) ?? null;
  const row = truth.rows.find((entry) => entry.provider === name) ?? null;
  return [
    [`admin-status-${name}`, config?.status ?? '(none)'],
    [`admin-enabled-${name}`, config ? String(config.enabled) : '(none)'],
    [`admin-proof-${name}`, config?.chargeVerifiedAt ? 'stamped' : '(none)'],
    [`admin-stored-${name}-SANDBOX`, storedKeys(row, 'SANDBOX')],
    [`admin-stored-${name}-PRODUCTION`, storedKeys(row, 'PRODUCTION')],
  ];
}

// Rendered as a definition list: with ~30 facts per case, term/definition is
// the honest structure — and the styles are hoisted so each row stays a line.
const FACT_ROW = { display: 'flex', gap: 10, margin: 0 } as const;
const FACT_TERM = { color: '#667', minWidth: 240, flexShrink: 0, fontWeight: 400 } as const;
const FACT_VALUE = { whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 } as const;

/** One labelled fact, addressable on its own; newlines survive rendering. */
function FactRow({ id, value }: { id: string; value: string }): JSX.Element {
  return (
    <div style={FACT_ROW}>
      <dt style={FACT_TERM}>{id}</dt>
      <dd data-testid={id} style={FACT_VALUE}>
        {value}
      </dd>
    </div>
  );
}

export function AdminProbe({ world, label }: { world: AdminWorld; label?: string }): JSX.Element {
  const truth = useServerTruth(world);
  const facts: [string, string][] = [
    ['admin-base-url', world.baseUrl],
    ['admin-wire-paths', wirePaths(world)],
    ['admin-wire-bodies', wireBodies(world)],
    ['admin-rotation', listed(truth.view?.providerChain ?? [])],
    ['admin-active-provider', truth.view?.activeProvider ?? '(none)'],
    ['admin-failover-policy', truth.view?.failoverPolicy ?? '(none)'],
    ['admin-enabled', enabledChain(truth.view)],
    ...world.registry.names.flatMap((name) => providerFacts(name, truth)),
    [
      'admin-activation-charges',
      listed(world.activationCharges.map((c) => `${c.provider}:${c.status}:${c.reference}`)),
    ],
    ['admin-activation-refunds', listed(world.activationRefunds)],
    ['admin-oauth-state', listed(world.mintedStates)],
    ['admin-oauth-consumed', listed(world.consumedStates)],
    ['admin-verify-calls', listed(world.verifyCalls.map((v) => `${v.provider}:${v.environment}`))],
    ['admin-revoke-failures', listed(world.revokeFailures)],
    ['admin-exchanges', listed(world.exchanges.map((e) => `${e.provider}:${e.code}`))],
    ['admin-nav-log', listed(world.nav)],
  ];
  return (
    <section
      data-testid="admin-probe"
      style={{ marginTop: 24, padding: 12, border: '1px dashed #99a', borderRadius: 6 }}
    >
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: '#667', margin: '0 0 8px' }}>
        Admin probe{label ? ` · ${label}` : ''}
      </h3>
      <dl style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, margin: 0 }}>
        {facts.map(([id, value]) => (
          <FactRow key={id} id={id} value={value} />
        ))}
      </dl>
    </section>
  );
}
