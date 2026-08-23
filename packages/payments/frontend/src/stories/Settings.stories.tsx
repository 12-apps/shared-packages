import { Box, Button, Stack, Typography } from "@mui/material";
import type { JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

// Internal, deliberately: neither component is on `index.ts`, and both are
// mounted props-only below with the same justification as their stories give —
// the states they pin are unreachable at initial render through the live page.
import { ConfirmCredentialSave } from "../components/ConfirmCredentialSave";
import { EnvironmentNotice } from "../components/EnvironmentTabs";
import type { PaymentProviderSettingsProps } from "../index";

import { SettingsScene } from "./settings-host";
import type { SettingsStorySpec } from "./settings-store";
import { TAG_FIELD, type SettingsStoryProvider } from "./settings-store-adapter";
import { SettingsStoryHost } from "./settings-story-host";

/**
 * THE MERCHANT SETTINGS SURFACE, against a real mount (workstream B).
 *
 * Each story below is a different STORE — a different catalog, a different
 * stage of connection, a different failure — and `PaymentProviderSettings`
 * reacts to it exactly as the deployed admin would: every state on screen was
 * computed by the real `createSettingsService` + `createPaymentsHttp` +
 * `mountPayments` stack running in the page (see `settings-store.ts`), never
 * hand-answered.
 *
 * How to read a story: the writes are LIVE. Typing into a form, saving,
 * toggling "Recebendo vendas", reordering the chain and disconnecting all go
 * over the wire to the in-page mount and re-render from its answer.
 */
const meta: Meta = {
  title: "Merchant/Provider settings",
  parameters: {
    docs: {
      description: {
        component:
          "`PaymentProviderSettings` — catalog, per-provider credential/OAuth pages, " +
          "failover chain and setup walkthrough, driven against a live " +
          "`createSettingsService` + `mountPayments` stack running in the page.",
      },
    },
  },
};
export default meta;

/** One story = one merchant + which page of the settings opens. */
function scene(name: string, spec: SettingsStorySpec, provider: string | null = null): StoryObj {
  return {
    name,
    render: () => <SettingsScene spec={spec} provider={provider} />,
  };
}

// ---------------------------------------------------------------------------
// The catalog — three FICTIONAL providers, one per connection shape
// ---------------------------------------------------------------------------

/** Credentials mode, one money-destination tag (the default schema). */
const AURORA: SettingsStoryProvider = { name: "aurora", displayName: "Aurora Pagamentos" };

/** Credentials mode, several fields — a write-only secret plus a readable id. */
const BOREAL: SettingsStoryProvider = {
  name: "boreal",
  displayName: "Boreal Pay",
  credentialSchema: [
    { key: "apiKey", label: "Chave secreta (API key)", secret: true, required: true },
    { key: "merchantId", label: "Identificador da conta", secret: false, required: true },
  ],
  stored: { apiKey: "sk_sandbox_7c1d9e4b2a63", merchantId: "conta_10293" },
};

/** OAuth mode: a connect button, tokens that expire, an account identity. */
const INFINITO: SettingsStoryProvider = {
  name: "infinito",
  displayName: "Infinito Conta",
  authMode: "oauth",
};

/** The identity a completed authorization records (FUT-300). */
const CONTA_DA_ANA = {
  id: "acct_92817",
  label: "financeiro@lojadaana.com.br",
  scopes: ["payments.read", "payments.create", "payments.refund", "accounts.read"],
} as const;

// ---------------------------------------------------------------------------
// The catalog view
// ---------------------------------------------------------------------------

/**
 * A brand-new store: every provider fresh, one card per adapter with the
 * "Não conectado" badge, and NO chain box above them — there is no order to
 * argue about until something is enabled.
 */
export const FreshCatalog: StoryObj = scene("Catálogo — loja nova, nada conectado", {
  providers: [AURORA, BOREAL, INFINITO],
});

/**
 * All four card badges (`connectionBadge`) at once, each computed by the real
 * service from a differently-staged row: nothing stored ⇒ "Não conectado";
 * saved but switched off ⇒ "Conectado" (a connection is not a rotation);
 * proven and on ⇒ "Ativo" (the only green — money can move); the grant dead
 * with the switch still up ⇒ "Reconectar" in red, because `enabled` is checked
 * FIRST and only a not-enabled row ever shows the error color.
 *
 * Exactly ONE provider is enabled, so the chain box above the catalog stays
 * hidden on purpose (`ProviderList` renders it only past one entry): with a
 * single active provider there is no order to argue about.
 */
export const CatalogBadges: StoryObj = scene("Catálogo — os quatro selos de conexão", {
  providers: [
    AURORA,
    { ...BOREAL, stage: "saved" },
    { name: "vega", displayName: "Vega Pagamentos", stage: "proven" },
    { ...INFINITO, stage: "reconnect", enabled: false },
  ],
});

// ---------------------------------------------------------------------------
// The credentials path, stage by stage
// ---------------------------------------------------------------------------

/**
 * Credentials on record and the probe passed. The chip deliberately says
 * CONEXÃO OK, not VERIFICADO — the probe only proves the keys authenticate,
 * and the green word is reserved for money actually landing. The secret shows
 * as its `••••`-hint (write-only), the readable id in full, and Salvar is dead
 * until something is typed.
 */
export const SavedVerified: StoryObj = scene(
  "Credenciais salvas — probe passou (CONEXÃO OK)",
  { providers: [{ ...BOREAL, stage: "saved" }] },
  "boreal",
);

/**
 * A real charge has landed: VERIFICADO in green, "Recebendo vendas" on, and
 * the finished credential folded into its one-line summary row — still
 * legible, no longer one keystroke from being changed.
 */
export const ProvenEnabled: StoryObj = scene(
  "Comprovado por cobrança — VERIFICADO e recebendo vendas",
  { providers: [{ ...AURORA, stage: "proven", activationCharge: true }] },
  "aurora",
);

/**
 * The dirty-state rule: Salvar starts DISABLED and only wakes once a field is
 * touched — saving an untouched form is not a free no-op (it would reset the
 * connection to UNVERIFIED), so the button refuses to exist as a trap. Type a
 * tag shaped like `$loja` and the button comes alive; break the shape and it
 * dies again (`pattern`).
 */
export const ManualFormDirtyState: StoryObj = scene(
  "Formulário manual — Salvar espera você digitar",
  { providers: [AURORA] },
  "aurora",
);

/**
 * The warning BEFORE the owner types, on a store that has already proved it
 * can receive (`payments-reverify-warning`): saving new credentials invalidates
 * the proof and drops the provider out of rotation until a fresh activation
 * charge lands — correct, invisible, and worth saying before the typo-fix
 * begins rather than after the storefront goes quiet.
 *
 * A MULTI-FIELD schema on purpose: a proven single-field provider folds into
 * its summary row (the warning then appears only after Alterar), but a form of
 * two fields has no one-line summary, so the fields — and this warning — are
 * the resting state.
 */
export const ReverifyWarningAtRest: StoryObj = scene(
  "Aviso antes de trocar credenciais comprovadas",
  { providers: [{ ...BOREAL, stage: "proven" }] },
  "boreal",
);

/**
 * The last look at the value that decides WHO GETS PAID, quoted back large in
 * the face it will be read in.
 *
 * PINNED PROPS-ONLY, deliberately: through the real mount this dialog exists
 * only between clicking Salvar and answering it — click-state inside
 * `ProviderForm`, unreachable at initial render. The interactive path is one
 * story up: in "Formulário manual", type a tag and press Salvar, and this
 * exact dialog opens over the same live mount.
 */
export const ConfirmMoneyDestination: StoryObj = {
  name: "Confirmação — o campo que decide quem recebe",
  render: () => (
    <SettingsStoryHost>
      <ConfirmCredentialSave
        pending={{ spec: TAG_FIELD, value: "$loja-da-ana" }}
        busy={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    </SettingsStoryHost>
  ),
};

// ---------------------------------------------------------------------------
// The probe, failing each way it can fail
// ---------------------------------------------------------------------------

/**
 * The credential names no account. Drive it: type any well-shaped tag, press
 * Salvar and confirm — the save lands, the automatic probe runs against the
 * mount, and the adapter's OWN sentence comes back in a red alert while the
 * chip stays NÃO VERIFICADO (a store that mistyped a tag has not "failed", it
 * has a step still to finish).
 *
 * `allowStubMode: false`, necessarily: under a stub-granting deployment every
 * adapter's probe short-circuits `{ ok: true, 'stub mode' }` without asking the
 * acquirer anything, so a FAILED verdict is unreachable there by design. This
 * store is the deployment where the probe really runs.
 */
export const VerifyFails: StoryObj = scene(
  "Testar conexão — a tag não corresponde a nenhuma conta",
  {
    allowStubMode: false,
    providers: [
      {
        ...AURORA,
        probe: {
          ok: false,
          fault: "NOT_FOUND",
          message:
            "A tag informada não corresponde a nenhuma conta Aurora. " +
            "Confira a Tag de recebimento no aplicativo, em Perfil.",
        },
      },
    ],
  },
  "aurora",
);

/**
 * The probe never got an answer — an OUTAGE, not a rejection. The alert is
 * amber, accuses nobody of a typo, and carries the only control that helps:
 * "Testar conexão" again. Nothing is persisted about the credentials (the
 * probe learned nothing about them). Same driving steps — and the same
 * `allowStubMode: false` necessity — as the story above.
 */
export const VerifyUnreachable: StoryObj = scene(
  "Testar conexão — o provedor fora do ar (tente de novo)",
  {
    allowStubMode: false,
    providers: [
      {
        ...AURORA,
        probe: {
          ok: false,
          fault: "UNREACHABLE",
          message:
            "O provedor Aurora não respondeu. A tag salva pode estar perfeita — " +
            "tente de novo em instantes.",
        },
      },
    ],
  },
  "aurora",
);

// ---------------------------------------------------------------------------
// The two gates ahead of the page, and the environment band
// ---------------------------------------------------------------------------

/**
 * The `/settings` read failed: the page's error gate
 * (`PaymentProviderSettings`' red alert) instead of a blank screen. The shim
 * is the HOST's outage (`settingsRead: "failing"`, `settings-host.tsx`) — the
 * live mount cannot be asked to refuse its own view read.
 *
 * PACKAGE FINDING, documented rather than restyled: the alert prints the
 * client error's message raw, and `createPaymentsSettingsClient` throws the
 * response BODY verbatim — so a merchant reads an English JSON envelope
 * (`{"error":"indisponível","code":"SERVER_ERROR"}`) on a pt-BR screen. The
 * sentence belongs to the package to fix, not to a story to hide.
 */
export const SettingsReadFailed: StoryObj = {
  name: "Falha ao carregar — o portão de erro",
  render: () => <SettingsScene settingsRead="failing" />,
};

/**
 * The `/settings` read has not answered: the loading gate
 * (`payments-settings-loading`) — the one frame every visit starts on, pinned
 * by a read that never settles.
 */
export const SettingsReadPending: StoryObj = {
  name: "Carregando — o portão de espera",
  render: () => <SettingsScene settingsRead="pending" />,
};

/**
 * The store charges in PRODUCTION: the panel opens on the Produção tab —
 * `config.environment` decides, not a default — and the full-bleed band goes
 * amber: "Produção — dinheiro real. Tudo o que você fizer aqui vale para as
 * vendas da loja." The seeded row carries `stub: false`, necessarily: the
 * backend derives stub mode and never grants it outside SANDBOX.
 *
 * Drive it: click the Sandbox tab and the band flips to the info tone AND
 * gains the other-environment clause — "Hoje a loja está usando Produção" —
 * because the tab on screen stops being the one checkout charges with.
 */
export const ProductionEnvironment: StoryObj = scene(
  "Ambiente Produção — a faixa de dinheiro real",
  { providers: [{ ...BOREAL, stage: "proven", environment: "PRODUCTION" }] },
  "boreal",
);

/**
 * The other-environment clause on its own, both directions. PINNED PROPS-ONLY,
 * deliberately (same rule as the confirmation dialog above): through the live
 * page this clause exists only after a tab click — the panel always opens on
 * the ACTIVE environment, where the clause has nothing to say. The interactive
 * path is one story up.
 */
export const EnvironmentElsewhereNote: StoryObj = {
  name: "Aviso de ambiente — a loja usa o outro",
  render: () => (
    <SettingsStoryHost>
      <Stack spacing={2}>
        <EnvironmentNotice environment="SANDBOX" active="PRODUCTION" />
        <EnvironmentNotice environment="PRODUCTION" active="SANDBOX" />
      </Stack>
    </SettingsStoryHost>
  ),
};

// ---------------------------------------------------------------------------
// The OAuth path
// ---------------------------------------------------------------------------

/**
 * Connected, and connected AS WHOM: the account identity, the connect date,
 * the granted scopes as pt-BR chips, the environment sealed into the grant,
 * and the neutral "válido até" caption (the expiry is months out — SAFE
 * grade). Desconectar opens its own confirmation and really clears the row
 * through the mount.
 */
export const OAuthConnected: StoryObj = scene(
  "Conta OAuth conectada — identidade, escopos, validade",
  {
    providers: [{ ...INFINITO, stage: "saved", expiresInDays: 180, account: CONTA_DA_ANA }],
  },
  "infinito",
);

/**
 * The proximity-graded expiry warning (FUT-683), NEAR grade: the renewal
 * sweep normally refreshes a grant long before this — an expiry three days
 * out means renewal has been failing quietly, and this bold amber caption
 * (`payments-expiry-warning`) is the only warning the owner gets before
 * checkout starts refusing. The PAST grade is in the reconnect story below.
 */
export const OAuthExpiring: StoryObj = scene(
  "Autorização expirando — o aviso graduado por proximidade",
  {
    providers: [{ ...INFINITO, stage: "proven", expiresInDays: 3, account: CONTA_DA_ANA }],
  },
  "infinito",
);

/**
 * The grant died: RECONNECT_REQUIRED. The chip goes red RECONECTAR (the one
 * not-connected state that is NEWS rather than a step), the banner says what
 * happened and what to do, and the lapsed expiry renders in the PAST grade.
 * The switch still reads "Recebendo vendas" — nobody turned it off, the
 * AUTHORIZATION lapsed — which is exactly why the server's chain routes
 * around the row instead of trusting `enabled`.
 */
export const ReconnectRequired: StoryObj = scene(
  "Conexão expirada — banner e chip RECONECTAR",
  {
    providers: [{ ...INFINITO, stage: "reconnect", expiresInDays: -2, account: CONTA_DA_ANA }],
  },
  "infinito",
);

/**
 * The same OAuth provider on a deployment that registered NO provider
 * application (`prepareConnect` omitted — the host knob, not a store state):
 * there is no working connect button to offer, so the panel says so in an info
 * alert and falls back to the manual credential form, bare — no accordion,
 * because the form is now the only path rather than the advanced one. The
 * docstring on `OAuthPanel` names exactly this deployment.
 */
export const OAuthWithoutConnectSeam: StoryObj = {
  name: "OAuth sem botão de conexão — o fallback manual",
  render: () => <SettingsScene spec={{ providers: [INFINITO] }} provider="infinito" withPrepareConnect={false} />,
};

/**
 * The connect branch with a walkthrough, un-buried (FUT-691): the guide and
 * "Testar conexão" render OUTSIDE the manual-credentials disclosure — the
 * connect card says no key needs copying, so nothing in there could ever be
 * found — while the credential FORM stays folded behind it. The guide came
 * over the wire with this store's progress (connected, unproven), so it opens
 * on the step still owed, not on step 1. The probe button is LIVE: clicking it
 * runs the real verify against the mount.
 *
 * A distinct provider name (`polaris`), so the confirm step's per-store
 * browser state never bleeds between guide stories.
 */
export const OAuthGuideUnburied: StoryObj = scene(
  "Conta OAuth conectada — guia e Testar conexão à vista",
  {
    providers: [
      {
        ...INFINITO,
        name: "polaris",
        displayName: "Polaris Conta",
        guide: true,
        stage: "saved",
        expiresInDays: 180,
        account: CONTA_DA_ANA,
      },
    ],
  },
  "polaris",
);

// ---------------------------------------------------------------------------
// The failover chain
// ---------------------------------------------------------------------------

/**
 * Three providers proven and enabled: the chain renders above the catalog,
 * names who is tried FIRST in prose, and reorders live — the arrows (and
 * drag) send the WHOLE order to the real `setPriorities`, which re-ranks and
 * answers with the view the list re-renders from. The decline-cascade switch
 * below it writes the real failover policy the same way.
 */
export const FailoverChain: StoryObj = scene("Fila de tentativa — três provedores, reordenável", {
  providers: [
    { ...AURORA, stage: "proven", activationCharge: true },
    { ...BOREAL, stage: "proven" },
    { ...INFINITO, stage: "proven", expiresInDays: 200, account: CONTA_DA_ANA },
  ],
  chain: ["aurora", "boreal", "infinito"],
});

// ---------------------------------------------------------------------------
// The setup walkthrough
// ---------------------------------------------------------------------------

/**
 * The provider's onboarding guide, open on step 1 for a fresh store: the
 * stepper, the section prose with its dashboard button and warning callout,
 * and — inside the same card — the live credential field the step is about,
 * with its Salvar. The guide came over the wire (`GET /settings/guides/…`),
 * interpolated with this merchant's webhook URL by the mount's
 * `setupContextFor`.
 */
export const SetupGuideOpen: StoryObj = scene(
  "Guia de configuração — passo 1 aberto",
  { providers: [{ ...AURORA, guide: true }] },
  "aurora",
);

/**
 * The guide one stage later, on the step only the OWNER can answer: the tag
 * is saved (its DoneRow sits above the card), and step 2 holds the
 * walkthrough until the owner presses the confirm button — no API reports the
 * provider-side switch, so the claim is theirs to make. Confirming advances
 * the guide; the browser remembers the answer per store, exactly as it does
 * for a real owner.
 *
 * A distinct provider name (`vega`), so confirming here never bleeds into the
 * other guide story's state.
 */
export const SetupGuideConfirmStep: StoryObj = scene(
  "Guia de configuração — o passo que só o dono confirma",
  {
    providers: [{ ...AURORA, name: "vega", displayName: "Vega Pagamentos", guide: true, stage: "saved" }],
  },
  "vega",
);

// ---------------------------------------------------------------------------
// The activation step — the HOST's card in the `renderVerification` slot
// ---------------------------------------------------------------------------

/** The slot's whole context type, straight off the component's own prop. */
type ActivationContext = Parameters<
  NonNullable<PaymentProviderSettingsProps["renderVerification"]>
>[0];

/**
 * A stand-in for the origin host's pay-R$1,01-and-activate card: the PACKAGE owns
 * only WHERE this appears and WHICH facts it is handed, so the story's card
 * prints those facts verbatim — it is the slot's contract made visible, not a
 * copy of any host's UI. A real host renders nothing visible when `hidden`
 * (the step still mounts, to resume an outstanding charge); the stand-in stays
 * visible on purpose, because the fact it reports IS the story.
 */
function StoryActivationCard(ctx: ActivationContext): JSX.Element {
  const fact = (label: string, value: boolean): JSX.Element => (
    <Typography key={label} variant="caption" component="span" sx={{ mr: 1.5 }}>
      {label}: <code>{String(value)}</code>
    </Typography>
  );
  return (
    <Box
      data-testid="story-activation-slot"
      sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 1.5 }}
    >
      <Typography variant="subtitle2">
        Passo de ativação do host — {ctx.displayName}
      </Typography>
      <Box sx={{ my: 0.5 }}>
        {fact("conectado", ctx.connected)}
        {fact("comprovado", ctx.proven)}
        {fact("bloqueado", ctx.blocked)}
        {fact("oculto", ctx.hidden)}
      </Box>
      {ctx.proven ? (
        <Typography variant="body2" data-testid="story-activation-proven">
          Cobrança de ativação já comprovada — o host confirma, nunca cobra de novo.
        </Typography>
      ) : ctx.connected && !ctx.blocked ? (
        <Button size="small" variant="contained" data-testid="story-activation-pay">
          Pagar R$ 1,01 e ativar (o endpoint é do host)
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {ctx.blocked
            ? "Botão de pagar retido: um passo anterior ainda está aberto."
            : "Nada para cobrar ainda — conecte o provedor primeiro."}
        </Typography>
      )}
    </Box>
  );
}

