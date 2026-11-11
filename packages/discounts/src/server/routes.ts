import type { z } from "zod";

import type { WireRequest, WireResponse, WireRoute } from "@12-apps/wiring";

import {
  assertCollections,
  ForeignTargetError,
  loadTargetGroups,
  type DiscountableCollection,
} from "./collections";
import {
  missingServerCopy,
  resolveDiscountsCopy,
  type DiscountsCopySource,
  type DiscountsServerCopy,
} from "./copy";
import {
  assertWholeDayCopy,
  pageWithCalendarDays,
  readZoneFor,
  warnUnflagged,
  withCalendarDays,
  writtenZone,
  type ReadZone,
  type StoreTimeZone,
} from "./calendar-days";
import { logWrite, observed, type DiscountsLogger } from "./logging";
import { createBulkRoute } from "./bulk-route";
import { fallbackSentence } from "./fallback-copy";
import { prepareWrite } from "./prepare-write";
import { problemsOf } from "./problems";
import { updateWithWindow, WindowChangedError, windowModeOf } from "./update-window";
import { isKnownTimeZone } from "../timezone";
import { listDiscountsQuery } from "./mcp";
import { DISCOUNTS_READ, DISCOUNTS_WRITE } from "./contribution";
import type { DiscountListInput, DiscountRecord, DiscountStore } from "./store";
import { DiscountValidationError } from "./validate";

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
  /**
   * Every sentence this surface answers a human with. Required, no defaults.
   *
   * A bilingual host passes a RESOLVER instead — `localeCopy(DISCOUNTS_SERVER_COPY)`
   * — and each request is answered in its own caller's language. The plain
   * value stays legal, so a host with one audience changes nothing.
   */
  copy: DiscountsCopySource<DiscountsServerCopy>;
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
  /**
   * The STORE's IANA zone for a tenant (FUT-4482) — `America/Sao_Paulo`.
   *
   * With it, Início and Término count WHOLE days on that clock: a write stores
   * the first instant of Início and of the day after Término, Início = Término
   * is a one-day promotion, and every record answered carries `startsOn` /
   * `endsOn`, the days it runs on there. A save whose days equal the ones a
   * read showed writes the stored window unchanged, whatever the zone (review
   * round 6). A zone the runtime does not know refuses CHANGED dates — on any
   * row, and on a create that sends any — with a 422 on the date field rather
   * than storing a window on a guessed clock, while an edit that keeps the
   * stored window (`keepWindow`, or the same days) saves, and so does a create
   * with no dates. A read then logs a warning and answers EVERY row
   * `datesLocked` (review round 8): a legacy row keeps its UTC days, a row
   * written in the zone has none to show and is `daysUnknown` (unless it has no
   * bounds: "sem prazo" needs no clock), so the list stays usable and shows no
   * guessed days. A write's own answer reads the same way (round 9). A null or
   * blank answer for a tenant fails every route: guard a nullable lookup.
   *
   * Omitted, every write and answer is what it was before: UTC midnights, an
   * exclusive Término, no day fields. Opt-in so no adopter changes meaning on a
   * version bump; a host that adopts it also re-reads its stored rules.
   */
  storeTimeZone?: StoreTimeZone;
}

function ok(body: unknown): WireResponse {
  return { status: 200, body };
}

/**
 * The `{ error, issues, problems }` shape a form reads its per-input errors out
 * of: `issues` for a client that predates `problems` (FUT-4729), `problems` for
 * the 422 every strict-input surface answers in.
 */
function fieldError(error: DiscountValidationError | ForeignTargetError): WireResponse {
  const status = error instanceof DiscountValidationError ? error.status : 422;
  return {
    status,
    body: {
      error: error.message,
      issues: { [error.field]: error.message },
      problems: [{ path: error.field, message: error.message }],
    },
  };
}

