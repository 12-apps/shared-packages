import { providerForHostId, type AiHostGuide, type AiProvider } from "../guide";

/**
 * Pure helpers + the connection type shared by the AI-onboarding flow steps
 * (`ai-flow-steps.tsx`) and the orchestration/status board (`ai-steps.tsx`),
 * kept here so neither JSX module has to import the other (no import cycle).
 */

/** The live connection surfaced from the server (empty list when none). */
export interface AiConnection {
  clientName: string | null;
  /**
   * The provider this connection is attributed to (derived server-side from the
   * OAuth client's redirect URIs / confirmed by `announceAiConnection`). `null`
   * for a legacy connection recorded before attribution existed — matched
   * best-effort to whichever host the owner is connecting.
   */
  host: AiProvider | null;
  lastActiveAt: Date;
}

/** Friendly provider names for the connected-state title ("Claude Conectado"). */
const PROVIDER_LABEL: Record<AiProvider, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex",
};

/** Resolve a persisted host id to its guide (falls back to the first host). */
export function resolveHost(hosts: readonly AiHostGuide[], hostId: unknown): AiHostGuide {
  const found = hosts.find((h) => h.id === hostId) ?? hosts[0];
  if (!found) throw new Error("resolveHost: hosts array must not be empty");
  return found;
}

/** Friendly label for a persisted host id (falls back to a generic word). */
export function hostLabel(hosts: readonly AiHostGuide[], hostId: unknown): string {
  return hosts.find((h) => h.id === hostId)?.label ?? "seu assistente";
}

/**
 * The live connection for a given host, or null. A connection is matched by its
 * derived provider; a legacy `null`-host connection matches best-effort (so the
 * pre-attribution single-connection behavior still works).
 */
export function connectionForHost(
  connections: readonly AiConnection[],
  hostId: unknown,
): AiConnection | null {
  const provider = typeof hostId === "string" ? providerForHostId(hostId) : null;
  if (!provider) return connections.find((c) => c.host === null) ?? connections[0] ?? null;
  return (
    connections.find((c) => c.host === provider) ?? connections.find((c) => c.host === null) ?? null
  );
}

/** Short pt-BR "ativo há X" from a timestamp (agora / min / h / dias). */
export function activeAgo(date: Date): string {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "ativo agora";
  if (minutes < 60) return `ativo há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ativo há ${hours} h`;
  return `ativo há ${Math.floor(hours / 24)} dias`;
}

/** The most-recently-active connection across all providers (null when none). */
function mostRecent(connections: readonly AiConnection[]): AiConnection | null {
  return connections.reduce<AiConnection | null>(
    (best, c) => (!best || c.lastActiveAt.getTime() > best.lastActiveAt.getTime() ? c : best),
    null,
  );
}

/** The configured-state TITLE, naming the connected assistant(s) — FUT req (F). */
export function connectedTitle(
  connections: readonly AiConnection[],
  hosts: readonly AiHostGuide[],
  connectedHostId: string | undefined,
): string {
  const providers = [...new Set(connections.map((c) => c.host).filter((h): h is AiProvider => h !== null))];
  if (providers.length === 1) return `${PROVIDER_LABEL[providers[0]!]} Conectado`;
  if (providers.length > 1) {
    return `${providers.map((p) => PROVIDER_LABEL[p]).join(", ")} conectados`;
  }
  // Legacy connection with no attributed provider — name the completed host.
  if (connections.length > 0) return `${hostLabel(hosts, connectedHostId)} Conectado`;
  return "IA conectada";
}

/** The completed summary line (second line) for the configured-state header. */
export function connectedSummary(connections: readonly AiConnection[]): string {
  const recent = mostRecent(connections);
  if (!recent) return "Integração configurada";
  return activeAgo(recent.lastActiveAt);
}
