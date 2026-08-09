/**
 * THE PROVIDER HALF of a merchant-settings story: one local, vendor-free
 * adapter per declared entry — the catalog `PaymentProviderSettings` renders
 * its cards, credential forms, connect buttons and walkthroughs from.
 *
 * ## Why this is not a mock
 *
 * Every state the settings page shows is computed SERVER-side — the masked
 * hints, the status vocabulary, the chain, what a save invalidates, what a
 * probe may persist. A story that answered `getSettings` from a hand-built
 * `MerchantSettingsView` literal would freeze all of that at whatever the
 * author believed, which is the FUT-740 failure one surface over. So the
 * stories run the REAL `createSettingsService` + `createPaymentsHttp` +
 * `mountPayments` stack (see `settings-store.ts`); what a story declares HERE
 * is only what a browser genuinely cannot have — the provider adapters at the
 * far end of the merchant's credentials.
 *
 * ## No vendor subpaths, no vendor names
 *
 * Only `@12-apps/payments-backend`'s ROOT entry is imported: the adapter
 * subpaths (`./providers/*`) reach for `node:crypto` and would not survive
 * bundling. And every provider is FICTIONAL (`aurora`, `boreal`, `infinito`) —
 * a story about the RECONNECT banner is a story about the state machine, never
 * about one vendor.
 */
import type {
  CredentialFieldSpec,
  PaymentEnvironment,
  PaymentProviderAdapter,
  ProbeFault,
  ProviderAuthMode,
  ProviderSetupGuide,
  SetupGuideContext,
  SetupSection,
} from "@12-apps/payments-backend";

import { CHECKOUT_CONFIRM_ACTION } from "../components/SetupGuideSection";

/** How far one provider's connection has got — what the story seeds. */
export type SettingsStage = "fresh" | "saved" | "proven" | "reconnect";

/** One provider in the merchant's catalog, as the story declares it. */
export interface SettingsStoryProvider {
  /** Opaque, FICTIONAL key. Never a real vendor's name. */
  name: string;
  /** Human name on cards and headers. Defaults to the name itself. */
  displayName?: string;
  /** Paste-credentials form (default) or OAuth connect button. */
  authMode?: ProviderAuthMode;
  /**
   * Where this connection stands:
   *
   *   - `fresh`     nothing stored (default) — the empty form / bare connect
   *   - `saved`     credentials on record, probe passed ⇒ status `VERIFIED`
   *   - `proven`    a real charge landed ⇒ `chargeVerifiedAt`, in the chain
   *   - `reconnect` the OAuth grant died ⇒ `RECONNECT_REQUIRED`
   */
  stage?: SettingsStage;
  /**
   * The environment the seeded connection is ACTIVE in (default SANDBOX): the
   * tab the panel opens on, the slot the credentials sit in, and — because
   * `applySaveCredentials` only ever stamps `stub` for SANDBOX — whether the
   * row may run the deterministic stub at all.
   */
  environment?: PaymentEnvironment;
  /**
   * A real charge landed at some point (`chargeVerifiedAt`), independent of
   * `stage` — the proof PERSISTS, so a `reconnect` row can still carry it.
   * That combination is what pins `statusBadge`'s precedence rule: VERIFICADO
   * outranks every stored status the moment the proof exists.
   */
  chargeProven?: boolean;
  /** The credential form. Default: the single money-destination tag. */
  credentialSchema?: CredentialFieldSpec[];
  /**
   * SANDBOX values already on record (for `stage` ≠ fresh). Derived from the
   * schema when omitted; spell them out when a story reads one back.
   */
  stored?: Record<string, string>;
  /**
   * Gate "Recebendo vendas" behind a real charge
   * (`capabilities.activationCharge`) instead of behind the probe alone.
   */
  activationCharge?: boolean;
  /** What "Testar conexão" answers. Omitted ⇒ the probe passes. */
  probe?: { ok: boolean; message?: string; fault?: ProbeFault };
  /** Ship the onboarding walkthrough (the adapter's `setupGuide`). */
  guide?: boolean;
  /** OAuth grant expiry, in days from the render (negative = already lapsed). */
  expiresInDays?: number;
  /** WHO authorized — the connected-account card's identity (FUT-300). */
  account?: { id?: string; label?: string; scopes?: readonly string[]; connectedAt?: string };
  /** Override the stage's enablement (a proven provider paused, say). */
  enabled?: boolean;
}

