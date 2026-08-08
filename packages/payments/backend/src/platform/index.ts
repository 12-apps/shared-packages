/**
 * The PLATFORM-operations surface (FUT-479 / FUT-483, packaged by FUT-573),
 * re-exported by the package root. Split out because the root `index.ts` sits
 * at the repo's 400-line size gate; this is the same explicit list it would
 * otherwise carry.
 */
export {
  consultConnectApplications,
  type ConnectApplicationReport,
  type ConnectApplicationStatus,
  type ConsultConnectApplicationsDeps,
  type RegisteredConnectApplication,
} from './connect-application';
export {
  platformHomologacaoGuide,
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
