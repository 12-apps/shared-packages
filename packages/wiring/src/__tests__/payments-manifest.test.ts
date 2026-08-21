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

import { paymentsBackendManifest } from "@12-apps/payments-backend/manifest";
import { paymentsBackendServerManifest } from "@12-apps/payments-backend/manifest/server";
import paymentsPackageJson from "@12-apps/payments-backend/package.json";
import type { AnyServerManifest } from "../contract/manifest";
import type { PackageManifest } from "../contract/manifest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "../producer";

const manifest: PackageManifest = paymentsBackendManifest;
const server: AnyServerManifest = paymentsBackendServerManifest;

describe("the payments-backend manifest, through wiring's own producer", () => {
  it("passes the producer assertions, server half included", () => {
    expect(defineManifest(manifest)).toBe(manifest);
    expect(defineServerManifest(manifest, server)).toBe(server);
  });

  it("declares identity, db, observability and jobs — nothing else", () => {
    expect(manifest.name).toBe("@12-apps/payments-backend");
    expect(manifest.contract).toBe(1);
    expect(manifest.db).toEqual({
      partial: "prisma/payments.prisma",
      migrations: "prisma/migrations",
    });
    // Where a wiring host files the bound handlers' reports. The package
    // itself still binds no logger anywhere — that trait is load-bearing.
    expect(manifest.observability).toEqual({ namespace: "payments" });
    expect(manifest.server).toEqual(["jobs"]);
    // Absences pinned, with their reasons in the manifest's own docblock:
    // http (two privilege-separated dispatch tables behind framework-free
    // mounts, not WireRoute descriptors), mcp and permissions (host ports),
    // e2e (the journeys ship in the SIBLING @12-apps/payments-e2e), env
    // (zero process.env reads; PAYMENTS_STUB is host-read and the OAuth
    // names are computed per provider).
    expect(manifest.web).toBeUndefined();
    expect(manifest.env).toBeUndefined();
    expect(manifest.e2e).toBeUndefined();
  });

  it("declares the reconcile sweep whole: cadence, no-retry posture and lease", () => {
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
    // Enqueue-free: no interval beside the schedule (the producer asserts
    // the XOR), and the handler takes no payload.
    expect(blueprint).not.toHaveProperty("interval");
  });

  it("mirrors db into package.json, and the exports map matches the declarations", () => {
    expect(() => assertDbMirror(manifest, paymentsPackageJson)).not.toThrow();
    expect(() => assertEnvMirror(manifest, paymentsPackageJson)).not.toThrow();
    expect(() => assertExportsMirror(manifest, paymentsPackageJson)).not.toThrow();
  });
});