/**
 * The field that decides WHERE THE MONEY GOES — the catalog's default
 * credential, shaped like a receiving handle: one required, readable-back
 * value with `confirmOnSave`, so a story exercises the dirty-state rule, the
 * collapsed summary AND the read-it-back dialog with no extra setup.
 */
export const TAG_FIELD: CredentialFieldSpec = {
  key: "tag",
  label: "Tag de recebimento",
  secret: false,
  required: true,
  mono: true,
  confirmOnSave: true,
  placeholder: "$sualoja",
  helperText: "A tag aparece no aplicativo do provedor, em Perfil.",
  pattern: "^\\$[a-z0-9][a-z0-9._-]*$",
};

/**
 * OAuth providers keep a manual fallback behind the disclosure — stores
 * connected before Connect existed still hold a pasted token, write-only.
 */
const TOKEN_SCHEMA: CredentialFieldSpec[] = [
  { key: "accessToken", label: "Token de acesso", secret: true, required: true },
];

function schemaFor(spec: SettingsStoryProvider): CredentialFieldSpec[] {
  if (spec.credentialSchema) return spec.credentialSchema;
  return spec.authMode === "oauth" ? TOKEN_SCHEMA : [TAG_FIELD];
}

/**
 * The identity facts the OAuth exchange records beside the tokens — the
 * reserved field keys `connectedAccountFrom` copies out to the client
 * (`accountId`, `accountLabel`, `scope`, `connectedAt`).
 */
function identityFields(spec: SettingsStoryProvider): Record<string, string> {
  const account = spec.account;
  if (!account) return {};
  return {
    ...(account.id ? { accountId: account.id } : {}),
    ...(account.label ? { accountLabel: account.label } : {}),
    ...(account.scopes?.length ? { scope: account.scopes.join(" ") } : {}),
    connectedAt: account.connectedAt ?? "2026-06-28T14:10:00.000Z",
  };
}

/**
 * The grant's expiry, relative to the RENDER rather than fixed: the proximity
 * grades (`SAFE`/`NEAR`/`PAST`) are computed against `Date.now()`, so a pinned
 * date would silently migrate between grades as the calendar moved.
 */
export function oauthExpiryOf(spec: SettingsStoryProvider): Date | null {
  if (spec.expiresInDays === undefined) return null;
  return new Date(Date.now() + spec.expiresInDays * 24 * 60 * 60 * 1000);
}

/** The credential set a non-fresh row's active environment holds, when the story spells none. */
export function seededCredentialFields(spec: SettingsStoryProvider): Record<string, string> {
  const env = (spec.environment ?? "SANDBOX").toLowerCase();
  if (spec.authMode === "oauth") {
    return { accessToken: `tok_${spec.name}_${env}`, ...identityFields(spec) };
  }
  if (spec.stored) return { ...spec.stored };
  return Object.fromEntries(
    schemaFor(spec)
      .filter((field) => field.required)
      .map((field) => [
        field.key,
        field.secret ? `chave_${spec.name}_${env}_9f4a` : `$${spec.name}-matriz`,
      ]),
  );
}

/** The OAuth block — present only on `authMode: 'oauth'` adapters. */
function storyOAuth(spec: SettingsStoryProvider): NonNullable<PaymentProviderAdapter["oauth"]> {
  const tokens = () => ({
    fields: { accessToken: `tok_${spec.name}_renovado`, ...identityFields(spec) },
    expiresAt: oauthExpiryOf(spec),
  });
  return {
    // The STATE is the host's (`prepareConnect` minted it) and travels back
    // verbatim — that round trip is the whole CSRF contract, so the fictional
    // consent URL carries it visibly. Clicking Conectar in a story really does
    // navigate there; the page at the far end is imaginary on purpose.
    async buildAuthorizeUrl(_app, ctx) {
      const redirect = encodeURIComponent(ctx.redirectUri);
      return {
        url: `https://conta.${spec.name}.exemplo/autorizar?state=${ctx.state}&redirect_uri=${redirect}`,
        state: ctx.state,
      };
    },
    async exchangeCode() {
      return tokens();
    },
    async refresh() {
      return tokens();
    },
    // Instant and silent, so Desconectar's LOCAL cleanup is the whole story —
    // which is the contract anyway: a failed revoke never blocks it.
    async revoke() {
      return undefined;
    },
  };
}

/** Stage ids double as section ids — that pairing is how the guide advances. */
const STAGES = [
  { id: "conta", label: "Conectar a conta" },
  { id: "habilitar", label: "Habilitar cobranças" },
  { id: "vendas", label: "Ativar as vendas" },
] as const;

