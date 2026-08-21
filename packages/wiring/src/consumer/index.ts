/**
 * The consumer half: what a HOST imports to adopt package manifests.
 */

export {
  createWiringHost,
  WiringHost,
  type AssembledWiring,
  type HostKind,
  type PackageAreaContribution,
  type PackageDbContribution,
  type PackageEnvContribution,
  type ServerAdoption,
  type SharedCapabilityAnswers,
  type WebAdoption,
  type WiringHostOptions,
} from "./host";

export {
  isDeclined,
  type DeclinedBinding,
  type EmailBindingValue,
  type HttpBindingValue,
  type JobsBindingValue,
  type MailerOf,
  type ServerBindings,
  type SurfaceBindingValue,
  type SurfaceOf,
  type WebBindings,
} from "./bindings";

export {
  joinRoutePath,
  routeClaimKey,
  routePolicyTable,
  sortRoutes,
  findRouteConflicts,
  unclaimedRoutes,
  type RouteConflict,
  type RoutePolicyRow,
} from "./paths";

export {
  renderWiringReport,
  unboundEntries,
  type CapabilityReportEntry,
  type CapabilityStatus,
  type PackageReportEntry,
  type WiringReport,
} from "./report";

export {
  createWireRouteTable,
  forwardWireParams,
  parseWireRouteKey,
  wireAnswer,
  wireResponse,
  type WireRouteTable,
} from "./endpoint";
