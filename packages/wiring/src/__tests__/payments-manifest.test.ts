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
    // SIBLING @12-apps/payments-e2e), env (zero process.env reads).
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

  it("declares the reconcile sweep whole: cadence, no-retry posture and lease", () => {
    const server = serverOf();
    expect(server.jobs?.namespace).toBe("payments");
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
