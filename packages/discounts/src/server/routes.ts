import type { z } from "zod";

import type { WireRequest, WireResponse, WireRoute } from "@12-apps/wiring";

import { missingServerCopy, type DiscountsServerCopy } from "./copy";
import { listDiscountsQuery } from "./mcp";
import { DISCOUNTS_READ, DISCOUNTS_WRITE } from "./contribution";
import type { DiscountListInput, DiscountRecord, DiscountStore } from "./store";
import {
  DiscountValidationError,
  targetsForScope,
  toDiscountScalars,
  toDiscountWriteInput,
  type DiscountWriteBody,
} from "./validate";

/**
 * The admin discounts HTTP surface (FUT-244), as framework-neutral wiring
 * descriptors: tenant-scoped CRUD over the promotions an operator manages.
 *
 * What is NOT here is as deliberate as what is. There is no lifecycle or
 * approval branch (FUT-235 D7) — a pricing rule with a live redemption counter
 * is not versioned catalog content, so a write applies immediately or fails.
 * There is no authentication, no tenant resolution and no RBAC: each
 * descriptor DECLARES the permission it needs and the host's guard answers it,
 * because which tier a route requires is host policy, and the actor arrives
 * already resolved.
 *
 * Delete is a SOFT archive rather than a row removal, and that is a product
 * decision rather than an implementation detail: the orders that already
 * redeemed this discount keep their snapshot, and its redemption counter stays
 * readable for reporting.
 */

/** Whoever the host resolved: the tenant this request may act inside. */
export interface DiscountsActor {
  /** The tenant's id — every store call is scoped to it. */
  clientId: string;
}

export type DiscountRoute = WireRoute<DiscountsActor>;

export interface DiscountsApiConfig {
  /** Where the rows are — see {@link DiscountStore}. */
  store: DiscountStore;
  /** Every sentence this surface answers a human with. Required, no defaults. */
  copy: DiscountsServerCopy;
  /**
   * The schema the list query is validated against. Optional ONLY because a
   * mechanical default is portable: the package's own, built from the search
   * config's defaults. A host that tunes page-size ceilings by environment, or
   * that adds a pill of its own vocabulary, passes the schema it also
   * advertises through `mcpOverrides.listDiscounts.query` — one object, so the
   * advertised surface and the enforced one cannot drift.
   */
  listQuery?: z.ZodType<DiscountListInput>;
}

function ok(body: unknown): WireResponse {
  return { status: 200, body };
}

/** The `{ error, issues }` shape a form reads its per-input errors out of. */
function fieldError(error: DiscountValidationError): WireResponse {
  return {
    status: error.status,
    body: { error: error.message, issues: { [error.field]: error.message } },
  };
}

/** The id acknowledgement update and delete answer with. */
function acknowledged(id: string): WireResponse {
  return ok({ data: { id } });
}

/**
 * Fold a validated body into what the store persists.
 *
 * Both writes go through it, so the rules run exactly once per write and a
 * second caller cannot half-apply them.
 */
function writeFrom(body: unknown, copy: DiscountsServerCopy) {
  const input = toDiscountWriteInput(body as DiscountWriteBody);
  return { scalars: toDiscountScalars(input, copy), targets: targetsForScope(input) };
}

/**
 * Run a write, turning this package's own validation failure into the 422 the
 * operator can act on. Everything else — a uniqueness clash, a foreign target,
 * a stale id — is the STORE's to raise, in the host's own error vocabulary,
 * and travels untouched to the host's error mapping.
 */
async function attempt(run: () => Promise<WireResponse>): Promise<WireResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DiscountValidationError) return fieldError(error);
    throw error;
  }
}

function listRoute(config: DiscountsApiConfig): DiscountRoute {
  const schema = config.listQuery ?? (listDiscountsQuery as z.ZodType<DiscountListInput>);
  return {
    method: "GET",
    path: "/discounts",
    permission: DISCOUNTS_READ,
    handle: async ({ actor, query }: WireRequest<DiscountsActor>) => {
      const parsed = schema.safeParse(query);
      if (!parsed.success) {
        return { status: 400, body: { error: config.copy.invalidQuery } };
      }
      // Returned as-is rather than wrapped: the page IS the `{ data,
      // pagination }` envelope the advertised response describes, and wrapping
      // it again would nest it under a second `data`.
      return ok(await config.store.list(actor.clientId, parsed.data));
    },
  };
}

function readRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "GET",
    path: "/discounts/:id",
    permission: DISCOUNTS_READ,
    handle: async ({ actor, params }: WireRequest<DiscountsActor>) => {
      const record = await config.store.get(actor.clientId, String(params.id));
      if (record === null) return { status: 404, body: { error: config.copy.notFound } };
      return ok({ data: record as DiscountRecord });
    },
  };
}

function createRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "POST",
    path: "/discounts",
    permission: DISCOUNTS_WRITE,
    handle: ({ actor, body }: WireRequest<DiscountsActor>) =>
      attempt(async () =>
        ok({ data: await config.store.create(actor.clientId, writeFrom(body, config.copy)) }),
      ),
  };
}

function updateRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "PATCH",
    path: "/discounts/:id",
    permission: DISCOUNTS_WRITE,
    handle: ({ actor, params, body }: WireRequest<DiscountsActor>) =>
      attempt(async () => {
        const id = String(params.id);
        await config.store.update(actor.clientId, id, writeFrom(body, config.copy));
        return acknowledged(id);
      }),
  };
}

function archiveRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "DELETE",
    path: "/discounts/:id",
    permission: DISCOUNTS_WRITE,
    handle: async ({ actor, params }: WireRequest<DiscountsActor>) => {
      const id = String(params.id);
      await config.store.archive(actor.clientId, id);
      return acknowledged(id);
    },
  };
}

/**
 * The five descriptors, config asserted at construction.
 *
 * Copy is checked HERE rather than at first request, because a missing
 * sentence is a wiring mistake and it should fail where the wiring is written
 * — the report-builder doctrine: required fields, no defaults, asserted at
 * assembly.
 */
export function createApiDiscounts(config: DiscountsApiConfig): {
  routes: readonly DiscountRoute[];
} {
  const missing = missingServerCopy(config.copy);
  if (missing.length > 0) {
    throw new Error(
      `@12-apps/discounts: createApiDiscounts is missing copy for ${missing.join(", ")} — ` +
        "every sentence this surface answers a human with is host config, with no defaults.",
    );
  }
  return {
    routes: [
      listRoute(config),
      readRoute(config),
      createRoute(config),
      updateRoute(config),
      archiveRoute(config),
    ],
  };
}
