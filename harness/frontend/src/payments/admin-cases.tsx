/**
 * The shapes every merchant-settings page repeats: mount the published
 * `PaymentProviderSettings` over a case's own `createAdminStore` world, render
 * the server-truth probe, and — for OAuth cases — the consent panel that
 * REPLACES the component mid-flow plus the host's callback effect.
 *
 * ## The OAuth hop, without losing the world
 *
 * The world lives at CASE level (`useMemo(..., [])` in `AdminSettings`), one
 * level above the consent-panel swap. The authorize URL differs from the
 * current URL only in its FRAGMENT, so the provider hop is a same-document
 * navigation: the settings component unmounts, the world does not. The page
 * watches the hash itself (`useHashQuery`); `?oauth=consent` swaps in the
 * consent panel, `?code=` drives the host callback route, and
 * `?connected=` / `?connectError=` land on the banner logic, which erases the
 * query — the same choreography the origin host's admin performs.
 */
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  PaymentProviderSettings,
  type PaymentProviderSettingsProps,
} from '@12-apps/payments-frontend';

import { callbackUrl, currentSlug } from './admin-extensions';
import { AdminProbe } from './admin-probe';
import { createAdminStore, type AdminStoreSpec, type AdminWorld } from './admin-store';
import type { HarnessCase } from './panel';

type ProviderChange = NonNullable<PaymentProviderSettingsProps['onProviderChange']>;

