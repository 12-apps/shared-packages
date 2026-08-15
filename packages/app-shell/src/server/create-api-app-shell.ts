/**
 * The one thing this package exposes to a BACKEND host (12-18).
 *
 * The shell is mostly a browser thing, and this half is deliberately small: the
 * consent status/accept pair, which is the only part of the shell that needs a
 * server at all. It is HERE rather than in the host because the two halves must
 * agree on the paths and on the response body, and the extraction proved what
 * happens when the gate and the endpoint are owned by different repos — the endpoint could
 * fix a stale caller for months while nothing on screen ever called it.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Who is calling** — `consent.resolveActor` reads the host's own session.
 *  - **Where consent state lives** — `isCurrent` / `record`, against the host's
 *    identity row. This package owns no Prisma model; see ADOPTING.md for why.
 *  - **The terms version** — a fact about the host's own legal documents.
 *  - **The signing secret** — only the host has it, so only the host can mint the
 *    signed handoff cookie.
 *  - **Telling other devices** — `onAccepted`, where a host wires its publisher.
 */
import { appShellRoutes } from './routes';
import type { AppShellRoute, AppShellServerConfig } from './config';

export interface ApiAppShell {
  /** The whole surface, in mount order. */
  routes: AppShellRoute[];
  /** The version every answer was measured against, for a host's own logging. */
  termsVersion: string;
}

export function createApiAppShell(config: AppShellServerConfig): ApiAppShell {
  return { routes: appShellRoutes(config), termsVersion: config.termsVersion };
}
