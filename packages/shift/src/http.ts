import { ShiftConfigError, ShiftError, type ShiftErrorCode } from './errors';
import type { Shift, ShiftListInput, ShiftPage, ShiftResource } from './types';

/**
 * `createApiShift` — the shift HTTP surface as framework-neutral route
 * descriptors (the wiring contract's `http` capability, restated here
 * structurally: this package imports nothing from the contract, and the
 * compliance suite pins the twins in its own test run).
 *
 * What used to be the origin host's three thin route files is now three
 * descriptors, with the same split the service already draws:
 *
 * - the PACKAGE owns the surface — the paths, the open-roster/history branch,
 *   the own/force close branch, the `{ data }` envelope, and the
 *   {@link SHIFT_ERROR_STATUS} mapping from a {@link ShiftError} code to the
 *   status a worker's request earned;
 * - the HOST owns everything it always owned — the guards in front of each
 *   route (which permission gates a close depends on the BODY's mode, so the
 *   route deliberately declares no policy and the host's adapter keeps
 *   choosing), request validation in its own schema language, the resource
 *   vocabulary a shift may claim ({@link ShiftHttpResources}), and the wire
 *   shape of a shift ({@link ShiftApiConfig.serialize} — the host's clients
 *   read host field names off this envelope, so a package default could only
 *   be wrong).
 *
 * The handlers never touch the database: they call a {@link ShiftHttpPort}
 * the host implements over its own policy layer, which is where actor-tenant
 * binding and post-commit hints already live and stay.
 */

/** The caller a host's adapter resolves before any shift route runs. */
export interface ShiftHttpActor {
  /** The tenant the host's guard resolved from the URL. */
  clientId: string;
  /** The AMBIENT user — never taken from the request body (see `open`). */
  userId: string;
}

/** Structural twin of the wiring contract's `WireRequest<ShiftHttpActor>`. */
export interface ShiftHttpRequest {
  actor: ShiftHttpActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
}

/** Structural twin of the wiring contract's `WireResponse`. */
export interface ShiftHttpResponse {
  status: number;
  body: unknown;
}

/** Structural twin of the wiring contract's `WireRoute<ShiftHttpActor>`. */
export interface ShiftRoute {
  method: 'GET' | 'POST' | 'PATCH';
  /** Relative to the host's mount, `:param` form. */
  path: string;
  handle(request: ShiftHttpRequest): Promise<ShiftHttpResponse>;
}

/**
 * What the handlers call instead of the service directly: the host's policy
 * layer over `createShiftService`, where actor-tenant binding, the
 * own-target check and any post-write signals already live. Inputs carry the
 * ids the ROUTE resolved; the implementation is free to re-derive and refuse
 * (defence in depth is its call).
 */
export interface ShiftHttpPort {
  open(input: {
    clientId: string;
    userId: string;
    kind: string;
    resource?: ShiftResource;
  }): Promise<Shift>;
  closeOwn(input: { clientId: string; shiftId: string; userId: string }): Promise<Shift>;
  forceClose(input: { clientId: string; shiftId: string; byUserId: string }): Promise<Shift>;
  listOpen(input: { clientId: string; kind?: string }): Promise<Shift[]>;
  list(input: ShiftListInput): Promise<ShiftPage>;
}

/**
 * The host's resource vocabulary, if it has one. A shift claims at most one
 * resource, but WHICH body fields name it — and which rows they must point
 * at — is host domain (a cooking line, an area of the floor). `fromBody` maps
 * the validated body onto the package's claim, and refuses in the host's own
 * error language; throwing here flows out of the handler untouched, exactly
 * like a guard's refusal.
 */
export interface ShiftHttpResources {
  fromBody(
    body: Record<string, unknown>,
    actor: ShiftHttpActor,
  ): Promise<{ resource?: ShiftResource }> | { resource?: ShiftResource };
}

export interface ShiftApiConfig {
  /** The host's policy layer over the service — see {@link ShiftHttpPort}. */
  shifts: ShiftHttpPort;
  /**
   * A stored shift as the host's clients read it. REQUIRED with no default,
   * deliberately: the wire fields are host vocabulary (the origin host
   * flattens the three-column resource snapshot into its own id fields), and a
   * package-invented shape would break every existing client on adoption.
   */
  serialize(shift: Shift): unknown;
  /** Absent means the surface accepts no resource claims. */
  resources?: ShiftHttpResources;
}

export interface ShiftApi {
  /** Three descriptors: the collection pair and the close. */
  routes: readonly ShiftRoute[];
}

