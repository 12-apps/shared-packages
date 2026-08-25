import type { ImpersonationSessionCodec } from '../core/session';
import type { ImpersonationTarget, ImpersonationTenant } from '../core/types';

import { NO_SESSION, bannerState } from './banner-state';
import {
  ImpersonationApiError,
  ok,
  type ImpersonationActor,
  type ImpersonationRequest,
  type ImpersonationResponse,
  type ImpersonationRoute,
  type ImpersonationServerConfig,
  messagesOf,
} from './context';
import { authorizedSession } from './live-session';
import { attemptOf, type AttemptContext, type Refusals } from './refusals';
import { recordEnd } from './session-end';
import { startOperatorBody, type StartOperatorBody } from './wire';

/**
 * The PLATFORM surface — start, stop and describe a session.
 *
 * Three verbs on ONE resource, because that is what it is: a session either
 * exists or does not, and there is exactly one of it per browser.
 *
 *   POST   start — platform authority only, minted + audited, cookie planted
 *   DELETE stop  — anyone holding one, cookie cleared
 *   GET    the banner's state — anyone, including nobody in particular
 *
 * WHY THE THREE GATES DIFFER, since a reader will notice and should not have to
 * guess. STARTING is the privileged act. STOPPING is gated on nothing but
 * possession of the cookie, deliberately: there is no session to protect from
 * someone who wants to end it, and any check here is a new way for the exit to
 * fail. DESCRIBING is likewise open, because it answers only from the caller's
 * own cookie and a storefront mounts the same banner for anonymous visitors — a
 * 401 there would be noise on every page load.
 *
 * WHY THE STOP AND READ VERBS LIVE ON THIS SURFACE even though a tenant preview
 * is not a platform action: every app mounts the same banner, so they must share
 * one endpoint, and a shared endpoint has to sit somewhere that is not
 * tenant-scoped.
 */

interface PlatformParts {
  config: ImpersonationServerConfig;
  codec: ImpersonationSessionCodec;
  refusals: Refusals;
}

/** The three things a start has to have resolved before it may mint anything. */
interface StartContext {
  tenant: ImpersonationTenant;
  actorUserId: string;
  target: ImpersonationTarget;
}

function parseBody(
  parts: PlatformParts,
  body: unknown,
  locale: string | undefined,
): StartOperatorBody {
  const result = startOperatorBody(parts.config.mintPolicy).safeParse(body);
  if (!result.success) {
    throw new ImpersonationApiError(400, messagesOf(parts.config, locale).invalidBody);
  }
  return result.data;
}

/**
 * Refuse a start made from INSIDE a live session.
 *
 * There is exactly one cookie per browser, so a second mint does not nest: it
 * OVERWRITES. And because the end entry is written by the EXIT rather than by
 * the overwrite, the replaced session's start row is left dangling forever in a
 * record that cannot be amended — the trail would show an operator entering two
 * accounts and leaving one. Refusing is the only shape that keeps every start
 * paired, since "end the old one on their behalf" would file an end nobody asked
 * for and hide the mistake.
 *
 * The row is keyed to the LIVE session's tenant, not to the one the request
 * named: that is the tenant whose end record was nearly lost, and its id is
 * known to exist (a session was minted against it), so a host with a foreign key
 * on the trail holds without a lookup.
 */
async function refuseNesting(
  parts: PlatformParts,
  request: ImpersonationRequest,
  body: StartOperatorBody,
): Promise<ImpersonationApiError | null> {
  const live = await authorizedSession(parts.codec, parts.config, request);
  if (!live) return null;
  return parts.refusals.refuse(
    'already_impersonating',
    attemptOf(live.state.tenantId, {
      actorUserId: live.state.realUserId,
      targetUserId: body.targetUserId,
      reason: body.reason,
    }),
    request.locale,
  );
}

/**
 * Require platform authority, recording the denial when there is a caller to
 * record it against AND the tenant has standing to hear about it.
 *
 * The named tenant must EXIST before a row is written: a host whose trail keys
 * on a real tenant would fail the insert for a made-up id and turn a 403 into a
 * 500 — the caller learning less, not more.
 */
async function authorizeStart(
  parts: PlatformParts,
  actor: ImpersonationActor,
  body: StartOperatorBody,
  locale: string | undefined,
): Promise<void> {
  if (actor.isPlatformAdmin) return;
  const tenant = await parts.config.directory.findTenant(body.tenantId);
  if (!tenant) {
    throw new ImpersonationApiError(403, messagesOf(parts.config, locale).notAuthorized);
  }
  throw await parts.refusals.refuseUnauthorized(
    'not_authorized',
    attemptOf(tenant.id, {
      actorUserId: actor.userId,
      // The caller's own address is deliberately NOT recorded here. The field
      // exists for the one refusal that has no user id to name instead, and a
      // caller refused HERE has one by construction (the standing check needs
      // it) — so writing it would be contact data bought for nothing, in a
      // record the tenant's own owner can read.
      actorEmail: null,
      targetUserId: body.targetUserId,
      reason: body.reason,
    }),
    locale,
  );
}

/**
 * Resolve the tenant, the real human and the target — refusing (with a row) at
 * the first thing that does not hold.
 *
 * The ORDER keeps every refusal recordable. The tenant comes first because it is
 * what a row hangs off; the actor second, because a caller with no user id
 * cannot be named as the impersonator and the trail must always name a real
 * account; the target last, since its refusals need the other two to be
 * recordable at all.
 */
