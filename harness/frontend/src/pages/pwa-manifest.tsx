import { useEffect, useState, type JSX } from 'react';

import { registerServiceWorker } from '@12-apps/pwa';

/**
 * `@12-apps/pwa`'s request-time half, from the browser (12-23).
 *
 * Two things can only be proven here, in a real browser against the real mount:
 *
 *  1. **The manifest is an ENDPOINT.** A bundle has one `index.html` for every
 *     tenant it serves, so a static `manifest.webmanifest` cannot vary by the
 *     store the visitor is looking at. This page asks for it three times — as two
 *     different tenant domains and as one nobody registered — and prints what came
 *     back, so "one installable app per tenant" is a comparison rather than a
 *     claim. (`x-forwarded-host` is how a reverse proxy states the public host;
 *     whether to honour it is the HOST's call, and future-pay answers it against
 *     verified-domain rows.)
 *
 *  2. **The worker actually registers, at the root.** A worker's default scope is
 *     its script's own directory, so one served from anywhere else silently covers
 *     almost nothing unless `Service-Worker-Allowed: /` came with it. That header
 *     is set by the package's own route and can only be observed by a browser
 *     that accepts or rejects the registration — jsdom has no service worker at
 *     all, and a unit test asserting `register` was called proves only that the
 *     call was made.
 */

/** The two tenant domains the harness backend knows, and one it does not. */
const HOSTS = {
  a: 'loja.harness.test',
  b: 'segunda.harness.test',
  unknown: 'nao-registrada.harness.test',
} as const;

interface ManifestProbe {
  status: number;
  /** The document, or `null` for the 404 (which has an empty body by design). */
  body: Record<string, unknown> | null;
  contentType: string | null;
}

/**
 * One path, three hosts — and the browser's own cache is part of the test.
 *
 * The manifest is cacheable and the URL is identical for every tenant, so the
 * second probe is answered from the first unless the response says the forwarded
 * host is part of the key. That is exactly what happened when this page was first
 * written: the unregistered host came back 200, carrying tenant A's manifest, with
 * no request leaving the tab. `Vary: X-Forwarded-Host` on the package's adapter is
 * the fix, and leaving the fetches cacheable here is what keeps proving it.
 */
async function probeManifest(host: string): Promise<ManifestProbe> {
  const response = await fetch('/manifest.webmanifest', { headers: { 'x-forwarded-host': host } });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    contentType: response.headers.get('content-type'),
  };
}

interface WorkerProbe {
  supported: boolean;
  /** The scope the browser granted — `/` only if the header allowed it. */
  scope: string | null;
  /** What the browser refused with, if it did. */
  error: string | null;
}

/**
 * Register the packaged worker and report what the browser made of it.
 *
 * `registerServiceWorker` is deliberately fire-and-forget and silent — a browser
 * that refuses a worker must still get a working app — so the page asks
 * `navigator.serviceWorker` directly afterwards rather than expecting a return
 * value the package does not give.
 */
async function probeWorker(): Promise<WorkerProbe> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, scope: null, error: null };
  }
  registerServiceWorker({ path: '/sw.js', scope: '/' });
  try {
    const registration = await navigator.serviceWorker.ready;
    return { supported: true, scope: new URL(registration.scope).pathname, error: null };
  } catch (error) {
    return { supported: true, scope: null, error: String(error) };
  }
}

/** One printed fact, so a red spec names the value it read rather than a screenshot. */
function Fact({ label, testId, value }: { label: string; testId: string; value: string }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </>
  );
}

/** A manifest field as text — empty for anything the response did not carry. */
function field(probe: ManifestProbe | undefined, name: string): string {
  const value = probe?.body?.[name];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The three probes, printed side by side: two tenant domains and one nobody
 * registered, on ONE deployment — the claim a static manifest file cannot make.
 */
function ManifestFacts({ probes }: { probes: Record<string, ManifestProbe> }): JSX.Element {
  return (
    <dl data-testid="pwa-manifest-probe" style={{ fontSize: 13 }}>
      <Fact label="tenant A — name" testId="manifest-a-name" value={field(probes.a, 'name')} />
      <Fact label="tenant A — id" testId="manifest-a-id" value={field(probes.a, 'id')} />
      <Fact
        label="tenant A — short_name"
        testId="manifest-a-short-name"
        value={field(probes.a, 'short_name')}
      />
      <Fact
        label="tenant A — content-type"
        testId="manifest-a-content-type"
        value={probes.a?.contentType ?? ''}
      />
      <Fact label="tenant B — name" testId="manifest-b-name" value={field(probes.b, 'name')} />
      <Fact label="tenant B — id" testId="manifest-b-id" value={field(probes.b, 'id')} />
      <Fact
        label="unregistered host — status"
        testId="manifest-unknown-status"
        value={probes.unknown ? String(probes.unknown.status) : ''}
      />
    </dl>
  );
}

/** What the browser made of the packaged worker. */
function WorkerFacts({ worker }: { worker: WorkerProbe | null }): JSX.Element {
  return (
    <dl data-testid="pwa-worker-probe" style={{ fontSize: 13 }}>
      <Fact
        label="supported"
        testId="worker-supported"
        value={worker ? String(worker.supported) : '—'}
      />
      <Fact label="granted scope" testId="worker-scope" value={worker?.scope ?? '—'} />
      <Fact label="error" testId="worker-error" value={worker?.error ?? '—'} />
    </dl>
  );
}

export function PwaManifestPage(): JSX.Element {
  const [manifests, setManifests] = useState<Record<string, ManifestProbe> | null>(null);
  const [worker, setWorker] = useState<WorkerProbe | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([probeManifest(HOSTS.a), probeManifest(HOSTS.b), probeManifest(HOSTS.unknown)])
      .then(([a, b, unknown]) => {
        if (alive) setManifests({ a, b, unknown });
      })
      .catch(() => {
        if (alive) setManifests({});
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Registration is behind a button, not an effect.
   *
   * A worker claiming `/` intercepts every navigation in the page's scope, and a
   * page that registered one on mount would impose that on any spec that merely
   * visited it. Explicit is also closer to what the specs need to assert: the
   * scope the browser granted, at a moment the test chose.
   */
  const register = (): void => {
    void probeWorker().then(setWorker);
  };

  return (
    <section data-testid="pwa-manifest-page">
      <h2>Manifest &amp; service worker</h2>

      {manifests === null ? (
        <p data-testid="pwa-manifest-loading">carregando…</p>
      ) : (
        <ManifestFacts probes={manifests} />
      )}

      <button type="button" data-testid="register-worker" onClick={register}>
        Registrar service worker
      </button>

      <WorkerFacts worker={worker} />
    </section>
  );
}
