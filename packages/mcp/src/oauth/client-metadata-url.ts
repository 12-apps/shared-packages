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

/**
 * IPv4 blocks a server-side fetch must never reach: every special-use block of
 * RFC 6890 (draft-03 §10.7 MUST), as [network, prefix length].
 */
const NON_PUBLIC_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, where cloud metadata services live
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
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

/**
 * IPv6 blocks refused: the special-use blocks of RFC 6890 plus multicast, as
 * [network, prefix length]. `::ffff:0:0/96` is not here: a mapped address is
 * judged by the IPv4 address it carries.
 */
const NON_PUBLIC_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible (deprecated), e.g. ::7f00:1
  ["::ffff:0:0:0", 96], // SIIT translated addresses
  ["64:ff9b::", 96], // NAT64, which reaches v4 private space
  ["64:ff9b:1::", 48], // local-use NAT64 (RFC 8215)
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID…)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

/** The 128-bit value of an IPv6 address, embedded IPv4 tail included. */
function v6ToBigInt(address: string): bigint {
  let text = address;
  // An embedded IPv4 tail is whatever follows the last colon, when it has dots.
  // Split rather than matched: the address may come from outside, and a
  // backtracking pattern over it is a slow-input hazard.
  const v4Tail = text.slice(text.lastIndexOf(":") + 1);
  if (v4Tail.includes(".")) {
    const value = v4ToInt(v4Tail);
    text = `${text.slice(0, -v4Tail.length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.reduce((value, group) => (value << 16n) + BigInt(Number.parseInt(group || "0", 16)), 0n);
}

function inV6Range(value: bigint, [network, bits]: readonly [string, number]): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === v6ToBigInt(network) >> shift;
}

const MAPPED_V4_PREFIX = 0xffffn << 32n;

function isNonPublicV6(address: string): boolean {
  const value = v6ToBigInt(address);
  // ::ffff:a.b.c.d, in dotted or hex form, is judged as the IPv4 address it is.
  if (value >> 32n === MAPPED_V4_PREFIX >> 32n) {
    const v4 = Number(value & 0xffffffffn);
    return isNonPublicV4([v4 >>> 24, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join("."));
  }
  return NON_PUBLIC_V6.some((range) => inV6Range(value, range));
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
