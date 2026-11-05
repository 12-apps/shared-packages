// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, MerchantSettingsView, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import { connectionBadge, sandboxRefused } from '../components/connection-state';
import { withLiveSandboxWords } from '../locales';
import { isGrant, productionStored } from '../components/to-production';
import { EN_US_PAYMENTS_SETTINGS_COPY } from '../components/settings-en-US';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';
import type { PaymentsSettingsCopy } from '../components/settings-copy';

/**
 * FUT-4432: a connection in its provider's SIMULATED sandbox, on a deployment
 * that sells for real (the server says so: `sandboxRefused`). The header says
 * the store charges nobody, a band under it offers "Conectar em Produção", the
 * activation step is withheld, and the list reads "Modo de teste". Every other
 * state is exactly as before.
 */

const OAUTH = {
  name: 'aurora',
  displayName: 'Aurora',
  urlSlug: 'aurora',
  authMode: 'oauth',
  capabilities: { methods: ['PIX', 'CARD'], activationCharge: true },
  credentialSchema: [{ key: 'token', label: 'Token de acesso', secret: true, required: true }],
} as unknown as ProviderDescriptor;

const KEYS = {
  name: 'banco',
  displayName: 'Banco',
  urlSlug: 'banco',
  authMode: 'credentials',
  // A card, so the host's activation step is runnable and its absence means something.
  capabilities: { methods: ['PIX', 'CARD'] },
  credentialSchema: [{ key: 'clientId', label: 'Client ID', secret: false, required: true }],
} as unknown as ProviderDescriptor;

const GRANT = { accountId: null, accountLabel: null, grantedScopes: [], connectedAt: '2026-11-01T12:00:00Z' };

function config(over: Partial<MaskedProviderConfig> & { provider: string }): MaskedProviderConfig {
  return {
    status: 'VERIFIED',
    enabled: true,
    chargeVerifiedAt: '2026-11-01T12:00:00Z',
    environment: 'SANDBOX',
    environments: { SANDBOX: { token: { configured: true, hint: '••••1234' }, clientId: { configured: true, hint: 'c' } }, PRODUCTION: {} },
    connectedAccount: null,
    sandboxRefused: true,
    ...over,
  } as unknown as MaskedProviderConfig;
}

const NOT_CONNECTED = (provider: string) =>
  config({ provider, status: 'UNVERIFIED', enabled: false, chargeVerifiedAt: null, environments: { SANDBOX: {}, PRODUCTION: {} }, sandboxRefused: false });

interface World {
  descriptor: ProviderDescriptor;
  configs: MaskedProviderConfig[];
  activeProvider?: string | null;
  /** What the view reads as after a removal. */
  after?: MaskedProviderConfig[];
}

function fakeClient(world: World): PaymentsSettingsClient {
  const view = (configs: MaskedProviderConfig[]) =>
    ({ providers: [world.descriptor], configs, activeProvider: world.activeProvider ?? null, providerChain: [] }) as unknown as MerchantSettingsView;
  const disconnectOAuth = vi.fn().mockResolvedValue({ disconnected: true });
  return {
    baseUrl: '/api/admin/acme/payments',
    // After a removal landed the view reads as `after` — what the server now says.
    getSettings: vi.fn(async () => view(disconnectOAuth.mock.results.some((r) => r.type === 'return') && world.after ? world.after : world.configs)),
    getSetupGuide: vi.fn().mockResolvedValue(null),
    verify: vi.fn(),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
    disconnectOAuth,
    setPriorities: vi.fn(),
    setFailoverPolicy: vi.fn(),
    beginOAuth: vi.fn().mockResolvedValue({ url: 'https://provider.test/consent' }),
  } as unknown as PaymentsSettingsClient;
}

interface Mount {
  copy?: PaymentsSettingsCopy;
  prepareConnect?: ((provider: string, environment: string) => Promise<{ state: string; redirectUri: string }>) | null;
  readOnly?: boolean;
}

