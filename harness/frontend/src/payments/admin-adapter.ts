/**
 * THE FICTIONAL CAST of the merchant admin store: one local, vendor-free
 * adapter per declared provider, exercising the settings/OAuth halves of the
 * published adapter contract exactly as `./adapter.ts` exercises the charge
 * half. Every name is opaque on purpose (`aurora`, `boreal`, `cerrado`,
 * `dunas`) — the portability gate makes a vendor name in this folder a hard
 * error, and a fixture that names one is the first line of a provider-shaped
 * fork.
 *
 * What each member of the cast is FOR:
 *   - `aurora`  — the one-handle shape: a single required, non-secret,
 *     confirm-on-save field, an activation charge, and the walkthrough guide
 *     (warning step, collapsible copy field, owner-confirmed step).
 *   - `boreal`  — the many-secrets shape: three required fields, two secret,
 *     no guide, no activation charge; its probe outcome is scriptable.
 *   - `cerrado` — the OAuth provider WITH a manual-credentials fallback
 *     (non-empty schema), whose refresh can be declared dead.
 *   - `dunas`   — the OAuth-only provider (empty schema) whose revoke throws.
 */
import type {
  CredentialFieldSpec,
  OAuthTokens,
  PaymentProviderAdapter,
  ProbeFault,
  ProbeOutcome,
  ProviderAuthMode,
  ProviderSetupGuide,
  ResolvedCredentials,
  SetupGuideContext,
} from '@12-apps/payments-backend';
import { ProviderRequestError } from '@12-apps/payments-backend';
import { CHECKOUT_CONFIRM_ACTION } from '@12-apps/payments-frontend';

import { consentUrl } from './admin-extensions';
import type { AdminSinks } from './admin-store';

/** What a `verifyCredentials` probe answers, declared per case. */
export type AdminVerifyOutcome =
  | 'ok'
  /** Held open until `world.releaseVerify()` — the slow-probe case. */
  | 'deferred'
  | { ok: false; message?: string; fault?: ProbeFault };

/** How one declared provider behaves on the merchant surface. */
export interface AdminProvider {
  /** Opaque key. The factory never types one; a host does, as these pages do. */
  name: string;
  displayName: string;
  urlSlug?: string;
  authMode?: ProviderAuthMode;
  credentialSchema?: CredentialFieldSpec[];
  /** Enabling requires a real charge to have landed (FUT-463). */
  activationCharge?: boolean;
  /** What the credential probe answers. Default: `ok`. */
  verify?: AdminVerifyOutcome;
  /** Ships the walkthrough guide (the one-handle provider's). */
  guide?: boolean;
  /** Implements the OAuth connect block. */
  oauth?: boolean;
  /** `oauth.refresh` throws — how `reconnect-required` is produced. */
  refreshFails?: boolean;
  /** `oauth.revoke` exists and throws — the swallowed-revoke reporter case. */
  revokeThrows?: boolean;
}

/** The one-handle provider. Overrides let a case script its probe. */
export function aurora(overrides: Partial<AdminProvider> = {}): AdminProvider {
  return {
    name: 'aurora',
    displayName: 'Aurora Pagamentos',
    credentialSchema: [
      {
        key: 'handle',
        label: 'Arroba da loja',
        secret: false,
        required: true,
        mono: true,
        confirmOnSave: true,
        placeholder: '@loja-harness',
        helperText: 'O arroba aparece no topo do aplicativo Aurora.',
        pattern: '^@[a-z][a-z0-9-]{3,}$',
      },
    ],
    activationCharge: true,
    guide: true,
    ...overrides,
  };
}

/** The many-secrets provider: three required fields, two of them secret. */
export function boreal(overrides: Partial<AdminProvider> = {}): AdminProvider {
  return {
    name: 'boreal',
    displayName: 'Boreal Pay',
    credentialSchema: [
      { key: 'apiKey', label: 'Chave de API', secret: true, required: true },
      { key: 'apiSecret', label: 'Segredo de API', secret: true, required: true },
      { key: 'merchantCode', label: 'Código do lojista', secret: false, required: true },
    ],
    activationCharge: false,
    ...overrides,
  };
}

/**
 * The OAuth provider with a manual fallback. Its schema key deliberately does
 * NOT overlap the reserved OAuth identity/token keys: the masked view iterates
 * `credentialSchema` alone, and the connect specs depend on the token blob
 * staying invisible to it.
 */
