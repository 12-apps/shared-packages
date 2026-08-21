/**
 * The route descriptors — the surface's own parsing, status codes and
 * envelopes, framework-neutral. The adapter serializes what a handler chose;
 * it never reshapes it.
 */
import type { EntitlementsEngine } from '../core/engine';
import type { FiledPlanRequest, OpenPlanRequest } from '../plan-wire';
import type { EntitlementsMessages } from './copy';
import type { PlanService } from './plan-service';
import { entitlementDenialResponse, isEntitlementDenial, type WireResponse } from './wire';

/**
 * The caller, resolved by the host. Returning it is the host's whole job:
 * authentication, tenant resolution and RBAC happen before any descriptor
 * runs.
 */
export interface EntitlementsActor {
  tenantId: string;
  /** The host's user id, kept opaque. Empty string reads as "no user row". */
  userId?: string | null;
  /**
   * Every permission id this caller holds, resolved by the host's RBAC.
   *
   * REQUIRED, and a list rather than a boolean: the write on this surface is
   * gated by an id this package OWNS and exports (`entitlementsPermissions`),
   * so it can be granted, revoked, audited and shown in a role editor like any
   * other. It used to be `canRequestPlanChange?: boolean`, which meant every
   * host spelled this package's own decision in a permission of its own — and
   * an omitted field silently refused every ask with no way to tell that from
   * a genuine denial.
   *
   * The READ routes take no permission at all: explaining a denial to whoever
   * hit it is the whole point of a plan screen. Only the ask, which puts the
   * tenant on a sales call, is gated.
   */
  permissions: readonly string[];
}

/** What a descriptor receives from the adapter. */
export interface EntitlementsRequest {
  actor: EntitlementsActor;
  body?: unknown;
}

/** One endpoint, framework-neutral. Paths are relative to the mount. */
export interface EntitlementsRoute {
  method: 'GET' | 'POST';
  path: string;
  handle(request: EntitlementsRequest): Promise<WireResponse>;
}

/**
 * The host's plan-change lead store. The model behind it is a BILLING table
 * and stays in the host — this port is the whole coupling. Create must be
 * idempotent: a repeat press returns the open request with `created: false`,
 * because from where the tenant is standing "we already have your request" is
 * simply true.
 */
export interface PlanChangeRequestPort {
  getOpen(tenantId: string): Promise<OpenPlanRequest | null>;
  /**
   * Returns `{ id, status }` only — the write's contract. The read route next
   * door is where the details live.
   */
  create(input: {
    tenantId: string;
    requestedPlanKey: string;
    /** Resolved SERVER-SIDE from the engine — never trusted from the body. */
    currentPlanKey: string;
    featureKey: string | null;
    requestedByUserId: string | null;
    note: string | null;
  }): Promise<{ request: FiledPlanRequest; created: boolean }>;
}

interface ParsedAsk {
  requestedPlan: string;
  feature: string | null;
  note: string | null;
}

/**
 * The ask, validated by hand — this package has zero runtime dependencies.
 *
 * Mirrors the host's original zod contract exactly (`requestedPlan`
 * trim+min(1)+max(50), `feature` trim+min(1)+max(120) when present, `note`
 * trim+max(1000) when present), plus one check the ladder makes possible:
 * the requested key must be a tier the catalog actually declares.
 */
/**
 * `.trim().min(1).max(len)` for an OPTIONAL field: `null` when absent,
 * `undefined` when invalid (present but wrong type, blank, or over the
 * ceiling), the trimmed string otherwise.
 */
function optionalTrimmed(
  value: unknown,
  maxLength: number,
  { allowEmpty = false } = {},
): string | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return allowEmpty ? null : undefined;
  return trimmed.length > maxLength ? undefined : trimmed;
}

function parseRequestBody(raw: unknown, isKnownPlan: (key: string) => boolean): ParsedAsk | null {
  if (raw === null || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.requestedPlan !== 'string') return null;
  const requestedPlan = body.requestedPlan.trim();
  if (requestedPlan === '' || requestedPlan.length > 50 || !isKnownPlan(requestedPlan)) return null;

  const feature = optionalTrimmed(body.feature, 120);
  // A blank note is simply no note; a blank feature was named and is invalid.
  const note = optionalTrimmed(body.note, 1000, { allowEmpty: true });
  if (feature === undefined || note === undefined) return null;

  return { requestedPlan, feature, note };
}

