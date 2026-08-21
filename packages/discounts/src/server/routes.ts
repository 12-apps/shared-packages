import type { z } from "zod";

import type { WireRequest, WireResponse, WireRoute } from "@12-apps/wiring";

import {
  assertCollections,
  assertTargetsOwned,
  ForeignTargetError,
  loadTargetGroups,
  type DiscountableCollection,
} from "./collections";
import { missingServerCopy, type DiscountsServerCopy } from "./copy";
import { logWrite, observed, type DiscountsLogger } from "./logging";
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
   * Where this surface says what it did. Required, and for the same reason
   * `copy` is: a default would be a no-op, and a no-op default is exactly the
   * silence this config exists to end — the manifest declares an
   * `observability` namespace, so a host adopting through
   * `@12-apps/wiring/consumer` already HAS the logger and passes
   * `assembled.loggers["@12-apps/discounts"]`; a host on no wiring passes any
   * `createFeatureLogger`-shaped child. See `./logging`.
   */
  logger: DiscountsLogger;
  /**
   * The host tables a discount may be pointed at — see `./collections`.
   *
   * OPTIONAL, and the omission is a real configuration rather than an
   * oversight: a host that sells one undifferentiated thing has no catalog
   * dimension to register, and ORDER-scoped promotions need none. What it
   * costs is stated plainly rather than defaulted around — with no collection
   * registered for a dimension, `GET /discounts/targets` reports nothing for
   * it and the cross-tenant check on ITS ids does not run here, so the store
   * remains responsible for refusing a foreign target.
   */
  collections?: readonly DiscountableCollection[];
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
function fieldError(error: DiscountValidationError | ForeignTargetError): WireResponse {
  const status = error instanceof DiscountValidationError ? error.status : 422;
  return {
    status,
    body: { error: error.message, issues: { [error.field]: error.message } },
  };
}

/** The id acknowledgement update and delete answer with. */
function acknowledged(id: string): WireResponse {
  return ok({ data: { id } });
}

/**
 * Fold a validated body into what the store persists, and refuse a target that
 * is not this tenant's.
 *
 * Both writes go through it, so the rules run exactly once per write and a
 * second caller cannot half-apply them. The ownership check is here rather than
 * in each route for the same reason, and it runs AFTER the fold because the
 * fold is what narrows the targets to the scope — checking the raw body would
 * reject ids a COMBO-scoped write was about to drop anyway.
 */
async function prepareWrite(config: DiscountsApiConfig, clientId: string, body: unknown) {
  const input = toDiscountWriteInput(body as DiscountWriteBody);
  const write = { scalars: toDiscountScalars(input, config.copy), targets: targetsForScope(input) };
  if (config.collections) {
    await assertTargetsOwned(config.collections, clientId, write.targets, config.copy.foreignTarget);
  }
  return write;
}

/**
 * One descriptor's handler, observed and then folded.
 *
 * `observed` logs every outcome and changes none of them (see `./logging`);
 * this fold turns THIS package's own validation failure into the 422 the
 * operator can act on. Everything else — a uniqueness clash, a foreign target,
 * a stale id — is the STORE's to raise, in the host's own error vocabulary,
 * and travels untouched to the host's error mapping.
 *
 * Every route goes through it, reads included. A read cannot raise a
 * `DiscountValidationError`, but it can absolutely throw — and before this the
 * three read routes had no catch at all, so a store that failed inside `list`
 * reached the host's catch-all with nothing in the log naming discounts.
 */
function endpoint(
  config: DiscountsApiConfig,
  route: string,
  handle: (request: WireRequest<DiscountsActor>) => Promise<WireResponse>,
): (request: WireRequest<DiscountsActor>) => Promise<WireResponse> {
  const observedHandle = observed(config.logger, route, handle);
  return async (request) => {
    try {
      return await observedHandle(request);
    } catch (error) {
      const refusal = error instanceof DiscountValidationError || error instanceof ForeignTargetError;
      if (refusal) return fieldError(error);
      throw error;
    }
  };
}