export function cerrado(overrides: Partial<AdminProvider> = {}): AdminProvider {
  return {
    name: 'cerrado',
    displayName: 'Cerrado Pagamentos',
    authMode: 'oauth',
    oauth: true,
    credentialSchema: [
      {
        key: 'manualToken',
        label: 'Token de acesso manual',
        secret: true,
        required: true,
        helperText: 'Somente para instalações sem o botão de conexão.',
      },
    ],
    activationCharge: false,
    ...overrides,
  };
}

/** The OAuth-only provider: empty schema, and a revoke that throws. */
export function dunas(overrides: Partial<AdminProvider> = {}): AdminProvider {
  return {
    name: 'dunas',
    displayName: 'Dunas Digital',
    authMode: 'oauth',
    oauth: true,
    credentialSchema: [],
    activationCharge: false,
    revokeThrows: true,
    ...overrides,
  };
}

const DAY_MS = 864e5;

/** The scripted probe answer, recording nothing — the caller records. */
function probeAnswer(declared: AdminProvider, world: AdminSinks): Promise<ProbeOutcome> {
  const outcome = declared.verify ?? 'ok';
  if (outcome === 'ok') return Promise.resolve({ ok: true });
  if (outcome === 'deferred') {
    return new Promise<void>((resolve) => world.heldVerifies.push(resolve)).then(() => ({
      ok: true,
    }));
  }
  return Promise.resolve(outcome);
}

/** The tokens a successful exchange or refresh hands back. */
function grantedTokens(declared: AdminProvider, code: string): OAuthTokens {
  return {
    fields: {
      accessToken: `at_${code}`,
      refreshToken: `rt_${code}`,
      accountId: 'ACC-9921',
      accountLabel: `Loja Harness (${declared.name})`,
      scope: 'payments.read payments.create',
    },
    expiresAt: new Date(Date.now() + 90 * DAY_MS),
  };
}

function oauthBlockFor(
  declared: AdminProvider,
  world: AdminSinks,
): NonNullable<PaymentProviderAdapter['oauth']> {
  return {
    // Same origin, same path, FRAGMENT differs only — so the published
    // `window.location.assign(url)` is a same-document navigation and the
    // in-page mount survives the hop. See `consentUrl`.
    buildAuthorizeUrl: async (_appCredentials, ctx) => ({
      url: consentUrl(declared.name, ctx.state),
      state: ctx.state,
    }),
    exchangeCode: async (code) => {
      world.exchanges.push({ provider: declared.name, code });
      world.fire();
      if (code === 'harness-code-refused') {
        throw new ProviderRequestError(declared.name, 'O provedor recusou o código de autorização.');
      }
      return grantedTokens(declared, code);
    },
    refresh: async () => {
      if (declared.refreshFails) {
        throw new ProviderRequestError(declared.name, 'O provedor recusou renovar a autorização.');
      }
      return grantedTokens(declared, 'renovado');
    },
    ...(declared.revokeThrows
      ? {
          revoke: async (): Promise<void> => {
            throw new ProviderRequestError(declared.name, 'O provedor não respondeu à revogação.');
          },
        }
      : {}),
  };
}

/**
 * The one-handle provider's walkthrough. Three stages, sections for the first
 * two only; `activeStage` is computed from the host-supplied progress, which
 * is what makes a post-save refetch come back DIFFERENT — the assertion the
 * guided-setup case is built on.
 */
function handleGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  const configured = ctx.progress?.configured['handle'] === true;
  const connected = ctx.progress?.connected === true;
  return {
    stages: [
      { id: 'chave', label: 'Informar o arroba' },
      { id: 'ativar-cobrancas', label: 'Ativar cobranças' },
      { id: 'vender', label: 'Vender' },
    ],
    sections: [
      {
        id: 'chave',
        title: 'Informe o arroba da loja',
        intro: 'O arroba identifica quem recebe as vendas.',
        steps: [{ text: 'Copie o arroba no aplicativo Aurora e informe no campo abaixo.' }],
      },
      {
        id: 'ativar-cobrancas',
        title: 'Habilite o Checkout Integrado',
        doneSummary: { label: 'Checkout Integrado', value: 'Habilitado na conta Aurora' },
        steps: [
          {
            tone: 'warning',
            text: 'A página abaixo também permite trocar o arroba que recebe as vendas — não altere esse campo.',
          },
          {
            text: 'Abra o painel Aurora e ative o Checkout Integrado.',
            button: { label: 'Abrir painel Aurora', url: 'https://painel.aurora.exemplo/checkout' },
          },
          { copy: { label: 'URL de notificação', text: ctx.webhookUrl, collapsible: true } },
          // The confirm button's label is the frontend package's own; the
          // adapter only names the action.
          { action: CHECKOUT_CONFIRM_ACTION },
        ],
      },
    ],
    activeStage: configured ? (connected ? 2 : 1) : 0,
  };
}

