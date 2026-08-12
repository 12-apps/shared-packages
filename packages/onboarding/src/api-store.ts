import type { OnboardingStateSnapshot, OnboardingStore } from "./types";

/**
 * The `OnboardingStore` bound to the package's OWN endpoints (12-23).
 *
 * `OnboardingProvider` takes a store, and until now every host wrote that store
 * itself — future-pay's `apps/admin/src/shared/onboarding-store.ts` is a
 * ~70-line file whose entire content is "which URL, which body, revive the
 * dates". Those are facts about the endpoints in `./server`, which is to say
 * facts about this package: shipping the two halves separately is how a
 * `PATCH { op: 'save' }` on one side and a `POST { status }` on the other stay
 * green in their own test suites while never having spoken to each other.
 *
 * A host still supplies its own store when persistence is not these routes
 * (localStorage, tRPC, server actions) — the seam is unchanged.
 */

/** The snapshot as it crosses the wire — JSON has no `Date`. */
interface OnboardingSnapshotWire {
  featureKey: string;
  status: OnboardingStateSnapshot["status"];
  step: string | null;
  data: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
}

/** The `{ data }` envelope every endpoint in this package answers with. */
interface Envelope<T> {
  data: T;
}

/** Revive the wire snapshot's ISO dates into the package's `Date` fields. */
function reviveSnapshot(wire: OnboardingSnapshotWire): OnboardingStateSnapshot {
  return {
    ...wire,
    startedAt: wire.startedAt ? new Date(wire.startedAt) : null,
    completedAt: wire.completedAt ? new Date(wire.completedAt) : null,
  };
}

export interface OnboardingApiStoreConfig {
  /**
   * Where the package's routes are mounted, WITHOUT a trailing slash — e.g.
   * `/api/admin/minha-loja`. The `/onboarding/:featureKey` half is the
   * package's own and is appended here.
   */
  apiBase: string;
  /** Which guided feature this store persists (`ai_integration`, `payments`…). */
  featureKey: string;
  /**
   * Injected `fetch`, for a host that adds credentials/headers (and for tests).
   * Defaults to the global.
   */
  fetchImpl?: typeof fetch;
}

/** The URL of one feature's progress resource. */
function statePath(config: OnboardingApiStoreConfig): string {
  return `${config.apiBase}/onboarding/${encodeURIComponent(config.featureKey)}`;
}

async function patchState(
  config: OnboardingApiStoreConfig,
  body: Record<string, unknown>,
): Promise<OnboardingStateSnapshot> {
  const doFetch = config.fetchImpl ?? fetch;
  const response = await doFetch(statePath(config), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) {
    // The `OnboardingStore` contract is throw-on-failure: the provider keeps
    // its optimistic state and the next read reconciles. Swallowing it here
    // would report a failed save as a successful one.
    throw new Error(`onboarding save failed (${response.status})`);
  }
  const payload = (await response.json()) as Envelope<OnboardingSnapshotWire>;
  return reviveSnapshot(payload.data);
}

/**
 * Read the caller's saved progress for this feature — `null` before any
 * progress exists, which is exactly what `OnboardingProvider`'s `initialState`
 * takes. A failed read is also `null`: a first paint must not depend on it.
 */
export async function fetchOnboardingState(
  config: OnboardingApiStoreConfig,
): Promise<OnboardingStateSnapshot | null> {
  const doFetch = config.fetchImpl ?? fetch;
  try {
    const response = await doFetch(statePath(config), { credentials: "same-origin" });
    if (!response.ok) return null;
    const payload = (await response.json()) as Envelope<OnboardingSnapshotWire | null>;
    return payload.data ? reviveSnapshot(payload.data) : null;
  } catch {
    return null;
  }
}

/** The store handed to `<OnboardingProvider store={…}>`. */
export function createOnboardingApiStore(config: OnboardingApiStoreConfig): OnboardingStore {
  return {
    save: (patch) =>
      patchState(config, {
        op: "save",
        status: patch.status,
        step: patch.step,
        data: patch.data,
      }),
    dismiss: () => patchState(config, { op: "dismiss" }),
    reset: () => patchState(config, { op: "reset" }),
  };
}
