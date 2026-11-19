import { z } from "zod";

import { ACCOUNT_DELETION_COPY, type AccountDeletionRefusals } from "./copy";
import type { AccountDeletionService, CancelOutcome, ScheduleOutcome } from "./service";
import type { AccountDeletionConfig } from "./types";

/**
 * The three routes, request in and response out, mounted by the host at one
 * path (`GET`, `POST` and `POST …/cancel`). The `{ data }` / `{ error, code }`
 * envelope is the package's; the caller is the host's `resolveCaller`.
 */

export const scheduleDeletionBody = z.strictObject({ password: z.string().min(1).max(200).optional() });
export const cancelDeletionBody = z.strictObject({});

const blocker = z.object({ kind: z.string(), label: z.string(), href: z.string() });
const forfeit = z.object({ kind: z.string(), label: z.string(), amount: z.string(), href: z.string() });

/** The wire of `GET`, for a host's API description. */
export const deletionReportSchema = z.object({
  state: z.enum(["active", "pending"]),
  purgeAt: z.string().nullable(),
  graceDays: z.number().int(),
  blockers: z.array(blocker),
  forfeits: z.array(forfeit),
  confirm: z.enum(["password", "google"]),
  freshSignIn: z.boolean(),
  canSchedule: z.boolean(),
});

type Reason = Extract<ScheduleOutcome, { ok: false }>["reason"] | Extract<CancelOutcome, { ok: false }>["reason"];

const STATUS: Record<Reason, [number, keyof AccountDeletionRefusals]> = {
  impersonating: [403, "impersonating"],
  pending: [409, "alreadyScheduled"],
  blocked: [409, "blocked"],
  "wrong-password": [403, "wrongPassword"],
  "rate-limited": [429, "tooManyAttempts"],
  "sign-in-again": [403, "signInAgain"],
  deleted: [401, "notScheduled"],
  "not-scheduled": [409, "notScheduled"],
};

const localeOf = (request: Request): "pt-BR" | "en-US" =>
  (request.headers.get("accept-language") ?? "").toLowerCase().startsWith("en") ? "en-US" : "pt-BR";

const refuse = (request: Request, reason: Reason): Response => {
  const [status, key] = STATUS[reason];
  return Response.json({ error: ACCOUNT_DELETION_COPY[localeOf(request)].refusals[key], code: reason }, { status });
};

const unauthorized = (): Response => Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });

async function bodyOf<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

export interface AccountDeletionRoutes {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  cancel: (request: Request) => Promise<Response>;
}

export function createAccountDeletionRoutes(
  service: AccountDeletionService,
  config: Pick<AccountDeletionConfig, "resolveCaller">,
): AccountDeletionRoutes {
  return {
    GET: async (request) => {
      const caller = await config.resolveCaller(request);
      if (!caller) return unauthorized();
      return Response.json({ data: await service.report(caller) });
    },
    POST: async (request) => {
      const caller = await config.resolveCaller(request);
      if (!caller) return unauthorized();
      const body = await bodyOf(request, scheduleDeletionBody);
      if (!body) return Response.json({ error: "Invalid body", code: "INVALID_BODY" }, { status: 400 });
      const outcome = await service.schedule(caller, body.password ?? null);
      return outcome.ok ? Response.json({ data: { purgeAt: outcome.purgeAt.toISOString() } }) : refuse(request, outcome.reason);
    },
    cancel: async (request) => {
      const caller = await config.resolveCaller(request);
      if (!caller) return unauthorized();
      if (!(await bodyOf(request, cancelDeletionBody))) return Response.json({ error: "Invalid body", code: "INVALID_BODY" }, { status: 400 });
      const outcome = await service.cancel(caller);
      return outcome.ok ? Response.json({ data: { cancelled: true } }) : refuse(request, outcome.reason);
    },
  };
}
