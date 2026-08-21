import type { WireRequest, WireResponse } from "@12-apps/wiring";

import type { DiscountsActor } from "./routes";
import { DiscountValidationError } from "./validate";

/**
 * What this surface says out loud, and to whom (FUT-244).
 *
 * The manifest declares `observability: { namespace: "discounts" }`, which is a
 * PROMISE: a discounts failure files under `discounts` rather than under the
 * host app or nowhere. Declaring it bought nothing on its own — the binder
 * built the namespaced logger, hung it on `assembled.loggers`, and the package
 * never took it, so for the whole of 1.0.x a refused write and a store that
 * threw were equally silent. This module is the other half.
 *
 * ## Why every line is a STRING, and never an object
 *
 * A host's `LoggerPort` is a Winston child in practice, whose formatter runs
 * `util.inspect(…, { depth: 5 })` over any extra argument. That is not a
 * theoretical leak in this org: a provider error retains the provider's parsed
 * response body, buyer name, e-mail and CPF included, so passing the cause as a
 * second argument is precisely how a buyer's details reach a third party.
 * {@link errorText} folds the cause into the sentence instead, which is the
 * same call the origin host's own `errorText` makes and for the same reason.
 *
 * ## Why the sentences here are NOT copy config
 *
 * Everything below is written for a DEVELOPER reading a log, so it is English
 * and it is the package's own — the copy-portability rule governs what a USER
 * reads. Nothing logged here is shown to anyone; the operator's sentence comes
 * from {@link DiscountsServerCopy} and travels in the response body.
 */

/**
 * The three methods a host's logger must offer — the structural twin of
 * `@12-apps/wiring`'s `LoggerPort` and of `createFeatureLogger`'s return.
 *
 * Declared here rather than imported so that the wiring contract stays a
 * type-only devDependency: a host on no wiring at all still satisfies this by
 * passing any Winston/pino child, and a host on wiring passes
 * `assembled.loggers["@12-apps/discounts"]` unchanged.
 */
export interface DiscountsLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** The cause as a log line — never the object. See the module note. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a line may name: the tenant, the route, the discount, the field, the
 * status. Never a body, never a coupon code, never a name an operator typed —
 * a log line is read by whoever can read the log, and none of those are needed
 * to find the failure.
 */
function subject(route: string, request: WireRequest<DiscountsActor>): string {
  const id = request.params.id;
  return `${route}${id === undefined ? "" : ` [${id}]`} for tenant ${request.actor.clientId}`;
}

/**
 * Wrap one descriptor's handler so that nothing it does is silent.
 *
 * Three outcomes, three levels, and the split is about who has to act:
 *
 *  - a REFUSAL the package itself decided (a 4xx it returned, or the 422 a
 *    {@link DiscountValidationError} folds into) is `warn` — the operator
 *    typed something the rules do not allow, which is worth seeing when a
 *    store reports "it will not let me save" and worth nobody's pager;
 *  - anything else THROWN is `error` and is re-thrown unchanged: the store's
 *    own failures (a unique clash, a dead connection, a foreign target) belong
 *    to the host's error mapping, and swallowing one here to make a tidy
 *    response is how a broken database becomes a 404 nobody investigates;
 *  - a write that SUCCEEDED is `info`, because a discount is a direct lever on
 *    what a buyer is charged and "who repriced the menu at 03:12" is a
 *    question that gets asked.
 *
 * The catch is what makes the promise total. Before this, only the two write
 * routes had any catch at all ({@link DiscountValidationError} → 422) and the
 * three read routes had none, so a store that threw inside `list` produced a
 * stack in the host's catch-all with nothing naming discounts.
 */
export function observed(
  logger: DiscountsLogger,
  route: string,
  handle: (request: WireRequest<DiscountsActor>) => Promise<WireResponse>,
): (request: WireRequest<DiscountsActor>) => Promise<WireResponse> {
  return async (request) => {
    try {
      const response = await handle(request);
      if (response.status >= 400) {
        logger.warn(`${subject(route, request)} refused with ${response.status}`);
      }
      return response;
    } catch (error) {
      if (error instanceof DiscountValidationError) {
        logger.warn(`${subject(route, request)} refused with 422 on field "${error.field}"`);
        throw error;
      }
      logger.error(`${subject(route, request)} failed: ${errorText(error)}`);
      throw error;
    }
  };
}

/** The one line a successful write leaves — see {@link observed}'s third case. */
export function logWrite(
  logger: DiscountsLogger,
  verb: string,
  request: WireRequest<DiscountsActor>,
  id: string,
): void {
  logger.info(`${verb} discount ${id} for tenant ${request.actor.clientId}`);
}
