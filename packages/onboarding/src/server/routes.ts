import type { OnboardingRepository } from "../repository";
import type { OnboardingStatePatch, OnboardingStateSnapshot, OnboardingStatus } from "../types";

import {
  foldApiError,
  messagesOf,
  ok,
  OnboardingApiError,
  type OnboardingActor,
  type OnboardingRoute,
  type OnboardingServerConfig,
} from "./context";

/**
 * The two progress endpoints (12-23) — the package half of the origin host's
 * `app/api/admin/[tenantSlug]/onboarding/[featureKey]/route.ts`:
 *
 *   GET   /onboarding/:featureKey   → the caller's snapshot, or `null`
 *   PATCH /onboarding/:featureKey   → one operation (save / dismiss / reset)
 *
 * Paths are relative to the host's mount (the origin host mounts them under
 * `/api/admin/:tenantSlug`). Parsing, statuses, the `{ data }` envelope and the
 * three operations' semantics are the package's; who is asking, on which
 * tenant, is the host's.
 */

/** The four statuses the `onboarding_states.status` CHECK admits. */
const STATUSES: readonly OnboardingStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "dismissed",
];

/** A clean not-started snapshot — what a wiped feature reads back as. */
function emptySnapshot(featureKey: string): OnboardingStateSnapshot {
  return {
    featureKey,
    status: "not_started",
    step: null,
    data: {},
    startedAt: null,
    completedAt: null,
  };
}

/**
 * The `featureKey` path param, validated against the host's declared set.
 *
 * A 404 rather than a 400 on an undeclared key: the resource genuinely does not
 * exist on this host, and answering 200 with an empty snapshot (what an
 * unvalidated key did) makes a typo indistinguishable from a first visit.
 */
function requireFeatureKey(
  config: OnboardingServerConfig,
  params: Record<string, string | undefined>,
): string {
  const featureKey = params.featureKey;
  if (!featureKey) {
    throw new OnboardingApiError(404, messagesOf(config).unknownFeature);
  }
  if (config.featureKeys && !config.featureKeys.includes(featureKey)) {
    throw new OnboardingApiError(404, messagesOf(config).unknownFeature);
  }
  return featureKey;
}

/** A plain JSON object, or `undefined` for anything else. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** One onboarding operation, mirroring the origin host's discriminated-union body. */
type Operation =
  | { op: "save"; patch: OnboardingStatePatch }
  | { op: "dismiss" }
  | { op: "reset" };

/**
 * The `save` patch, field by field. Deliberately strict about `status` and about
 * the field TYPES (a `step` that is a number, a `data` that is an array) — an
 * unvalidated patch reaches the DB CHECK as a 500 instead of a 400.
 *
 * `undefined` means the field is ABSENT, which is not the same as `null`: an
 * absent `step` keeps whatever is stored, a null one clears it.
 */
function parseSavePatch(
  record: Record<string, unknown>,
  invalid: () => never,
): OnboardingStatePatch {
  const patch: OnboardingStatePatch = {};
  if (record.status !== undefined) {
    if (typeof record.status !== "string" || !STATUSES.includes(record.status as OnboardingStatus)) {
      invalid();
    }
    patch.status = record.status as OnboardingStatus;
  }
  if (record.step !== undefined) {
    if (record.step !== null && typeof record.step !== "string") invalid();
    patch.step = record.step as string | null;
  }
  if (record.data !== undefined) {
    const data = asRecord(record.data);
    if (!data) invalid();
    patch.data = data;
  }
  return patch;
}

/** Parse + validate the PATCH body into one of the three operations. */
function parseOperation(config: OnboardingServerConfig, body: unknown): Operation {
  const record = asRecord(body);
  const invalid = (): never => {
    throw new OnboardingApiError(400, messagesOf(config).invalidOperation);
  };
  if (!record) return invalid();

  if (record.op === "dismiss") return { op: "dismiss" };
  if (record.op === "reset") return { op: "reset" };
  if (record.op !== "save") return invalid();

  return { op: "save", patch: parseSavePatch(record, invalid) };
}

interface RouteDeps {
  config: OnboardingServerConfig;
  repository: OnboardingRepository;
}

/** `process.env` is read through this so a host can decide what "prod" means. */
function resetAllowed(config: OnboardingServerConfig): boolean {
  if (config.resetEnabled) return config.resetEnabled();
  return typeof process === "undefined" || process.env?.NODE_ENV !== "production";
}

async function applyOperation(
  deps: RouteDeps,
  actor: OnboardingActor,
  featureKey: string,
  operation: Operation,
): Promise<OnboardingStateSnapshot> {
  const { userId, clientId } = actor;
  if (operation.op === "save") {
    return deps.repository.upsertOnboardingState(userId, clientId, featureKey, operation.patch);
  }
  if (operation.op === "dismiss") {
    return deps.repository.upsertOnboardingState(userId, clientId, featureKey, {
      status: "dismissed",
    });
  }
  // `reset` — DEV-only: refuse in production even if a caller reaches the route
  // (the origin host also compiles the UI affordance out of prod builds).
  //
  // DIVERGENCE from the origin host, deliberate: this answers 403 where the host's
  // `ActionError` mapping made it 400. 403 is the accurate code for "you may not do
  // this here", and no caller branches on it (the affordance is compiled out), but
  // it IS a changed status rather than a pure move.
  if (!resetAllowed(deps.config)) {
    throw new OnboardingApiError(403, messagesOf(deps.config).resetUnavailable);
  }
  await deps.repository.deleteOnboardingState(userId, clientId, featureKey);
  return emptySnapshot(featureKey);
}

export function onboardingRoutes(deps: RouteDeps): OnboardingRoute[] {
  return [
    {
      method: "GET",
      path: "/onboarding/:featureKey",
      async handle({ actor, params }) {
        try {
          const featureKey = requireFeatureKey(deps.config, params);
          // `null` is a legitimate answer, not a 404: "this user has not
          // started" is exactly what the provider's `initialState` wants.
          return ok(
            await deps.repository.getOnboardingState(actor.userId, actor.clientId, featureKey),
          );
        } catch (error) {
          return foldApiError(error);
        }
      },
    },
    {
      method: "PATCH",
      path: "/onboarding/:featureKey",
      async handle({ actor, params, body }) {
        try {
          const featureKey = requireFeatureKey(deps.config, params);
          const operation = parseOperation(deps.config, body);
          return ok(await applyOperation(deps, actor, featureKey, operation));
        } catch (error) {
          return foldApiError(error);
        }
      },
    },
  ];
}