function connectSection(spec: SettingsStoryProvider): SetupSection {
  return {
    id: "conta",
    title: "Passo 1 · Informe sua Tag de recebimento",
    intro: "A tag identifica a conta que recebe as vendas desta loja.",
    steps: [
      {
        text: "Abra o aplicativo do provedor e copie a tag da conta.",
        button: { label: "Ver a minha tag", url: `https://conta.${spec.name}.exemplo/perfil` },
      },
      {
        tone: "warning",
        text:
          "A tag decide **quem recebe o dinheiro** das vendas desta loja. " +
          "Confira caractere por caractere antes de salvar.",
      },
    ],
    doneSummary: { label: "Tag de recebimento", value: "Informada e verificada" },
  };
}

function enableSection(spec: SettingsStoryProvider, ctx: SetupGuideContext): SetupSection {
  return {
    id: "habilitar",
    title: "Passo 2 · Habilite as cobranças online",
    intro: "Contas novas vêm com as cobranças online desligadas — só o painel da conta mostra isso.",
    steps: [
      {
        text: "No painel da conta, ative a opção de cobranças online.",
        button: {
          label: "Abrir o painel da conta",
          url: `https://conta.${spec.name}.exemplo/config`,
        },
      },
      {
        copy: { label: "URL de notificações (referência)", text: ctx.webhookUrl, collapsible: true },
      },
      // The step only the OWNER can answer — no API reports the switch, so the
      // guide holds here until they confirm. The confirm button's label and
      // handler come from the component (`SetupGuideSection`), not from here.
      { action: CHECKOUT_CONFIRM_ACTION },
    ],
    doneSummary: { label: "Cobranças online", value: "Habilitadas na conta" },
  };
}

/**
 * The walkthrough, branched on the merchant's PROGRESS exactly as a shipped
 * adapter's would be: the host reports what is already true (`ctx.progress`)
 * and the guide shows only what is left. Stage 3 ships no section on purpose —
 * the activation step is the HOST's card (`renderVerification`), never the
 * adapter's prose.
 */
function guideFor(spec: SettingsStoryProvider, ctx: SetupGuideContext): ProviderSetupGuide {
  const progress = ctx.progress;
  const activeStage = progress?.proven ? STAGES.length : progress?.connected ? 2 : 0;
  return {
    stages: [...STAGES],
    activeStage,
    sections: [connectSection(spec), enableSection(spec, ctx)],
  };
}

/** A local, vendor-free adapter that behaves as the story declared. */
export function settingsAdapter(spec: SettingsStoryProvider): PaymentProviderAdapter {
  return {
    name: spec.name,
    displayName: spec.displayName ?? spec.name,
    ...(spec.authMode ? { authMode: spec.authMode } : {}),
    capabilities: {
      methods: ["PIX", "CARD"],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: "PUBLIC_KEY",
      // Opt-in per story: with it, "Recebendo vendas" stays locked until a
      // real charge has landed (`chargeVerifiedAt`); without it, a VERIFIED
      // probe is enough. Both gates are the shipped ones.
      ...(spec.activationCharge ? { activationCharge: true } : {}),
    },
    credentialSchema: schemaFor(spec),
    async verifyCredentials(credentials) {
      // The same short-circuit every SHIPPED adapter applies: under a
      // server-granted stub the probe asks the acquirer nothing and passes
      // (`config/verify.ts` documents the invariant). Honoring it here is what
      // keeps a declared `probe` failure honest — a story that wants the probe
      // to actually run must run a deployment that refuses stub mode
      // (`allowStubMode: false` on its spec), exactly as a real one would.
      if (credentials.stub) return { ok: true, message: "stub mode" };
      return spec.probe ?? { ok: true };
    },
    // The merchant surface never charges — the buyer mount (`store.ts`) owns
    // that side of the till. A settings story reaching either of these is a
    // bug worth throwing about.
    async createCharge(): Promise<never> {
      throw new Error(`settings stories never charge (${spec.name})`);
    },
    async getCharge(): Promise<never> {
      throw new Error(`settings stories never poll a charge (${spec.name})`);
    },
    webhook: {
      async verify() {
        return true;
      },
      async parse() {
        return [];
      },
    },
    ...(spec.authMode === "oauth" ? { oauth: storyOAuth(spec) } : {}),
    ...(spec.guide ? { setupGuide: (ctx: SetupGuideContext) => guideFor(spec, ctx) } : {}),
    clientConfig: () => ({ provider: spec.name, tokenization: "PUBLIC_KEY" }),
  };
}