/**
 * The status a {@link ShiftError} code answers with — package knowledge that
 * used to live in the origin host's error mapper. Exported so an adopting
 * host maps the SAME codes to the SAME statuses on its non-wired paths.
 */
export const SHIFT_ERROR_STATUS = {
  INVALID_SHIFT: 400,
  SHIFT_ALREADY_OPEN: 409,
  SHIFT_NOT_FOUND: 404,
  SHIFT_ALREADY_ENDED: 409,
  SHIFT_NOT_OWNED: 403,
  RESOURCE_TAKEN: 409,
  ASSIGNMENT_CONFLICT: 409,
} as const satisfies Record<ShiftErrorCode, number>;

function ok(data: unknown): ShiftHttpResponse {
  return { status: 200, body: { data } };
}

/** A {@link ShiftError} as the wire answer its code earns; anything else rethrows. */
async function answering(run: () => Promise<ShiftHttpResponse>): Promise<ShiftHttpResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ShiftError) {
      return {
        status: SHIFT_ERROR_STATUS[error.code],
        body: { error: error.message, code: error.code },
      };
    }
    throw error;
  }
}

function recordOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function limitOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function listQueryOf(actor: ShiftHttpActor, query: ShiftHttpRequest['query']): ShiftListInput {
  return {
    clientId: actor.clientId,
    ...(query['kind'] !== undefined ? { kind: query['kind'] } : {}),
    ...(query['userId'] !== undefined ? { userId: query['userId'] } : {}),
    ...(query['cursor'] !== undefined ? { cursor: query['cursor'] } : {}),
    ...(limitOf(query['limit']) !== undefined ? { limit: limitOf(query['limit']) } : {}),
  };
}

export function createApiShift(config: ShiftApiConfig): ShiftApi {
  if (typeof config?.serialize !== 'function') {
    throw new ShiftConfigError(
      'createApiShift needs serialize — the wire shape of a shift is the host\'s to state.',
    );
  }
  if (config.shifts === undefined) {
    throw new ShiftConfigError('createApiShift needs shifts — the host\'s port over the service.');
  }
  const { shifts, serialize, resources } = config;

  const listRoute: ShiftRoute = {
    method: 'GET',
    path: '/shifts',
    handle: ({ actor, query }) =>
      answering(async () => {
        // The on-duty roster is a different question from the history and
        // needs no cursor: "who is working right now" is bounded by the size
        // of a shop floor. The userId narrowing stays in memory for the same
        // reason.
        if (query['open'] === 'true') {
          const open = await shifts.listOpen({
            clientId: actor.clientId,
            ...(query['kind'] !== undefined ? { kind: query['kind'] } : {}),
          });
          const items = query['userId']
            ? open.filter((shift) => shift.userId === query['userId'])
            : open;
          return ok({ items: items.map(serialize), nextCursor: null });
        }
        const page = await shifts.list(listQueryOf(actor, query));
        return ok({ items: page.items.map(serialize), nextCursor: page.nextCursor });
      }),
  };

  const openRoute: ShiftRoute = {
    method: 'POST',
    path: '/shifts',
    handle: ({ actor, body }) =>
      answering(async () => {
        const record = recordOf(body);
        // Never from the request: the target user IS the actor. A body that
        // named its own subject would make the host's own-target check a
        // formality the request supplies both sides of.
        const bound = resources ? await resources.fromBody(record, actor) : {};
        const shift = await shifts.open({
          clientId: actor.clientId,
          userId: actor.userId,
          kind: textOf(record['kind']) ?? '',
          ...bound,
        });
        return ok(serialize(shift));
      }),
  };

  const closeRoute: ShiftRoute = {
    method: 'PATCH',
    path: '/shifts/:shiftId',
    handle: ({ actor, params, body }) =>
      answering(async () => {
        // Two explicit modes, never inferred from whose shift the id names —
        // a manager who mistyped an id must not silently force-close a
        // stranger's shift under their OWN-shift permission. The host's
        // adapter picks the guard from the same field, so a mode outside the
        // pair has already paid the stricter gate before this branch runs.
        const shiftId = params['shiftId'] ?? '';
        const shift =
          recordOf(body)['mode'] === 'own'
            ? await shifts.closeOwn({ clientId: actor.clientId, shiftId, userId: actor.userId })
            : await shifts.forceClose({
                clientId: actor.clientId,
                shiftId,
                byUserId: actor.userId,
              });
        return ok(serialize(shift));
      }),
  };

  return { routes: [listRoute, openRoute, closeRoute] };
}
