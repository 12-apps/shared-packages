import { describe, expect, it } from "vitest";

import { createWiringHost, renderWiringReport, unclaimedRoutes } from "../consumer";
import { WiringAssemblyError } from "../errors";
import { memoryEmailPort } from "../ports";
import { defineManifest, defineServerManifest } from "../producer";
import {
  notesManifest,
  notesServerManifest,
  notesWebManifest,
  type NotesJobDeps,
  type NotesStore,
} from "./fixture-package";

function memoryStore(): NotesStore & { rows: string[] } {
  const rows: string[] = [];
  return {
    rows,
    list: () => Promise.resolve([...rows]),
    add: (_tenantId, text) => {
      rows.push(text);
      return Promise.resolve();
    },
  };
}

const MOUNT = "/api/admin/:tenantSlug";

function adoptNotes(host: ReturnType<typeof createWiringHost>, deps: NotesJobDeps) {
  return host.adoptServer({
    manifest: notesManifest,
    server: notesServerManifest,
    bindings: {
      http: { mountPath: MOUNT, config: { store: deps.store } },
      jobs: { deps },
      email: {},
    },
  });
}

describe("a server host adopting the fixture package", () => {
  it("binds every capability and assembles the aggregate", async () => {
    const email = memoryEmailPort();
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: email.port } });
    const store = memoryStore();
    const deps: NotesJobDeps = { store, ran: [] };
    const { mailer } = adoptNotes(host, deps);
    const assembled = host.assemble();

    expect(assembled.routes).toHaveLength(4);
    expect(assembled.permissions[0]?.ids).toEqual(["notes:read", "notes:manage"]);
    expect(assembled.notifications[0]?.type).toBe("notes.created");
    expect(assembled.mcpEndpoints.map((tool) => tool.operationId)).toEqual([
      "listDeliveryNotes",
      "addDeliveryNote",
    ]);
    // Absolutized from the http binding's mountPath, in OpenAPI form.
    expect(assembled.mcpEndpoints[0]?.path).toBe("/api/admin/{tenantSlug}/notes");
    expect(assembled.mcpEndpoints[0]?.annotations?.readOnly).toBe(true);
    expect(assembled.db[0]?.contribution.partial).toBe("prisma/delivery-notes.prisma");

    const job = assembled.jobs[0];
    expect(job?.name).toBe("notes.digest");
    expect(job?.schedule?.pattern).toBe("0 7 * * *");
    await job?.handle(undefined as never, {
      runId: "r1",
      attempt: 1,
      maxAttempts: 1,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    expect(deps.ran).toEqual(["digest"]);

    await mailer.sendDigest("owner@example.com", 2);
    expect(email.sent[0]?.to).toBe("owner@example.com");
    expect(email.sent[0]?.message.subject).toContain("2");
  });

  it("applies MCP overrides by operationId and refuses one for an undeclared tool", () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    const deps: NotesJobDeps = { store: memoryStore(), ran: [] };
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      bindings: {
        http: { mountPath: MOUNT, config: { store: deps.store } },
        jobs: { deps },
        email: {},
      },
      mcpOverrides: { listDeliveryNotes: { summary: "List notes for THIS host." } },
    });
    const { mcpEndpoints } = host.assemble();
    expect(mcpEndpoints[0]?.summary).toBe("List notes for THIS host.");
    expect(mcpEndpoints[0]?.path).toBe("/api/admin/{tenantSlug}/notes");

    const other = createWiringHost({ name: "api2", kind: "server" });
    expect(() =>
      other.adoptServer({
        manifest: notesManifest,
        server: notesServerManifest,
        mcpOverrides: { nope: { summary: "?" } },
      }),
    ).toThrow(/does not declare/);
  });

  it("orders routes most-specific-first", () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    const deps: NotesJobDeps = { store: memoryStore(), ran: [] };
    adoptNotes(host, deps);
    const paths = host
      .assemble()
      .routes.filter((mounted) => mounted.route.method === "GET")
      .map((mounted) => mounted.route.path);
    expect(paths).toEqual(["/notes/drafts", "/notes/:id", "/notes"]);
  });

  it("reports every capability with its status", () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    adoptNotes(host, { store: memoryStore(), ran: [] });
    const { report } = host.assemble();
    const byKind = new Map(
      report.packages[0]?.capabilities.map((entry) => [entry.kind, entry.status]),
    );
    expect(byKind.get("http")).toBe("bound");
    expect(byKind.get("jobs")).toBe("bound");
    expect(byKind.get("email")).toBe("bound");
    expect(byKind.get("permissions")).toBe("collected");
    expect(byKind.get("surface")).toBe("out-of-scope");
    expect(renderWiringReport(report)).toContain("@12-apps/delivery-notes");
  });

  it("names the routes a file-per-endpoint host has not claimed", () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    adoptNotes(host, { store: memoryStore(), ran: [] });
    const { routes } = host.assemble();
    const missing = unclaimedRoutes(routes, [
      `GET ${MOUNT}/notes`,
      `POST ${MOUNT}/notes`,
      `GET ${MOUNT}/notes/drafts`,
    ]);
    expect(missing.map((mounted) => mounted.route.path)).toEqual(["/notes/:id"]);
  });
});

