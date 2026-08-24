/**
 * What every route in this surface shares (12-17): the actor, the request, the
 * response envelope and the error mapping. Mirrors the rbac/report-builder
 * shape — framework-neutral descriptors a forty-line adapter mounts.
 */

import { LifecycleError } from '../errors';
import type { DraftRecord, FeatureFlagMap, LifecycleContext, Snapshot, WriteResult } from '../types';
import type { DraftWire, WriteOutcomeWire } from '../wire';

/**
 * What a host must resolve before a request reaches these handlers: WHO is
 * calling, WHICH tenant the request is scoped to, and the tenant's two
 * lifecycle feature layers. Everything else — feature gating per collection,
 * approvals interception, version/bin/draft state — the package resolves
 * itself, from the tables it owns.
 *
 * The feature layers ride the actor because they are tenant state the host
 * owns (the origin host keeps them as two JSON columns on its tenant row): the
 * package never reads a tenant table it cannot know the shape of.
 */
export interface LifecycleActor {
  /** The tenant row id this admin surface is scoped to. */
  tenantId: string;
  /** The caller's DB user id, or `null` for a system/allowlist caller. */
  userId: string | null;
  /** PLAN layer: what the tenant pays for. Missing feature = not entitled. */
  entitlements: FeatureFlagMap;
  /** TENANT layer: config-panel toggles. Missing = the feature's default. */
  settings: FeatureFlagMap;
  /**
   * The caller's resolved permission ids. The package narrows against them
   * (each registration's `approvePermission`); it never computes them.
   */
  permissions?: ReadonlySet<string> | readonly string[];
  /** Platform operator: may decide approvals for every collection. */
  isSuper?: boolean;
}

/** One request, already authenticated and routed by the host. */
export interface LifecycleRequest {
  actor: LifecycleActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  /**
   * The language to answer this caller in, as a BCP-47 tag — the same field
   * `@12-apps/wiring`'s `WireRequest` carries.
   *
   * Populated by the host's adapter, which is the only layer that can negotiate
   * one. Absent is meaningful and not an error: a host with one audience never
   * sets it, and this package must then answer with the words it was configured
   * with rather than invent a language.
   */
  locale?: string;
}

/** What a handler answers with; the host maps this onto its response type. */
export interface LifecycleResponse {
  status: number;
  /** `undefined` means NO body at all (204) — not the same as `null`. */
  body: unknown;
}

export interface LifecycleRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /**
   * Path relative to the host's admin mount, in `:param` form. The SHAPE is
   * fixed because the packaged client builds these URLs.
   */
  path: string;
  handle(request: LifecycleRequest): Promise<LifecycleResponse>;
}

/**
 * The host's user directory — history, bin and approvals lists show "who",
 * not a UUID. Identity is host data and crosses this seam by value. Optional:
 * without it every name renders as the system fallback.
 */
export interface LifecycleUserDirectory {
  getUsers(ids: readonly string[]): Promise<{ id: string; name: string | null }[]>;
}

/**
 * The answer of a collection's `authorize` gate (see
 * `LifecycleEntityRegistration.authorize`). A denial crosses the wire
 * unmodified — the host's `status` and `error` pass through (the origin host's
 * entitlement denial is a 402 with its own copy); omitted, the denial is the
 * 403 feature-off message.
 */
export type LifecycleAuthorization =
  | { ok: true }
  | { ok: false; status?: number; error?: string };

/** The collection `authorize` gate's shape, shared by registration + helpers. */
export type LifecycleAuthorizeGate = (
  actor: LifecycleActor,
) => Promise<LifecycleAuthorization> | LifecycleAuthorization;

/** The user-facing copy this surface emits (pt-BR product copy by default). */
export interface LifecycleMessages {
  entityNotFound: string;
  versionNotFound: string;
  entryNotFound: string;
  draftNotFound: string;
  requestNotFound: string;
  requestAlreadyDecided: string;
  featureDisabled: string;
  notAuthorized: string;
  routeNotAllowed: string;
  operationFailed: string;
  unknownEntityType: string;
  invalidBody: string;
  unauthenticated: string;
}

