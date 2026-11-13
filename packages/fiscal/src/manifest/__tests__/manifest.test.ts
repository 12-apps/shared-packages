import { describe, expect, it, vi } from "vitest";
import type { WireJobContext } from "@12-apps/wiring";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";
import { createWiringHost } from "@12-apps/wiring/consumer";

import packageJson from "../../../package.json";
import { DANFE_NFCE_PT_BR } from "../../danfe/pt-BR";
import { createApiFiscal } from "../../http";
import { FISCAL_JOBS } from "../../jobs";
import { createFiscalNotificationBlueprints } from "../../notifications";
import { FISCAL_PERMISSIONS, fiscalManifest } from "..";
import { fiscalServerManifest } from "../server";

/**
 * The wiring-compliance suite: the producer's assertions (the contract is a
 * type-only dependency, so they run here), the mirrors, the routes' policy,
 * and an adoption by a real wiring host.
 */

const stubApi = () =>
  createApiFiscal({ documents: {} as never, storage: {} as never, danfeLabels: DANFE_NFCE_PT_BR });

/** The jobs' clock where the case does not read it. */
const NOW = "2026-11-20T15:30:00.000Z";

describe("the fiscal manifest", () => {
  it("passes the producer assertions", () => {
    expect(defineManifest(fiscalManifest)).toBe(fiscalManifest);
    expect(defineServerManifest(fiscalManifest, fiscalServerManifest)).toBe(fiscalServerManifest);
  });

  it("declares the permissions, the db, the observability namespace and the server inventory", () => {
    expect(fiscalManifest).toEqual({
      name: "@12-apps/fiscal",
      contract: 1,
      permissions: FISCAL_PERMISSIONS,
      db: { partial: "prisma/fiscal.prisma", migrations: "prisma/migrations" },
      observability: { namespace: "fiscal" },
      server: ["http", "jobs"],
    });
    // The screens come with their own tickets; the alerts ship as a factory over host copy.
    expect(fiscalManifest).not.toHaveProperty("web");
    expect(fiscalManifest).not.toHaveProperty("notifications");
  });

  it("declares the four permissions, and only them", () => {
    expect(FISCAL_PERMISSIONS.ids).toEqual(["fiscal:read", "fiscal:manage", "fiscal:issue", "fiscal:cancel"]);
    expect(Object.keys(FISCAL_PERMISSIONS.permissions)).toEqual([...FISCAL_PERMISSIONS.ids]);
  });

  it("mirrors the db, the env absence and the exports map into package.json", () => {
    expect(() => assertDbMirror(fiscalManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(fiscalManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(fiscalManifest, packageJson)).not.toThrow();
  });

  it("ships the modules, the partial and the tables", () => {
    expect(Object.keys(packageJson.exports)).toEqual([
      "./danfe",
      "./danfe/en-US",
      "./danfe/pt-BR",
      "./documents",
      "./engine",
      "./http",
      "./issuer",
      "./jobs",
      "./manifest",
      "./manifest/server",
      "./notifications",
      "./sale",
      "./sidecar",
      "./sidecar/schema/*",
      "./tables/*",
      "./package.json",
    ]);
    expect(packageJson.files).toEqual(expect.arrayContaining(["tables", "prisma"]));
  });

  it("ships the fiscal service's sources, never its installed dependencies or its tests", () => {
    expect(packageJson.files).toContain("sidecar");
    expect(packageJson.files).toEqual(
      expect.arrayContaining(["!sidecar/vendor", "!sidecar/tests", "!sidecar/phpunit.xml"]),
    );
  });

  it("serves the ticket's routes, each behind one of the package's own permissions", () => {
    const { routes } = stubApi();
    expect(routes.map((route) => `${route.method} ${route.path} ${route.permission}`)).toEqual([
      "GET /fiscal/profile fiscal:read",
      "PUT /fiscal/profile fiscal:manage",
      "PUT /fiscal/profile/certificate fiscal:manage",
      "GET /fiscal/issuing-points fiscal:read",
      "POST /fiscal/issuing-points fiscal:manage",
      "POST /fiscal/documents fiscal:issue",
      "GET /fiscal/documents/:documentId fiscal:read",
      "POST /fiscal/documents/:documentId/cancel fiscal:cancel",
      "POST /fiscal/documents/:documentId/resend fiscal:issue",
      "POST /fiscal/documents/:documentId/release fiscal:issue",
      "POST /fiscal/documents/:documentId/lookup fiscal:read",
      "GET /fiscal/documents/:documentId/danfe fiscal:read",
    ]);
    for (const route of routes) expect(FISCAL_PERMISSIONS.ids).toContain(route.permission);
  });

  it("is adopted by a server host, which mounts the routes, binds the jobs and collects the rest", () => {
    const host = createWiringHost({ name: "host", kind: "server", ports: { loggerFor: () => ({ info() {}, warn() {}, error() {} }) } });
    host.adoptServer({
      manifest: fiscalManifest,
      server: fiscalServerManifest,
      bindings: {
        http: { mountPath: "/api/admin/:tenant", config: { documents: {} as never, storage: {} as never, danfeLabels: DANFE_NFCE_PT_BR } },
        jobs: { deps: { documents: {} as never, store: {} as never, notify: { emit: async () => ({}) }, now: () => new Date(NOW) } },
      },
    });
    const wired = host.assemble();
    expect(wired.permissions).toEqual([FISCAL_PERMISSIONS]);
    expect(wired.routes).toHaveLength(12);
    expect(wired.jobs.map((job) => job.name).sort()).toEqual(["fiscal.certificate-expiry", "fiscal.sweep", "fiscal.transmit-contingency"]);
    expect(wired.db).toEqual([expect.objectContaining({ packageName: "@12-apps/fiscal" })]);
  });
});

function context(): WireJobContext & { logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } } {
  return { runId: "run-1", attempt: 1, maxAttempts: 1, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
}

describe("the fiscal jobs", () => {
  const idle = { advanced: [], failures: [] };

  it("sweep and transmit through the service, and log failures under the job's name", async () => {
    const ctx = context();
    const sweep = vi.fn().mockResolvedValue({ advanced: [{ documentId: "d1", status: "AUTHORIZED" }], failures: [{ documentId: "d2", message: "boom" }] });
    const transmitContingency = vi.fn().mockResolvedValue(idle);
    const deps = { documents: { sweep, transmitContingency }, store: {} as never, notify: { emit: vi.fn() }, now: () => new Date(NOW) };
    await FISCAL_JOBS.blueprints.sweep.handle(undefined as never, deps, ctx);
    await FISCAL_JOBS.blueprints.transmitContingency.handle(undefined as never, deps, ctx);
    expect(sweep).toHaveBeenCalledWith(10);
    expect(transmitContingency).toHaveBeenCalledWith(10);
    expect(ctx.logger.error).toHaveBeenCalledWith("fiscal sweep failed for document d2: boom");
    expect(FISCAL_JOBS.blueprints.sweep.lease).toEqual({ ttlMs: 1_800_000 });
  });

  it("warns on the 30th, 15th, 7th, 3rd and last day, and daily once expired", async () => {
    const now = new Date("2026-11-20T10:07:00.000Z");
    const at = (days: number) => new Date(now.getTime() + days * 86_400_000 - 60_000).toISOString();
    const profiles = [30, 29, 15, 7, 3, 1, 0, -2].map((days) => ({ ownerId: `owner${days}`, certificateExpiresAt: at(days) }));
    const emit = vi.fn().mockResolvedValue({ accepted: true });
    await FISCAL_JOBS.blueprints.certificateExpiry.handle(
      undefined as never,
      { documents: {} as never, store: { listExpiringCertificates: async () => profiles as never }, notify: { emit }, now: () => now },
      context(),
    );
    expect(emit.mock.calls.map(([event]) => event.payload.daysLeft)).toEqual([30, 15, 7, 3, 1, 0, -2]);
    expect(emit.mock.calls[0]![0]).toMatchObject({ type: "fiscal.certificate-expiring", recipient: { tenantId: "owner30", permission: "fiscal:manage" } });
  });
});

describe("the fiscal notifications", () => {
  it("are blueprints over the host's words, one per event", () => {
    const [expiring, rejected, attention, deadline] = createFiscalNotificationBlueprints({
      certificateExpiring: (payload) => ({ title: `expires in ${payload.daysLeft}`, body: "renew" }),
      documentRejected: (payload) => ({ title: `rejected ${payload.code}`, body: payload.reason }),
      documentNeedsAttention: (payload) => ({ title: `look at ${payload.number}`, body: payload.reason }),
      contingencyDeadline: (payload) => ({ title: `transmit ${payload.number}`, body: payload.since }),
    });
    expect([expiring.type, rejected.type, attention.type, deadline.type]).toEqual([
      "fiscal.certificate-expiring",
      "fiscal.document-rejected",
      "fiscal.document-needs-attention",
      "fiscal.contingency-deadline",
    ]);
    expect(expiring.generate({ ownerId: "o", expiresAt: "x", daysLeft: 7 }).title).toBe("expires in 7");
    expect(() => createFiscalNotificationBlueprints({} as never)).toThrow(/certificateExpiring/);
  });
});
