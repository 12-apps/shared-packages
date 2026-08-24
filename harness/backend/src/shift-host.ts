/**
 * The half of `@12-apps/shift` a package can never ship: this host's staff
 * vocabulary, its resources, its wire shape and its policy layer.
 *
 * Four things the surface REQUIRES from a host, and each one is required
 * because it is a fact about an application rather than about work periods:
 *
 * - **`kinds`** — `createShiftService` takes them with no default, and the
 *   package's own docblock says why: a default would be one application's staff
 *   structure wearing the word "default", inherited in silence by the next host.
 *   This harness declares a lighthouse authority's, in a domain the package was
 *   not extracted from, for the same reason `audit-host.ts` does.
 * - **`serialize`** — required with no default, because the wire fields are host
 *   vocabulary and a package-invented shape would break every existing client
 *   on adoption. This host flattens the resource snapshot the way the origin
 *   host does, so the shape is a real one rather than a pass-through of `Shift`.
 * - **`resources.fromBody`** — which body fields name a resource, and which rows
 *   they must point at, is host domain. This one resolves against the host's
 *   OWN desks table and refuses in the host's own words.
 * - **the port** — `ShiftHttpPort` is where actor-tenant binding and the
 *   own-target check live. The handlers never touch the database.
 *
 * ## The resource is real, and that is the point
 *
 * A harness whose "resources" were free-form strings would satisfy
 * `fromBody` and never exercise the exclusivity rule, because nothing could be
 * taken by somebody else. So this host has `harness_desks` — rows the package
 * has never heard of — and `fromBody` refuses an id that is not one of them.
 * That separation is what `resource_assignments` protects, and a host that let
 * any string through could not tell a taken desk from a typo.
 */
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { createShiftService, ShiftError } from '@12-apps/shift';
import { createApiShift, type ShiftApi, type ShiftHttpPort } from '@12-apps/shift/http';
import type { Shift, ShiftResource } from '@12-apps/shift/types';

import { applyShiftMigrations, createShiftHostTables, shiftDb } from './shift-db';
import { Params, type SqlRunner } from './shift-rows';
import { honoRouterFor } from './wire-hono';

/**
 * This host's staff structure — a library's, not a restaurant's.
 *
 * Deliberately NOT the origin host's `['kitchen', 'service']`. The package
 * removed those from its own union precisely so an adopter's vocabulary would
 * be its own, and a harness that passed the extracted host's two values back in
 * would prove the surface works for exactly the application it came from.
 */
export const SHIFT_KINDS = ['desk', 'stacks', 'reference'] as const;

export const SHIFT_TENANT_ID = 'shift-harness';
export const SHIFT_TENANT_B_ID = 'shift-harness-b';

/** The resource type this host claims. One is enough to hold the rule. */
export const DESK_RESOURCE_TYPE = 'desk';

/** Where the three routes hang. The tenant is a path segment, as in a real host. */
export const SHIFT_MOUNT_PATH = '/api/admin/:tenantSlug';

/**
 * The header this harness resolves the AMBIENT user from.
 *
 * A real host reads a session. What matters for the surface is only that the
 * user never comes from the request BODY — the package's own comment on the
 * open route says a body that named its own subject would make the host's
 * own-target check a formality the request supplies both sides of.
 */
export const SHIFT_USER_HEADER = 'x-shift-user';

export interface HarnessDesk {
  id: string;
  clientId: string;
  label: string;
  /** A desk somebody must be alone at; a shared trolley is not. */
  exclusive: boolean;
}

export const HARNESS_DESKS: readonly HarnessDesk[] = [
  { id: 'desk-front', clientId: SHIFT_TENANT_ID, label: 'Balcão de empréstimos', exclusive: true },
  { id: 'desk-back', clientId: SHIFT_TENANT_ID, label: 'Sala de referência', exclusive: true },
  { id: 'trolley', clientId: SHIFT_TENANT_ID, label: 'Carrinho de devoluções', exclusive: false },
  { id: 'desk-b', clientId: SHIFT_TENANT_B_ID, label: 'Balcão da filial', exclusive: true },
];