function mount(world: World, options: Mount = {}) {
  const client = fakeClient(world);
  const prepareConnect = options.prepareConnect === null
    ? undefined
    : (options.prepareConnect ?? vi.fn().mockResolvedValue({ state: 'st_1', redirectUri: 'https://host.test/cb' }));
  render(
    <PaymentProviderSettings
      copy={options.copy ?? PT_BR_PAYMENTS_SETTINGS_COPY}
      client={client}
      initialProvider={world.descriptor.name}
      prepareConnect={prepareConnect as never}
      readOnly={options.readOnly}
      renderVerification={() => <div data-testid="host-activation-step">passo 3</div>}
    />,
  );
  return { client, prepareConnect };
}

const live = () => PT_BR_PAYMENTS_SETTINGS_COPY.liveSandbox!;

/** A promise the test fails by hand — the removal still in flight. */
function pending(): { promise: Promise<never>; reject: (reason: Error) => void } {
  const gate = new AbortController();
  const promise = new Promise<never>((_, settle) => {
    gate.signal.addEventListener('abort', () => settle(gate.signal.reason as Error));
  });
  return { promise, reject: (reason) => gate.abort(reason) };
}
const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sandboxRefused and the list badge', () => {
  const copy = PT_BR_PAYMENTS_SETTINGS_COPY.listBadge;

  it('is the server flag on a connection, and nothing on one that is not connected', () => {
    expect(sandboxRefused(config({ provider: 'aurora' }))).toBe(true);
    expect(sandboxRefused(config({ provider: 'aurora', sandboxRefused: false }))).toBe(false);
    expect(sandboxRefused({ ...NOT_CONNECTED('aurora'), sandboxRefused: true } as MaskedProviderConfig)).toBe(false);
    expect(sandboxRefused(null)).toBe(false);
  });

  it('reads TEST_MODE over ACTIVE and CONNECTED, and keeps Reconectar for a lapsed grant', () => {
    expect(connectionBadge(copy, config({ provider: 'aurora' }))).toMatchObject({ state: 'TEST_MODE', label: 'Modo de teste' });
    expect(connectionBadge(copy, config({ provider: 'aurora', enabled: false }))).toMatchObject({ state: 'TEST_MODE' });
    expect(connectionBadge(copy, config({ provider: 'aurora', status: 'RECONNECT_REQUIRED' }))).toMatchObject({ state: 'RECONNECT' });
  });

  it('is unchanged when not refused, an enabled lapsed grant included', () => {
    expect(connectionBadge(copy, config({ provider: 'aurora', sandboxRefused: false }))).toMatchObject({ state: 'ACTIVE', label: 'Ativo' });
    expect(connectionBadge(copy, config({ provider: 'aurora', sandboxRefused: false, status: 'RECONNECT_REQUIRED' }))).toMatchObject({ state: 'ACTIVE' });
    expect(connectionBadge(copy, NOT_CONNECTED('aurora'))).toMatchObject({ state: 'NOT_CONNECTED' });
  });

  it('falls back to the English word for a host pack that predates it', () => {
    const older = { ...copy };
    delete older.testMode;
    expect(connectionBadge(older, config({ provider: 'aurora' })).label).toBe('Test mode');
  });

  it('draws the outlined chip with its icon on the provider list', async () => {
    const client = fakeClient({ descriptor: OAUTH, configs: [config({ provider: 'aurora' })] });
    render(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={client} />);

    const chip = await screen.findByTestId('payments-provider-badge-aurora');
    expect(chip.textContent).toBe('Modo de teste');
    expect(chip.className).toMatch(/MuiChip-outlined/);
    expect(chip.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('a refused sandbox on an OAuth grant', () => {
  const world = (over: Partial<World> = {}): World => ({
    descriptor: OAUTH,
    configs: [config({ provider: 'aurora', connectedAccount: GRANT as never })],
    after: [NOT_CONNECTED('aurora')],
    ...over,
  });

  it('says the store charges nobody, in the header and in a status band with one primary', async () => {
    mount(world());

    const band = await screen.findByTestId('payments-live-sandbox-band');
    expect(band.getAttribute('role')).toBe('status');
    expect(band.textContent).toContain(live().bandLead);
    expect(band.textContent).toContain(live().bandNobodyPays);
    expect(within(band).getByRole('button', { name: live().bandAction })).toBeTruthy();
    expect(screen.getByTestId('payments-enable-hint').textContent).toBe(live().headerSub);
    expect(screen.getByTestId('payments-enable-state').textContent).toBe(live().headerState);
    expect(screen.getByTestId('payments-enable-state').querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // Reconectar steps down to the inverted primary: the band's is the one primary.
    expect(getComputedStyle(screen.getByRole('button', { name: 'Reconectar' })).backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('withholds the activation step', async () => {
    mount(world());

    await screen.findByTestId('payments-live-sandbox-band');
    await waitFor(() => expect(screen.queryByTestId('host-activation-step')).toBeNull());
  });

  it('says the next provider pays when another one in the chain takes the money', async () => {
    mount(world({ activeProvider: 'other' }));

    const band = await screen.findByTestId('payments-live-sandbox-band');
    expect(band.textContent).toContain(live().bandNextInLine);
    expect(band.textContent).not.toContain(live().bandNobodyPays);
    expect(screen.getByTestId('payments-enable-hint').textContent).toBe(live().headerSubNextInLine);
  });

  it('removes the test grant, then starts the connect in PRODUCTION with no third tap', async () => {
    const { client, prepareConnect } = mount(world());

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(live().toProductionQuestion('Aurora'))).toBeTruthy();
    expect(dialog.textContent).toContain(live().toProductionConsequence('Aurora'));
    expect(dialog.textContent).toContain(live().toProductionAfter);
    expect(dialog.textContent).toContain(live().toProductionIrreversible);
    expect(dialog.textContent).not.toContain(PT_BR_PAYMENTS_SETTINGS_COPY.card.removeRestartsSetup);
    await waitFor(() => expect(within(dialog).queryByTestId('payments-pause-instead')).toBeNull());

    fireEvent.click(within(dialog).getByRole('button', { name: live().toProductionConfirm }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://provider.test/consent'));
    expect(client.disconnectOAuth).toHaveBeenCalledWith('aurora');
    expect(prepareConnect).toHaveBeenCalledWith('aurora', 'PRODUCTION');
    expect(client.beginOAuth).toHaveBeenCalledWith('aurora', expect.objectContaining({ environment: 'PRODUCTION' }));
  });

  it('closes with nothing changed on Cancelar', async () => {
    const { client } = mount(world());

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.disconnectOAuth).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the reason inside it when the removal fails', async () => {
    const { client, prepareConnect } = mount(world());
    vi.mocked(client.disconnectOAuth).mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: live().toProductionConfirm }));

    const error = await screen.findByTestId('payments-disconnect-error');
    expect(screen.getByRole('dialog').contains(error)).toBe(true);
    expect(prepareConnect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('payments-connect-failure')).toBeNull());
  });

  it('lands on the not-connected card with Produção selected when the connect start fails', async () => {
    const prepareConnect = vi.fn().mockRejectedValue(new Error('mint failed'));
    mount(world(), { prepareConnect });

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: live().toProductionConfirm }));

    expect(await screen.findByTestId('payments-connect-failure')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('payments-environment-PRODUCTION').getAttribute('aria-selected')).toBe('true');
    expect(prepareConnect).toHaveBeenCalledWith('aurora', 'PRODUCTION');
  });

  it('disables the button for a viewer who may not change settings', async () => {
    mount(world(), { readOnly: true });

    const button = await screen.findByRole('button', { name: live().bandAction });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('payments-live-sandbox-band').textContent).toContain(live().bandLead);
  });

  it('keeps the band as the one primary over a lapsed grant, with the revoked alert', async () => {
    mount(world({ configs: [config({ provider: 'aurora', status: 'RECONNECT_REQUIRED', connectedAccount: GRANT as never })] }));

    expect(await screen.findByRole('button', { name: live().bandAction })).toBeTruthy();
    expect(screen.getByText(PT_BR_PAYMENTS_SETTINGS_COPY.oauth.revoked)).toBeTruthy();
    expect(getComputedStyle(screen.getByRole('button', { name: 'Reconectar' })).backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('shows the band with no button where this installation cannot connect', async () => {
    mount(world(), { prepareConnect: null });

    const band = await screen.findByTestId('payments-live-sandbox-band');
    await waitFor(() => expect(within(band).queryByRole('button')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('host-activation-step')).toBeNull());
  });

  it('speaks English for a host pack that predates the group', async () => {
    const older: PaymentsSettingsCopy = { ...PT_BR_PAYMENTS_SETTINGS_COPY };
    delete older.liveSandbox;
    mount(world(), { copy: older });

    const band = await screen.findByTestId('payments-live-sandbox-band');
    expect(band.textContent).toContain(EN_US_PAYMENTS_SETTINGS_COPY.liveSandbox!.bandLead);
  });
});

describe('a refused sandbox on pasted keys', () => {
  it('opens the manual path on Produção and never removes anything', async () => {
    const { client } = mount({ descriptor: OAUTH, configs: [config({ provider: 'aurora' })] });

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));

    expect(await screen.findByTestId('payments-environment-PRODUCTION')).toBeTruthy();
    expect(screen.getByTestId('payments-environment-PRODUCTION').getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.disconnectOAuth).not.toHaveBeenCalled();
  });
});

