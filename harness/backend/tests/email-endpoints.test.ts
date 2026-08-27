import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';

/**
 * The published e-mail preview surface, driven over the same app the browser
 * drives — `@12-apps/notifications`' SECOND manifest, through the wiring
 * adoption and the shared Hono bridge, against the packed tarball.
 *
 * Three of these cases exist because the property they hold is NOT decidable
 * from the package's own suite:
 *
 *  - **sources are re-asked per request.** A unit test can call `list()` twice;
 *    only a mounted surface can show that a message registered AFTER the mount
 *    was assembled reaches a later caller. That is the shape a domain module
 *    registering as an import side effect actually has, and a catalogue built
 *    once at mount time gets it wrong in the direction that looks fine — a
 *    product that appears to send fewer mails than it does.
 *  - **an unknown locale is refused.** Quietly answering the default to
 *    `?locale=es-AR` looks exactly like a product with no Spanish, which is
 *    the question the operator was asking.
 *  - **the layout survives the wire.** The document the console shows is the
 *    document the vendor would be handed, and nothing between here and there
 *    may reformat it.
 */

const BASE = '/api/platform/email-previews';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
});

afterAll(async () => {
  await backend.close();
});

function request(path: string): Promise<Response> {
  return backend.app.request(`${BASE}${path}`);
}

interface IndexBody {
  data: {
    locale: string;
    locales: string[];
    items: Array<{ id: string; owner: string; family: string; subject: string }>;
    coverage: { missing: string[]; orphan: string[] };
  };
}

interface DetailBody {
  data: { id: string; locale: string; html: string; text: string; subject: string };
}

describe('the e-mail preview surface', () => {
  it('lists every declared source, grouped by owner', async () => {
    const response = await request('');
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as IndexBody;
    expect(data.items.map((row) => row.id)).toContain('account.verify');
    expect(data.items.map((row) => row.owner)).toContain('@12-apps/auth');
    expect(data.locales).toEqual(['pt-BR', 'en-US']);
    expect(data.locale).toBe('pt-BR');
  });

  it('carries no rendered bytes in the list — a catalogue is not twenty mails', async () => {
    const { data } = (await (await request('')).json()) as IndexBody;
    // A rendered mail is 6-10 KB and a catalogue of twenty would be twenty
    // times that on a screen where the operator reads one.
    for (const row of data.items) expect(row).not.toHaveProperty('html');
  });

  it('reports the coverage gap the source declares rather than hiding it', async () => {
    const { data } = (await (await request('')).json()) as IndexBody;
    expect(data.coverage.missing).toContain('account.invite');
  });

  it('renders one whole document, layout and both halves intact', async () => {
    const response = await request('/account.verify');
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as DetailBody;
    expect(data.html).toContain('<!DOCTYPE html');
    // The host's brand and its own palette — the two things the package may
    // never supply for itself, arriving through `bindings.http.config`.
    expect(data.html).toContain('Harness Mail');
    // The host's accent, which is deliberately NOT the package's neutral
    // default — otherwise this would pass whether the theme travelled or not.
    expect(data.html).toContain('#7A1F5E');
    // The bulletproof CTA: a `bgcolor` ATTRIBUTE as well as the background
    // style, because Outlook drops the style and would render white on white.
    expect(data.html).toContain('bgcolor="#7A1F5E"');
    expect(data.text).not.toContain('<');
    expect(data.text).toContain('https://harness.example/verify?t=abc');
  });

  it('answers the language the caller asked for', async () => {
    const { data } = (await (await request('/account.verify?locale=en-US')).json()) as DetailBody;
    expect(data.locale).toBe('en-US');
    expect(data.subject).toBe('Confirm your e-mail');
    expect(data.html).toContain('lang="en-US"');
  });

  it('refuses a language it does not have instead of answering the default', async () => {
    const response = await request('/account.verify?locale=es-AR');
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toEqual({
      error: 'Unknown locale "es-AR".',
    });
  });

  it('404s an id nothing produces, naming it', async () => {
    const response = await request('/account.nope');
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toEqual({
      error: 'No e-mail preview named "account.nope".',
    });
  });

  it('re-asks its sources, so a message registered after the mount appears', async () => {
    const before = (await (await request('')).json()) as IndexBody;
    expect(before.data.items.map((row) => row.id)).not.toContain('late-1');

    // The suite's own lever, under `/__harness`: it registers a message into a
    // source AFTER `assemble()` already ran. A catalogue built once at the
    // mount would still be answering the list above.
    const registered = await backend.app.request('/__harness/email-previews/register/late-1', {
      method: 'POST',
    });
    expect(registered.status).toBe(204);

    const after = (await (await request('')).json()) as IndexBody;
    expect(after.data.items.map((row) => row.id)).toContain('late-1');
    expect(await (await request('/late-1')).status).toBe(200);
  });
});
