import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runPublisherParity, type PublisherEntry } from "../index";

/**
 * The publisher-parity gate.
 *
 * What it defends: a domain is AUTHORIZABLE the moment it is registered, so without an
 * emitter a screen connects, is told it is live, SLOWS its poll and hears nothing — ending
 * up staler than before it adopted realtime while announcing the opposite.
 *
 * Two properties, and the gate needs both because either alone can pass while the failure
 * ships: the host's registry and its declarations must COVER each other, and a `publishes`
 * claim must be TRUE.
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

/** The registry every `publishes(…)` case above is complete against. */
const KITCHEN_ONLY = { tenant: ["kitchen"], user: [] };

/** `runPublisherParity` with the registry filled in, for the cases not about coverage. */
function parityOf(options: {
  root: string;
  declarations: readonly PublisherEntry[];
  domains?: { tenant: readonly string[]; user: readonly string[] };
  baselineFile?: string;
}) {
  return runPublisherParity({ ...options, domains: options.domains ?? KITCHEN_ONLY });
}

describe("runPublisherParity — a publishes claim must be true", () => {
  it("passes when the declared module really calls publishRealtimeEvent", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": 'await publishRealtimeEvent(topic, { type: "x", data: {} });',
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    expect(
      parityOf({ root, declarations: [publishes("lib/kitchen-hints.ts")] }),
    ).toMatchObject({ ok: true, publishing: 1, silent: [] });
  });

  it("matches a call that narrows the envelope's generic", () => {
    // A literal `"publishRealtimeEvent("` match declared a real publisher missing on this
    // gate's very first run: `publishRealtimeEvent<Wire["data"]>(…)`.
    const root = fakeRepo({
      "lib/hints.ts": 'publishRealtimeEvent<ResearchWire["data"]>(topic, event);',
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    expect(parityOf({ root, declarations: [publishes("lib/hints.ts")] }).ok).toBe(true);
  });

  it("fails when the declared module does not exist", () => {
    const root = fakeRepo({ ".realtime-silent-domains.json": EMPTY_BASELINE });
    const result = parityOf({ root, declarations: [publishes("lib/missing.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("does not exist");
  });

  it("fails when the module exists but never emits", () => {
    // Otherwise the declaration is just a second place to be wrong.
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "export function publishKitchenChanged() { /* TODO */ }",
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    const result = parityOf({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
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
    expect(parityOf({ root, declarations: [silentKitchen] })).toMatchObject({
      ok: true,
      silent: ["tenant:kitchen"],
      publishing: 0,
    });
  });

  it("refuses a NEW silent domain — you cannot grandfather one", () => {
    const root = fakeRepo({ ".realtime-silent-domains.json": EMPTY_BASELINE });
    const result = parityOf({ root, declarations: [silentKitchen] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("may only shrink");
  });

  it("refuses a STALE entry — adding the publisher is never enough, the line must go", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      ".realtime-silent-domains.json": JSON.stringify({ silent: ["tenant:kitchen"] }),
    });
    const result = parityOf({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("which now publish");
  });

  it("fails when the baseline file is missing rather than assuming an empty one", () => {
    const root = fakeRepo({ "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);" });
    const result = parityOf({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("missing baseline");
  });

  it("reads the baseline from a custom path", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      "config/silent.json": EMPTY_BASELINE,
    });
    expect(
      parityOf({
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
    const result = runPublisherParity({ root, declarations: [], domains: { tenant: [], user: [] } });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("no publisher declarations");
  });
});

/**
 * COMPLETENESS: the host's registry and its declarations must cover each other.
 *
 * This is what the gate could not see when `declarations` was an optional array with a
 * shipped default. A domain added to `REALTIME_DOMAINS` and forgotten in the map was not a
 * violation — it was silence — so the gate stayed green while the screen said "Ao vivo" and
 * received nothing. That is FUT-440 again, past the gate built to prevent it.
 */
describe("runPublisherParity — every subscribable domain must be accounted for", () => {
  it("REPORTS a subscribable domain that declares nothing at all", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    // The registry grew a domain; the map did not. Everything else about this run is
    // perfect — one declared publisher, one real module, an empty ratchet.
    const result = runPublisherParity({
      root,
      declarations: [publishes("lib/kitchen-hints.ts")],
      domains: { tenant: ["kitchen", "stock"], user: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("declare no publisher at all: tenant:stock");
  });

  it("reports a missing USER-scheme domain too, and names every one", () => {
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    const result = runPublisherParity({
      root,
      declarations: [publishes("lib/kitchen-hints.ts")],
      domains: { tenant: ["kitchen"], user: ["consent", "notifications"] },
    });
    expect(result.problems.join("\n")).toContain("user:consent, user:notifications");
  });

  it("counts a SILENT declaration as accounted for — that is what the ratchet is", () => {
    // Declaring a domain silent is a legitimate answer to "this has no emitter"; the
    // ratchet is what keeps it temporary. Only declaring NOTHING is the hole.
    const root = fakeRepo({
      ".realtime-silent-domains.json": JSON.stringify({ silent: ["tenant:stock"] }),
    });
    const result = runPublisherParity({
      root,
      declarations: [
        { scheme: "tenant", domain: "stock", declaration: { kind: "silent", ticket: "12-99", why: "no emitter yet" } },
      ],
      domains: { tenant: ["stock"], user: [] },
    });
    expect(result).toMatchObject({ ok: true, silent: ["tenant:stock"] });
  });

  it("does NOT mind a declaration for a domain nobody can subscribe to", () => {
    // The asymmetry is deliberate: publishing to an internal or system topic is
    // legitimate, and being subscribable with nothing to hear is the failure.
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event);",
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    expect(
      runPublisherParity({
        root,
        declarations: [publishes("lib/kitchen-hints.ts")],
        domains: { tenant: [], user: [] },
      }).ok,
    ).toBe(true);
  });
});

describe("runPublisherParity — a DOCSTRING is not a publisher", () => {
  it("fails on a module whose only mention of the call is commented out", () => {
    // The fail-open this closes: a module whose emit was refactored out but whose docstring
    // still says `publishRealtimeEvent(topic, …)`. Very live in this codebase's docstring
    // style, and the same class as the comment-defeated brace scan shipped twice before.
    const root = fakeRepo({
      "lib/kitchen-hints.ts": [
        "/**",
        " * Was: publishRealtimeEvent(tenantTopic(id, 'kitchen'), { type: 'x' });",
        " */",
        "export function publishKitchenChanged() {",
        "  // publishRealtimeEvent(topic, event);",
        "}",
      ].join("\n"),
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    const result = parityOf({ root, declarations: [publishes("lib/kitchen-hints.ts")] });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("never calls publishRealtimeEvent");
  });

  it("still passes a real call that has a comment on the same line", () => {
    // The stripper must not be able to hide a live one: that direction fails CLOSED and
    // loud, but a false violation on a working publisher is its own kind of broken gate.
    const root = fakeRepo({
      "lib/kitchen-hints.ts": "publishRealtimeEvent(topic, event); // the fan-out",
      ".realtime-silent-domains.json": EMPTY_BASELINE,
    });
    expect(parityOf({ root, declarations: [publishes("lib/kitchen-hints.ts")] }).ok).toBe(true);
  });
});

describe("the gate ships no example declarations to fall back on", () => {
  it("has no subject to invent when a host omits its own lists", () => {
    const root = fakeRepo({ ".realtime-silent-domains.json": EMPTY_BASELINE });
    // @ts-expect-error — `declarations` and `domains` are REQUIRED. This is the whole M3
    // fix at the type level: the old signature made both optional and silently substituted
    // one adopter's seven domains, so a host with a different registry got a green run.
    const result = runPublisherParity({ root });
    // And it does not fall back at runtime either: nothing to check is a violation.
    expect(result.ok).toBe(false);
  });
});
