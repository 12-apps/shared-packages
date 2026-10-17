import type { OAuthAppCredentialsResolver, OAuthConnectService } from '../../config/oauth';
import type { ProviderConfigStore } from '../../config/types';
import type { PaymentsGateway } from '../../core/gateway';
import type { MerchantRef, PaymentEnvironment } from '../../core/types';
import { consultConnectApplication, type ConsultConnectApplicationsDeps } from '../connect-application';
import { beginSellerConnect, completeSellerConnect, type SellerCallback } from './connect';
import { buildHomologacaoEvidenceFile, type EvidenceFile } from './file';
import {
  createPrismaHomologacaoEvidenceStore,
  prismaEvidenceCharge,
  prismaEvidenceWebhooks,
  type EvidenceChargeDelegate,
  type EvidenceDelegate,
  type EvidenceWebhookDelegate,
} from './prisma';
import { completeEvidenceRun, prepareEvidenceRun, type EvidenceRunDeps } from './run';
import type { BrowserCardResult, EvidenceRecord, HomologacaoEvidenceCopy } from './types';

/**
 * The homologação evidence as ONE service (FUT-3696) — what a host mounts.
 *
 * Everything a route needs is here: the seller's connection as a screen shows
 * it, the two halves of its authorization, the two halves of a run, and the
 * file. The host supplies only what it alone knows — its gateway and stores,
 * the seller's merchant id, where its webhooks land and what the file's header
 * names — so the host side is configuration, as `payments-loc-budget` asks.
 */

const PROVIDER = 'pagbank';

/**
 * PagBank's own sandbox example buyer. Test data only, and the file says so:
 * the evidence may never carry a real person.
 */
export const PAGBANK_SANDBOX_TEST_BUYER = {
  name: 'Jose da Silva',
  email: 'cliente@sandbox.pagseguro.com.br',
  taxId: '12345678909',
} as const;

export interface HomologacaoEvidenceConfig {
  gateway: Pick<PaymentsGateway, 'charge' | 'refreshCharge' | 'refund'>;
  oauth: Pick<OAuthConnectService, 'begin' | 'complete' | 'refresh'>;
  config: Pick<ProviderConfigStore, 'get' | 'save'>;
  /** The sandbox test seller — a merchant no storefront resolves to. */
  merchant: MerchantRef;
  /** The host's Prisma client, duck-typed on the three tables the evidence reads. */
  prisma: HomologacaoEvidencePrisma;
  /** The platform's application credentials — the consult, and `connect.usage`'s comparison. */
  appCredentials: OAuthAppCredentialsResolver;
  consult: ConsultConnectApplicationsDeps;
  /** Where the seller's webhooks land — stamped on its row at connect. */
  webhookUrl: string;
  /** The file header's name and site; the callback is the consult's `expectedRedirectUri`. */
  identification: { name: string; site: string };
  copy: HomologacaoEvidenceCopy;
  newId?: () => string;
}

/** The three delegates, by the model names a Prisma client gives the host's tables. */
export interface HomologacaoEvidencePrisma {
  platformHomologationEvidence: EvidenceDelegate;
  paymentWebhookEvent: EvidenceWebhookDelegate;
  paymentCharge: EvidenceChargeDelegate;
}

/** The seller's connection as a screen may show it — never its token. */
export interface HomologacaoSellerConnection {
  connected: boolean;
  environment: PaymentEnvironment | null;
  status: string | null;
  connectedAt: string | null;
  accountId: string | null;
  /**
   * Why the LATEST authorization did not complete, in the evidence copy's
   * words — so the screen can say it without the operator reading the file.
   * Null when it completed, or never started.
   */
  lastConnectProblem: string | null;
}

export interface HomologacaoEvidenceService {
  seller(): Promise<HomologacaoSellerConnection>;
  beginConnect(ctx: { state: string; redirectUri: string }): Promise<{ url: string }>;
  completeConnect(callback: SellerCallback): Promise<{ ok: boolean; record: EvidenceRecord }>;
  prepare(): Promise<{ runId: string; publicKey: string | null }>;
  run(runId: string, cards: readonly BrowserCardResult[]): Promise<EvidenceRecord>;
  file(): Promise<EvidenceFile>;
}

async function storedSeller(cfg: HomologacaoEvidenceConfig) {
  const stored = await cfg.config.get(cfg.merchant, PROVIDER);
  return { stored, fields: stored?.environments[stored.environment] };
}

/**
 * The connection as a screen shows it. The problem is the latest connect's
 * failed step, or the note an executed exchange carries when the row it
 * stored could not be enabled.
 */
function connectProblem(connect: EvidenceRecord | null): string | null {
  const steps = connect?.steps ?? [];
  const failed = steps.find((step) => step.status === 'FAILED');
  if (failed) return failed.observed;
  return steps.find((step) => step.key === 'connect.exchange')?.notes[0] ?? null;
}

function sellerView(
  { stored, fields }: Awaited<ReturnType<typeof storedSeller>>,
  connect: EvidenceRecord | null,
): HomologacaoSellerConnection {
  const field = (key: string): string | null => fields?.[key] ?? null;
  return {
    connected: field('token') !== null,
    environment: stored?.environment ?? null,
    status: stored?.status ?? null,
    connectedAt: field('connectedAt'),
    accountId: field('accountId'),
    lastConnectProblem: connectProblem(connect),
  };
}

export function createHomologacaoEvidence(cfg: HomologacaoEvidenceConfig): HomologacaoEvidenceService {
  const store = createPrismaHomologacaoEvidenceStore(cfg.prisma.platformHomologationEvidence);
  const newId = cfg.newId ?? (() => crypto.randomUUID());
  const base = { merchant: cfg.merchant, store, copy: cfg.copy.outcome, newId };
  const connectDeps = { ...base, oauth: cfg.oauth, config: cfg.config, webhookUrl: cfg.webhookUrl };
  const runDeps: EvidenceRunDeps = {
    ...base,
    gateway: cfg.gateway,
    oauth: cfg.oauth,
    seller: async () => {
      const { stored, fields } = await storedSeller(cfg);
      return stored ? { environment: stored.environment, token: fields?.['token'] ?? null } : null;
    },
    platformToken: async () => cfg.appCredentials(PROVIDER, 'SANDBOX')?.fields['accountToken'] ?? null,
    consultApplication: () => consultConnectApplication(cfg.consult, 'SANDBOX'),
    customer: { ...PAGBANK_SANDBOX_TEST_BUYER },
  };
  return {
    async seller() {
      return sellerView(await storedSeller(cfg), await store.latest(PROVIDER, 'CONNECT'));
    },
    beginConnect: (ctx) => beginSellerConnect(connectDeps, ctx),
    completeConnect: (callback) => completeSellerConnect(connectDeps, callback),
    prepare: () => prepareEvidenceRun(runDeps),
    run: (runId, cards) => completeEvidenceRun(runDeps, runId, cards),
    file: () =>
      buildHomologacaoEvidenceFile({
        store,
        copy: cfg.copy,
        identification: {
          ...cfg.identification,
          callbackUrl: cfg.consult.expectedRedirectUri,
          clientId: cfg.appCredentials(PROVIDER, 'SANDBOX')?.fields['clientId'] ?? null,
        },
        webhookEvents: prismaEvidenceWebhooks(cfg.prisma.paymentWebhookEvent, cfg.merchant, PROVIDER),
        chargeRow: prismaEvidenceCharge(cfg.prisma.paymentCharge, cfg.merchant),
      }),
  };
}
