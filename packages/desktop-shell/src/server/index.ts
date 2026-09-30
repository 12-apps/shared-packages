/**
 * `@12-apps/desktop-shell/server` — the web host's half of a desktop agent.
 *
 * Framework-free at its edges (`Request` in, `Response` out) and Node-only
 * inside. Authentication, the route paths and the logger stay the host's: its
 * routes authenticate, then delegate here.
 *
 * - {@link serveDesktopAsset} / {@link serveNamedDesktopAsset} — an installer
 *   or an update-feed file, from disk first and then the host's bucket
 *   ({@link DesktopStoragePort}), with a coded 404 when neither has it.
 *   {@link platformFor} guesses the machine.
 * - {@link desktopReportSchema}, {@link describeDesktopReport} and
 *   {@link createReportBudget} — the crash-report intake for `../telemetry`.
 *   The only import of `zod` in the package, an optional peer.
 */
export {
  platformFor,
  PRESIGNED_TTL_SECONDS,
  serveDesktopAsset,
  serveNamedDesktopAsset,
  type DesktopAssetSpec,
  type DesktopPlatform,
  type DesktopStoragePort,
  type NamedDesktopAssetSpec,
  type StoredAsset,
} from "./assets";
export {
  createReportBudget,
  describeDesktopReport,
  desktopReportSchema,
  type DescribeOptions,
  type DesktopReport,
  type ReportBudget,
} from "./telemetry-intake";
