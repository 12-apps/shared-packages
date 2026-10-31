/**
 * `@12-apps/payments-backend/homologacao-evidence` (FUT-3696) — the PagBank
 * homologação evidence: the test seller's Connect, the recorded Pix and card
 * run, and the file built from both — in sandbox, or in production with real
 * R$ 1,00 charges that the run refunds (FUT-4198).
 *
 * Its own subpath because it is server-only: loading it installs the
 * AsyncLocalStorage the traffic recorder runs on (`./record.ts`), and the root
 * entry may reach no Node builtin. The TYPES are on the root too, for screens.
 */
export { beginSellerConnect, completeSellerConnect, type SellerCallback, type SellerConnectDeps } from './connect';
export {
  completeEvidenceRun,
  confirmEvidencePix,
  EvidenceRunNotFoundError,
  prepareEvidenceRun,
  type EvidenceRunDeps,
  type PixConfirmAction,
  type PreparedEvidenceRun,
} from './run';
export { buildHomologacaoEvidenceFile, formatEvidenceTime, type EvidenceFile, type EvidenceFileDeps } from './file';
export { buildHomologacaoEvidenceJson } from './json';
export { createMemoryHomologacaoEvidenceStore } from './memory';
export {
  createPrismaHomologacaoEvidenceStore,
  type EvidenceChargeDelegate,
  type EvidenceDelegate,
  type EvidenceWebhookDelegate,
} from './prisma';
export {
  createHomologacaoEvidence,
  PAGBANK_SANDBOX_TEST_BUYER,
  type EvidenceFileFormat,
  type HomologacaoEvidenceConfig,
  type HomologacaoEvidencePrisma,
  type HomologacaoEvidenceService,
  type HomologacaoSellerConnection,
} from './service';
export { recordTraffic, type RecordedOutcome } from './record';
export { PT_BR_HOMOLOGACAO_EVIDENCE_COPY } from './pt-BR';
export { EN_US_HOMOLOGACAO_EVIDENCE_COPY } from './en-US';
export {
  EN_US_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
  PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
} from './production-copy';
export * from './types';
export type { RecordedHttpCall } from '../../core/traffic-recorder';
