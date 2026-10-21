/**
 * The PLATFORM-operations surface (FUT-479 / FUT-483, packaged by FUT-573),
 * re-exported by the package root. Split out because the root `index.ts` sits
 * at the repo's 400-line size gate; this is the same explicit list it would
 * otherwise carry.
 */
export { PT_BR_CONNECT_APPLICATION_COPY, PT_BR_HOMOLOGACAO_ANSWERS } from './pt-BR';
export { EN_US_CONNECT_APPLICATION_COPY } from './en-US';
export {
  consultConnectApplication,
  consultConnectApplications,
  consultPastedConnectApplication,
  type ConnectApplicationCopy,
  type ConnectCredentialPreview,
  type ConnectApplicationReport,
  type ConnectApplicationStatus,
  type ConsultConnectApplicationsDeps,
  type PastedConnectApplicationResult,
  type PastedConnectCredentials,
  type RegisteredConnectApplication,
} from './connect-application';
export {
  ACCESS_INSTRUCTIONS_MAX,
  platformHomologacaoGuide,
  type HomologacaoFieldLabels,
  type HomologacaoGuide,
  type PlatformHomologacaoGuideFacts,
} from './homologacao-guide';
export {
  createHomologationRecordService,
  createMemoryHomologationRecordStore,
  HOMOLOGATION_STATUSES,
  type HomologationRecordService,
  type HomologationRecordStore,
  type PlatformHomologationRecord,
  type PlatformHomologationStatus,
  type SaveHomologationInput,
} from './homologacao-record';
export {
  buildPlatformHomologacaoAnexo,
  type HomologacaoAnexo,
  type HomologacaoAnexoFailure,
  type HomologacaoAnexoResult,
  type PlatformHomologacaoAnexoInput,
} from './homologacao-anexo';
export {
  BROWSER_CARD_FAILURES,
  BROWSER_CARD_SCENARIOS,
  BROWSER_WALLET_FAILURES,
  EVIDENCE_RUN_SECTIONS,
  EVIDENCE_SECTIONS,
  EVIDENCE_STEP_KEYS,
  EVIDENCE_WALLETS,
  type BrowserCardFailure,
  type BrowserCardResult,
  type BrowserCardScenario,
  type BrowserWalletFailure,
  type BrowserWalletResult,
  type EvidenceRunSection,
  type EvidenceWallet,
  type EvidenceWalletsConfig,
  type EvidenceSection,
  type EvidenceRecord,
  type EvidenceRecordKind,
  type EvidenceStatus,
  type EvidenceStep,
  type EvidenceStepKey,
  type EvidenceSummary,
  type HomologacaoEvidenceCopy,
  type HomologacaoEvidenceStore,
} from './evidence/types';
export type { DebitTestData } from './evidence/sandbox-buyer';
