import { Hono } from 'hono';
import type { Context } from 'hono';

import { emailPreviewRoutes } from './routes';
import type { EmailPreviewsConfig } from './catalog';

/**
 * `@12-apps/notifications/email/previews/hono` — the catalogue as a router.
 *
 * The framework-neutral descriptors in `./server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with
 * `hono` as an OPTIONAL peer — a host on Express, or one that only wants the
 * layout, never resolves it.
 *
 * A host writes:
 *
 *   const previews = emailPreviewsRouter({ sources, locales, defaultLocale });
 *   app.use('/api/platform/email-previews/*', requirePlatformOperator);
 *   app.route('/api/platform/email-previews', previews.router);
 *
 * ## The `use` line above is not decoration
 *
 * This surface publishes a host's whole transactional-mail inventory and the
 * exact wording of its verification and reset mails. The routes declare no
 * session of their own because a package cannot know who a host lets look — so
 * the gate is the host's, it is REQUIRED, and it is written here rather than
 * left to be inferred, because the failure is silent: an ungated mount answers
 * every stranger and nothing about it looks wrong.
 */

export interface EmailPreviewsHonoConfig extends EmailPreviewsConfig {
  /**
   * Optional last-resort refusal, for a host that would rather state the gate
   * once here than mount middleware around the router.
   *
   * Returning `false` answers 403 before any handler runs. Absent means the
   * host has gated the mount itself — which is the ordinary case, and why this
   * is not required: a package that demanded its own guard would be a second
   * authorization system beside the one the host already runs.
   */
  readonly allow?: (c: Context) => Promise<boolean> | boolean;
}

/** The mounted router, plus the descriptors it was built from. */
export interface EmailPreviewsRouter {
  router: Hono;
}

export function emailPreviewsRouter(config: EmailPreviewsHonoConfig): EmailPreviewsRouter {
  const router = new Hono();

  for (const route of emailPreviewRoutes(config)) {
    router.get(route.path, async (c) => {
      if (config.allow && !(await config.allow(c))) {
        return c.json({ error: 'Forbidden.' }, 403);
      }
      const response = await route.handle({
        params: c.req.param() as Record<string, string | undefined>,
        // `Object.fromEntries` over the parsed query rather than the raw string:
        // a repeated `?locale=` is a caller error, and taking the last value is
        // the same answer every framework here gives.
        query: c.req.query() as Record<string, string | undefined>,
      });
      return c.json(response.body as Record<string, unknown>, response.status as 200 | 400 | 404);
    });
  }

  return { router };
}