/**
 * What a copy field takes once its words can follow a reader.
 *
 * Declared here rather than imported from `@12-apps/i18n`: this package must
 * stay liftable into a repo that has never heard of it, so the two agree
 * STRUCTURALLY and nothing forces the dependency. The context is deliberately
 * loose — a raw tag off the wire, unnarrowed — because matching it is the host
 * resolver's job, not this package's.
 */
export type LifecycleCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
export type LifecycleCopySource<T> = T | LifecycleCopyResolver<T>;

/**
 * The copy a field is offering, at the moment it is needed.
 *
 * Call this where the sentence is USED, never where the surface is built: a
 * factory that resolves once and stores the result has re-frozen the language
 * into its mount, and a single-locale host cannot tell the difference. The
 * route wrappers in `routes-shared.ts` and `routes-entity.ts` are the only two
 * callers, which is what keeps every helper below them on a plain value.
 */
export function resolveLifecycleCopy<T>(
  source: LifecycleCopySource<T>,
  locale: string | undefined,
): T {
  return typeof source === 'function'
    ? (source as LifecycleCopyResolver<T>)({ locale })
    : source;
}

/** The messages in force — REQUIRED host config; pt-BR ships as `./pt-BR`. */
export function messagesOf(
  config: { messages: LifecycleCopySource<LifecycleMessages> },
  locale?: string,
): LifecycleMessages {
  return resolveLifecycleCopy(config.messages, locale);
}

/** A user-safe API error carrying the HTTP status the wire promises. */
export class LifecycleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LifecycleApiError';
    this.status = status;
    Object.setPrototypeOf(this, LifecycleApiError.prototype);
  }
}

export const ok = (data: unknown, status = 200): LifecycleResponse => ({
  status,
  body: { data },
});
const fail = (status: number, error: string): LifecycleResponse => ({
  status,
  body: { error },
});
export const noContent = (): LifecycleResponse => ({ status: 204, body: undefined });

/** {@link LifecycleError} code → HTTP status + which pt-BR sentence to say. */
const ERROR_SURFACE: Record<string, [number, keyof LifecycleMessages]> = {
  ENTITY_NOT_FOUND: [404, 'entityNotFound'],
  VERSION_NOT_FOUND: [404, 'versionNotFound'],
  ENTRY_NOT_FOUND: [404, 'entryNotFound'],
  DRAFT_NOT_FOUND: [404, 'draftNotFound'],
  REQUEST_NOT_FOUND: [404, 'requestNotFound'],
  REQUEST_ALREADY_DECIDED: [409, 'requestAlreadyDecided'],
  FEATURE_DISABLED: [403, 'featureDisabled'],
  NOT_AUTHORIZED: [403, 'notAuthorized'],
};

/** Map a {@link LifecycleError} to the user-safe pt-BR HTTP surface. */
function toApiError(error: unknown, messages: LifecycleMessages): LifecycleApiError | undefined {
  if (error instanceof LifecycleApiError) return error;
  if (!(error instanceof LifecycleError)) return undefined;
  const [status, key] = ERROR_SURFACE[error.code] ?? [422, 'operationFailed'];
  return new LifecycleApiError(status, messages[key]);
}

/**
 * Run a lifecycle call, translating library failures to the HTTP surface.
 *
 * EXPORTED from `./index`, and that is the whole point of it being here: a host
 * funnelling its OWN create/update/delete routes through
 * `lifecycleEntity(type).lifecycle` catches exactly these failures without
 * going through a packaged descriptor, and until this was reachable it had no
 * way to reach {@link ERROR_SURFACE} — so it restated the eight-row table and
 * the pt-BR sentences beside it. That copy is the drift this export deletes.
 * `LifecycleApiError` and `PT_BR_LIFECYCLE_MESSAGES` were already public; the
 * function that PAIRS them was the missing third.
 */
export async function foldLifecycle<T>(
  messages: LifecycleMessages,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toApiError(error, messages) ?? error;
  }
}

/** Fold a thrown {@link LifecycleApiError} into a response; rethrow the rest. */
export function foldApiError(error: unknown): LifecycleResponse {
  if (error instanceof LifecycleApiError) return fail(error.status, error.message);
  throw error;
}