describe('a refused sandbox on a credentials provider', () => {
  it('replaces the sandbox notice with the band, whose button puts the tabs on Produção', async () => {
    mount({ descriptor: KEYS, configs: [config({ provider: 'banco' })] });

    await screen.findByTestId('payments-live-sandbox-band');
    await waitFor(() => expect(screen.queryByTestId('payments-environment-notice-SANDBOX')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('host-activation-step')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: live().bandAction }));

    await waitFor(() => expect(screen.getByTestId('payments-environment-PRODUCTION').getAttribute('aria-selected')).toBe('true'));
  });
});

describe('anything that is not a refused sandbox', () => {
  it('renders exactly as before: no band, today\'s lines and the sandbox notice', async () => {
    mount({ descriptor: KEYS, configs: [config({ provider: 'banco', sandboxRefused: false })] });

    expect(await screen.findByTestId('payments-environment-notice-SANDBOX')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('payments-live-sandbox-band')).toBeNull());
    expect(screen.getByTestId('payments-enable-hint').textContent).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.status.receiving.sub);
    expect(screen.getByTestId('payments-enable-state').textContent).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.status.receiving.state);
    expect(screen.getByTestId('host-activation-step')).toBeTruthy();
  });

  it('keeps Reconectar the primary on an OAuth grant', async () => {
    mount({ descriptor: OAUTH, configs: [config({ provider: 'aurora', sandboxRefused: false, connectedAccount: GRANT as never })] });

    const reconnect = await screen.findByRole('button', { name: 'Reconectar' });
    expect(getComputedStyle(reconnect).backgroundColor).not.toBe('rgb(255, 255, 255)');
    await waitFor(() => expect(screen.queryByTestId('payments-live-sandbox-band')).toBeNull());
  });
});

