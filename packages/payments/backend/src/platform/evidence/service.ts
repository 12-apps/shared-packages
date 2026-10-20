import type { OAuthAppCredentialsResolver, OAuthConnectService } from '../../config/oauth';
import type { ProviderConfigStore } from '../../config/types';
import type { PaymentsGateway } from '../../core/gateway';
import type { MerchantRef, PaymentEnvironment } from '../../core/types';
import { consultConnectApplication, type ConsultConnectApplicationsDeps } from '../connect-application';
import { beginSellerConnect, completeSellerConnect, type SellerCallback } from './connect';
import { buildHomologacaoEvidenceFile, type EvidenceFile } from './file';
import { buildHomologacaoEvidenceJson } from './json';
import {
  createPrismaHomologacaoEvidenceStore,
  prismaEvidenceCharge,
  prismaEvidenceWebhooks,
  type EvidenceChargeDelegate,
  type EvidenceDelegate,
  type EvidenceWebhookDelegate,
} from './prisma';
import { walletsConfig } from './orders-wallet';
import { completeEvidenceRun, prepareEvidenceRun, type EvidenceRunDeps, type PreparedEvidenceRun } from './run';
import { PAGBANK_SANDBOX_TEST_BUYER } from './sandbox-buyer';
import type {
  BrowserCardResult,
  BrowserWalletResult,
  EvidenceRecord,
  EvidenceWalletsConfig,
  HomologacaoEvidenceCopy,
} from './types';

/** Which rendering of the evidence a download asks for. */
export type EvidenceFileFormat = 'TXT' | 'JSON';

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

/** PagBank's sandbox example buyer — browser-safe, so it lives beside the 3DS contact. */
export { PAGBANK_SANDBOX_TEST_BUYER };

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
  /**
   * Whether the host has an Apple Pay identity (FUT-3755), e.g.
   * `() => platformApplePayIdentity(process.env) !== null`. Optional: absent,
   * Apple Pay is not configured and its evidence section stays PENDING,
   * waiting for the Apple Developer account.
   */
  applePayConfigured?: () => boolean | Promise<boolean>;
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
  /**
   * What each wallet's sheet needs before a run (FUT-3755): the sheet must open
   * inside the operator's tap, so the screen reads it here, not from phase 1.
   */
  wallets: EvidenceWalletsConfig;
}

export interface HomologacaoEvidenceService {
  seller(): Promise<HomologacaoSellerConnection>;
  beginConnect(ctx: { state: string; redirectUri: string }): Promise<{ url: string }>;
  completeConnect(callback: SellerCallback): Promise<{ ok: boolean; record: EvidenceRecord }>;
  /** Phase 1: the seller's public key and the debit card's 3DS session, each null when not minted. */
  prepare(): Promise<PreparedEvidenceRun>;
  /** Phase 2, with the browser's test cards and — when their buttons were pressed — wallet tokens. */
  run(runId: string, cards: readonly BrowserCardResult[], wallets?: readonly BrowserWalletResult[]): Promise<EvidenceRecord>;
  /** The evidence file — the TXT PagBank's form takes, or the same records as JSON (FUT-3755). */
  file(format?: EvidenceFileFormat): Promise<EvidenceFile>;
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
  wallets: EvidenceWalletsConfig,
): HomologacaoSellerConnection {
  const field = (key: string): string | null => fields?.[key] ?? null;
  return {
    connected: field('token') !== null,
    environment: stored?.environment ?? null,
    status: stored?.status ?? null,
    connectedAt: field('connectedAt'),
    accountId: field('accountId'),
    lastConnectProblem: connectProblem(connect),
    wallets,
  };
}

/** Google Pay mints against a SANDBOX seller's PagBank account only — the evidence is sandbox-only. */
function sandboxAccountId({ stored, fields }: Awaited<ReturnType<typeof storedSeller>>): string | null {
  return stored?.environment === 'SANDBOX' && fields?.['token'] ? (fields['accountId'] ?? null) : null;
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
      return stored
        ? { environment: stored.environment, token: fields?.['token'] ?? null, accountId: fields?.['accountId'] ?? null }
        : null;
    },
    platformToken: async () => cfg.appCredentials(PROVIDER, 'SANDBOX')?.fields['accountToken'] ?? null,
    consultApplication: () => consultConnectApplication(cfg.consult, 'SANDBOX'),
    customer: { ...PAGBANK_SANDBOX_TEST_BUYER },
    ...(cfg.applePayConfigured ? { applePayConfigured: cfg.applePayConfigured } : {}),
  };
  return {
    async seller() {
      const seller = await storedSeller(cfg);
      return sellerView(seller, await store.latest(PROVIDER, 'CONNECT'), await walletsConfig(runDeps, sandboxAccountId(seller)));
    },
    beginConnect: (ctx) => beginSellerConnect(connectDeps, ctx),
    completeConnect: (callback) => completeSellerConnect(connectDeps, callback),
    prepare: () => prepareEvidenceRun(runDeps),
    run: (runId, cards, wallets) => completeEvidenceRun(runDeps, runId, cards, wallets),
    file: (format = 'TXT') =>
      (format === 'JSON' ? buildHomologacaoEvidenceJson : buildHomologacaoEvidenceFile)({
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
