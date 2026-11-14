/**
 * `@12-apps/messaging/server` — framework-neutral route descriptors and job
 * blueprints, in the `@12-apps/wiring` contract's shapes.
 */

import type { WireRoute, WireRouteAnswer } from "@12-apps/wiring";

import { webhookRoutes, type MessagingApiConfig } from "./webhook";

/** The connector's HTTP surface: the webhook pair. Mount it where the host keeps webhooks (`/api`). */
export function createApiMessaging(config: MessagingApiConfig): { routes: readonly WireRoute<unknown, WireRouteAnswer>[] } {
  return { routes: webhookRoutes(config) };
}

export type { MessagingApiConfig } from "./webhook";
export {
  MESSAGING_JOBS,
  MESSAGING_PROCESS_ATTEMPTS,
  MESSAGING_SWEEP_QUEUE,
  type MessagingJobDeps,
  type ProcessDeliveryPayload,
} from "./jobs";