describe('withLiveSandboxWords', () => {
  it('lays a host\'s own words over the neutral ones, per locale, and keeps every other sentence', () => {
    const packs = withLiveSandboxWords({
      'pt-BR': { liveSandbox: { headerSub: 'Modo de teste: o catálogo não cobra clientes.' } },
      'en-US': { liveSandbox: { bandNobodyPays: 'Shoppers see a closed checkout.' } },
    });

    expect(packs['pt-BR'].liveSandbox?.headerSub).toBe('Modo de teste: o catálogo não cobra clientes.');
    expect(packs['pt-BR'].liveSandbox?.bandLead).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.liveSandbox!.bandLead);
    expect(packs['en-US'].liveSandbox?.bandNobodyPays).toBe('Shoppers see a closed checkout.');
    expect(packs['en-US'].liveSandbox?.headerSub).toBe(EN_US_PAYMENTS_SETTINGS_COPY.liveSandbox!.headerSub);
    expect(packs['pt-BR'].status).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.status);
  });
});

describe('telling an OAuth grant from pasted keys', () => {
  it('is a grant when the identity fields are present, the credentials path otherwise', () => {
    expect(isGrant(config({ provider: 'aurora', connectedAccount: GRANT as never }))).toBe(true);
    expect(isGrant(config({ provider: 'aurora', connectedAccount: null }))).toBe(false);
  });

  it('knows when PRODUCTION credentials are already on record', () => {
    expect(productionStored(config({ provider: 'aurora' }))).toBe(false);
    const both = config({ provider: 'aurora', environments: { SANDBOX: {}, PRODUCTION: { token: { configured: true, hint: '••••9999' } } } as never });
    expect(productionStored(both)).toBe(true);
  });
});

