/**
 * `@12-apps/notifications-email-previews` mounted the way a host mounts it.
 *
 * The SECOND manifest `@12-apps/notifications` ships. The first one — the
 * inbox, the preference matrix, the transports — is adopted in
 * `notifications-host.ts`; this is the platform-staff console over the mail
 * that package's EMAIL transport sends, and the two are separate manifests
 * precisely so a host can mount one without the other.
 *
 * The frontend harness drives `./react`: the console lists the owners, renders
 * one message into a sandboxed frame and flips between the HTML and the plain
 * text. That proves the last hop. It says nothing about the hop before it —
 * how a REQUEST becomes a rendered document — and that half is where the two
 * properties worth proving live:
 *
 *  - the catalogue asks its sources PER REQUEST, so a source backed by a
 *    registry that fills at import time answers with whatever is registered
 *    NOW rather than with whatever existed when the mount was built;
 *  - an unknown locale is a 400 rather than a silent fall back to the default,
 *    because a diagnostic surface that quietly answers pt-BR to `?locale=es-AR`
 *    looks exactly like a product with no Spanish.
 *
 * Neither is something the package's own suite can prove is REACHABLE: both
 * are properties of a mounted route, and a unit test constructs its way around
 * the mount.
 *
 * ## Why the sources are the harness's own mail, and not a fixture
 *
 * WHICH messages exist is the host's half of this package and cannot be
 * otherwise — a package cannot know that a host sends a "your shift is
 * closing" notice, let alone what data that notice renders from. So this file
 * writes the half a real adopter writes: two owners, four messages, the brand,
 * the theme and every sentence stated here.
 *
 * The `late` source is not decoration. It registers its message on FIRST CALL
 * rather than at module load, which is the shape a domain module registering as
 * an import side effect actually has — and the shape a catalogue built once at
 * mount time gets wrong. `tests/email-endpoints.test.ts` is what reads it.
 *
 * ## The gate
 *
 * The routes declare `kind: 'authenticated'`, the contract's word for "behind
 * the host's session resolution". `honoRouterFor` answers 401 for a null actor
 * before any handler runs, so binding this host's reader IS the gate here — the
 * same arrangement every other authenticated surface in this backend has.
 */
import { Hono } from 'hono';
import { renderEmail } from '@12-apps/notifications/email';
import type { EmailTheme } from '@12-apps/notifications/email';
import { EMAIL_CHROME } from '@12-apps/notifications/email/locales';
import type {
  EmailPreviewCoverage,
  EmailPreviewMessage,
  EmailPreviewSource,
} from '@12-apps/notifications/email/previews';
import { notificationEmailPreviewsManifest } from '@12-apps/notifications/manifest';
import { notificationEmailPreviewsServerManifest } from '@12-apps/notifications/manifest/server';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import type { MountedRoute } from '@12-apps/wiring';

import { honoRouterFor, harnessLoggerFor } from './wire-hono';

/** Where `mount-surfaces.ts` hangs the router — the adoption's claim. */
export const EMAIL_PREVIEWS_MOUNT_PATH = '/api/platform/email-previews';

/** Whose language a preview opens in when the caller names none. */
export const EMAIL_DEFAULT_LOCALE = 'pt-BR';

/** Every language this host's mail is written in. */
export const EMAIL_LOCALES = ['pt-BR', 'en-US'] as const;

/** Who the mounted surface acts for — a platform operator, not a shopper. */
const OPERATOR = 'u-operator';

/**
 * This host's brand and palette — the two things a package must never default.
 *
 * The theme MAY be omitted (the package ships a neutral one, and `theme.ts`
 * argues why that asymmetry is deliberate). Stated here anyway, because an
 * adoption that took the default would prove the default rather than the seam.
 */
const HARNESS_BRAND = 'Harness Mail';

const HARNESS_THEME: EmailTheme = {
  page: '#F4F5F7',
  surface: '#FFFFFF',
  panel: '#EEF1F5',
  border: '#D9DDE3',
  ink: '#1B1F24',
  muted: '#5C6672',
  // Deliberately NOT the neutral default's `#1F5EDB`: an assertion against a
  // value the package would have supplied anyway proves nothing about whether
  // the host's theme travelled.
  accent: '#7A1F5E',
  onAccent: '#FFFFFF',
  rule: '#7A1F5E',
};

/** One message, rendered for one reader. Pure — nothing here can send. */
interface Built {
  subject: string;
  heading: string;
  paragraphs: string[];
  /** At most one CTA — the bulletproof button, when this message has one. */
  action?: { label: string; href: string };
}

