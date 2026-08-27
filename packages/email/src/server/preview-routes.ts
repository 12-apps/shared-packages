import {
  createEmailPreviews,
  type ApiEmailPreviews,
  type EmailPreviewsConfig,
} from './catalog';

/**
 * The two endpoints over the catalogue, as descriptors.
 *
 * `GET /` answers the list — one row per message, a subject each, no rendered
 * bytes — and `GET /:id` answers one whole document. Two calls rather than one
 * because a rendered mail is 6-10 KB and a catalogue of twenty would be twenty
 * times that on a screen where the operator reads one.
 *
 * ## Nothing here can send anything
 *
 * The surface holds no driver, no transport and no address. `render` is pure by
 * the contract `EmailPreviewMessage` states, so the one mistake a preview
 * surface must be incapable of — putting a sample in somebody's inbox — is not
 * reachable from this code at all rather than merely not done.
 *
 * ## The gate is the HOST's, and deliberately not declared here
 *
 * These routes are `session: false`: this package cannot know who may look.
 * That is not an invitation to mount them open. The surface reveals a host's
 * whole transactional-mail inventory and the exact wording and link shape of
 * its verification and password-reset mails, which is the reference somebody
 * writing a convincing phishing mail would want — so a host mounts it behind
 * whichever gate it already uses for platform staff, and `ADOPTING.md` says so
 * in the one place an adopter is reading.
 *
 * An unknown LOCALE is a 400 rather than a silent fall back to the default.
 * This is a diagnostic surface: quietly answering the default language to
 * `?locale=es-AR` looks exactly like a product with no Spanish, which is the
 * question the operator was asking.
 */

/** Twin of the wiring contract's request; no import, so this package stays liftable. */
export interface EmailPreviewRequest {
  /** The path segment after the mount, when the caller asked for one message. */
  params?: Readonly<Record<string, string | undefined>>;
  query?: Readonly<Record<string, string | undefined>>;
}

export interface EmailPreviewResponse {
  status: number;
  body: unknown;
}

export interface EmailPreviewRoute {
  method: 'GET';
  path: string;
  /** The host's own gate decides who may look — see the docblock above. */
  session: false;
  handle(request: EmailPreviewRequest): Promise<EmailPreviewResponse>;
}

const ok = (body: unknown): EmailPreviewResponse => ({ status: 200, body: { data: body } });
const fail = (status: number, error: string): EmailPreviewResponse => ({ status, body: { error } });

/** `undefined` passes through as "not asked"; anything unknown is refused. */
function readLocale(
  previews: ApiEmailPreviews,
  request: EmailPreviewRequest,
): { ok: true; locale?: string } | { ok: false; tag: string } {
  const tag = request.query?.locale;
  if (tag === undefined || tag === '') return { ok: true };
  return previews.supportsLocale(tag) ? { ok: true, locale: tag } : { ok: false, tag };
}

export function emailPreviewRoutes(config: EmailPreviewsConfig): EmailPreviewRoute[] {
  const previews = createEmailPreviews(config);

  return [
    {
      method: 'GET',
      path: '/',
      session: false,
      handle: (request) => {
        const locale = readLocale(previews, request);
        if (!locale.ok) return Promise.resolve(fail(400, `Unknown locale "${locale.tag}".`));
        return Promise.resolve(ok(previews.index(locale.locale)));
      },
    },
    {
      method: 'GET',
      path: '/:id',
      session: false,
      handle: (request) => {
        const locale = readLocale(previews, request);
        if (!locale.ok) return Promise.resolve(fail(400, `Unknown locale "${locale.tag}".`));
        const id = request.params?.id ?? '';
        const detail = previews.render(id, locale.locale);
        return Promise.resolve(detail ? ok(detail) : fail(404, `No e-mail preview named "${id}".`));
      },
    },
  ];
}