/** The admin mounts exclude the whole charge surface; landing here is a bug. */
function unreachable(provider: string, member: string): () => Promise<never> {
  return async () => {
    throw new Error(`unreachable: the admin mounts exclude the charge surface (${provider}.${member})`);
  };
}

/**
 * The ACTIVATION half a provider declaring `activationCharge` carries
 * (FUT-689). The HTTP charge surface stays excluded — only the host's
 * activation extension reaches these, in-process — and they answer like the
 * published stub: a token carrying the decline marker is refused with a named
 * reason, anything else is PAID, and the refund settles REFUNDED so the cent
 * demonstrably comes back. Every charge and refund lands in the world.
 */
function activationOps(
  declared: AdminProvider,
  world: AdminSinks,
): Pick<PaymentProviderAdapter, 'createCharge' | 'refund'> {
  return {
    async createCharge(input) {
      const token = input.card?.token ?? '(none)';
      const declined = token.endsWith('-declined') || token.startsWith('tok_declined');
      world.activationCharges.push({
        provider: declared.name,
        reference: input.reference,
        token,
        status: declined ? 'DECLINED' : 'PAID',
      });
      world.fire();
      const base = {
        provider: declared.name,
        providerChargeId: `stub_${declared.name}_${input.reference}`,
        amount: input.amount,
        method: input.method,
      };
      if (declined) {
        return { ...base, status: 'DECLINED', declineReason: 'CARD_DECLINED', declineRetriable: true };
      }
      return { ...base, status: 'PAID' };
    },
    async refund(input) {
      world.activationRefunds.push(input.providerChargeId);
      world.fire();
      return {
        provider: declared.name,
        providerChargeId: input.providerChargeId,
        providerRefundId: `refund_${input.providerChargeId}`,
        status: 'REFUNDED',
        amount: input.amount ?? { amountCents: 1, currency: 'BRL' },
      };
    },
  };
}

/**
 * A local, vendor-free adapter that behaves as the case declared. The
 * settings/OAuth half of the contract is real; the charge half is a thrower,
 * because every admin mount excludes those intents by construction.
 */
export function adminAdapter(declared: AdminProvider, world: AdminSinks): PaymentProviderAdapter {
  return {
    name: declared.name,
    displayName: declared.displayName,
    ...(declared.urlSlug ? { urlSlug: declared.urlSlug } : {}),
    ...(declared.authMode ? { authMode: declared.authMode } : {}),
    capabilities: {
      methods: ['PIX', 'CARD'],
      wallets: [],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
      ...(declared.activationCharge ? { activationCharge: true } : {}),
    },
    credentialSchema: declared.credentialSchema ?? [],
    async verifyCredentials(credentials: ResolvedCredentials) {
      world.verifyCalls.push({ provider: declared.name, environment: credentials.environment });
      world.fire();
      return probeAnswer(declared, world);
    },
    createCharge: unreachable(declared.name, 'createCharge'),
    getCharge: unreachable(declared.name, 'getCharge'),
    ...(declared.activationCharge ? activationOps(declared, world) : {}),
    webhook: {
      verify: unreachable(declared.name, 'webhook.verify'),
      parse: unreachable(declared.name, 'webhook.parse'),
    },
    clientConfig: () => ({ provider: declared.name, tokenization: 'PUBLIC_KEY' }),
    ...(declared.oauth ? { oauth: oauthBlockFor(declared, world) } : {}),
    ...(declared.guide ? { setupGuide: (ctx: SetupGuideContext) => handleGuide(ctx) } : {}),
  };
}