/** The `{ applied, entityId, requestId }` wire shape for approvals-aware writes. */
export function writeOutcome(result: WriteResult): WriteOutcomeWire {
  return result.status === 'applied'
    ? { applied: true, entityId: result.entityId, requestId: null }
    : { applied: false, entityId: null, requestId: result.requestId };
}

/** A parked write answers 202; an applied one 200 (the origin host contract). */
export function writeResponse(result: WriteResult): LifecycleResponse {
  return ok(writeOutcome(result), result.status === 'applied' ? 200 : 202);
}

/** Serialize a draft for the wire (shared by the draft routes). */
export function draftJson(draft: DraftRecord | null): { draft: DraftWire | null } {
  return {
    draft: draft
      ? {
          id: draft.id,
          entityId: draft.entityId,
          data: draft.data,
          status: draft.status,
          updatedAt: draft.updatedAt.toISOString(),
        }
      : null,
  };
}

/**
 * Resolve display names for a set of actor ids through the host's directory.
 * Unknown/system ids map to nothing (rendered as the system fallback).
 */
export async function resolveActorNames(
  directory: LifecycleUserDirectory | undefined,
  ids: readonly (string | null)[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0 || !directory) return new Map();
  const users = await directory.getUsers(unique);
  return new Map(users.map((user) => [user.id, user.name]));
}

/** The actor's permission ids as a set (either accepted input form). */
function permissionSetOf(actor: LifecycleActor): ReadonlySet<string> {
  return actor.permissions instanceof Set
    ? (actor.permissions as ReadonlySet<string>)
    : new Set(actor.permissions ?? []);
}

/**
 * Gate a collection-scoped route on the registration's `routePermission`
 * (the origin host's `roles:manage`). `isSuper` bypasses, mirroring `contextOf`.
 */
export function requireRoutePermission(
  actor: LifecycleActor,
  routePermission: string | undefined,
  messages: LifecycleMessages,
): void {
  if (routePermission === undefined || actor.isSuper === true) return;
  if (!permissionSetOf(actor).has(routePermission)) {
    throw new LifecycleApiError(403, messages.routeNotAllowed);
  }
}

/**
 * Await the collection's `authorize` gate (the host's plan/billing answer).
 * A denial becomes the wire response unmodified — the host's status/error
 * pass through; defaults are 403 + the feature-off copy.
 */
export async function requireAuthorized(
  actor: LifecycleActor,
  authorize: LifecycleAuthorizeGate | undefined,
  messages: LifecycleMessages,
): Promise<void> {
  if (!authorize) return;
  const result = await authorize(actor);
  if (!result.ok) {
    throw new LifecycleApiError(result.status ?? 403, result.error ?? messages.featureDisabled);
  }
}

/** The per-request feature/approval context for one registered collection. */
export function contextOf(
  actor: LifecycleActor,
  approvePermission: string | undefined,
): LifecycleContext {
  const permissions = permissionSetOf(actor);
  return {
    tenantId: actor.tenantId,
    actorId: actor.userId || null,
    entitlements: actor.entitlements,
    settings: actor.settings,
    canApprove:
      actor.isSuper === true ||
      (approvePermission !== undefined && permissions.has(approvePermission)),
  };
}

/** The one body shape the draft writes accept: `{ data: <snapshot> }`. */
export function parseSnapshotBody(body: unknown, messages: LifecycleMessages): Snapshot {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as { data?: unknown }).data !== 'object' ||
    (body as { data?: unknown }).data === null ||
    Array.isArray((body as { data?: unknown }).data)
  ) {
    throw new LifecycleApiError(400, messages.invalidBody);
  }
  return (body as { data: Snapshot }).data;
}

/** The reject body: `{ note?: string }` (≤500 chars, trimmed — the MCP contract). */
export function parseRejectBody(body: unknown, messages: LifecycleMessages): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new LifecycleApiError(400, messages.invalidBody);
  }
  const note = (body as { note?: unknown }).note;
  if (note === undefined) return undefined;
  if (typeof note !== 'string' || note.trim().length > 500) {
    throw new LifecycleApiError(400, messages.invalidBody);
  }
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