const renderActivation: PaymentProviderSettingsProps["renderVerification"] = (ctx) => (
  <StoryActivationCard {...ctx} />
);

/**
 * The slot on a CONNECTED, unproven store — the state the step exists for:
 * `connected` (credentials the probe reached), `proven` false, nothing
 * blocking, so the host's pay button is offered. On the credentials branch the
 * card renders under the form, and only on a tab whose environment actually
 * stores the credentials it would charge through.
 *
 * The two callbacks are wired live (`onVerified` → reload, `onSetupIncomplete`
 * → withdraw the owner's step-2 confirmation) but cannot fire from a story:
 * the settings mount refuses to charge by design, which is exactly the
 * boundary that makes this slot the HOST's.
 */
export const ActivationSlotConnected: StoryObj = {
  name: "Passo de ativação — conectado, pronto para cobrar",
  render: () => (
    <SettingsScene
      spec={{ providers: [{ ...AURORA, stage: "saved", activationCharge: true }] }}
      provider="aurora"
      renderVerification={renderActivation}
    />
  ),
};

/**
 * The slot once the charge has LANDED: `proven`, so the card is a
 * confirmation, never the pay button again — the button reappearing after a
 * reload is what once made an owner pay four times. `hidden` is forced false
 * here whatever the walkthrough says: with the proof stamped, this step IS the
 * confirmation and the guide has nothing left to show.
 */
