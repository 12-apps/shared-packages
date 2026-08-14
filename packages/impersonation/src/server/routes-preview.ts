import type { ImpersonationSessionCodec } from '../core/session';
import type { ImpersonationTenant } from '../core/types';

import {
  ImpersonationApiError,
  ok,
  type ImpersonationActor,
  type ImpersonationRequest,
  type ImpersonationResponse,
  type ImpersonationRoute,
  type ImpersonationServerConfig,
} from './context';
import { authorizedSession } from './live-session';
import { attemptOf, type AttemptContext, type Refusals } from './refusals';
import { recordEnd } from './session-end';
import { startPreviewBody, type StartPreviewBody } from './wire';

/**
 * The TENANT surface — the only thing that mints a preview, and one of the two
 * things that drops a session.
 *
 * THE THREE GATES, ALL REFUSED HERE AND NOT MERELY HIDDEN IN A UI. Every one of
 * them is typically a pass-through on the client — a page renders when a tenant
 * has switched a feature off, a nav row stays unlocked, and a permission the
 * client does not know about only hides a button. So a tenant that never armed
 * the feature can still SEE the affordance and click it, and nothing between
 * that click and the cookie refuses unless THIS route does:
 *
 *   1. the preview permission  -> 403   the caller personally may not
 *   2. the plan                -> the host's own status (typically 402)
 *   3. the tenant's own switch -> the host's own status (typically 409)
 *
 * ORDER IS THE CONTRACT, and gates 2 and 3 are one call because an entitlement
 * engine already distinguishes them. Never intersect 1 with 2: an owner holds
 * every permission in their tenant, so collapsing them would tell the person who
 * needs to BUY something to go ask somebody for access.
 *
 * A FOURTH refusal, particular to the MEMBER variant: the named member must hold
 * an ACTIVE membership in THIS tenant. Without it "preview a member" is a
 * cross-tenant read primitive — any user id in the world, rendered inside a
 * tenant they have nothing to do with — which is the exact capability the
 * cookie's mandatory `tenantId` exists to withhold. A DISABLED membership is
 * refused with it: such a member is treated as having no access everywhere else,
 * so previewing one would render a screen that person cannot reach.
 *
 * WHY THE ROUTE DOES NOT ASK FOR `allowWrites`. It is not a parameter of this
 * surface. Both preview variants are minted with it false, and the ONE exception
 * — a role preview may write, because it substitutes nobody and only ever
 * narrows the caller's own set — is re-derived from `kind` + the previewed role
 * name rather than from a boolean anyone could set. A MEMBER preview is
 * read-only because of the SHAPE of the cookie this route mints, not because of
 * a flag it remembered to pass.
 *
 * WHY `DELETE` DOES NOT ASK FOR THE PREVIEW PERMISSION. It cannot: while a
 * preview is in force the caller's permissions are INTERSECTED with the previewed
 * ceiling, and neither ceiling contains it — a role preview resolves the
 * previewed role's set, a member preview resolves as the member. Gating the exit
 * on the permission would lock every previewer inside the preview for the full
 * time box. The exit asks for a SESSION and nothing more, which is the right
 * bar: dropping your own cookie is not a privilege.
 *
 * THE TENANT AND THE ACTOR ARE RESOLVED FIRST, before any gate. Both are needed
 * by every refusal entry — a denial recorded against no tenant, or naming no
 * human, answers neither of the questions the trail exists to answer.
 */

interface PreviewParts {
  config: ImpersonationServerConfig;
  codec: ImpersonationSessionCodec;
  refusals: Refusals;
}

/** Resolve the tenant named by the mount's slug, or the host's own 404. */
async function requireTenant(
  parts: PreviewParts,
  params: Record<string, string | undefined>,
): Promise<ImpersonationTenant> {
  const slug = params.tenantSlug ?? '';
  const tenant = slug ? await parts.config.directory.findTenantBySlug(slug) : null;
  if (!tenant) {
    throw new ImpersonationApiError(404, parts.config.messages.tenantNotFound);
  }
  return tenant;
}

