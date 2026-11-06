import { isIP } from "node:net";

import { ClientMetadataDocumentError } from "./client-metadata-errors";

/**
 * The URL half of Client ID Metadata Documents (FUT-4522): which `client_id`s are
 * URLs at all, the draft's rules for one, which addresses a server-side fetch may
 * never reach, and the loopback redirect rule a native client needs.
 */

/**
 * Whether `clientId` is shaped like a metadata-document URL rather than a
 * registered id. Registered ids are UUIDs, so the two can never collide.
 */
export function isClientIdMetadataUrl(clientId: string): boolean {
  return clientId.startsWith("https://");
}

/** Each rule of the draft (§3) with the reason it refuses, checked in order. */
const URL_RULES: ReadonlyArray<readonly [string, (url: URL, raw: string) => boolean]> = [
  ["client_id is not https", (url) => url.protocol !== "https:"],
  ["client_id carries credentials", (url) => Boolean(url.username || url.password)],
  ["client_id carries a fragment", (_url, raw) => raw.includes("#")],
  ["client_id has no path", (url) => url.pathname === "/" || url.pathname === ""],
  // `new URL` resolves dot segments away, so they are checked on the raw text.
  ["client_id has a dot segment", (url, raw) => hasDotSegment(raw.slice(url.origin.length))],
  ["client_id host is an IP address", (url) => isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0],
  // The client_id is compared byte for byte with the document's, so a URL the
  // parser would rewrite (case, default port, percent-encoding) is not the URL
  // it names.
  ["client_id is not in canonical form", (url, raw) => url.href !== raw],
];

function hasDotSegment(pathAndQuery: string): boolean {
  const path = pathAndQuery.split(/[?#]/, 1)[0] ?? "";
  return path.split("/").some((segment) => segment === "." || segment === "..");
}

/**
 * The URL rules of the draft (§3): https, a path, no fragment, no credentials, no
 * dot segments; and of this server: a host name, not an IP literal. A query is
 * discouraged by the draft but not forbidden, so it is allowed. Returns the
 * parsed URL, or throws naming the rule that failed.
 */
export function parseClientIdMetadataUrl(clientId: string): URL {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new ClientMetadataDocumentError("client_id is not a URL");
  }
  const broken = URL_RULES.find(([, breaks]) => breaks(url, clientId));
  if (broken) throw new ClientMetadataDocumentError(broken[0]);
  return url;
}

/** IPv4 ranges a server-side fetch must never reach, as [network, prefix length]. */
const NON_PUBLIC_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, where cloud metadata services live
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 3], // multicast, reserved, broadcast
];

function v4ToInt(address: string): number {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

function inV4Range(address: string, [network, bits]: readonly [string, number]): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(v4ToInt(address) / size) === Math.floor(v4ToInt(network) / size);
}

function isNonPublicV4(address: string): boolean {
  return NON_PUBLIC_V4.some((range) => inV4Range(address, range));
}

/** IPv6 prefixes refused, by the value of the first 16 bits under a mask. */
const NON_PUBLIC_V6: ReadonlyArray<readonly [number, number]> = [
  [0xfe00, 0xfc00], // unique local fc00::/7
  [0xffc0, 0xfe80], // link-local fe80::/10
  [0xff00, 0xff00], // multicast ff00::/8
  [0xffff, 0x0064], // NAT64 64:ff9b::/96 reaches v4 private space
];

function isNonPublicV6(address: string): boolean {
  if (address === "::" || address === "::1" || address.startsWith("2001:db8:")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1];
  if (mapped) return isNonPublicV4(mapped);
  const first = Number.parseInt(address.split(":")[0] || "0", 16);
  return NON_PUBLIC_V6.some(([mask, value]) => (first & mask) === value);
}

/** Whether `address` (v4 or v6) is somewhere a server-side fetch must never go. */
export function isNonPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isNonPublicV4(address);
  if (version === 6) return isNonPublicV6(address.toLowerCase());
  return true;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameButPort(allowed: string, requested: URL): boolean {
  let candidate: URL;
  try {
    candidate = new URL(allowed);
  } catch {
    return false;
  }
  return (
    candidate.protocol === requested.protocol &&
    candidate.hostname === requested.hostname &&
    candidate.pathname === requested.pathname &&
    candidate.search === requested.search
  );
}

/**
 * RFC 8252 §7.3: a native app listens on an ephemeral loopback port, so a
 * loopback redirect URI matches on everything BUT the port. Applied only to a
 * metadata-document client, whose document cannot know the port in advance
 * (`https://claude.ai/oauth/claude-code-client-metadata` lists
 * `http://localhost/callback`); a registered client keeps the exact match.
 */
export function matchesLoopbackRedirectUri(registered: readonly string[], redirectUri: string): boolean {
  let requested: URL;
  try {
    requested = new URL(redirectUri);
  } catch {
    return false;
  }
  if (requested.protocol !== "http:" || !LOOPBACK_HOSTS.has(requested.hostname)) return false;
  if (requested.username || requested.password || requested.hash) return false;
  return registered.some((allowed) => sameButPort(allowed, requested));
}
