import { Hono } from "hono";
import type { Context } from "hono";

import {
  createApiEvents,
  type EventsApi,
  type EventsServerConfig,
} from "../server/create-api-events";
import type { EventsRoute } from "../server/types";

/**
 * `@12-apps/realtime/hono` — the subscribe surfaces as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with `hono`
 * as an OPTIONAL peer (the report-builder precedent — a host on Express, or one
 * that only wants the browser half, never resolves Hono).
 *
 * A host writes:
 *
 *     const events = eventsRouter({ surfaces: [...], outbox: { db } });
 *     app.route("/api", events.router);
 *     await events.start();
 *
 * ## Streams pass through untouched
 *
 * A subscribe endpoint answers a long-lived body, which no `{ status, body }`
 * shape can carry. So a `stream` descriptor may answer `{ response }` and this
 * adapter returns that `Response` verbatim — no re-wrapping, no header
 * rewriting, and in particular nothing that would buffer it. Any other adapter
 * MUST do the same: re-serializing the body is how a stream turns into a
 * request that never finishes.
 *
 * ## The envelope
 *
 * Success bodies are already `{ data }` when the handler chose one; denials are
 * deliberately UNWRAPPED (`{ error }`). The adapter never reinterprets either —
 * the status and the body travel together from the handler that chose them.
 */

/** The router plus everything `createApiEvents` returns. */
export interface EventsHono extends EventsApi {
  router: Hono;
}

/** A stream result carries a `Response`; a json result carries status + body. */
function isStreamResult(
  result: Awaited<ReturnType<EventsRoute["handle"]>>,
): result is { response: Response } {
  return "response" in result;
}

export function eventsRouter(config: EventsServerConfig): EventsHono {
  const api = createApiEvents(config);
  const router = new Hono();

  // Mounted IN DESCRIPTOR ORDER, which any adapter must preserve. Each surface
  // contributes `GET <path>` and `POST <path>/ticket`; those cannot collide with
  // each other, but a HOST route shaped like either one can, and Hono resolves by
  // registration order (ADOPTING rule 6).
  for (const route of api.routes) {
    const handler = async (c: Context): Promise<Response> => {
      const result = await route.handle({
        params: c.req.param() as Record<string, string | undefined>,
        query: c.req.query() as Record<string, string | undefined>,
        // The raw request, for hosts whose authorization reads cookies or
        // headers — a seat cookie, a session.
        request: c.req.raw,
      });

      // Verbatim. See the module docstring: touching this body breaks the stream.
      if (isStreamResult(result)) return result.response;
      return c.json(result.body as Record<string, unknown>, result.status as 200);
    };

    if (route.method === "GET") router.get(route.path, handler);
    else router.post(route.path, handler);
  }

  return { ...api, router };
}
