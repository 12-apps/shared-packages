/**
 * `@12-apps/entity-lifecycle/server` — the host-mounted backend surface
 * (12-17): `createApiEntityLifecycle(config)` generates the versions /
 * restore / drafts / recycle-bin / approvals endpoints for every registered
 * collection from its DECLARATION, over the four tables the package owns.
 */

export {
  createApiEntityLifecycle,
  type ApiEntityLifecycle,
  type EntityLifecycleHandle,
  type EntityLifecycleServerConfig,
} from './create-api-entity-lifecycle';
export type { LifecycleEntityRegistration } from './registration';
export {
  LifecycleApiError,
  contextOf,
  draftJson,
  foldLifecycle,
  messagesOf,
  writeOutcome,
  type LifecycleActor,
  type LifecycleAuthorization,
  type LifecycleAuthorizeGate,
  type LifecycleMessages,
  type LifecycleRequest,
  type LifecycleResponse,
  type LifecycleRoute,
  type LifecycleUserDirectory,
} from './context';
export { PT_BR_LIFECYCLE_MESSAGES } from './pt-BR';
export { EN_US_LIFECYCLE_MESSAGES } from './en-US';
export { LIFECYCLE_MESSAGES } from './locales';
export { createDbLifecycleStores } from './stores';
export type {
  ChangeRequestCreateData,
  ChangeRequestDelegate,
  ChangeRequestRow,
  ChangeRequestUpdateData,
  ChangeRequestWhere,
  EntityDraftCreateData,
  EntityDraftDelegate,
  EntityDraftRow,
  EntityDraftWhere,
  EntityVersionCreateData,
  EntityVersionDelegate,
  EntityVersionRow,
  EntityVersionWhere,
  LifecycleDb,
  LifecycleDbClient,
  LifecycleDbProvider,
  RecycleBinCreateData,
  RecycleBinDelegate,
  RecycleBinRow,
  RecycleBinWhere,
} from './db';