export const ActivationSlotProven: StoryObj = {
  name: "Passo de ativação — comprovado, vira confirmação",
  render: () => (
    <SettingsScene
      spec={{ providers: [{ ...AURORA, stage: "proven", activationCharge: true }] }}
      provider="aurora"
      renderVerification={renderActivation}
    />
  ),
};

/**
 * The slot while the walkthrough still holds an earlier step: the guide's
 * confirm question is unanswered, so the context arrives `blocked` (withhold
 * the pay button — a new charge must not be offered) AND `hidden` (an earlier
 * step is the one on screen). The step still renders — unmounting it is how a
 * payment already made stops being confirmable — which is why the contract is
 * two booleans and not a conditional mount.
 *
 * A provider name no other guide story uses (`sirius`): the owner's step-2
 * answer persists per store+provider in the browser, and sharing a name would
 * let one story's confirmation bleed into this one's blocked state.
 */
export const ActivationSlotBlocked: StoryObj = {
  name: "Passo de ativação — bloqueado pelo passo 2",
  render: () => (
    <SettingsScene
      spec={{
        providers: [
          {
            name: "sirius",
            displayName: "Sirius Pagamentos",
            guide: true,
            stage: "saved",
            activationCharge: true,
          },
        ],
      }}
      provider="sirius"
      renderVerification={renderActivation}
    />
  ),
};