/**
 * The SUCCESS envelope: every 2xx body ships as `{ data: … }`, matching the
 * report-builder reference (`ok()` in its descriptors). The packaged react
 * half unwraps it. Denials and refusals are NEVER wrapped: they are plain
 * `{ error }` bodies.
 */
const ok = (data: Record<string, unknown>): WireResponse => ({ status: 200, body: { data } });

/** Run a handler, mapping the engine's own denials onto the wire contract. */
async function answering(
  messages: EntitlementsMessages,
  body: () => Promise<WireResponse>,
): Promise<WireResponse> {
  try {
    return await body();
  } catch (error) {
    if (isEntitlementDenial(error)) return entitlementDenialResponse(error, messages);
    throw error;
  }
}

function askRoute(
  service: PlanService,
  leads: PlanChangeRequestPort,
  isKnownPlan: (key: string) => boolean,
  requestPermission: string,
  messages: EntitlementsMessages,
): EntitlementsRoute {
  return {
    // "I want a bigger plan." Writes a LEAD, never a plan: moving a tenant
    // onto a tier is the platform writer's job, with its own guard and audit
    // trail — an endpoint a tenant can reach must not be able to grant a
    // tenant anything.
    method: 'POST',
    path: '/plan/request',
    handle: ({ actor, body }) =>
      answering(messages, async () => {
        if (!actor.permissions.includes(requestPermission)) {
          return {
            status: 403,
            body: { error: messages.planRequestForbidden },
          };
        }
        const parsed = parseRequestBody(body, isKnownPlan);
        if (parsed === null) {
          return { status: 400, body: { error: messages.invalidPlanRequest } };
        }
        // From the engine, not the caller: a client that could name its own
        // current tier could file a lead saying the tenant is on a tier it is
        // not.
        const view = await service.getPlanView(actor.tenantId);
        const userId = actor.userId ?? null;
        const result = await leads.create({
          tenantId: actor.tenantId,
          requestedPlanKey: parsed.requestedPlan,
          currentPlanKey: view.planKey,
          featureKey: parsed.feature,
          // `""` for a platform operator acting without a user row — stored
          // as null so a foreign key can hold.
          requestedByUserId: userId === '' ? null : userId,
          note: parsed.note,
        });
        // 200 either way, including on a repeat press: "we already have your
        // request" is simply true, and an error would read as though the ask
        // had been lost.
        return ok({ request: result.request, created: result.created });
      }),
  };
}

export function buildEntitlementsRoutes<F extends string>(deps: {
  engine: EntitlementsEngine<F>;
  service: PlanService;
  leads: PlanChangeRequestPort | null;
  isKnownPlan: (key: string) => boolean;
  /** The permission id `POST /plan/request` requires of the actor. */
  requestPermission: string;
  /** The refusal/denial sentences — REQUIRED, the host's words. */
  messages: EntitlementsMessages;
}): EntitlementsRoute[] {
  const { engine, service, leads, messages } = deps;

  const routes: EntitlementsRoute[] = [
    {
      // The SPA's bootstrap read: the server-resolved snapshot the provider
      // renders from. The client NEVER re-resolves.
      method: 'GET',
      path: '/entitlements',
      handle: ({ actor }) =>
        answering(messages, async () => ok({ snapshot: await engine.toSnapshot(actor.tenantId) })),
    },
    {
      // What plan this tenant is on. READ-ONLY, permissionless, and it
      // deliberately never 402s: it is the screen somebody opens BECAUSE
      // something was denied, so gating it would hide the explanation exactly
      // when it is needed.
      method: 'GET',
      path: '/plan',
      handle: ({ actor }) =>
        answering(messages, async () => ok({ plan: await service.getPlanPayload(actor.tenantId) })),
    },
  ];

  if (leads !== null) {
    routes.push(
      {
        // Is an ask already in flight? Staff-wide like the plan read: somebody
        // who can see that a feature is withheld should also see that a
        // colleague already asked, rather than being invited to ask again.
        method: 'GET',
        path: '/plan/request',
        handle: ({ actor }) =>
          answering(messages, async () => ok({ request: await leads.getOpen(actor.tenantId) })),
      },
      askRoute(service, leads, deps.isKnownPlan, deps.requestPermission, messages),
    );
  }

  return routes;
}
