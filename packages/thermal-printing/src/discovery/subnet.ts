/**
 * Which addresses are worth knocking on.
 *
 * Nothing in Node — or in any operating system — answers "what printers are on
 * this network?". There is no registry to read: a receipt printer with an
 * address is a device that opened a TCP port and told nobody. So finding one
 * means knocking on every door in the building, and the only interesting
 * question is which building.
 *
 * That question is this module, and it is kept apart from the knocking because
 * it is pure arithmetic over what the host's own interfaces report — testable
 * with no socket anywhere near it, which is the same trade the line model makes
 * against the encoders.
 */

/**
 * The most doors we will knock on in one range.
 *
 * A /24 is 253 probes and sweeps in about two seconds, which is the common
 * case. A /22 is 1,022 and takes closer to eight — slow, but still an answer,
 * and a shop really on a /22 would rather wait than be told there is no
 * printer. Past this, the range is not swept as given; see
 * {@link NARROW_TO_PREFIX}.
 */
export const MAX_SCAN_HOSTS = 1_024;

/**
 * What a network too wide for {@link MAX_SCAN_HOSTS} is cut down to.
 *
 * A VPN client, a corporate WLAN or a badly configured router will hand out a
 * /16, and enumerating that is 65,534 connections — minutes of work, a file
 * descriptor storm, and something that looks like a port scan to any monitoring
 * on the network. Such a range is NARROWED to the /24 containing the
 * interface's own address rather than refused: the printer somebody is hunting
 * for is, in practice, the device plugged in next to them, and the /24 around
 * the counter is where it lives.
 *
 * Refusing instead would be worse — it would report "no printer found" to a
 * merchant whose printer is two addresses away.
 */
export const NARROW_TO_PREFIX = 24;

export interface ScanRange {
  /** The interface this range came from, for a UI that found more than one. */
  interfaceName: string;
  /** The host's own address on it — never probed, and worth showing. */
  selfAddress: string;
  /** Dotted-quad hosts to probe, self and the edges already removed. */
  hosts: string[];
  /** True when {@link NARROW_TO_PREFIX} cut a wider network down. */
  narrowed: boolean;
}

/** Just enough of `os.networkInterfaces()` to compute a range from. */
export interface InterfaceAddress {
  name: string;
  address: string;
  netmask: string;
  family: "IPv4" | "IPv6" | 4 | 6;
  internal: boolean;
}

function toInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // `Number` on "" is 0 and on "1e2" is 100, so the shape is checked first:
    // a netmask that parsed loosely would silently scan the wrong network.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function toDotted(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

/** How many leading 1-bits a netmask has, or `null` if it is not contiguous. */
function prefixOf(netmask: number): number | null {
  // A netmask is 1s then 0s. Inverting it must yield a value one less than a
  // power of two; anything else is a mask no router should have handed out and
  // we would rather find no printer than scan an address space we guessed at.
  const inverted = (~netmask >>> 0) + 1;
  if ((inverted & (inverted - 1)) !== 0) return null;
  let prefix = 0;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if ((netmask & (1 << bit)) === 0) break;
    prefix += 1;
  }
  return prefix;
}

function isIPv4(family: InterfaceAddress["family"]): boolean {
  return family === "IPv4" || family === 4;
}

/**
 * Turn one interface into the doors to knock on.
 *
 * Returns `null` for everything that cannot hold a shop's printer: IPv6 (a
 * receipt printer in this class is v4-only in practice), loopback, a malformed
 * or non-contiguous mask, and a /31/32 with no room for a neighbour.
 *
 * The network and broadcast addresses are dropped because they are not hosts,
 * and the interface's own address because knocking on it can only find this
 * machine — on Windows that is a real risk, where a print spooler may well be
 * listening on 9100 and would be reported as the shop's printer.
 */
export function rangeFor(entry: InterfaceAddress): ScanRange | null {
  if (!isIPv4(entry.family) || entry.internal) return null;
  const address = toInt(entry.address);
  const mask = toInt(entry.netmask);
  if (address === null || mask === null) return null;

  const declared = prefixOf(mask);
  if (declared === null || declared > 30) return null;

  // Narrowing is governed by the probe ceiling rather than by the prefix
  // directly, so a /22 that fits is swept whole and only a genuinely
  // unenumerable network pays for the cut.
  const declaredHosts = 2 ** (32 - declared) - 2;
  const narrowed = declaredHosts > MAX_SCAN_HOSTS;
  const prefix = narrowed ? NARROW_TO_PREFIX : declared;
  const effectiveMask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & effectiveMask) >>> 0;
  const broadcast = (network | (~effectiveMask >>> 0)) >>> 0;

  const hosts: string[] = [];
  for (let value = network + 1; value < broadcast && hosts.length < MAX_SCAN_HOSTS; value += 1) {
    if (value === address) continue;
    hosts.push(toDotted(value));
  }
  if (hosts.length === 0) return null;

  return { interfaceName: entry.name, selfAddress: entry.address, hosts, narrowed };
}

/**
 * Every range worth sweeping, nearest-looking first.
 *
 * A counter PC routinely has more than one: Wi-Fi and Ethernet both up, plus
 * whatever Docker, WSL or a VPN left behind. All of them are returned — the
 * printer may be on either real one and we cannot tell which from here — but
 * ordered so the most plausible is swept first, because a scan that finds the
 * printer in its first range can stop and answer in under a second.
 *
 * "Most plausible" is the smallest range: a virtual adapter is typically a
 * whole private /16 narrowed to a sparse /24, while the shop's LAN is a real
 * /24 with things on it. Ties keep the order the OS gave.
 */
export function rangesFor(entries: InterfaceAddress[]): ScanRange[] {
  const ranges: ScanRange[] = [];
  for (const entry of entries) {
    const range = rangeFor(entry);
    if (range) ranges.push(range);
  }
  return ranges
    .map((range, index) => ({ range, index }))
    .sort((a, b) => {
      // A narrowed range came from an implausibly wide mask; it goes last.
      if (a.range.narrowed !== b.range.narrowed) return a.range.narrowed ? 1 : -1;
      return a.index - b.index;
    })
    .map((entry) => entry.range);
}
