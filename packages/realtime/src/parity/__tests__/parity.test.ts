import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FUTURE_PAY_PUBLISHER_DECLARATIONS,
  runPublisherParity,
  type PublisherEntry,
} from "../index";

/**
 * The publisher-parity gate.
 *
 * What it defends: a domain is AUTHORIZABLE the moment it is registered, so without an
 * emitter a screen connects, is told it is live, SLOWS its poll and hears nothing — ending
 * up staler than before it adopted realtime while announcing the opposite. The compiler
 * forces every domain to appear in the host's map; only this checks the map is TRUE.
 */

/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the subject: this gate
   reads a host's declared publisher modules and its ratchet file, so mocking the reads
   would leave the suite asserting against a fixture rather than against the behaviour that
   fails CI. Every path is inside a fresh mkdtemp per case, so there is nothing to race. */

/** A throwaway repo root with the files a case needs. */
function fakeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "realtime-parity-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const EMPTY_BASELINE = JSON.stringify({ silent: [] });

const publishes = (module: string): PublisherEntry => ({
  scheme: "tenant",
  domain: "kitchen",
  declaration: { kind: "publishes", module },
});

describe("runPublisherParity — a publishes claim must be true", () => {
  it("passes when the declared module really calls publishRealtimeEvent", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": 'await publishRealtimeEvent(topic, { type: "x", data: {} });',
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    expect(
      runPublisherParity({ root, declarations: [publishes("lib/kitchen-hints.ts")] }),
    ).toMatchObject({ ok: true, publishing: 1, silent: [] });
  });

  it("matches a call that narrows the envelope's generic", () => {
    // A literal `"publishRealtimeEvent("` match declared a real publisher missing on this
    // gate's very first run: `publishRealtimeEvent<Wire["data"]>(…)`.
    const root = fakeRepo({
      "lib/hints.ts": 'publishRealtimeEvent<ResearchWire["data"]>(topic, event);',
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    expect(runPublisherParity({ root, declarations: [publishes("lib/hints.ts")] }).ok).toBe(true);
  });

  it("fails when the declared module does not exist", () => {
    const root = fakeRepo({ ".realtime-silent-domains.json": EMPTY_BASELINE });
    const result = runPublisherParity({ root, declarations: [publishes("lib/missing.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("does not exist");
  });

  it("fails when the module exists but never emits", () => {
    // Otherwise the declaration is just a second place to be wrong.
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "export function publishKitchenChanged() { /* TODO */ }",
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    const result = runPublisherParity({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("never calls publishRealtimeEvent");
  });
});

describe("runPublisherParity — the shrink-only ratchet", () => {
  const silentKitchen: PublisherEntry = {
    scheme: "tenant",
    domain: "kitchen",
    declaration: { kind: "silent", ticket: "12-99", why: "no emitter yet" },
  };

  it("accepts a silent domain that the baseline already lists", () => {
    const root = fakeRepo({
      ".realtime-silent-domains.json": JSON.stringify({ silent: ["tenant:kitchen"] }),
    });
    expect(runPublisherParity({ root, declarations: [silentKitchen] })).toMatchObject({
      ok: true,
      silent: ["tenant:kitchen"],
      publishing: 0,
    });
  });

  it("refuses a NEW silent domain — you cannot grandfather one", () => {
    const root = fakeRepo({ ".realtime-silent-domains.json": EMPTY_BASELINE });
    const result = runPublisherParity({ root, declarations: [silentKitchen] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("may only shrink");
  });

  it("refuses a STALE entry — adding the publisher is never enough, the line must go", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      ".realtime-silent-domains.json": JSON.stringify({ silent: ["tenant:kitchen"] }),
    });
    const result = runPublisherParity({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("which now publish");
  });

  it("fails when the baseline file is missing rather than assuming an empty one", () => {
    const root = fakeRepo({ "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);" });
    const result = runPublisherParity({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("missing baseline");
  });

  it("reads the baseline from a custom path", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      "config/silent.json": EMPTY_BASELINE,
    });
    expect(
      runPublisherParity({
        root,
        declarations: [publishes("lib/kitchen-hints.ts")],
        baselineFile: "config/silent.json",
      }).ok,
    ).toBe(true);
  });
});

describe("runPublisherParity — it cannot pass vacuously", () => {
  it("fails on an empty declaration set", () => {
    // Zero declarations would make every other check vacuously green — the exact shape of
    // the failure this gate exists to catch.
    const root = fakeRepo({ ".realtime-silent-domains.json": EMPTY_BASELINE });
    const result = runPublisherParity({ root, declarations: [] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("no publisher declarations");
  });
});

describe("the shipped future-pay defaults", () => {
  it("declares every subscribable domain of both schemes, all publishing", () => {
    // Shipped so a host with the future-pay layout adopts the gate with no configuration —
    // the same reason `@12-apps/rbac/coverage` ships `FUTURE_PAY_RBAC_GUARDS`.
    expect(FUTURE_PAY_PUBLISHER_DECLARATIONS.map((entry) => `${entry.scheme}:${entry.domain}`))
      .toEqual([
        "tenant:kitchen",
        "tenant:tables",
        "tenant:orders",
        "tenant:comanda",
        "tenant:research-run",
        "user:consent",
        "user:notifications",
      ]);
    expect(
      FUTURE_PAY_PUBLISHER_DECLARATIONS.every((entry) => entry.declaration.kind === "publishes"),
    ).toBe(true);
  });
});
