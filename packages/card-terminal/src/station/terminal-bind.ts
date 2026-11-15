/** One address of one interface, as `os.networkInterfaces()` lists it. */
export interface InterfaceAddress {
  readonly address: string;
  /** "IPv4" or "IPv6"; Node 18.0–18.3 said `4` or `6`. */
  readonly family: string | number;
  readonly internal: boolean;
}

/** The machine's interfaces by name, as `os.networkInterfaces()` answers them. */
export type NetworkInterfaces = Readonly<Record<string, readonly InterfaceAddress[] | undefined>>;

/**
 * Where the station listens for its terminal: its private
 * IPv4 addresses only — RFC 1918 and link-local — never every interface, so a
 * station with a public address does not answer on it.
 */

/** Whether `address` is an RFC 1918 or link-local IPv4 address. */
export function isPrivateIpv4(address: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Node 18.0–18.3 said `4`; every later version says "IPv4". */
const isIpv4 = (entry: InterfaceAddress): boolean => entry.family === "IPv4" || entry.family === 4;

/**
 * The addresses to listen on: each private IPv4 address of a non-loopback
 * interface, once. Never `0.0.0.0`: a public interface stays closed.
 */
export function privateBindAddresses(interfaces: NetworkInterfaces): string[] {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => isIpv4(entry) && !entry.internal && isPrivateIpv4(entry.address))
    .map((entry) => entry.address);
  return [...new Set(addresses)];
}
