/**
 * The fixture package — "@12-apps/delivery-notes", a small imaginary package
 * exercising EVERY capability the contract knows: permissions, a
 * notification blueprint, MCP tools with annotations, a Prisma partial, e2e
 * pointers, HTTP routes, a scheduled job, a mailer, a web surface and an
 * area contribution. What the tests adopt, and what the docs quote.
 */

import { defineManifest, defineServerManifest, defineWebManifest } from "../producer";
import type { WireRequest, WireResponse } from "../contract/http";

export interface NotesStore {
  list(tenantId: string): Promise<readonly string[]>;
  add(tenantId: string, text: string): Promise<void>;
}

interface NotesActor {
  tenantId: string;
  canManage: boolean;
}

/** The host vocabulary the HTTP capability requires. No defaults. */
interface NotesServerConfig {
  store: NotesStore;
}

export interface NotesJobDeps {
  store: NotesStore;
  ran: string[];
}

interface NotesMailer {
  sendDigest(to: string, count: number): Promise<void>;
}

interface NotesSurfaceConfig {
  apiBase: string;
}

/** Component types stand in as render functions — the shape is what matters. */
interface NotesSurface {
  NotesPage: () => string;
}

export const notesManifest = defineManifest({
  name: "@12-apps/delivery-notes",
  contract: 1,
  permissions: {
    source: "@12-apps/delivery-notes",
    ids: ["notes:read", "notes:manage"],
    permissions: {
      "notes:read": { kind: "class" },
      "notes:manage": { kind: "class", separateFrom: ["notes:read"] },
    },
    labels: { domains: { notes: "Notes" } },
  },
  notifications: [
    {
      type: "notes.created",
      category: "orders",
      generate(payload: { noteId: string }) {
        return { title: "Note created", body: `Note ${payload.noteId} was created.`, link: "/notes" };
      },
    },
  ],
  // Mount-relative, like the route descriptors: the consumer absolutizes
  // them from the http binding's mountPath.
  mcp: {
    endpoints: [
      {
        operationId: "listDeliveryNotes",
        method: "GET",
        path: "/notes",
        summary: "List the tenant's delivery notes.",
        annotations: { readOnly: true },
      },
      {
        operationId: "addDeliveryNote",
        method: "POST",
        path: "/notes",
        summary: "Add one delivery note.",
        annotations: { readOnly: false, destructive: false },
      },
    ],
  },
  db: { partial: "prisma/delivery-notes.prisma", migrations: "prisma/migrations" },
  e2e: { entry: "@12-apps/delivery-notes/e2e" },
  observability: { namespace: "delivery-notes" },
  server: ["http", "jobs", "email"],
  web: ["surface", "areas"],
});

async function listNotes(
  store: NotesStore,
  request: WireRequest<NotesActor>,
): Promise<WireResponse> {
  return { status: 200, body: { data: await store.list(request.actor.tenantId) } };
}

async function addNote(store: NotesStore, request: WireRequest<NotesActor>): Promise<WireResponse> {
  if (!request.actor.canManage) return { status: 403, body: { error: "forbidden" } };
  await store.add(request.actor.tenantId, String(request.body ?? ""));
  return { status: 201, body: { data: null } };
}

export const notesServerManifest = defineServerManifest(notesManifest, {
  name: "@12-apps/delivery-notes",
  http: {
    create(config: NotesServerConfig) {
      return {
        routes: [
          {
            method: "GET" as const,
            path: "/notes",
            handle: (request: WireRequest<NotesActor>) => listNotes(config.store, request),
          },
          {
            method: "POST" as const,
            path: "/notes",
            handle: (request: WireRequest<NotesActor>) => addNote(config.store, request),
          },
          {
            method: "GET" as const,
            path: "/notes/drafts",
            handle: () => Promise.resolve({ status: 200, body: { data: [] } }),
          },
          {
            method: "GET" as const,
            path: "/notes/:id",
            handle: (request: WireRequest<NotesActor>) =>
              Promise.resolve({ status: 200, body: { data: request.params["id"] ?? null } }),
          },
        ],
        // Beside the routes, deliberately: the contract is a floor, and the
        // consumer must expose the WHOLE factory result (assembled.http) for
        // hosts whose own code funnels through extra members.
        store: config.store,
      };
    },
  },
  jobs: {
    namespace: "notes",
    blueprints: {
      digest: {
        name: "digest",
        queue: "sweeps",
        concurrency: 1,
        schedule: { pattern: "0 7 * * *", timezone: "America/Sao_Paulo" },
        async handle(_payload: never, deps: NotesJobDeps) {
          deps.ran.push("digest");
          await Promise.resolve();
        },
      },
    },
  },
  email: {
    createMailer(port): NotesMailer {
      return {
        sendDigest: (to, count) =>
          port.send(to, {
            subject: `Your ${count} delivery notes`,
            text: `You have ${count} notes.`,
            html: `<p>You have ${count} notes.</p>`,
          }),
      };
    },
  },
});

export const notesWebManifest = defineWebManifest(notesManifest, {
  name: "@12-apps/delivery-notes",
  surface: {
    create(config: NotesSurfaceConfig): NotesSurface {
      return { NotesPage: () => `notes@${config.apiBase}` };
    },
  },
  areas: [
    {
      area: "admin",
      routes: [{ path: "notes", screen: "NotesPage", permission: "notes:read" }],
      nav: [{ testId: "notes", path: "notes", badge: "notes-pending" }],
    },
  ],
});