/** The id acknowledgement update and delete answer with. */
function acknowledged(id: string): WireResponse {
  return ok({ data: { id } });
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
    handle: endpoint(config, "GET /discounts", async ({ actor, query, locale }) => {
      const parsed = schema.safeParse(query);
      if (!parsed.success) {
        // Worded per request, from the tag the adapter put on it — never at the
        // mount, which ran once at boot. Every problem rides along with its path.
        return {
          status: 422,
          body: {
            error: resolveDiscountsCopy(config.copy, locale).invalidQuery,
            problems: problemsOf(parsed.error),
          },
        };
      }
      // Returned as-is rather than wrapped: the page IS the `{ data,
      // pagination }` envelope the advertised response describes, and wrapping
      // it again would nest it under a second `data`.
      const page = await config.store.list(actor.clientId, parsed.data);
      const zone = await readZoneFor(config.storeTimeZone, actor.clientId, config.logger);
      warnUnflagged(page.data, zone, config.logger);
      return ok(pageWithCalendarDays(page, zone));
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
    handle: endpoint(config, "GET /discounts/:id", async ({ actor, params, locale }) => {
      const record = await config.store.get(actor.clientId, String(params.id));
      if (record === null) {
        return { status: 404, body: { error: resolveDiscountsCopy(config.copy, locale).notFound } };
      }
      const zone = await readZoneFor(config.storeTimeZone, actor.clientId, config.logger);
      warnUnflagged([record as DiscountRecord], zone, config.logger);
      return ok({ data: withCalendarDays(record as DiscountRecord, zone) });
    }),
  };
}

function createRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "POST",
    path: "/discounts",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "POST /discounts", async (request) => {
      const { actor, body, locale } = request;
      const { write, timeZone } = await prepareWrite(
        config,
        resolveDiscountsCopy(config.copy, locale),
        actor.clientId,
        body,
        "create",
      );
      const created = await config.store.create(actor.clientId, write);
      logWrite(config.logger, "created", request, created.id);
      const zone = writtenZone(timeZone);
      warnUnflagged([created], zone, config.logger);
      return ok({ data: withCalendarDays(created, zone) });
    }),
  };
}

function updateRoute(config: DiscountsApiConfig): DiscountRoute {
  return {
    method: "PATCH",
    path: "/discounts/:id",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "PATCH /discounts/:id", async (request) => {
      const { actor, params, body, locale } = request;
      const id = String(params.id);
      const copy = resolveDiscountsCopy(config.copy, locale);
      // Validation and the ownership check run FIRST, before the store is read:
      // a refused body costs no read, and the window never excuses a bad one.
      const prepared = await prepareWrite(config, copy, actor.clientId, body, "update", locale);
      const mode = windowModeOf({ ...prepared, zone: preparedZone(prepared.timeZone) });
      const target = { clientId: actor.clientId, id, logger: config.logger };
      try {
        const outcome = await updateWithWindow(config.store, target, mode, prepared.write);
        if (outcome === "missing") return { status: 404, body: { error: copy.notFound } };
      } catch (error) {
        if (!(error instanceof WindowChangedError)) throw error;
        // Review round 6 (N3): a row that kept moving is the operator's to
        // re-open, said as such — never a 500.
        config.logger.warn(`discounts: ${error.message}`);
        return { status: 409, body: { error: fallbackSentence(copy, "windowChanged", locale) } };
      }
      logWrite(config.logger, "re-stated", request, id);
      return acknowledged(id);
    }),
  };
}

/** Where a read of the row placed its days: the zone the PATCH was prepared on. */
function preparedZone(timeZone: string | undefined): ReadZone {
  if (timeZone === undefined) return { kind: "off" };
  return isKnownTimeZone(timeZone) ? { kind: "zone", timeZone } : { kind: "unknown" };
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
  // Validated against the DEFAULT rendering — a resolver asked for no locale.
  // A host that forgot a sentence should fail at the mount, as it always did,
  // rather than at whichever request first needs the missing one.
  const missing = missingServerCopy(resolveDiscountsCopy(config.copy, undefined));
  if (missing.length > 0) {
    throw new Error(
      `@12-apps/discounts: createApiDiscounts is missing copy for ${missing.join(", ")} — ` +
        "every sentence this surface answers a human with is host config, with no defaults.",
    );
  }
  assertWholeDayCopy(config.storeTimeZone, resolveDiscountsCopy(config.copy, undefined));
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
      createBulkRoute(config, endpoint),
      updateRoute(config),
      archiveRoute(config),
    ],
  };
}
