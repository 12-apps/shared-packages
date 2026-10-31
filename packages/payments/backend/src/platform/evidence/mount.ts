import { createConnectState, type ConnectState } from '../../config/connect-state';
import type { MerchantRef } from '../../core/types';
import { PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY } from './production-pt-BR';
import { PT_BR_HOMOLOGACAO_EVIDENCE_COPY } from './pt-BR';
import { createHomologacaoEvidence, type HomologacaoEvidenceConfig, type HomologacaoEvidenceService } from './service';
import type { EvidenceEnvironment } from './types';

/**
 * The homologação evidence, mounted once per host for BOTH environments
 * (FUT-4198). Everything that differs by environment is decided here, so a
 * host hands over only what its deployment knows — its cookie prefix, its
 * callback, where its webhook routes live — and gets back:
 *
 *   - each environment's seller: its own PLATFORM merchant, because a
 *     provider row holds one active environment and the sandbox seller can
 *     never be the production one;
 *   - each seller's own state cookie, so the host's shared OAuth callback
 *     tells the sandbox seller, the production seller and a store apart;
 *   - which environment a request is about (`?ambiente=producao`);
 *   - the service itself, with its seller, webhook URL and copy pack.
 *
 * The copy is pt-BR whatever the operator reads: the file's reader is
 * PagBank's reviewer.
 */

const SELLERS: Record<EvidenceEnvironment, MerchantRef> = {
  SANDBOX: { kind: 'PLATFORM', id: 'homologacao-seller' },
  PRODUCTION: { kind: 'PLATFORM', id: 'homologacao-seller-production' },
};

/** What a host hands over: the per-environment parts are derived from these. */
export interface HomologacaoEvidenceMountOptions {
  /** The sandbox seller's state cookie prefix; production's is the same plus `_prod`. */
  cookiePrefix: string;
  /** The host's registered OAuth callback, shared with its stores. */
  callbackPath: string;
  /** The sandbox seller's webhook namespace; production's is the same plus `-producao`. Both end in `/pagbank`. */
  webhookPath: string;
  baseUrl: () => string;
  /** Everything else the service needs, read when a service is built. */
  deps: () => Promise<Omit<HomologacaoEvidenceConfig, 'environment' | 'merchant' | 'webhookUrl' | 'copy'>>;
}

export interface HomologacaoEvidenceMount {
  seller: (environment: EvidenceEnvironment) => MerchantRef;
  connectState: (environment: EvidenceEnvironment) => ConnectState;
  environmentOf: (request: Request) => EvidenceEnvironment;
  evidence: (environment?: EvidenceEnvironment) => Promise<HomologacaoEvidenceService>;
}

export function createHomologacaoEvidenceMount(options: HomologacaoEvidenceMountOptions): HomologacaoEvidenceMount {
  const state = (cookiePrefix: string) =>
    createConnectState({ cookiePrefix, callbackPath: options.callbackPath, baseUrl: options.baseUrl });
  const states: Record<EvidenceEnvironment, ConnectState> = {
    SANDBOX: state(options.cookiePrefix),
    PRODUCTION: state(`${options.cookiePrefix}_prod`),
  };
  return {
    seller: (environment) => SELLERS[environment],
    connectState: (environment) => states[environment],
    environmentOf: (request) =>
      new URL(request.url).searchParams.get('ambiente') === 'producao' ? 'PRODUCTION' : 'SANDBOX',
    evidence: async (environment = 'SANDBOX') => {
      const production = environment === 'PRODUCTION';
      return createHomologacaoEvidence({
        ...(await options.deps()),
        environment,
        merchant: SELLERS[environment],
        webhookUrl: `${options.baseUrl()}${options.webhookPath}${production ? '-producao' : ''}/pagbank`,
        copy: production ? PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY : PT_BR_HOMOLOGACAO_EVIDENCE_COPY,
      });
    },
  };
}