describe('a refused sandbox: the edges of "Conectar em Produção"', () => {
  const grantWorld = (over: Partial<World> = {}): World => ({
    descriptor: OAUTH,
    configs: [config({ provider: 'aurora', connectedAccount: GRANT as never })],
    after: [NOT_CONNECTED('aurora')],
    ...over,
  });

  it('switches a grant that already holds PRODUCTION keys by saving PRODUCTION, and removes nothing', async () => {
    const withKeys = config({
      provider: 'aurora',
      connectedAccount: GRANT as never,
      environments: { SANDBOX: { token: { configured: true, hint: '••••1234' } }, PRODUCTION: { token: { configured: true, hint: '••••9999' } } } as never,
    });
    const { client } = mount(grantWorld({ configs: [withKeys] }));

    const button = await screen.findByRole('button', { name: live().bandAction });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(client.saveCredentials).toHaveBeenCalledTimes(1));
    expect(client.saveCredentials).toHaveBeenCalledWith('aurora', { environment: 'PRODUCTION', fields: {} });
    expect(client.disconnectOAuth).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removes the grant BEFORE it mints the PRODUCTION connect', async () => {
    const { client, prepareConnect } = mount(grantWorld());

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: live().toProductionConfirm }));

    await waitFor(() => expect(prepareConnect).toHaveBeenCalledWith('aurora', 'PRODUCTION'));
    const removed = vi.mocked(client.disconnectOAuth).mock.invocationCallOrder[0] ?? Infinity;
    const minted = vi.mocked(prepareConnect as never as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? -Infinity;
    expect(removed).toBeLessThan(minted);
  });

  it('removes once for a double tap on the confirm', async () => {
    const { client } = mount(grantWorld());

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: live().toProductionConfirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(client.disconnectOAuth).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while a removal is in flight, and shows its failure in the dialog', async () => {
    const { client } = mount(grantWorld());
    const removal = pending();
    vi.mocked(client.disconnectOAuth).mockImplementationOnce(() => removal.promise as never);

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: live().toProductionConfirm }));
    // MUI's Escape handler sits on the modal's root, not on the paper.
    fireEvent.keyDown(dialog.closest('.MuiModal-root') ?? dialog, { key: 'Escape', code: 'Escape' });
    // Longer than the dialog's exit transition, so a dismissal would have unmounted it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    removal.reject(new Error('boom'));

    const error = await screen.findByTestId('payments-disconnect-error');
    expect(screen.getByRole('dialog').contains(error)).toBe(true);
    expect(screen.getByRole('dialog').closest('.MuiModal-hidden')).toBeNull();
  });

  it('still offers pasted keys the Produção tab where this installation cannot connect', async () => {
    mount({ descriptor: OAUTH, configs: [config({ provider: 'aurora' })] }, { prepareConnect: null });

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));

    await waitFor(() => expect(screen.getByTestId('payments-environment-PRODUCTION').getAttribute('aria-selected')).toBe('true'));
  });

  it('draws the confirmation as a bottom sheet on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'), media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }));
    mount(grantWorld());

    fireEvent.click(await screen.findByRole('button', { name: live().bandAction }));

    const sheet = await screen.findByRole('dialog');
    expect(sheet.className).toMatch(/MuiDrawer-paper/);
    expect(sheet.textContent).toContain(live().toProductionConfirm);
  });
});

describe('the failover order with a refused sandbox at its head', () => {
  it('names the first provider that sells, not the refused one', async () => {
    const OTHER = { ...OAUTH, name: 'boreal', displayName: 'Boreal', urlSlug: 'boreal' } as unknown as ProviderDescriptor;
    const configs = [config({ provider: 'aurora', priority: 0 }), config({ provider: 'boreal', priority: 1, sandboxRefused: false })];
    const client = fakeClient({ descriptor: OAUTH, configs });
    vi.mocked(client.getSettings).mockResolvedValue({ providers: [OAUTH, OTHER], configs, activeProvider: 'boreal', providerChain: ['boreal'] } as never);
    render(<PaymentProviderSettings copy={PT_BR_PAYMENTS_SETTINGS_COPY} client={client} />);

    const first = await screen.findByTestId('payments-priority-first');
    expect(screen.getByTestId('payments-priority-item-boreal').contains(first)).toBe(true);
    await waitFor(() => expect(within(screen.getByTestId('payments-priority-item-aurora')).queryByTestId('payments-priority-first')).toBeNull());
  });
});