/** Rewrite this page's hash query in place — a correction, not a navigation. */
function replaceHashQuery(queryString: string): void {
  const hash = queryString ? `#/${currentSlug()}?${queryString}` : `#/${currentSlug()}`;
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  // `replaceState` never fires `hashchange`, and both the shell and
  // `useHashQuery` subscribe to it — tell them the address moved.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** The page's own query — the slug's `?…` half, live across `hashchange`. */
export function useHashQuery(): URLSearchParams {
  const read = (): string => window.location.hash.split('?')[1] ?? '';
  const [raw, setRaw] = useState(read);
  useEffect(() => {
    const onChange = (): void => setRaw(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return useMemo(() => new URLSearchParams(raw), [raw]);
}

type Seeding = { phase: 'pending' | 'ready' } | { phase: 'failed'; detail: string };

/** Gate the mount on the seeding promise — see `createAdminStore`. */
function useSeeding(ready: Promise<void>): Seeding {
  const [state, setState] = useState<Seeding>({ phase: 'pending' });
  useEffect(() => {
    let live = true;
    ready.then(
      () => live && setState({ phase: 'ready' }),
      (error: unknown) => live && setState({ phase: 'failed', detail: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [ready]);
  return state;
}

interface ConnectOutcome {
  connected: string | null;
  connectError: string | null;
}

/**
 * Land the connect outcome ONCE: hold it in state, then erase the query so a
 * reload or a shared link does not replay it — `history.replaceState`, exactly
 * as the production admin does.
 */
function useConnectOutcome(query: URLSearchParams, enabled: boolean): ConnectOutcome {
  const [outcome, setOutcome] = useState<ConnectOutcome>({ connected: null, connectError: null });
  const connected = query.get('connected');
  const connectError = query.get('connectError');
  useEffect(() => {
    if (!enabled || (!connected && !connectError)) return;
    setOutcome({ connected, connectError });
    replaceHashQuery('');
  }, [enabled, connected, connectError]);
  return outcome;
}

/** The `error` name a refusal body carries, or the bare status. */
async function refusalTag(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error ?? String(response.status);
  } catch {
    return String(response.status);
  }
}

async function deliverCallback(
  world: AdminWorld,
  provider: string,
  code: string,
  state: string,
): Promise<void> {
  const response = await world.postCallback(provider, {
    code,
    state,
    redirectUri: callbackUrl(),
    environment: 'SANDBOX',
  });
  replaceHashQuery(
    response.ok ? `connected=${provider}` : `connectError=${await refusalTag(response)}`,
  );
}

/**
 * The host's callback route, driven from the page: on `?code=`, POST
 * `{base}/oauth/callback/{provider}` — on `?connectError=`, nothing at all
 * (the provider refused; there is no code to spend). Each code is spent once.
 */
function useOAuthCallback(world: AdminWorld, query: URLSearchParams, enabled: boolean): void {
  const spent = useRef<Set<string>>(new Set());
  const code = query.get('code');
  const state = query.get('state') ?? '';
  const provider = query.get('provider') ?? '';
  useEffect(() => {
    if (!enabled || !code || spent.current.has(code)) return;
    spent.current.add(code);
    void deliverCallback(world, provider, code, state);
  }, [world, enabled, code, state, provider]);
}

/** The banner half the HOST owns in production, so the harness owns it here. */
function OutcomeBanner({ outcome }: { outcome: ConnectOutcome }): JSX.Element | null {
  if (outcome.connected) {
    return (
      <p role="status" data-testid="payments-connect-success" style={{ color: '#1a6b2f' }}>
        Conta conectada com sucesso.
      </p>
    );
  }
  if (outcome.connectError) {
    return (
      <p role="alert" data-testid="payments-connect-error" style={{ color: '#a02020' }}>
        Não foi possível concluir a conexão ({outcome.connectError}).
      </p>
    );
  }
  return null;
}

/**
 * The fictional provider's consent screen — one of exactly three simulated
 * things in the round trip (with the code string and the network hop). The
 * four controls return by fragment-only navigation, so the world survives.
 */
function ConsentPanel({ world, query }: { world: AdminWorld; query: URLSearchParams }): JSX.Element {
  const state = query.get('state') ?? '';
  const provider = query.get('provider') ?? '';
  const code = `harness-code-${world.mintedStates.length}`;
  const back = (queryString: string): void =>
    window.location.assign(`#/${currentSlug()}?${queryString}`);
  return (
    <section data-testid="admin-oauth-consent" style={{ border: '1px solid #b9a', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Autorizar acesso — {provider}</h2>
      <p>A Loja Harness pede permissão para consultar e criar pagamentos na sua conta.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="admin-oauth-authorize"
          onClick={() => back(`code=${code}&state=${state}&provider=${provider}`)}
        >
          Autorizar
        </button>
        <button
          type="button"
          data-testid="admin-oauth-deny"
          onClick={() => back('connectError=access_denied')}
        >
          Recusar
        </button>
        <button
          type="button"
          data-testid="admin-oauth-tamper"
          onClick={() => back(`code=${code}&state=harness-forged&provider=${provider}`)}
        >
          Voltar com state adulterado
        </button>
        <button
          type="button"
          data-testid="admin-oauth-refuse"
          onClick={() => back(`code=harness-code-refused&state=${state}&provider=${provider}`)}
        >
          Voltar com código recusado
        </button>
      </div>
    </section>
  );
}

/**
 * Controlled selection, kept in the hash query — the contract the production
 * admin implements: `replace` corrects the current entry, anything else
 * pushes. Every call also lands in `world.nav`, which is what makes the
 * `{replace: true}` half of the contract directly assertable.
 */
function providerChangeWriter(world: AdminWorld): ProviderChange {
  return (provider, options) => {
    world.nav.push(`${options?.replace ? 'replace' : 'push'}:${provider ?? '(none)'}`);
    const hash = provider ? `#/${currentSlug()}?provider=${provider}` : `#/${currentSlug()}`;
    const url = `${window.location.pathname}${hash}`;
    if (options?.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    world.fire();
  };
}

export interface AdminSettingsProps {
  spec: AdminStoreSpec;
  /** Probe label — `adminCase` passes the case id. */
  label?: string;
  /** Wire the OAuth surface: `prepareConnect`, consent panel, callback route. */
  connect?: boolean;
  /** Keep selection in the hash query (`?provider=`) — controlled mode. */
  controlled?: boolean;
  /** Passed through to the published component untouched. */
  renderVerification?: PaymentProviderSettingsProps['renderVerification'];
  /** `renderVerification` built over the case's world — for a step that must reach host routes. */
  renderVerificationWith?: (world: AdminWorld) => PaymentProviderSettingsProps['renderVerification'];
  /** Page-owned fixture controls, rendered between the mount and the probe. */
  controls?: (world: AdminWorld) => ReactNode;
}

interface MountArgs {
  props: AdminSettingsProps;
  world: AdminWorld;
  query: URLSearchParams;
  outcome: ConnectOutcome;
}

function SettingsMount({ props, world, query, outcome }: MountArgs): JSX.Element {
  const controlled = props.controlled === true;
  const changeProvider = useMemo(
    () => (controlled ? providerChangeWriter(world) : undefined),
    [controlled, world],
  );
  const verification = props.renderVerificationWith?.(world) ?? props.renderVerification;
  return (
    <div>
      <OutcomeBanner outcome={outcome} />
      {/* The key is the host's post-callback refresh: the callback POST wrote
          through `oauth.complete` AFTER this component's mount-effect fetched
          its view, and nothing inside the component refetches on the outcome.
          Remounting on `connected` makes the fresh mount's `GET /settings`
          strictly follow the write — and hands `initialProvider` its land-once
          moment on a screen whose view can actually show the connection. */}
      <PaymentProviderSettings
        key={outcome.connected ?? 'live'}
        client={world.client}
        prepareConnect={props.connect ? world.prepareConnect : undefined}
        initialProvider={outcome.connected}
        selectedProvider={controlled ? query.get('provider') : undefined}
        onProviderChange={changeProvider}
        renderVerification={verification}
      />
    </div>
  );
}

/** One case's whole body: seeding gate, consent swap, mount, controls, probe. */
export function AdminSettings(props: AdminSettingsProps): JSX.Element {
  // CASE level, one level above the consent-panel swap: the world survives
  // every fragment navigation the flow performs.
  const { world, ready } = useMemo(() => createAdminStore(props.spec), []);
  const seeding = useSeeding(ready);
  const query = useHashQuery();
  const connect = props.connect === true;
  const outcome = useConnectOutcome(query, connect);
  useOAuthCallback(world, query, connect && seeding.phase === 'ready');
  if (seeding.phase === 'pending') {
    return <p data-testid="admin-store-seeding">Preparando a loja…</p>;
  }
  if (seeding.phase === 'failed') {
    return <p data-testid="admin-store-seeding">Falha ao preparar a loja: {seeding.detail}</p>;
  }
  return (
    <div>
      {query.get('oauth') === 'consent' ? (
        <ConsentPanel world={world} query={query} />
      ) : (
        <SettingsMount props={props} world={world} query={query} outcome={outcome} />
      )}
      {props.controls?.(world)}
      <AdminProbe world={world} label={props.label} />
    </div>
  );
}

/** One case of a multi-store page, mounting the settings for its own store. */
export function adminCase(
  id: string,
  label: string,
  spec: AdminStoreSpec,
  extras: Omit<AdminSettingsProps, 'spec' | 'label'> = {},
): HarnessCase {
  return { id, label, render: () => <AdminSettings spec={spec} label={id} {...extras} /> };
}

/**
 * A fixture button issuing ONE raw request at the mount, printing the status
 * under `<testid>-status`. Issued through `world.fetchImpl`, not through the
 * settings client: the client throws on a non-2xx, which would report the
 * refusal by exploding instead of by printing a status.
 */
export function RawRequestButton({
  world,
  testid,
  label,
  method,
  route,
  body,
}: {
  world: AdminWorld;
  testid: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT';
  route: string;
  body?: Record<string, unknown>;
}): JSX.Element {
  const [status, setStatus] = useState('(none)');
  const send = async (): Promise<void> => {
    const response = await world.fetchImpl(`${world.baseUrl}${route}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    setStatus(String(response.status));
  };
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginRight: 12 }}>
      <button type="button" data-testid={testid} onClick={() => void send()}>
        {label}
      </button>
      <output data-testid={`${testid}-status`}>{status}</output>
    </span>
  );
}

/** Releases every probe a `deferred` adapter is holding open. */
export function ReleaseVerifyButton({ world }: { world: AdminWorld }): JSX.Element {
  return (
    <button type="button" data-testid="admin-release-verify" onClick={() => world.releaseVerify()}>
      Liberar verificação
    </button>
  );
}

/**
 * The two `assertReorderOnly` refusals the package's own reorder control can
 * never send (it always permutes the rendered chain), issued raw at the
 * mount. Both land in the shared `admin-priorities-refusal` fact as
 * `"<status> <error>"`.
 */
export function PriorityRefusalButtons({
  world,
  legs,
}: {
  world: AdminWorld;
  legs: { testid: string; label: string; providers: string[] }[];
}): JSX.Element {
  const [refusal, setRefusal] = useState('(none)');
  const put = async (providers: string[]): Promise<void> => {
    const response = await world.fetchImpl(`${world.baseUrl}/settings/priorities`, {
      method: 'PUT',
      body: JSON.stringify({ providers }),
    });
    setRefusal(`${response.status} ${await refusalTag(response)}`);
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
      {legs.map((leg) => (
        <button
          key={leg.testid}
          type="button"
          data-testid={leg.testid}
          onClick={() => void put(leg.providers)}
        >
          {leg.label}
        </button>
      ))}
      <output data-testid="admin-priorities-refusal">{refusal}</output>
    </div>
  );
}
