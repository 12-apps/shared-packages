/**
 * `@12-apps/wiring` — the package-to-host wiring contract.
 *
 * The root entry is the CONTRACT: the capability shapes both halves share,
 * framework-free and dependency-free. The producer half (`./producer`) is
 * what a package uses to declare its manifest; the consumer half
 * (`./consumer`) is what a host uses to adopt manifests and bind every
 * declared capability; the ports (`./ports`) are what a host provides once
 * for every package to require.
 */

export { WiringAssemblyError, WiringDefinitionError } from "./errors";

export type {
  HttpContribution,
  MountedRoute,
  WireHttpMethod,
  WireRawResponse,
  WireRequest,
  WireResponse,
  WireRoute,
  WireRouteAnswer,
  WireRouteKind,
  WireRoutePolicy,
} from "./contract/http";

export type {
  BoundJob,
  JobsContribution,
  WireJobBackoff,
  WireJobBlueprint,
  WireJobContext,
  WireJobInterval,
  WireJobLease,
  WireJobLogger,
  WireJobSchedule,
} from "./contract/jobs";

export { envScopesOf } from "./contract/env";
export type { WireEnvScope, WireEnvValues, WireEnvVar } from "./contract/env";

export type {
  McpContribution,
  WireMcpAnnotations,
  WireMcpTool,
} from "./contract/mcp";

export type {
  WirePermissionKind,
  WirePermissionSpec,
  WirePermissionsContribution,
  WirePermissionVocabulary,
  WirePermissionVocabularyResolver,
} from "./contract/permissions";

export type {
  AnyNotificationBlueprint,
  WireNotificationBlueprint,
  WireNotificationContent,
} from "./contract/notifications";

export type { EmailContribution, EmailPort, WireEmailMessage } from "./contract/email";

export { isIsolatedDb } from "./contract/db";
export type {
  ComposedPrismaContribution,
  IsolatedPrismaContribution,
  PrismaContribution,
} from "./contract/db";

export type {
  AreaContribution,
  AreaNavDeclaration,
  AreaRouteDeclaration,
  WebSurfaceContribution,
  WirePermissionGate,
} from "./contract/web";

export type {
  AnyServerManifest,
  AnyWebManifest,
  CapabilityKind,
  E2eContribution,
  ObservabilityContribution,
  PackageManifest,
  ServerCapabilityKind,
  SharedCapabilityKind,
  WebCapabilityKind,
} from "./contract/manifest";