async function resolveStart(
  parts: PlatformParts,
  actor: ImpersonationActor,
  body: StartOperatorBody,
  locale: string | undefined,
): Promise<StartContext> {
  const { directory } = parts.config;
  const messages = messagesOf(parts.config, locale);
  const tenant = await directory.findTenant(body.tenantId);
  if (!tenant) throw new ImpersonationApiError(404, messages.tenantNotFound);

  const attempt: AttemptContext = attemptOf(tenant.id, {
    actorEmail: actor.email,
    targetUserId: body.targetUserId,
    reason: body.reason,
  });

  if (!actor.userId) {
    throw await parts.refusals.refuse('actor_not_recorded', attempt, locale);
  }
  const actorUserId = actor.userId;
  const withActor = { ...attempt, actorUserId };

  const target = await directory.resolveTarget(body.targetUserId);
  if (!target) throw await parts.refusals.refuse('target_not_found', withActor, locale);
  if (target.isPlatformAdmin) {
    throw await parts.refusals.refuse('target_is_platform_admin', withActor, locale);
  }
  return { tenant, actorUserId, target };
}

/**
 * `POST` — start an operator session.
 *
 * The audit entry is written BEFORE the cookie is minted, and that order is the
 * only guarantee available here: there is no database mutation to share a
 * transaction with (the session IS the cookie), so "logged, then started" is
 * what makes an unrecorded session impossible. A failed write costs the operator
 * a retry; the reverse order would cost a session nobody can see.
 *
 * THE NESTING CHECK RUNS BEFORE THE AUTHORITY CHECK, and the order is not
 * cosmetic. A host forces platform authority OFF while a session is in force
 * (that is the point of the feature), so an authority check made from inside one
 * answers "you are not an operator" — and would file that as the refusal, naming
 * the wrong reason for the rest of the record's life. Asking the question this
 * handler can answer honestly first is what keeps the trail true.
 */
async function handleStart(
  parts: PlatformParts,
  request: ImpersonationRequest,
): Promise<ImpersonationResponse> {
  const { config, codec } = parts;
  const { actor, locale } = request;
  const body = parseBody(parts, request.body, locale);

  if (actor.isMachineToken === true) {
    throw new ImpersonationApiError(403, messagesOf(config, locale).machineTokenRefused);
  }

  const nested = await refuseNesting(parts, request, body);
  if (nested) throw nested;

  await authorizeStart(parts, actor, body, locale);
  const { tenant, actorUserId, target } = await resolveStart(parts, actor, body, locale);

  const refusal = await config.mintPolicy.refuse?.({
    actor,
    surface: 'platform',
    tenantId: tenant.id,
  });
  if (refusal) throw new ImpersonationApiError(403, refusal);

  const { session, cookie } = codec.start({
    kind: 'operator',
    realUserId: actorUserId,
    targetUserId: target.id,
    targetApp: body.targetApp,
    tenantId: tenant.id,
    reason: body.reason,
    allowWrites: body.allowWrites,
  });

  await config.audit.started({
    kind: 'operator',
    tenantId: tenant.id,
    actorUserId,
    targetUserId: target.id,
    targetApp: body.targetApp,
    reason: body.reason,
    previewOf: null,
    allowWrites: body.allowWrites,
    readOnly: !body.allowWrites,
    expiresAt: session.expiresAt,
  });

  // The subject is narrowed to the three fields the banner renders. `target`
  // also carries `isPlatformAdmin`, which is an authority answer this endpoint
  // computed for its own refusal and has no business publishing.
  const subject = { id: target.id, name: target.name, email: target.email };
  return ok(bannerState(session, subject, tenant), cookie);
}

/**
 * `DELETE` — stop the session.
 *
 * It clears the cookie and NOTHING else. The actor's own session token is never
 * touched, which is the property that made a separate cookie the right shape to
 * begin with: stopping an impersonation must not be able to cost someone their
 * sign-in.
 *
 * Answers 200 whether or not a session was in force, so a double-click, a stale
 * tab and a browser that already dropped the cookie all converge on the same
 * cleared state instead of surfacing an error the caller can do nothing with.
 */
async function handleStop(
  parts: PlatformParts,
  request: ImpersonationRequest,
): Promise<ImpersonationResponse> {
  const live = await authorizedSession(parts.codec, parts.config, request);
  await recordEnd(parts.config, live);
  return ok({ ended: live !== null }, parts.codec.end());
}

/**
 * `GET` — what the banner should say.
 *
 * BOTH kinds, one shape. The authoritative reader is the same one every guard
 * uses, so a banner is never painted over a session the rest of the app is
 * ignoring.
 */
async function handleDescribe(
  parts: PlatformParts,
  request: ImpersonationRequest,
): Promise<ImpersonationResponse> {
  const live = await authorizedSession(parts.codec, parts.config, request);
  if (!live) return ok(NO_SESSION);
  const [subject, tenant] = await Promise.all([
    parts.config.directory.findUser(live.state.subjectUserId),
    parts.config.directory.findTenant(live.state.tenantId),
  ]);
  return ok(bannerState(live.session, subject, tenant));
}

export function platformRoutes(parts: PlatformParts): ImpersonationRoute[] {
  return [
    { method: 'POST', surface: 'platform', path: '', handle: (r) => handleStart(parts, r) },
    { method: 'DELETE', surface: 'platform', path: '', handle: (r) => handleStop(parts, r) },
    { method: 'GET', surface: 'platform', path: '', handle: (r) => handleDescribe(parts, r) },
  ];
}
