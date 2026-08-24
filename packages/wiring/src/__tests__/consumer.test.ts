import { describe, expect, it } from "vitest";

import { createWiringHost, renderWiringReport, unclaimedRoutes } from "../consumer";
import { isIsolatedDb } from "../contract/db";
import { WiringAssemblyError } from "../errors";
import { memoryEmailPort } from "../ports";
import { defineManifest, defineServerManifest } from "../producer";
import {
  notesManifest,
  notesServerManifest,
  PT_BR_NOTES_COPY,
  EN_US_NOTES_COPY,
  type NotesCopy,
  type NotesCopySource,
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
    observability: { declined: "the capabilities suite owns this" },
    bindings: {
      http: { mountPath: MOUNT, config: { store: deps.store, copy: PT_BR_NOTES_COPY } },
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
    // The FULL factory result, surfaces-style: routes are mounted above, and
    // whatever else the factory returned rides on `http[packageName]` — the
    // entity-lifecycle `entity`/`stores` case.
    expect(
      (assembled.http["@12-apps/delivery-notes"] as { store: unknown }).store,
    ).toBe(store);
    expect(assembled.permissions[0]?.ids).toEqual(["notes:read", "notes:manage"]);
    expect(assembled.notifications[0]?.type).toBe("notes.created");
    expect(assembled.mcpEndpoints.map((tool) => tool.operationId)).toEqual([
      "listDeliveryNotes",
      "addDeliveryNote",
    ]);
    // Absolutized from the http binding's mountPath, in OpenAPI form.
    expect(assembled.mcpEndpoints[0]?.path).toBe("/api/admin/{tenantSlug}/notes");
    expect(assembled.mcpEndpoints[0]?.annotations?.readOnly).toBe(true);
    const db = assembled.db[0]?.contribution;
    expect(db && !isIsolatedDb(db) ? db.partial : undefined).toBe("prisma/delivery-notes.prisma");

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
      observability: { declined: "the capabilities suite owns this" },
      bindings: {
        http: { mountPath: MOUNT, config: { store: deps.store, copy: PT_BR_NOTES_COPY } },
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
        observability: { declined: "the capabilities suite owns this" },
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

  it("collects an isolated db contribution and names its pg schema in the report", () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: {} });
    host.adoptServer({
      manifest: {
        name: "@12-apps/ledger",
        contract: 1,
        db: {
          mode: "isolated",
          schema: "prisma/schema.prisma",
          migrations: "prisma/migrations",
          pgSchema: "ledger",
        },
      },
      server: { name: "@12-apps/ledger" },
    });
    const assembled = host.assemble();
    const contribution = assembled.db[0]?.contribution;
    expect(contribution && isIsolatedDb(contribution) ? contribution.pgSchema : undefined).toBe(
      "ledger",
    );
    const entry = assembled.report.packages[0]?.capabilities.find((c) => c.kind === "db");
    expect(entry?.status).toBe("collected");
    expect(entry?.detail).toContain('isolated in pg schema "ledger"');
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

/**
 * The property the `locale` field on `WireRequest` exists to buy: ONE mount,
 * built once for the life of the process, answering two readers in their own
 * languages.
 *
 * This is the seam's whole reason for being. A package that states its copy as
 * a required config field can be locale-aware only if something tells it who is
 * reading, and the mount cannot — it happened at boot. So the tag rides on the
 * request, and the package resolves at the moment it needs a sentence.
 */
describe("one mount, two languages", () => {
  /** What a bilingual host writes: `localeCopy(PACK)`, spelled out. */
  const resolver = ({ locale }: { readonly locale?: string | null }) =>
    locale === "en-US" ? EN_US_NOTES_COPY : PT_BR_NOTES_COPY;

  function mountWith(copy: NotesCopySource<NotesCopy>) {
    // Named apart from the `host` every `it` below declares: the flakiness gate
    // reads a binding of that name at describe scope as state the tests share.
    const mounted = createWiringHost({
      name: "api",
      kind: "server",
      ports: { email: memoryEmailPort().port },
    });
    mounted.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      observability: { declined: "the capabilities suite owns this" },
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore(), copy } },
        jobs: { declined: "no worker in this harness" },
        email: {},
      },
    });
    const listing = mounted
      .assemble()
      .routes.find((mounted) => mounted.route.method === "GET" && mounted.route.path === "/notes");
    return (locale?: string) =>
      listing?.route.handle({
        actor: { tenantId: "t1", canManage: false },
        params: {},
        query: {},
        locale,
      } as never) as Promise<{ body: { empty: string | null } }>;
  }

  it("answers each reader from a single mount", async () => {
    const call = mountWith(resolver);
    expect((await call("pt-BR")).body.empty).toBe("Nenhuma nota.");
    expect((await call("en-US")).body.empty).toBe("No notes.");
  });

  it("answers the configured words when the adapter populated no locale", async () => {
    // Absent is not an error: a host with one audience never sets it, and the
    // package must answer rather than invent a language.
    const call = mountWith(resolver);
    expect((await call()).body.empty).toBe("Nenhuma nota.");
  });

  it("leaves a host that passes plain copy exactly as it was", async () => {
    // The adoption cost of this seam for a single-audience host: zero.
    const call = mountWith(PT_BR_NOTES_COPY);
    expect((await call("en-US")).body.empty).toBe("Nenhuma nota.");
  });
});

describe("refusals", () => {
  it("refuses to assemble while a declared capability is unanswered", () => {
    const host = createWiringHost({ name: "api", kind: "server" });
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      observability: { declined: "the capabilities suite owns this" },
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore(), copy: PT_BR_NOTES_COPY } },
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
      observability: { declined: "the capabilities suite owns this" },
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore(), copy: PT_BR_NOTES_COPY } },
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
    const rival = defineManifest({
      name: "@12-apps/rival",
      contract: 1,
      server: ["http"],
      observability: { namespace: "rival" },
    });
    const rivalAnswers = { observability: { declined: "collision is the subject here" } };
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
      ...rivalAnswers,
      manifest: rival,
      server: rivalServer,
      bindings: { http: { mountPath: MOUNT, config: {} } },
    });
    host.adoptServer({
      manifest: notesManifest,
      server: notesServerManifest,
      observability: { declined: "the capabilities suite owns this" },
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore(), copy: PT_BR_NOTES_COPY } },
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
      observability: { declined: "the capabilities suite owns this" },
      bindings: {
        http: { mountPath: MOUNT, config: { store: memoryStore(), copy: PT_BR_NOTES_COPY } },
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
      observability: { declined: "the capabilities suite owns this" },
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
