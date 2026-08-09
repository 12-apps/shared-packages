import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type {
  MaskedProviderConfig,
  MerchantSettingsView,
  PaymentEnvironment,
  ProviderDescriptor,
} from "@12-apps/payments-backend";

// Everything through the PUBLISHED entry point, deliberately: these stories
// claim to double as the components' contract, and a symbol dropped from
// `index.ts` should fail them the way it would fail a host.
import {
  createPaymentsSettingsClient,
  ProviderConnection,
  ProviderStatusBar,
  statusBadge,
  type PaymentsSettingsClient,
} from "../index";

import {
  createSettingsStoryStore,
  SETTINGS_BASE_URL,
  type SettingsStorySpec,
} from "./settings-store";
import type { SettingsStoryProvider } from "./settings-store-adapter";

/**
 * THE CONNECTION COMPONENTS, one level below the settings page:
 * `ProviderConnection` — the `authMode: 'oauth'` half, whose connection is a
 * BUTTON — and `ProviderStatusBar` + `statusBadge` — the chip vocabulary and
 * the "Recebendo vendas" switch. `Settings.stories.tsx` owns the full-page
 * states; here each component is mounted BARE, with exactly the props a host
 * page hands it, so these stories double as the components' contract.
 *
 * Same rule as every settings story: nothing on screen is hand-answered. The
 * `MaskedProviderConfig` each card renders came over the wire from the real
 * `createSettingsService` + `createPaymentsHttp` + `mountPayments` stack
 * running in the page (`settings-store.ts`), and the writes — disconnect, the
 * enable switch — land there too.
 *
 * One caveat, inherent to the component's contract: clicking "Conectar" runs
 * the REAL `beginOAuth` against the mount and then `window.location.assign`s
 * the story iframe to the fictional consent page (`conta.infinito.exemplo`),
 * which does not exist — on purpose. Every state pinned below is on the NEAR
 * side of that hop; none depends on completing it.
 *
 * PACKAGE FINDING, worth knowing rather than working around: the component
 * hard-codes that `window.location.assign` (`ProviderConnection.tsx`) with no
 * navigation port, so neither a story nor a host can intercept the departure —
 * the one checkout precedent is `ports.navigate` on the buyer factory, and the
 * connect card has no equivalent seam.
 */
const meta: Meta = {
  title: "Merchant/Provider connection",
  parameters: {
    docs: {
      description: {
        component:
          "`ProviderConnection` — connect / reconnect / disconnect, the connected account's " +
          "identity and the proximity-graded expiry caption — and `ProviderStatusBar` + " +
          "`statusBadge` — the status chip and the \"Recebendo vendas\" switch — mounted bare " +
          "against a live `createSettingsService` + `mountPayments` stack running in the page.",
      },
    },
  },
};
export default meta;

// ---------------------------------------------------------------------------
// The host glue: one client over one in-page mount, per story
// ---------------------------------------------------------------------------

/** One fresh world, one client over it — what `SettingsScene` builds, minus the page. */
function settingsClient(spec: SettingsStorySpec): PaymentsSettingsClient {
  const world = createSettingsStoryStore(spec);
  return createPaymentsSettingsClient({ baseUrl: SETTINGS_BASE_URL, fetchImpl: world.fetchImpl });
}

/**
 * The host's OAuth state mint, story-sized — same shape as `settings-host.tsx`
 * and future-pay's `POST …/oauth/prepare`: the CSRF state the component only
 * RELAYS, echoed back visibly in the consent URL the mount answers with.
 */
async function prepareConnect(
  provider: string,
  environment: PaymentEnvironment,
): Promise<{ state: string; redirectUri: string; environment: PaymentEnvironment }> {
  return {
    state: `estado-csrf-${provider}`,
    redirectUri: `https://loja.exemplo/api/payments/oauth/callback/${provider}`,
    environment,
  };
}

