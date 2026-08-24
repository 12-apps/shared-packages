/**
 * `@12-apps/payments-backend`'s wiring compliance, asserted HERE rather than
 * in its own suite — the jobs-manifest move, for a different reason: the
 * payments portability ruleset (`payments/no-host-imports`) allows the
 * package no `@12-apps/wiring` import at all, type-only included, because it
 * must vendor into a repo with no wiring contract. Its manifests stay
 * untyped pure data over there, and this file gives them the same "fails in
 * a test run before any host sees it" guarantee — one package over, along a
 * dependency edge that costs nothing (payments-backend has zero runtime
 * dependencies, so no cycle can close).
 */

import { describe, expect, it } from "vitest";

import { paymentsBackendManifest, paymentsCheckoutManifest } from "@12-apps/payments-backend/manifest";
import {
  paymentsBackendServerManifest,
  paymentsCheckoutServerManifest,
} from "@12-apps/payments-backend/manifest/server";
import paymentsPackageJson from "@12-apps/payments-backend/package.json";
import {
  paymentsE2eManifest,
  paymentsPlatformE2eManifest,
} from "@12-apps/payments-e2e/manifest";
import paymentsE2ePackageJson from "@12-apps/payments-e2e/package.json";
import type { AnyServerManifest } from "../contract/manifest";
import type { PackageManifest } from "../contract/manifest";
import type { EmailPort } from "../contract/email";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "../producer";

const manifest: PackageManifest = paymentsBackendManifest;
const checkout: PackageManifest = paymentsCheckoutManifest;

/** The words a compliance run supplies where a host would supply its own. */
const COPY = {
  subject: (receipt: { reference: string }) => `r ${receipt.reference}`,
  text: () => "t",
  html: () => "<p>t</p>",
};

/** Read afresh per test — the flakiness lane refuses shared test-scope bindings. */
function serverOf(): AnyServerManifest {
  return paymentsBackendServerManifest({ receiptCopy: COPY }) as AnyServerManifest;
}

describe("the payments-backend manifests, through wiring's own producer", () => {
  it("passes the producer assertions, both identities, server halves included", () => {
    expect(defineManifest(manifest)).toBe(manifest);
    expect(defineManifest(checkout)).toBe(checkout);
    const server = serverOf();
    expect(defineServerManifest(manifest, server)).toBe(server);
    expect(
      defineServerManifest(checkout, paymentsCheckoutServerManifest as AnyServerManifest),
    ).toBe(paymentsCheckoutServerManifest);
  });

  it("declares the library surface whole: http, jobs and the receipt mailer", () => {
    expect(manifest.name).toBe("@12-apps/payments-backend");
    expect(manifest.contract).toBe(1);
    expect(manifest.db).toEqual({
      partial: "prisma/payments.prisma",
      migrations: "prisma/migrations",
    });
    expect(manifest.observability).toEqual({ namespace: "payments" });
    expect(manifest.server).toEqual(["http", "jobs", "email"]);
    // Absences pinned, with their reasons in the manifest's own docblock:
    // mcp and permissions (host ports), e2e (the journeys ship in the
    // SIBLING @12-apps/payments-e2e, which declares them in ITS own manifest
    // — see below), env (zero process.env reads).
    expect(manifest.web).toBeUndefined();
    expect(manifest.env).toBeUndefined();
    expect(manifest.e2e).toBeUndefined();
  });

  it("keeps the privilege split as two manifests — the buyer surface has one capability", () => {
    expect(checkout.name).toBe("@12-apps/payments-checkout");
    expect(checkout.server).toEqual(["http"]);
    expect(checkout.db).toBeUndefined();
    expect(checkout.observability).toEqual({ namespace: "payments-checkout" });
  });

  it("declares ALL FOUR sweeps — the three that were host code have moved in", () => {
    // The blueprint set was one entry while the adaptation report assigned
    // four; the other three lived in the origin host, each a restatement of
    // package knowledge, and any host that never wrote them silently had no
    // webhook drain, no activation repair and no OAuth renewal at all.
    const server = serverOf();
    expect(server.jobs?.namespace).toBe("payments");
    expect(Object.values(server.jobs?.blueprints ?? {}).map((job) => job.name)).toEqual([
      "reconcile-pending",
      "webhook-drain",
      "reconcile-activations",
      "oauth-renewal",
    ]);
  });

  it("declares the reconcile sweep whole: cadence, no-retry posture and lease", () => {
    const server = serverOf();
    const blueprint = server.jobs?.blueprints["reconcilePending"];
    expect(blueprint).toMatchObject({
      name: "reconcile-pending",
      queue: "sweeps",
      concurrency: 1,
      schedule: { pattern: "*/5 * * * *" },
      // The policy the origin host stated by hand for as long as it was the
      // only host with a sweep: the next tick is the retry, and one pass may
      // hold the single-flight name for the cadence itself.
      attempts: 1,
      lease: { ttlMs: 5 * 60_000 },
    });
    expect(blueprint).not.toHaveProperty("interval");
  });

  it("gives every sweep the single-flight posture, and the longest lease to the one that calls out", () => {
    const blueprints = serverOf().jobs?.blueprints ?? {};
    for (const job of Object.values(blueprints)) {
      // Not tuning, in any of the four: two passes interleaved on one row read
      // the same pre-apply answer, and for the renewal they invalidate each
      // other's rotated tokens. Concurrency bounds one process; the lease
      // bounds all of them.
      expect(job.queue).toBe("sweeps");
      expect(job.concurrency).toBe(1);
      // The next tick IS the retry, in every case — an immediate retry would
      // hammer a path that just demonstrated it is unwell, and for the renewal
      // it would re-present a refresh token the provider may have rotated.
      expect(job.attempts).toBe(1);
      expect(job.lease?.ttlMs).toBeGreaterThan(0);
    }
    // The drain re-VERIFIES each row against the provider — an outbound call
    // per delivery for an unsigned provider — so its ttl is the longest; the
    // activation pass makes no provider call at all, so its ttl is the shortest.
    expect(blueprints["webhookDrain"]?.lease?.ttlMs).toBe(20 * 60_000);
    expect(blueprints["reconcileActivations"]?.lease?.ttlMs).toBe(5 * 60_000);
    expect(blueprints["oauthRenewal"]?.lease?.ttlMs).toBe(10 * 60_000);
  });

  it("renews hourly against a window measured in weeks — the runway, not polling", () => {
    // The cadence only decides how fast a transient provider outage is retried.
    // A lapsed grant does not degrade: every charge for that merchant stops at
    // once and only the owner can undo it.
    const renewal = serverOf().jobs?.blueprints["oauthRenewal"];
    expect(renewal?.schedule).toEqual({ pattern: "0 * * * *" });
  });

  it("builds the receipt mailer over the contract's own port shape", async () => {
    const sent: { to: string; subject: string }[] = [];
    const port: EmailPort = {
      send: async (to, message) => {
        sent.push({ to, subject: message.subject });
      },
    };
    const mailer = serverOf().email?.createMailer(port) as {
      sendReceipt(to: string, receipt: unknown): Promise<void>;
    };
    await mailer.sendReceipt("ana@example.com", {
      reference: "inv_1",
      amountCents: 7500,
      currency: "BRL",
      method: "pix",
      paidAt: new Date(0),
    });
    expect(sent).toEqual([{ to: "ana@example.com", subject: "r inv_1" }]);
  });

  it("mirrors db into package.json, and the exports map matches the declarations", () => {
    expect(() => assertDbMirror(manifest, paymentsPackageJson)).not.toThrow();
    expect(() => assertEnvMirror(manifest, paymentsPackageJson)).not.toThrow();
    expect(() => assertExportsMirror(manifest, paymentsPackageJson)).not.toThrow();
  });
});