function parseBody(parts: PreviewParts, body: unknown): StartPreviewBody {
  const result = startPreviewBody.safeParse(body);
  if (!result.success) {
    throw new ImpersonationApiError(400, parts.config.messages.invalidBody);
  }
  return result.data;
}

/**
 * Gate 1, with the denial recorded.
 *
 * Platform authority short-circuits it, the same way it short-circuits every
 * other tenant gate in a typical host. That is contained rather than leaky: such
 * an actor's member-preview ceiling is whatever they hold in the tenant, which
 * is nothing for someone with no membership — they can mint a preview and see
 * nothing through it.
 */
async function requirePermission(
  parts: PreviewParts,
  actor: ImpersonationActor,
  attempt: AttemptContext,
): Promise<void> {
  if (actor.isPlatformAdmin) return;
  if (actor.permissions.includes(parts.config.previewPermission)) return;
  throw await parts.refusals.refuseUnauthorized('not_authorized', attempt);
}

/**
 * Gates 2 and 3, with the denial recorded and the HOST's own status answered.
 *
 * Answering through {@link PreviewEntitlementPort.denialResponse} rather than a
 * flat 403 is what keeps the two distinct on the wire — a client shows an
 * upgrade prompt for one and points at the tenant's own settings for the other,
 * and a route that collapsed them would make both untestable and one of them
 * wrong.
 */
async function requireEntitlement(
  parts: PreviewParts,
  attempt: AttemptContext,
): Promise<void> {
  const gate = parts.config.previewEntitlement;
  if (!gate) return;
  try {
    await gate.require(attempt.tenantId);
  } catch (error) {
    if (!gate.isDenial(error)) throw error;
    // Recorded UNCONDITIONALLY, unlike the permission denial above: reaching
    // this gate means the caller already passed gate 1, so they are no stranger
    // to this tenant and the standing question is already answered.
    await parts.refusals.record(gate.refusalCode?.(error) ?? 'not_entitled', attempt);
    const denial = gate.denialResponse(error);
    throw new ImpersonationApiError(denial.status, denial.message);
  }
}

/**
 * The two states that must never produce a cookie, refused with the reason
 * recorded.
 *
 * A caller with no user id is the "authenticated identity with no row" trap: a
 * session started by them would be attributable to nobody. The reader refuses
 * such a cookie anyway — this refuses it at MINT time so the caller is told why
 * instead of receiving a cookie that silently does nothing.
 *
 * Nesting is blocked because a role preview MAY write, so without this someone
 * could chain preview into preview — and every hop after the first would be
 * minted under a cookie whose ceiling had already narrowed them, producing a
 * trail nobody could reconstruct.
 */
async function requireStartableActor(
  parts: PreviewParts,
  request: ImpersonationRequest,
  attempt: AttemptContext,
): Promise<string> {
  if (await authorizedSession(parts.codec, parts.config, request)) {
    throw await parts.refusals.refuse('already_impersonating', attempt);
  }
  if (!attempt.actorUserId) {
    throw await parts.refusals.refuse('actor_not_recorded', attempt);
  }
  return attempt.actorUserId;
}

/**
 * The MEMBER variant's two subject checks. A role preview needs neither — an
 * unknown role name resolves to an EMPTY ceiling in any correct host, so it
 * grants nothing and is visibly wrong to the operator rather than silently
 * over-granting.
 *
 * The platform-account rule is about the SUBJECT, not about which endpoint
 * minted the cookie, and both endpoints mint the same one — so leaving it off
 * here would leave the whole refusal one differently-shaped request away from
 * irrelevant. It is not redundant with the ceiling either: a preview only ever
 * narrows, so the previewed account's own rights are not inherited — but the
 * membership would still resolve, the session would still be minted, and the
 * trail would still record someone rendering the app as a platform operator.
 * What is being protected is the READABILITY of the record, not the permission
 * set.
 */