function listRoute(config: DiscountsApiConfig): DiscountRoute {
  const schema = config.listQuery ?? (listDiscountsQuery as z.ZodType<DiscountListInput>);
  return {
    method: "GET",
    path: "/discounts",
    permission: DISCOUNTS_READ,
    handle: endpoint(config, "GET /discounts", async ({ actor, query }) => {
      const parsed = schema.safeParse(query);
      if (!parsed.success) {
        return { status: 400, body: { error: config.copy.invalidQuery } };
      }
      // Returned as-is rather than wrapped: the page IS the `{ data,
      // pagination }` envelope the advertised response describes, and wrapping
      // it again would nest it under a second `data`.
      return ok(await config.store.list(actor.clientId, parsed.data));
    }),
  };
}

/**
 * What an operator may point a discount at: every registered collection's rows,
 * in one round trip.
 *
 * It exists so the FORM stops assembling its own reference data. The origin
 * host's page side-loaded the tenant's whole category list and whole product
 * list from two unrelated admin endpoints, at a page size it had to know
 * (`?pageSize=500`), and gated its own render on both — three coupled decisions
 * in a screen that only wanted "what can I tick".
 *
 * The route exists even with NO collection registered, answering an empty list.
 * A route table that varied with config would make the advertised tool surface
 * vary with it too, and "which endpoints does this package have" must be
 * answerable without knowing how one host wired it.
 *
 * `discounts:write` rather than `discounts:read`: the grid needs none of this,
 * only the editor does, and the narrower gate is the one that says so.
 */
function targetsRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "GET",
    path: "/discounts/targets",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "GET /discounts/targets", async ({ actor }) =>
      ok({ data: await loadTargetGroups(config.collections ?? [], actor.clientId) }),
    ),
  };
}

function readRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "GET",
    path: "/discounts/:id",
    permission: DISCOUNTS_READ,
    handle: endpoint(config, "GET /discounts/:id", async ({ actor, params }) => {
      const record = await config.store.get(actor.clientId, String(params.id));
      if (record === null) return { status: 404, body: { error: config.copy.notFound } };
      return ok({ data: record as DiscountRecord });
    }),
  };
}

function createRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "POST",
    path: "/discounts",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "POST /discounts", async (request) => {
      const { actor, body } = request;
      const write = await prepareWrite(config, actor.clientId, body);
      const created = await config.store.create(actor.clientId, write);
      logWrite(config.logger, "created", request, created.id);
      return ok({ data: created });
    }),
  };
}

function updateRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "PATCH",
    path: "/discounts/:id",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "PATCH /discounts/:id", async (request) => {
      const { actor, params, body } = request;
      const id = String(params.id);
      const write = await prepareWrite(config, actor.clientId, body);
      await config.store.update(actor.clientId, id, write);
      logWrite(config.logger, "re-stated", request, id);
      return acknowledged(id);
    }),
  };
}

function archiveRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "DELETE",
    path: "/discounts/:id",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "DELETE /discounts/:id", async (request) => {
      const { actor, params } = request;
      const id = String(params.id);
      await config.store.archive(actor.clientId, id);
      logWrite(config.logger, "archived", request, id);
      return acknowledged(id);
    }),
  };
}

/** The three methods `observed` calls — asserted before any request arrives. */
function assertLogger(logger: DiscountsLogger | undefined): void {
  const complete =
    typeof logger?.info === "function" &&
    typeof logger.warn === "function" &&
    typeof logger.error === "function";
  if (complete) return;
  throw new Error(
    "@12-apps/discounts: createApiDiscounts needs a logger with info/warn/error — " +
      "the manifest declares an observability namespace, so a wiring host passes " +
      'assembled.loggers["@12-apps/discounts"]; there is no silent default.',
  );
}

/**
 * The five descriptors, config asserted at construction.
 *
 * Copy and the logger are checked HERE rather than at first request, because a
 * missing sentence or a missing logger is a wiring mistake and it should fail
 * where the wiring is written — the report-builder doctrine: required fields,
 * no defaults, asserted at assembly. The logger earned that treatment the hard
 * way: for the whole of 1.0.x the manifest promised these routes logged, the
 * host built the namespaced logger, and nothing connected the two.
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
  assertLogger(config.logger);
  assertCollections(config.collections ?? []);
  return {
    routes: [
      listRoute(config),
      // BEFORE the `:id` read, because `/discounts/targets` would otherwise be
      // matched by it in any router that resolves in declaration order — and
      // the answer would be a 404 for a discount named "targets".
      targetsRoute(config),
      readRoute(config),
      createRoute(config),
      updateRoute(config),
      archiveRoute(config),
    ],
  };
}