/** One provider's slice of the settings view — the exact props a host passes. */
function providerOf(
  view: MerchantSettingsView,
  name: string,
): { descriptor: ProviderDescriptor; config: MaskedProviderConfig | null } {
  const descriptor = view.providers.find((entry) => entry.name === name);
  if (!descriptor) throw new Error(`Connection story: provider ${name} is not in the catalog`);
  return { descriptor, config: view.configs.find((entry) => entry.provider === name) ?? null };
}

/**
 * `ProviderConnection` exactly as `ProviderPanel` embeds it: descriptor and
 * config read from the live view, `onChanged` refetching it — so Desconectar
 * really clears the row and the card re-renders from the mount's answer.
 */
function ConnectionScene(props: { spec: SettingsStorySpec; provider: string }): JSX.Element | null {
  // Built once per mount: a fresh world on every render would refetch — and
  // reseed — after each interaction.
  const client = useMemo(() => settingsClient(props.spec), []);
  const [view, setView] = useState<MerchantSettingsView | null>(null);
  const reload = useCallback(() => {
    void client.getSettings().then(setView);
  }, [client]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (!view) return null;
  const { descriptor, config } = providerOf(view, props.provider);
  return (
    <ProviderConnection
      descriptor={descriptor}
      config={config}
      client={client}
      prepareConnect={prepareConnect}
      onChanged={reload}
    />
  );
}

/** One story = one merchant + the bare connection card of one provider. */
function scene(name: string, spec: SettingsStorySpec, provider: string): StoryObj {
  return {
    name,
    render: () => <ConnectionScene spec={spec} provider={provider} />,
  };
}

// ---------------------------------------------------------------------------
// The catalog — fictional providers only, same cast as Settings.stories
// ---------------------------------------------------------------------------

/** OAuth mode: a connect button, tokens that expire, an account identity. */
const INFINITO: SettingsStoryProvider = {
  name: "infinito",
  displayName: "Infinito Conta",
  authMode: "oauth",
};

/**
 * The identity a completed authorization records (FUT-300): four scopes the
 * component translates to pt-BR, plus one (`repasses.read`) it does NOT know —
 * pinned on purpose, because unknown scopes fall back to the provider's own
 * spelling rather than to a wrong word.
 */
const CONTA_DA_ANA = {
  id: "acct_92817",
  label: "financeiro@lojadaana.com.br",
  scopes: [
    "payments.read",
    "payments.create",
    "payments.refund",
    "accounts.read",
    "repasses.read",
  ],
} as const;

// ---------------------------------------------------------------------------
// ProviderConnection — connect, connected, aging, dead, disconnect
// ---------------------------------------------------------------------------

/**
 * Nothing stored: the invite copy ("nenhuma chave precisa ser copiada") and
 * the `Conectar com Infinito Conta` button. No environment chip yet — only the
 * provider can seal an environment into a grant, and there is no grant.
 *
 * Clicking the button is LIVE: `prepareConnect` mints the CSRF state, the real
 * `beginOAuth` answers with the fictional consent URL carrying that state
 * visibly, and the story iframe navigates there — a dead page on purpose. The
 * pinned state is the one before the hop.
 */
export const ConnectInvitation: StoryObj = scene(
  "Não conectado — o convite para autorizar",
  { providers: [INFINITO] },
  "infinito",
);

/**
 * Connected, and connected AS WHOM (FUT-300): the account identity in bold,
 * the connect date, the granted scopes as chips — four in the owner's words,
 * and `repasses.read` raw, the deliberate fallback for a scope the component
 * does not know. Above them, the `Sandbox (testes)` chip the grant was sealed
 * with; below, the SAFE-grade expiry caption: neutral gray "Autorização válida
 * até …", months out, no emphasis — the warning tones are earned, not default.
 */
export const ConnectedAccount: StoryObj = scene(
  "Conectada — identidade, escopos e validade (grau SAFE)",
  { providers: [{ ...INFINITO, stage: "saved", expiresInDays: 180, account: CONTA_DA_ANA }] },
  "infinito",
);

/**
 * Connected with NO identity block: a grant made before the identity was
 * recorded reports `connectedAccount: null`, and the card says only "Sua conta
 * está conectada" — the state FUT-300 exists to improve on, still a state a
 * host meets. No expiry caption either: `expiresAt` is null, and a connection
 * that cannot lapse gets no line about lapsing.
 */
export const ConnectedLegacyGrant: StoryObj = scene(
  "Conectada sem identidade — concessão antiga",
  { providers: [{ ...INFINITO, stage: "saved" }] },
  "infinito",
);

/**
 * The grant sealed to PRODUCTION: the environment chip drops the reassuring
 * warning tone and the "(testes)" suffix — it reads plain "Produção", because
 * this authorization moves real money and the card must not dress that as the
 * safe case. The seeded row carries `stub: false`, necessarily: the backend
 * never grants stub mode outside SANDBOX.
 */
export const ConnectedProduction: StoryObj = scene(
  "Conectada em Produção — o chip sem tom de teste",
  {
    providers: [
      {
        ...INFINITO,
        stage: "saved",
        environment: "PRODUCTION",
        expiresInDays: 180,
        account: CONTA_DA_ANA,
      },
    ],
  },
  "infinito",
);

/**
 * The proximity-graded expiry caption (FUT-683), NEAR grade: the renewal sweep
 * normally refreshes a grant long before three days out, so an expiry this
 * close means renewal has been failing quietly — and this bold amber caption
 * (`payments-expiry-warning`) is the only warning the owner gets before
 * checkout starts refusing. The date is seeded RELATIVE to the render
 * (`expiresInDays: 3`), so the story can never drift into another grade as the
 * calendar moves.
 */
export const ExpiryNear: StoryObj = scene(
  "Expira em três dias — aviso âmbar (grau NEAR)",
  { providers: [{ ...INFINITO, stage: "saved", expiresInDays: 3, account: CONTA_DA_ANA }] },
  "infinito",
);

/**
 * PAST grade, with the status NOT yet caught up: the grant lapsed yesterday
 * but no sweep has stamped `RECONNECT_REQUIRED`, so there is NO banner — the
 * red caption "A autorização expirou em …" is the only line carrying the news,
 * which is exactly why the caption is graded instead of staying neutral gray.
 * (The banner state is the next story.)
 */
export const ExpiryPast: StoryObj = scene(
  "Expirou e o status não alcançou — aviso vermelho (grau PAST)",
  { providers: [{ ...INFINITO, stage: "saved", expiresInDays: -1, account: CONTA_DA_ANA }] },
  "infinito",
);

/**
 * The grant is dead and the server knows: `RECONNECT_REQUIRED`. The warning
 * banner states the fact and the fix — "A autorização expirou ou foi revogada.
 * Reconecte para voltar a receber pagamentos." — the connect button now reads
 * `Reconectar`, and the PAST-grade caption dates the lapse underneath. The
 * account details stay on screen: this store demonstrably worked and still
 * holds credentials (`isConnected` counts this status on purpose); it is the
 * AUTHORIZATION that died.
 */
export const ReconnectBanner: StoryObj = scene(
  "Autorização caducada — o banner de RECONNECT_REQUIRED",
  { providers: [{ ...INFINITO, stage: "reconnect", expiresInDays: -2, account: CONTA_DA_ANA }] },
  "infinito",
);

/**
 * The disconnect flow, end to end and REAL. Drive it: `Desconectar` opens the
 * confirmation — destructive and irreversible from here, so the dialog spells
 * the consequence ("sua loja deixa de conseguir cobrar imediatamente") —
 * `Cancelar` backs out; confirming runs the real `disconnectOAuth` against the
 * mount, which revokes at the (story) provider and empties the row. The card
 * then re-renders from the mount's answer: back to the connect invite, ready
 * to authorize again.
 */
export const DisconnectFlow: StoryObj = scene(
  "Desconectar — a confirmação e a limpeza reais",
  { providers: [{ ...INFINITO, stage: "proven", expiresInDays: 180, account: CONTA_DA_ANA }] },
  "infinito",
);

// ---------------------------------------------------------------------------
// ProviderStatusBar + statusBadge — the whole chip vocabulary, one row each
// ---------------------------------------------------------------------------

/**
 * One provider per state the service can stand a row in. Two of the stored
 * states (`UNVERIFIED`, `FAILED`) cannot be seeded declaratively — the seed
 * speaks in stages — so the gallery DRIVES them on mount through the real
 * write path (see `StatusBarGallery`).
 *
 * `allowStubMode: false`, necessarily: cometa's row exists to show a probe
 * that FAILED, and under a stub-granting deployment every adapter's probe
 * short-circuits `{ ok: true, 'stub mode' }` — the FAILED verdict is
 * unreachable there by design.
 */
const GALLERY: SettingsStorySpec = {
  allowStubMode: false,
  providers: [
    { name: "nova", displayName: "Nova Pagamentos" },
    { name: "umbra", displayName: "Umbra Pay" },
    {
      name: "cometa",
      displayName: "Cometa Pagamentos",
      probe: {
        ok: false,
        fault: "NOT_FOUND",
        message: "A tag informada não corresponde a nenhuma conta Cometa.",
      },
    },
    { name: "aurora", displayName: "Aurora Pagamentos", stage: "saved" },
    { name: "boreal", displayName: "Boreal Pay", stage: "saved", activationCharge: true },
    { name: "vega", displayName: "Vega Pagamentos", stage: "proven", activationCharge: true },
    // `activationCharge` on purpose: the caption's claim — resuming needs no
    // second charge BECAUSE the proof persists — is only decided by the proof
    // on a provider whose switch demands one. Without the capability the
    // switch is decided by `isConnected` alone and the caption names a rule
    // the row never engages.
    {
      name: "polar",
      displayName: "Polar Conta",
      stage: "proven",
      enabled: false,
      activationCharge: true,
    },
    { name: "infinito", displayName: "Infinito Conta", authMode: "oauth", stage: "reconnect" },
    // The precedence row: the grant died (`RECONNECT_REQUIRED`) on a store
    // whose proof persists (`chargeProven`) — two facts with rival chips, and
    // the badge must pick the money one.
    {
      name: "lyra",
      displayName: "Lyra Conta",
      authMode: "oauth",
      stage: "reconnect",
      chargeProven: true,
      enabled: false,
    },
  ],
};

/** What each row pins, in the order the catalog declares it. */
const GALLERY_ROWS: { provider: string; caption: string }[] = [
  {
    provider: "nova",
    caption: "Nada salvo: não é falha, é um passo por dar — e o interruptor espera a conexão.",
  },
  {
    provider: "umbra",
    caption: "Tag salva, conexão nunca testada (status UNVERIFIED no serviço).",
  },
  {
    provider: "cometa",
    caption:
      "O teste de conexão reprovou (status FAILED) — e mesmo assim NÃO VERIFICADO: quem " +
      "explica é a frase do provedor no formulário; o chip não acusa.",
  },
  {
    provider: "aurora",
    caption:
      "Probe passou (status VERIFIED): CONEXÃO OK — as chaves autenticam, dinheiro ainda " +
      "não caiu. O interruptor está vivo: ligar grava de verdade no serviço.",
  },
  {
    provider: "boreal",
    caption:
      "Probe passou, mas este provedor exige uma cobrança real (activationCharge): " +
      "CONEXÃO OK com o interruptor travado nos 3 passos.",
  },
  {
    provider: "vega",
    caption:
      "Uma cobrança real caiu (chargeVerifiedAt): VERIFICADO — a única palavra verde — " +
      "e recebendo vendas.",
  },
  {
    provider: "polar",
    caption:
      "Comprovado e pausado, num provedor que EXIGE a cobrança (activationCharge): a prova " +
      "persiste, então religar não exige nova cobrança — o interruptor está vivo por causa " +
      "do chargeVerifiedAt, não apesar dele.",
  },
  {
    provider: "infinito",
    caption:
      "A autorização caducou (RECONNECT_REQUIRED): RECONECTAR em vermelho e o interruptor " +
      "segue ligado — ninguém o desligou, a autorização morreu.",
  },
  {
    provider: "lyra",
    caption:
      "A precedência do dinheiro: a autorização caducou E uma cobrança real já caiu — " +
      "VERIFICADO vence o RECONECTAR, porque chargeVerifiedAt supera qualquer status " +
      "armazenado. O aviso de reconectar é do card de conexão, não do chip.",
  },
];

/**
 * Every chip state at once, every one computed by the REAL service — the
 * stages seed `VERIFIED` / proven / `RECONNECT_REQUIRED`, and the two states
 * no seed can declare are driven on mount through the same client the shipped
 * admin uses: a save with no probe lands `UNVERIFIED`; a save whose probe
 * answers `NOT_FOUND` lands `FAILED`.
 *
 * The annotation over each bar prints what the exported `statusBadge` computed
 * for that row, so the story is also the function's contract: three stored
 * states share NÃO VERIFICADO on purpose, `VERIFICADO` outranks everything the
 * moment `chargeVerifiedAt` exists, and only `RECONNECT_REQUIRED` earns red.
 *
 * The switches are LIVE: each one calls the real `setEnabled` and re-renders
 * from the store's answer — turn Aurora on, pause Vega, resume Polar (no
 * second charge required: the proof persists), switch the dead Infinito off.
 * The locked ones cannot fire at all, which is the same gate the server holds.
 */
function StatusBarGallery(): JSX.Element | null {
  // Built once per mount, same reason as ConnectionScene.
  const client = useMemo(() => settingsClient(GALLERY), []);
  const [view, setView] = useState<MerchantSettingsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const seedAndLoad = async (): Promise<void> => {
      await client.saveCredentials("umbra", {
        environment: "SANDBOX",
        fields: { tag: "$umbra-loja" },
      });
      await client.saveCredentials("cometa", {
        environment: "SANDBOX",
        fields: { tag: "$cometa-loja" },
      });
      await client.verify("cometa");
      const settled = await client.getSettings();
      if (active) setView(settled);
    };
    void seedAndLoad();
    return () => {
      active = false;
    };
  }, [client]);

  const toggle = (provider: string, enabled: boolean): void => {
    setBusy(provider);
    void client
      .setEnabled(provider, enabled)
      // A refused write changes nothing; the reload below reports the store's
      // truth either way. PACKAGE FINDING, worth keeping visible: the page's
      // own switch has no equivalent — `EnableBar` (`ProviderPanel.tsx`) runs
      // `setEnabled` in a try/finally with NO catch, so a refused toggle there
      // surfaces nothing to the owner and leaks an unhandled rejection. This
      // gallery drives its own client and works around it; the fix belongs in
      // the package, not here.
      .catch(() => undefined)
      .then(() => client.getSettings())
      .then(setView)
      .finally(() => setBusy(null));
  };

  if (!view) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {GALLERY_ROWS.map((row) => {
        const { descriptor, config } = providerOf(view, row.provider);
        const badge = statusBadge(config, descriptor);
        return (
          <section key={row.provider}>
            <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 4px" }}>
              <code>{`statusBadge → ${badge.label} · ${badge.color}`}</code> — {row.caption}
            </p>
            <ProviderStatusBar
              descriptor={descriptor}
              config={config}
              busy={busy === row.provider}
              onToggle={(enabled) => toggle(row.provider, enabled)}
            />
          </section>
        );
      })}
    </div>
  );
}

export const StatusChipGallery: StoryObj = {
  name: "Chip de status — o vocabulário completo, do serviço real",
  render: () => <StatusBarGallery />,
};
