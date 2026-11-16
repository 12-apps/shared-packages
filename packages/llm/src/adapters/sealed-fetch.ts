/**
 * The edge every built-in adapter sends through (FUT-3738, review item B3).
 *
 * A store's own key must reach its provider ALONE. The SDKs read the process
 * environment for anything left unset — a base URL, an organisation or
 * project, custom headers, a second token — so a platform's `OPENAI_*`,
 * `ANTHROPIC_*` or `GOOGLE_*` variables would ride along on a store's call:
 * billed to the platform's project, routed to the platform's proxy, or
 * authenticated twice. The adapters pass every such option explicitly, and
 * this `fetch` is the second layer, the shape of a credential gateway: it
 * pins the request to the adapter's own base URL, drops every auth and
 * tenant-routing header the SDK set, and sets only the call's credential.
 */
import { InvalidRequestError } from "../errors";

/** Headers that authenticate a request or bill it to an account. */
const ACCOUNT_HEADERS = [
  "authorization",
  "api-key",
  "x-api-key",
  "x-goog-api-key",
  "x-goog-user-project",
  "openai-organization",
  "openai-project",
] as const;

/** The SDKs' "extra headers" variables, as `Name: value` lines. */
const CUSTOM_HEADER_VARIABLES = ["OPENAI_CUSTOM_HEADERS", "ANTHROPIC_CUSTOM_HEADERS"] as const;

/** The header a custom-headers line names, with its value; null for a line the SDKs skip or `Headers` rejects. */
function parseLine(line: string): [string, string] | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const name = line.slice(0, colon).trim().toLowerCase();
  const value = line.slice(colon + 1).trim();
  try {
    new Headers().set(name, value);
  } catch {
    return null; // a name or value `Headers` rejects was never sent either
  }
  return [name, value];
}

function parseCustomHeaders(): Array<[string, string]> {
  const lines = CUSTOM_HEADER_VARIABLES.flatMap((variable) =>
    (typeof process === "undefined" ? "" : (process.env[variable] ?? "")).split(/\r?\n/),
  );
  return lines.map(parseLine).filter((pair): pair is [string, string] => pair !== null);
}

/** Drop the platform's custom headers, but never one the adapter set itself with another value. */
function dropPlatformHeaders(headers: Headers): void {
  for (const [name, value] of parseCustomHeaders()) {
    if (headers.get(name) === value) headers.delete(name);
  }
}

export interface SealOptions {
  provider: string;
  /** The only origin and path prefix a request may go to. */
  baseURL: string;
  /** The call's own credential headers, set last. */
  auth: Readonly<Record<string, string>>;
  /** The host's `fetch` (a proxy, a test double); the global one otherwise. */
  fetch?: typeof globalThis.fetch;
}

function within(url: URL, base: URL): boolean {
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(prefix));
}

export function sealedFetch(options: SealOptions): typeof globalThis.fetch {
  const base = new URL(options.baseURL);
  const send = options.fetch ?? globalThis.fetch;
  const sealed = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const outgoing = new Request(input, init);
    if (!within(new URL(outgoing.url), base)) {
      throw new InvalidRequestError(options.provider, `Refused a request outside the adapter's base URL (${base.origin}${base.pathname}).`);
    }
    const headers = new Headers(outgoing.headers);
    for (const name of ACCOUNT_HEADERS) headers.delete(name);
    dropPlatformHeaders(headers);
    for (const [name, value] of Object.entries(options.auth)) headers.set(name, value);
    const body = outgoing.method === "GET" || outgoing.method === "HEAD" ? undefined : await outgoing.arrayBuffer();
    return send(outgoing.url, { method: outgoing.method, headers, body, signal: outgoing.signal, redirect: outgoing.redirect });
  };
  return sealed as typeof globalThis.fetch;
}
