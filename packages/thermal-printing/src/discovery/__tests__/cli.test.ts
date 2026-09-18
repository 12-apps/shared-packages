import { describe, expect, it } from "vitest";

import { parseOrigins, runFinder } from "../cli";
import type { FinderOptions } from "../cli";

/**
 * The helper's own half, and mostly the one thing it must refuse.
 *
 * A bridge that started with no allowed origin would be a port scanner every
 * website the merchant has open could aim at the shop's network — so "no
 * origins" is not a missing default to fill in, it is a refusal, and it is
 * asserted as one.
 */

/** TEST-NET-1 is routed nowhere, so the startup sweep is quick and identical
 *  on every machine — never the CI runner's own network. */
const DEAD_RANGE: FinderOptions["scanOptions"] = {
  probeTimeoutMs: 80,
  statusTimeoutMs: 80,
  interfaces: [
    {
      name: "test0",
      address: "192.0.2.2",
      netmask: "255.255.255.252",
      family: "IPv4",
      internal: false,
    },
  ],
};

describe("parseOrigins", () => {
  it("takes repeated flags", () => {
    expect(parseOrigins(["--origin", "https://a.test", "--origin", "https://b.test"], {})).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });

  it("reads the environment a branded build bakes its origin into", () => {
    // A merchant double-clicks an icon; nobody is typing a flag.
    expect(parseOrigins([], { PRINTER_FINDER_ORIGINS: "https://admin.test, https://b.test" })).toEqual(
      ["https://admin.test", "https://b.test"],
    );
  });

  it("keeps one copy of an origin given twice", () => {
    expect(
      parseOrigins(["--origin", "https://a.test"], { PRINTER_FINDER_ORIGINS: "https://a.test" }),
    ).toEqual(["https://a.test"]);
  });

  it("finds none in an empty environment, which is what must stop a start", () => {
    expect(parseOrigins([], {})).toEqual([]);
    expect(parseOrigins([], { PRINTER_FINDER_ORIGINS: "" })).toEqual([]);
    expect(parseOrigins(["--origin"], {})).toEqual([]);
  });
});

describe("runFinder", () => {
  it("refuses to start with no allowed origin", async () => {
    await expect(runFinder({ allowedOrigins: [], log: () => {} })).rejects.toThrow(
      /no allowed origin/,
    );
  });

  it("serves the bridge and says where, without the startup sweep stopping it", async () => {
    // Everything the assertion reads is declared and consumed inside this test:
    // nothing survives it, so no other test can be affected by what it collects
    // and no hook has to reach in to tidy up.
    const written: string[] = [];
    const bridge = await runFinder({
      allowedOrigins: ["https://admin.test"],
      port: 0,
      ttlMs: 60_000,
      scanOptions: DEAD_RANGE,
      log: (line) => {
        written.push(line);
      },
    });

    try {
      expect(written[0]).toContain(`127.0.0.1:${bridge.port}`);
      // The merchant's real interface is the browser, so the console points
      // back at it rather than trying to be one.
      expect(written.join("\n")).toContain("browser");
    } finally {
      await bridge.close();
    }
  });
});