/** This host's refusals, in its own language — never the package's. */
export const SHIFT_COPY = {
  unknownDesk: 'Esta bancada não existe nesta biblioteca.',
  unknownKind: 'Este turno não é um dos turnos desta biblioteca.',
} as const;

/**
 * The host's own tables, and the package's, provisioned together.
 *
 * `harness_desks` is the catalog `fromBody` validates against;
 * `createShiftHostTables` adds the assignment ledger and the audit sink the
 * package's transaction seam writes through.
 */
export async function createShiftHostSchema(pg: PGlite): Promise<void> {
  await applyShiftMigrations(pg);
  await createShiftHostTables(pg);
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS "harness_desks" (
      "id"        TEXT NOT NULL,
      "client_id" TEXT NOT NULL,
      "label"     TEXT NOT NULL,
      "exclusive" BOOLEAN NOT NULL,
      PRIMARY KEY ("client_id", "id")
    );
  `);
}

/** Back to the seeded catalog, with no shift and no claim outstanding. */
export async function reseedShifts(pg: PGlite): Promise<void> {
  // A plain DELETE, and it is worth saying why it works: the package's
  // immutability trigger is UPDATE-only since FUT-446. `client_id` is a
  // by-value tenant reference with no foreign key — that is what keeps the
  // package host-agnostic — so a host dropping a tenant has to be able to sweep
  // the by-value tables by `client_id`, and an unconditional DELETE guard
  // wedged exactly that. Deletability is host policy; immutability is not.
  await pg.exec(`
    DELETE FROM "shifts";
    DELETE FROM "resource_assignments";
    DELETE FROM "shift_audits";
    DELETE FROM "harness_desks";
  `);
  for (const desk of HARNESS_DESKS) {
    const params = new Params();
    await (pg as unknown as SqlRunner).query(
      `INSERT INTO harness_desks (id, client_id, label, exclusive)
       VALUES (${params.add(desk.id)}, ${params.add(desk.clientId)},
               ${params.add(desk.label)}, ${params.add(desk.exclusive)})`,
      params.values,
    );
  }
}

/**
 * The wire shape, flattened the way the origin host's clients already read it.
 *
 * The three resource columns become two `desk*` fields plus the assignment id,
 * and the dates become ISO strings — neither is what `Shift` looks like, which
 * is the point of `serialize` being required. A host that returned the record
 * unchanged would be testing that the package can hand back its own type.
 */
export function serializeShift(shift: Shift): unknown {
  return {
    id: shift.id,
    userId: shift.userId,
    kind: shift.kind,
    startedAt: shift.startedAt.toISOString(),
    endedAt: shift.endedAt?.toISOString() ?? null,
    endedReason: shift.endedReason,
    endedBy: shift.endedByUserId,
    deskId: shift.resourceId,
    deskAssignmentId: shift.resourceAssignmentId,
  };
}

/**
 * `deskId` is this host's field name, and the desk must be one of ITS rows.
 *
 * `exclusive` comes off the catalog rather than off the request — a caller that
 * could declare its own claim non-exclusive would opt out of the very rule the
 * assignment ledger exists to enforce.
 */
async function deskFromBody(
  pg: PGlite,
  body: Record<string, unknown>,
  actor: { clientId: string },
): Promise<{ resource?: ShiftResource }> {
  const deskId = typeof body['deskId'] === 'string' ? body['deskId'] : undefined;
  if (deskId === undefined || deskId === '') return {};
  const params = new Params();
  const { rows } = await (pg as unknown as SqlRunner).query<{ exclusive: boolean }>(
    `SELECT exclusive FROM harness_desks
     WHERE client_id = ${params.add(actor.clientId)} AND id = ${params.add(deskId)}`,
    params.values,
  );
  const desk = rows[0];
  // The host's own error language, thrown from the host's own resolver — the
  // package documents that a throw here flows out of the handler untouched,
  // exactly like a guard's refusal.
  if (!desk) throw new ShiftError('INVALID_SHIFT', SHIFT_COPY.unknownDesk);
  return { resource: { type: DESK_RESOURCE_TYPE, id: deskId, exclusive: desk.exclusive } };
}

export type HarnessShift = ReturnType<typeof shiftHost>;

export function shiftHost(pg: PGlite): ShiftApi & {
  /** The three routes, served over Hono by the host's own one bridge. */
  router: ReturnType<typeof honoRouterFor>;
  /** The service itself, for the sweep case — no route drives auto-close. */
  service: ReturnType<typeof createShiftService<typeof SHIFT_KINDS>>;
} {
  const db = shiftDb(pg);
  const service = createShiftService(db, { kinds: SHIFT_KINDS, createId: randomUUID });

  /**
   * The host's policy layer. Thin here, and honestly so: a real adopter's
   * version also carries an RBAC check and a realtime hint, neither of which is
   * this package's business. What it must NOT do is re-derive the package's
   * rules — every refusal below comes back out of the service.
   */
  const port: ShiftHttpPort = {
    open: ({ clientId, userId, kind, resource }) =>
      service.openShift({
        clientId,
        userId,
        // The actor is always the subject: the route never reads a user from
        // the body, so `actorUserId` and `userId` genuinely coincide here.
        actorUserId: userId,
        kind: assertKnownKind(kind),
        ...(resource ? { resource } : {}),
      }),
    closeOwn: (input) => service.closeOwnShift(input),
    forceClose: (input) => service.forceCloseShift(input),
    listOpen: (input) => service.listOpenShifts(input),
    list: (input) => service.listShifts(input),
  };

  const api = createApiShift({
    shifts: port,
    serialize: serializeShift,
    resources: { fromBody: (body, actor) => deskFromBody(pg, body, actor) },
  });

  return {
    ...api,
    service,
    // `ShiftRoute` is a structural twin of the wiring contract's
    // `WireRoute`, which the package states outright — so the host's ONE
    // bridge serves these three the same way it serves every assembled
    // surface, and this adoption needs no shift-shaped adapter of its own.
    // Wrapping each descriptor as a `MountedRoute` is the whole translation.
    router: honoRouterFor(
      api.routes.map((route) => ({ route }) as never),
      (c) => {
        // No header means NO CALLER, so the actor is null and the bridge
        // answers 401 before any handler runs — what a real host's missing
        // session does. Returning an actor with an empty userId instead would
        // reach `open`, and the package would dutifully record a shift for the
        // person named ''.
        const userId = c.req.header(SHIFT_USER_HEADER);
        if (!userId) return null;
        return { clientId: c.req.param('tenantSlug') ?? SHIFT_TENANT_ID, userId };
      },
    ),
  };
}

/**
 * Everything this surface needs before it can answer, in one call.
 *
 * The package's own migrations out of the installed tarball, then the tables it
 * does NOT ship. `resource_assignments` is the interesting one: the package
 * asks a host to create, check and end resource claims, and names the unique
 * index they must carry, while owning no model for any of it — because WHAT a
 * shift claims is host domain. The package keeps only the three-column snapshot
 * it copied onto the shift. `harness_desks` is the catalog that makes a claim
 * refusable rather than a free-form string.
 *
 * Bundled here rather than spelled out in `app.ts` so the adoption reads as one
 * line there, the way the other surfaces do.
 */
export async function provisionShift(pg: PGlite): Promise<HarnessShift> {
  await createShiftHostSchema(pg);
  await reseedShifts(pg);
  return shiftHost(pg);
}

/** The host's own vocabulary check, in the host's own words. */
function assertKnownKind(kind: string): (typeof SHIFT_KINDS)[number] {
  const known = SHIFT_KINDS.find((candidate) => candidate === kind);
  if (!known) throw new ShiftError('INVALID_SHIFT', SHIFT_COPY.unknownKind);
  return known;
}