/**
 * The journeys' own manifest, asserted here for the same reason as the
 * backend's: `payments/no-host-imports` forbids the package a wiring import,
 * so the producer assertions run one package over.
 */
describe("the payments-e2e manifests, through wiring's own producer", () => {
  it("passes the producer assertions on both worlds", () => {
    expect(defineManifest(paymentsE2eManifest as PackageManifest)).toBe(paymentsE2eManifest);
    expect(defineManifest(paymentsPlatformE2eManifest as PackageManifest)).toBe(
      paymentsPlatformE2eManifest,
    );
  });

  it("declares the world by its exported factory, so a host must bind or decline it", () => {
    // This is what the backend manifest could not say: its `e2e` narrowing is
    // correct (a manifest must not declare another package's entry), and it
    // left the journeys declared by NOBODY. Adoption was by convention, which
    // is invisible to `assemble()` — a host that never adopted them looked
    // exactly like one that did.
    const checkoutWorld: PackageManifest = paymentsE2eManifest;
    expect(checkoutWorld.e2e).toEqual({
      entry: "@12-apps/payments-e2e",
      world: { factory: "definePaymentsWorld" },
    });
    const platformWorld: PackageManifest = paymentsPlatformE2eManifest;
    expect(platformWorld.e2e).toEqual({
      entry: "@12-apps/payments-e2e",
      world: { factory: "definePaymentsPlatformWorld" },
    });
  });

  it("keeps the two OPT-IN worlds as two manifests", () => {
    // Folding the platform journeys into `PaymentsWorld` would have broken
    // every checkout-only consumer, which is why they are a separate port and
    // glob triple. Two manifests keep that expressible: a host binds one and
    // declines the other in writing.
    expect(paymentsE2eManifest.name).toBe("@12-apps/payments-e2e");
    expect(paymentsPlatformE2eManifest.name).toBe("@12-apps/payments-platform-e2e");
  });

  it("declares no runtime half, so it owes no observability namespace", () => {
    // The capability is mandatory only for manifests that ship running code.
    // Journeys are compiled and executed by the HOST's Playwright.
    const shared: PackageManifest = paymentsE2eManifest;
    expect(shared.observability).toBeUndefined();
    expect(shared.server).toBeUndefined();
    expect(shared.web).toBeUndefined();
  });

  it("mirrors its manifest subpath into package.json — the #1008 tripwire", () => {
    expect(() =>
      assertExportsMirror(paymentsE2eManifest as PackageManifest, paymentsE2ePackageJson),
    ).not.toThrow();
  });
});
