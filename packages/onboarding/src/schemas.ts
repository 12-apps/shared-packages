/**
 * `@12-apps/onboarding/schemas` — the PATCH body as a zod schema, closed at
 * every depth once the host states each feature's `data` (FUT-4867).
 *
 * A subpath of its own because it is the one part of this package that needs
 * `zod`, an OPTIONAL peer: a host that validates nothing itself (the package's
 * own handler already refuses a malformed body) never loads it.
 *
 * Why a host wants it: its route validates the body before the package sees
 * it, and a host whose rule is that every request input is closed at every
 * depth cannot pass `z.unknown()` there — nor a `data` that is a record keyed
 * by any string. Built from the same per-key schemas the server config takes,
 * the advertised body and the package's own check cannot disagree:
 *
 * ```ts
 * const dataSchemas = {
 *   ai_integration: z.strictObject({ selectedHost: z.string() }).partial(),
 *   // a list of keyed entries, never a record keyed by any string
 *   team_setup: z.strictObject({ invites: z.array(z.strictObject({ email: z.string() })) }).partial(),
 *   first_visit: z.strictObject({}),
 * };
 * createApiOnboarding({ …, dataSchemas });           // the package refuses per key
 * const onboardingBody = onboardingPatchBodyOf(dataSchemas); // the host's route validator
 * ```
 */
import { z } from "zod";

import type { OnboardingStatus } from "./types";

/** The four statuses the `onboarding_states.status` CHECK admits — the server's own list. */
const STATUSES = ["not_started", "in_progress", "completed", "dismissed"] as const satisfies readonly OnboardingStatus[];

/** One feature's `data` schema, as a host hands it in: any zod schema of an object. */
export type OnboardingDataSchema = z.ZodType<Record<string, unknown>>;

/**
 * The `data` a `save` may carry: one feature's schema, or any of several.
 *
 * The body does not know WHICH feature it is for — the key is in the path —
 * so with several features the body accepts any of their shapes, and the
 * package's per-key `dataSchemas` check narrows it to the right one. A union
 * of closed shapes is still closed.
 */
function saveDataOf(schemas: readonly OnboardingDataSchema[]): OnboardingDataSchema {
  const [first, second, ...rest] = schemas;
  if (!first) return z.strictObject({});
  if (!second) return first;
  return z.union([first, second, ...rest]);
}

/**
 * The PATCH body of `/onboarding/:featureKey`, strict at every depth: one of
 * `{ op: "save", status?, step?, data? }`, `{ op: "dismiss" }` or
 * `{ op: "reset" }`, with `data` drawn from `dataSchemas`. Closed exactly when
 * every schema in `dataSchemas` is (a `z.strictObject` all the way down, no
 * `z.unknown()`, no record keyed by any string — a list of keyed entries in
 * its place). An empty map takes no `data` keys at all.
 */
export function onboardingPatchBodyOf(dataSchemas: Readonly<Record<string, OnboardingDataSchema>>) {
  return z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("save"),
      status: z.enum(STATUSES).optional(),
      step: z.string().nullable().optional(),
      data: saveDataOf(Object.values(dataSchemas)).optional(),
    }),
    z.strictObject({ op: z.literal("dismiss") }),
    z.strictObject({ op: z.literal("reset") }),
  ]);
}