async function assertSubjectAllowed(
  parts: PreviewParts,
  previewOf: StartPreviewBody,
  attempt: AttemptContext,
): Promise<void> {
  if (previewOf.as !== 'member') return;
  const [isMember, target] = await Promise.all([
    parts.config.directory.isActiveMember(previewOf.memberUserId, attempt.tenantId),
    parts.config.directory.resolveTarget(previewOf.memberUserId),
  ]);
  if (!isMember) throw await parts.refusals.refuse('not_a_member', attempt);
  if (target?.isPlatformAdmin) {
    throw await parts.refusals.refuse('target_is_platform_admin', attempt);
  }
}

async function handleStartPreview(
  parts: PreviewParts,
  request: ImpersonationRequest,
): Promise<ImpersonationResponse> {
  const { config, codec } = parts;
  const { actor } = request;

  // Before anything else, and before any row is written: a machine token may not
  // open a session for a person to look through.
  if (actor.isMachineToken === true) {
    throw new ImpersonationApiError(403, config.messages.machineTokenRefused);
  }

  const tenant = await requireTenant(parts, request.params);
  const previewOf = parseBody(parts, request.body);
  const attempt = attemptOf(tenant.id, {
    actorUserId: actor.userId,
    previewOf,
    targetUserId: previewOf.as === 'member' ? previewOf.memberUserId : null,
  });

  // The AUTHORIZATION denial is keyed to the code and the caller alone. The
  // subject is still caller-supplied at this point and nothing has validated it,
  // so writing it into an indexed column would put an unvalidated value there;
  // and this trail records no contact data, so no address either.
  await requirePermission(parts, actor, attemptOf(tenant.id, { actorUserId: actor.userId }));
  await requireEntitlement(parts, attempt);
  const realUserId = await requireStartableActor(parts, request, attempt);
  await assertSubjectAllowed(parts, previewOf, attempt);

  const refusal = await config.mintPolicy.refuse?.({
    actor,
    surface: 'tenant',
    tenantId: tenant.id,
  });
  if (refusal) throw new ImpersonationApiError(403, refusal);

  const { session, cookie } = codec.start({
    kind: 'preview',
    realUserId,
    tenantId: tenant.id,
    previewOf,
  });
  const readOnly = previewOf.as !== 'role';

  // BEFORE the cookie exists: an unlogged impersonation is the one outcome this
  // mechanism exists to prevent, so a failed audit write must mean NO session
  // rather than a session nobody can see. Unfenced on purpose.
  await config.audit.started({
    kind: 'preview',
    tenantId: tenant.id,
    actorUserId: realUserId,
    targetUserId: previewOf.as === 'member' ? previewOf.memberUserId : null,
    targetApp: null,
    reason: null,
    previewOf,
    allowWrites: false,
    readOnly,
    expiresAt: session.expiresAt,
  });

  return ok(
    {
      previewOf,
      expiresAt: new Date(session.expiresAt).toISOString(),
      readOnly,
    },
    cookie,
  );
}

/**
 * `DELETE` — stop whatever session this browser holds.
 *
 * The slug is resolved for its 404 alone, so an unknown tenant answers the way
 * every other tenant-scoped route does. The ENTRY is keyed to the SESSION's own
 * tenant, never to this URL's — see {@link recordEnd}.
 */
async function handleStopPreview(
  parts: PreviewParts,
  request: ImpersonationRequest,
): Promise<ImpersonationResponse> {
  await requireTenant(parts, request.params);
  const live = await authorizedSession(parts.codec, parts.config, request);
  await recordEnd(parts.config, live);
  return ok({ ended: live !== null }, parts.codec.end());
}

export function previewRoutes(parts: PreviewParts): ImpersonationRoute[] {
  return [
    {
      method: 'POST',
      surface: 'tenant',
      path: '',
      handle: (r) => handleStartPreview(parts, r),
    },
    {
      method: 'DELETE',
      surface: 'tenant',
      path: '',
      handle: (r) => handleStopPreview(parts, r),
    },
  ];
}
