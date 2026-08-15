/**
 * Fetching the reporting config the backend holds (FUT-718).
 *
 * The DSN is served rather than baked because a Vite bundle inlines
 * `import.meta.env` at build time — the host app's server-side resolver carries
 * the full argument: a rotation must not require a rebuild, and a static
 * bundle has no process of its own to read env on its behalf.
 *
 * Everything here fails SILENTLY and fast. Observability that can delay a first
 * paint, or throw on a boot path, is a worse bug than the ones it was added to
 * find: it would take down the storefront for every visitor in order to report
 * a crash for a few.
 */

/**
 * Which app is reporting, as the backend's `?app=` parameter spells it.
 *
 * A plain `string` rather than a union: the set of apps belongs to the HOST,
 * not to this package. The origin host narrows it to its own three in the adapter
 * that wires this up; another product would name its own.
 */
export type ObservabilityApp = string;

/** Where the host serves its per-app reporting config. */
export const DEFAULT_CONFIG_ENDPOINT = "/api/observability-config";

interface ObservabilityConfig {
  dsn: string;
  environment: string;
  release: string;
}

/**
 * How long to wait for the config before giving up on reporting entirely.
 *
 * Short on purpose. This request races the user's first interaction, and the
 * cost of losing it is one session's worth of events — while the cost of
 * hanging on to a pre-init error buffer indefinitely is a leak that grows for
 * as long as the tab is open.
 */
const TIMEOUT_MS = 5_000;

function isConfig(value: unknown): value is ObservabilityConfig {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.dsn === "string" &&
    typeof record.environment === "string" &&
    typeof record.release === "string"
  );
}

/**
 * Ask the backend where this app reports to. Resolves `null` for every failure
 * — offline, 404 on an older backend, malformed body, timeout — because each
 * one means the same thing to the caller: do not start reporting.
 *
 * Deliberately a bare `fetch` rather than the host's HTTP client: a client that
 * throws on non-2xx would make this the one call in the app that produces an
 * error while setting up error handling.
 */
export async function loadObservabilityConfig(
  app: ObservabilityApp,
  endpoint: string = DEFAULT_CONFIG_ENDPOINT,
): Promise<ObservabilityConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint}?app=${encodeURIComponent(app)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: unknown };
    return isConfig(payload.data) ? payload.data : null;
  } catch {
    // Offline, aborted, or a body that was not JSON. All the same answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