function message(
  id: string,
  key: string,
  family: string,
  build: (locale: string) => Built,
): EmailPreviewMessage {
  return {
    id,
    key,
    family,
    render: (locale) => {
      const chrome = EMAIL_CHROME[locale] ?? EMAIL_CHROME[EMAIL_DEFAULT_LOCALE];
      if (chrome === undefined) throw new Error(`no chrome pack for "${locale}"`);
      const { subject, heading, paragraphs, action } = build(locale);
      return renderEmail({
        subject,
        heading,
        paragraphs,
        action,
        chrome,
        brand: HARNESS_BRAND,
        locale,
        theme: HARNESS_THEME,
      });
    },
  };
}

const ENGLISH = (locale: string): boolean => locale.startsWith('en');

/**
 * The account owner's mails — the ordinary case: a source whose list is a
 * constant, because these messages exist from the first import.
 */
function accountSource(): EmailPreviewSource {
  const messages = [
    message('account.verify', 'account.verify', 'account', (locale) =>
      ENGLISH(locale)
        ? {
            subject: 'Confirm your e-mail',
            heading: 'One last step',
            paragraphs: ['Confirm this address and your account is ready.'],
            action: { label: 'Confirm', href: 'https://harness.example/verify?t=abc' },
          }
        : {
            subject: 'Confirme seu e-mail',
            heading: 'Falta um passo',
            paragraphs: ['Confirme este endereço e sua conta está pronta.'],
            action: { label: 'Confirmar', href: 'https://harness.example/verify?t=abc' },
          },
    ),
    message('account.reset', 'account.reset', 'account', (locale) =>
      ENGLISH(locale)
        ? {
            subject: 'Reset your password',
            heading: 'Password reset',
            paragraphs: ['Somebody asked for a new password. If it was not you, ignore this.'],
          }
        : {
            subject: 'Redefina sua senha',
            heading: 'Redefinição de senha',
            paragraphs: ['Alguém pediu uma nova senha. Se não foi você, ignore este e-mail.'],
          },
    ),
  ];

  return {
    owner: '@12-apps/auth',
    list: () => messages,
    /**
     * A gap this host KNOWS it has. Reported rather than omitted, because a
     * catalogue that quietly drops a message looks exactly like a product that
     * does not send it — and this is the assertion that pins the difference.
     */
    coverage: (): EmailPreviewCoverage => ({
      missing: ['account.invite'],
      orphan: [],
    }),
  };
}

/**
 * A source whose messages arrive LATE — registered on first call rather than at
 * module load.
 *
 * This is the whole reason `EmailPreviewSource.list()` is a function called per
 * request rather than an array read at the mount. A domain module that
 * registers its notifications as an import side effect fills up after the
 * server has finished wiring, and a catalogue built once would list whatever
 * happened to be imported first — which reads as a product that sends fewer
 * mails than it does.
 */
function lateSource(): { source: EmailPreviewSource; register: (id: string) => void } {
  const registered = new Map<string, EmailPreviewMessage>();

  return {
    source: {
      owner: 'harness-orders',
      list: () => [...registered.values()],
    },
    register: (id) => {
      registered.set(
        id,
        message(id, id, 'orders', (locale) =>
          ENGLISH(locale)
            ? { subject: `Order ${id}`, heading: 'Your order', paragraphs: ['It is on its way.'] }
            : { subject: `Pedido ${id}`, heading: 'Seu pedido', paragraphs: ['Ele está a caminho.'] },
        ),
      );
    },
  };
}

/**
 * The preview console's SERVER surface, adopted through the wiring consumer.
 *
 * `bindings.http.config` carries the sources, the languages and the default —
 * the package's `create(config)` receives exactly what this host bound, which
 * is why the manifest is a constant rather than a factory. A factory argument
 * would put the same decision somewhere `assemble()` cannot report on.
 */
export function wireEmailPreviews(): {
  router: Hono;
  report: WiringReport;
  routes: readonly MountedRoute[];
  harnessRoutes: Hono;
} {
  const late = lateSource();
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });
  host.adoptServer({
    manifest: notificationEmailPreviewsManifest,
    server: notificationEmailPreviewsServerManifest,
    bindings: {
      http: {
        mountPath: EMAIL_PREVIEWS_MOUNT_PATH,
        config: {
          sources: [accountSource(), late.source],
          locales: [...EMAIL_LOCALES],
          defaultLocale: EMAIL_DEFAULT_LOCALE,
        },
      },
    },
  });
  const wired = host.assemble();

  /**
   * The SUITE's lever, under `/__harness` because no package declares it: it
   * registers a message AFTER the mount was assembled, which is the only way to
   * observe that the catalogue re-asks its sources.
   */
  const harnessRoutes = new Hono().post('/register/:id', (c) => {
    late.register(c.req.param('id'));
    return c.body(null, 204);
  });

  return {
    router: honoRouterFor(wired.routes, () => OPERATOR),
    report: wired.report,
    routes: wired.routes,
    harnessRoutes,
  };
}
