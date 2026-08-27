import { describe, expect, it } from 'vitest';

import { PT_BR_EMAIL_CHROME } from '../../email/chrome.pt-BR';
import {
  DuplicateEmailPreviewIdError,
  createEmailPreviews,
  type EmailPreviewMessage,
  type EmailPreviewSource,
} from '../../email/previews/catalog';
import { emailPreviewRoutes } from '../../email/previews/routes';
import { renderEmail } from '../../email/template';

/**
 * The catalogue's contract.
 *
 * The properties worth pinning are the ones a host cannot check for itself:
 * that a source is asked PER REQUEST (so a registry filled at import time is
 * seen), that ids are unique across sources, that coverage is reported rather
 * than swallowed, and that an unknown locale is refused rather than answered
 * with the default.
 */
function messageOf(id: string, subject = 'Hello'): EmailPreviewMessage {
  return {
    id,
    key: id,
    family: 'test',
    render: (locale) =>
      renderEmail({
        subject: `${subject} (${locale})`,
        heading: subject,
        chrome: PT_BR_EMAIL_CHROME,
        brand: 'Acme',
        locale,
      }),
  };
}

function sourceOf(owner: string, messages: EmailPreviewMessage[]): EmailPreviewSource {
  return { owner, list: () => messages };
}

const LOCALES = ['pt-BR', 'en-US'];
const config = (sources: EmailPreviewSource[]) => ({
  sources,
  locales: LOCALES,
  defaultLocale: 'pt-BR',
});

describe('createEmailPreviews', () => {
  it('lists every source, tagged with its owner', () => {
    const previews = createEmailPreviews(
      config([sourceOf('@acme/auth', [messageOf('a')]), sourceOf('apps/web', [messageOf('b')])]),
    );
    const index = previews.index();
    expect(index.items.map((row) => row.owner)).toEqual(['@acme/auth', 'apps/web']);
  });

  it('asks a source PER REQUEST, so a late registration is seen', () => {
    // The property that makes this usable at all: domain modules register their
    // messages as an import side effect, so a catalogue built once at mount
    // time would list whatever happened to be imported first.
    const messages: EmailPreviewMessage[] = [messageOf('a')];
    const previews = createEmailPreviews(config([{ owner: 'apps/web', list: () => messages }]));
    expect(previews.index().items).toHaveLength(1);
    messages.push(messageOf('b'));
    expect(previews.index().items).toHaveLength(2);
  });

  it('renders each subject in the requested language', () => {
    const previews = createEmailPreviews(config([sourceOf('apps/web', [messageOf('a')])]));
    expect(previews.index('en-US').items[0]?.subject).toContain('en-US');
    expect(previews.index('pt-BR').items[0]?.subject).toContain('pt-BR');
  });

  it('falls back to the default locale when the caller names none', () => {
    const previews = createEmailPreviews(config([sourceOf('apps/web', [messageOf('a')])]));
    expect(previews.index().locale).toBe('pt-BR');
  });

  it('renders one message, both halves', () => {
    const previews = createEmailPreviews(config([sourceOf('apps/web', [messageOf('a')])]));
    const detail = previews.render('a', 'en-US');
    expect(detail?.html).toContain('<!DOCTYPE html');
    expect(detail?.text.trim()).not.toBe('');
    expect(detail?.locale).toBe('en-US');
  });

  it('answers null for an id no source owns', () => {
    const previews = createEmailPreviews(config([sourceOf('apps/web', [messageOf('a')])]));
    expect(previews.render('nope')).toBeNull();
  });

  it('refuses two sources that share an id', () => {
    // One message would be unreachable and the other ambiguous — and silently,
    // since the console would simply show whichever came first.
    const previews = createEmailPreviews(
      config([sourceOf('one', [messageOf('a')]), sourceOf('two', [messageOf('a')])]),
    );
    expect(() => previews.index()).toThrow(DuplicateEmailPreviewIdError);
  });

  it('reports what a source cannot show, in both directions', () => {
    const previews = createEmailPreviews(
      config([
        {
          owner: 'apps/web',
          list: () => [messageOf('a')],
          coverage: () => ({ missing: ['stock.low'], orphan: ['gone.event'] }),
        },
      ]),
    );
    // A catalogue that swallowed its own gaps would read as complete, which is
    // the failure this whole surface exists to prevent.
    expect(previews.coverage()).toEqual({ missing: ['stock.low'], orphan: ['gone.event'] });
    expect(previews.index().coverage.missing).toEqual(['stock.low']);
  });

  it('reports no gap for a source that declares no coverage', () => {
    const previews = createEmailPreviews(config([sourceOf('apps/web', [messageOf('a')])]));
    expect(previews.coverage()).toEqual({ missing: [], orphan: [] });
  });
});

describe('emailPreviewRoutes', () => {
  /**
   * Built PER TEST rather than once in the describe.
   *
   * The routes close over a catalogue, so one shared instance would let a case
   * that renders leave state behind for the next — the order dependency the
   * flakiness ruleset refuses, and the kind that only fails when somebody adds
   * a case in between.
   */
  const mounted = () => emailPreviewRoutes(config([sourceOf('apps/web', [messageOf('a')])]));

  it('mounts a list and an item, both GET', () => {
    expect(mounted().map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /',
      'GET /:id',
    ]);
  });

  it('asks for a gate: every route is kind "authenticated"', () => {
    // The wiring contract's word for "behind the host's session resolution and
    // its RBAC". A package cannot know WHICH gate a host uses, so it names no
    // permission id — but silence would have been worse than useless here: the
    // contract's default is already `authenticated`, so a descriptor saying
    // nothing reads the same to a host's gates while telling the person
    // adopting it nothing at all. This surface publishes the product's whole
    // mail inventory, so the posture is stated rather than inherited.
    expect(mounted().every((route) => route.kind === 'authenticated')).toBe(true);
  });

  it('answers the catalogue in the { data } envelope', async () => {
    const response = await mounted()[0]!.handle({});
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data.items');
  });

  it('refuses an unknown locale rather than quietly answering the default', async () => {
    // This is a diagnostic surface: a silent fall back looks exactly like a
    // product with no translation, which is the question being asked.
    const response = await mounted()[0]!.handle({ query: { locale: 'es-AR' } });
    expect(response.status).toBe(400);
  });

  it('404s an id nothing owns', async () => {
    const response = await mounted()[1]!.handle({ params: { id: 'nope' } });
    expect(response.status).toBe(404);
  });

  it('renders the message it was asked for', async () => {
    const response = await mounted()[1]!.handle({
      params: { id: 'a' },
      query: { locale: 'en-US' },
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data.html');
  });
});
