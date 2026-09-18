import { describe, expect, it } from "vitest";

import {
  MAX_SCAN_HOSTS,
  NARROW_TO_PREFIX,
  rangeFor,
  rangesFor,
  type InterfaceAddress,
} from "../subnet";

/**
 * Which doors get knocked on, decided with no socket in sight.
 *
 * This half is arithmetic, and the cost of getting it wrong is not a wrong
 * answer on screen — it is a sweep that takes four minutes, or one aimed at a
 * network the merchant is not on. Both are invisible in a manual test on a
 * developer's /24, which is exactly why they are asserted here.
 */

function entry(overrides: Partial<InterfaceAddress> = {}): InterfaceAddress {
  return {
    name: "eth0",
    address: "192.168.0.10",
    netmask: "255.255.255.0",
    family: "IPv4",
    internal: false,
    ...overrides,
  };
}

describe("rangeFor", () => {
  it("enumerates a /24 without the network, broadcast or the host itself", () => {
    const range = rangeFor(entry());

    expect(range).not.toBeNull();
    expect(range?.hosts).toHaveLength(253);
    expect(range?.hosts).toContain("192.168.0.1");
    expect(range?.hosts).toContain("192.168.0.254");
    expect(range?.hosts).not.toContain("192.168.0.0");
    expect(range?.hosts).not.toContain("192.168.0.255");
  });

  it("never probes the machine it is running on", () => {
    // On Windows a local spooler may well answer on 9100, and reporting that
    // as the shop's printer is a wrong answer that survives right up until
    // the server tries to use it.
    const range = rangeFor(entry({ address: "192.168.0.10" }));

    expect(range?.hosts).not.toContain("192.168.0.10");
    expect(range?.selfAddress).toBe("192.168.0.10");
  });

  it("narrows a network too wide to enumerate down to the /24 around the host", () => {
    const range = rangeFor(entry({ address: "10.4.7.33", netmask: "255.255.0.0" }));

    expect(range?.narrowed).toBe(true);
    expect(range?.hosts).toHaveLength(253);
    expect(range?.hosts).toContain("10.4.7.1");
    expect(range?.hosts).toContain("10.4.7.254");
    // The rest of the /16 is deliberately unvisited: 65,534 probes is minutes
    // of work and looks like an attack to anything watching the network.
    expect(range?.hosts).not.toContain("10.4.8.1");
  });

  it("holds every range under the probe ceiling", () => {
    const wide = rangeFor(entry({ address: "172.16.5.9", netmask: "255.240.0.0" }));
    const moderate = rangeFor(entry({ address: "192.168.1.9", netmask: "255.255.252.0" }));

    expect(wide?.hosts.length).toBeLessThanOrEqual(MAX_SCAN_HOSTS);
    expect(moderate?.hosts.length).toBeLessThanOrEqual(MAX_SCAN_HOSTS);
  });

  it("keeps a /22 whole, since it is under the narrowing threshold", () => {
    const range = rangeFor(entry({ address: "192.168.4.9", netmask: "255.255.252.0" }));

    expect(range?.narrowed).toBe(false);
    expect(range?.hosts).toContain("192.168.5.1");
  });

  it.each([
    ["IPv6", entry({ family: "IPv6", address: "fe80::1", netmask: "ffff::" })],
    ["loopback and other internal adapters", entry({ internal: true })],
    ["a /31 with no room for a neighbour", entry({ netmask: "255.255.255.254" })],
    ["a single-host /32", entry({ netmask: "255.255.255.255" })],
    ["a non-contiguous mask no router should hand out", entry({ netmask: "255.0.255.0" })],
    ["a malformed address", entry({ address: "192.168.0" })],
    ["an out-of-range octet", entry({ address: "192.168.0.999" })],
  ])("declines %s", (_label, candidate) => {
    expect(rangeFor(candidate)).toBeNull();
  });

  it("uses the numeric family node reports on newer releases", () => {
    // `os.networkInterfaces()` moved from "IPv4" to 4 in Node 18. Accepting
    // only the string would quietly find no interfaces at all.
    expect(rangeFor(entry({ family: 4 }))).not.toBeNull();
  });
});

describe("rangesFor", () => {
  it("keeps every usable interface, dropping the ones that cannot hold a printer", () => {
    const ranges = rangesFor([
      entry({ name: "eth0" }),
      entry({ name: "lo", internal: true }),
      entry({ name: "wlan0", address: "192.168.1.20" }),
    ]);

    expect(ranges.map((range) => range.interfaceName)).toEqual(["eth0", "wlan0"]);
  });

  it("sweeps a plausible LAN before a narrowed virtual adapter", () => {
    // Docker, WSL and VPN adapters hand out wide private networks. Sweeping
    // one of those first costs a second or two before the range the printer
    // is actually on is even tried.
    const ranges = rangesFor([
      entry({ name: "docker0", address: "172.17.0.1", netmask: "255.255.0.0" }),
      entry({ name: "eth0", address: "192.168.0.10" }),
    ]);

    expect(ranges.map((range) => range.interfaceName)).toEqual(["eth0", "docker0"]);
    expect(ranges[1]?.narrowed).toBe(true);
  });

  it("holds the order the OS gave between equally plausible interfaces", () => {
    const ranges = rangesFor([
      entry({ name: "wlan0", address: "192.168.1.5" }),
      entry({ name: "eth0", address: "192.168.0.5" }),
    ]);

    expect(ranges.map((range) => range.interfaceName)).toEqual(["wlan0", "eth0"]);
  });

  it("narrows at the documented prefix", () => {
    // The constant is part of the contract: a change to it changes how long a
    // sweep takes on every merchant's machine.
    expect(NARROW_TO_PREFIX).toBe(24);
  });
});
