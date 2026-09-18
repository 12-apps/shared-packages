import { afterEach, describe, expect, it } from "vitest";

import { ALLOW_PRIVATE_NETWORK, LOOPBACK_ONLY, startDiscoveryBridge, type BridgeHandle } from "../bridge";

/**
 * The loopback server, and mostly its refusals.
 *
 * A server on 127.0.0.1 is reachable by every page the merchant has open, so
 * the interesting assertions here are not "does it find a printer" — that is
 * the scanner's own suite — but "who is allowed to ask". Left unguarded this
 * would be a port scanner any website could aim at a shop's network and read
 * the results of, so each control below is a test rather than a comment.
 */

const ALLOWED = "https://admin.example.com";

const harness: { bridge: BridgeHandle | null } = { bridge: null };

afterEach(async () => {
  const running = harness.bridge;
  harness.bridge = null;
  if (running !== null) await running.close();
});

/** A bridge on an OS-chosen port, scanning a range with nothing in it. */
async function start(): Promise<BridgeHandle> {
  const bridge = await startDiscoveryBridge({
    allowedOrigins: [ALLOWED],
    port: 0,
    scanOptions: {
      probeTimeoutMs: 80,
      statusTimeoutMs: 80,
      interfaces: [
        {
          name: "test0",
          // TEST-NET-1 (RFC 5737): routed nowhere, so the sweep is quick.
          address: "192.0.2.2",
          netmask: "255.255.255.252",
          family: "IPv4",
          internal: false,
        },
      ],
    },
  });
  harness.bridge = bridge;
  return bridge;
}

const url = (bridge: BridgeHandle, path: string): string =>
  `http://${LOOPBACK_ONLY}:${bridge.port}${path}`;

describe("startDiscoveryBridge", () => {
  it("listens on loopback and nowhere else", async () => {
    // Binding 0.0.0.0 would expose the scan to the very network being scanned.
    const bridge = await start();
    const address = bridge.server.address();

    expect(typeof address === "object" && address !== null ? address.address : "").toBe(
      LOOPBACK_ONLY,
    );
  });

  it("answers an allowed origin, and opts into Private Network Access", async () => {
    // Without this header Chrome blocks the fetch before it is ever made, and
    // the whole feature silently does nothing.
    const bridge = await start();

    const response = await fetch(url(bridge, "/health"), { headers: { origin: ALLOWED } });

    expect(response.status).toBe(200);
    expect(response.headers.get(ALLOW_PRIVATE_NETWORK)).toBe("true");
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    await expect(response.json()).resolves.toEqual({ ok: true, protocol: 1 });
  });

  it("echoes one origin rather than a wildcard, and varies on it", async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, "/health"), { headers: { origin: ALLOWED } });

    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("refuses a page that was not on the list, and tells it nothing", async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, "/discover"), {
      headers: { origin: "https://attacker.example" },
    });

    expect(response.status).toBe(403);
    // No CORS headers on a refusal, so the calling page cannot even read this.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get(ALLOW_PRIVATE_NETWORK)).toBeNull();
  });

  it("refuses a caller that sent no origin at all", async () => {
    // Browsers always send one. Anything that does not is not the caller this
    // exists for, and a scan is not something to run for an unidentified one.
    const bridge = await start();

    const response = await fetch(url(bridge, "/discover"));

    expect(response.status).toBe(403);
  });

  it("clears the preflight Chrome sends before touching a private address", async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, "/discover"), {
      method: "OPTIONS",
      headers: { origin: ALLOWED, "access-control-request-private-network": "true" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get(ALLOW_PRIVATE_NETWORK)).toBe("true");
  });

  it("scans on demand and reports where it looked", async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, "/discover"), { headers: { origin: ALLOWED } });
    const body = (await response.json()) as {
      protocol: number;
      printers: unknown[];
      ranges: { interfaceName: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.protocol).toBe(1);
    expect(body.printers).toEqual([]);
    expect(body.ranges[0]?.interfaceName).toBe("test0");
  });

  it.each([
    ["no body at all", undefined],
    ["a missing host", { port: 9100, lines: [{ text: "x", align: "left", emphasis: "normal" }] }],
    ["a port outside the legal range", { host: "10.0.0.5", port: 70_000, lines: [{}] }],
    ["no lines to print", { host: "10.0.0.5", port: 9100, lines: [] }],
  ])("refuses a test print with %s", async (_label, body) => {
    const bridge = await start();

    const response = await fetch(url(bridge, "/test-print"), {
      method: "POST",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    expect(response.status).toBe(400);
  });

  it("has nothing at an unknown path", async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, "/nope"), { headers: { origin: ALLOWED } });

    expect(response.status).toBe(404);
  });
});
