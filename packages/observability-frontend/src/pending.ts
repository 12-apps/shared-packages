/**
 * A report held until the SDK is up, and whether it may wait (FUT-1023).
 */
import { shouldReport, SOURCE_ROUTE_BOUNDARY } from "./noise";

/** One report held until the SDK is up. */
export type Pending =
  | { kind: "error"; error: unknown }
  | { kind: "crash"; error: unknown; componentStack?: string | null }
  | { kind: "warning"; message: string; context?: Record<string, unknown> };

/**
 * Whether a held report fetches the SDK NOW rather than at quiet.
 *
 * A page that crashes while booting is the report worth most and the tab most
 * likely to be closed within seconds, so it does not wait for the page to
 * finish downloading. Noise does not buy that: the filter the SDK would apply
 * anyway decides first.
 */
export function isUrgent(item: Pending): boolean {
  if (item.kind === "warning") return true;
  const text = item.error instanceof Error ? `${item.error.message} ${item.error.stack ?? ""}` : String(item.error ?? "");
  const source = item.kind === "crash" ? SOURCE_ROUTE_BOUNDARY : "";
  return shouldReport(item.error, { text, source }).report;
}