describe("refusals", () => {
  it("refuses to assemble while a declared capability is unanswered", () => {
    const host = createWiringHost({ name: "api", kind: "server" });
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore() } },
        jobs: { declined: "no worker in this harness" },
        email: {},
      },
    });
    expect(() => host.assemble()).toThrow(/email/);
  });

  it("accepts a written decline and shows it in the report", () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore() } },
        jobs: { declined: "no worker in this harness" },
        email: {},
      },
    });
    const { jobs, report } = host.assemble();
    expect(jobs).toHaveLength(0);
    const jobsEntry = report.packages[0]?.capabilities.find((entry) => entry.kind === "jobs");
    expect(jobsEntry?.status).toBe("declined");
    expect(jobsEntry?.detail).toBe("no worker in this harness");
  });

  it("refuses a binding for a capability the manifest never declared", () => {
    const host = createWiringHost({ name: "api", kind: "server" });
    const manifest = defineManifest({ name: "@12-apps/bare", contract: 1 });
    expect(() =>
      host.adoptServer({
        manifest,
        bindings: { http: { mountPath: "/x", config: {} } } as never,
      }),
    ).toThrow(/does not declare/);
  });

  it("refuses the wrong adopt method for the host kind, and double adoption", () => {
    const web = createWiringHost({ name: "admin", kind: "web" });
    expect(() => web.adoptServer({ manifest: notesManifest })).toThrow(/web host/);
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    adoptNotes(host, { store: memoryStore(), ran: [] });
    expect(() => adoptNotes(host, { store: memoryStore(), ran: [] })).toThrow(/adopted twice/);
  });

  it("refuses two packages claiming one route", () => {
    const host = createWiringHost({ name: "api", kind: "server" });
    const rival = defineManifest({ name: "@12-apps/rival", contract: 1, server: ["http"] });
    const rivalServer = defineServerManifest(rival, {
      name: rival.name,
      http: {
        create: () => ({
          routes: [
            {
              method: "GET" as const,
              path: "/notes",
              handle: () => Promise.resolve({ status: 200, body: null }),
            },
          ],
        }),
      },
    });
    host.adoptServer({
      manifest: rival,
      server: rivalServer,
      bindings: { http: { mountPath: MOUNT, config: {} } },
    });
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore() } },
        jobs: { declined: "not this test's subject" },
        email: { declined: "not this test's subject" },
      },
    });
    expect(() => host.assemble()).toThrow(WiringAssemblyError);
    expect(() => host.assemble()).toThrow(/route claims collide/);
  });

  it("leaves email unbound when nobody provides a port", () => {
    const host = createWiringHost({ name: "api", kind: "server" });
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore() } },
        jobs: { declined: "not this test's subject" },
        email: {},
      },
    });
    expect(() => host.assemble()).toThrow(/no email port/);
  });
});

describe("a web host adopting the fixture package", () => {
  it("builds the surface once and collects the areas", () => {
    const host = createWiringHost({ name: "admin", kind: "web" });
    const { surface } = host.adoptWeb({
      manifest: notesManifest,
      web: notesWebManifest,
      bindings: { surface: { config: { apiBase: "/api/admin/loja" } } },
    });
    expect(surface.NotesPage()).toBe("notes@/api/admin/loja");
    const assembled = host.assemble();
    expect(assembled.surfaces["@12-apps/delivery-notes"]).toBe(surface);
    expect(assembled.areas[0]?.area).toBe("admin");
    expect(assembled.areas[0]?.packageName).toBe("@12-apps/delivery-notes");
    const statuses = new Map(
      assembled.report.packages[0]?.capabilities.map((entry) => [entry.kind, entry.status]),
    );
    expect(statuses.get("surface")).toBe("bound");
    expect(statuses.get("areas")).toBe("collected");
    expect(statuses.get("http")).toBe("out-of-scope");
  });
});
