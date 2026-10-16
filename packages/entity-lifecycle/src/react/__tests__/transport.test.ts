import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpLifecycleTransport } from '../transport';

/**
 * The default transport hands a restore clash to the screen whole (FUT-1342):
 * a 409 carries `{ error, conflict }`, and the dialog needs the conflict.
 */

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe('httpLifecycleTransport.send', () => {
  it('carries the conflict of a refused restore', async () => {
    const conflict = { title: 't', message: 'm', binned: {}, current: {}, fields: [] };
    respond(409, { error: 'm', conflict });
    await expect(httpLifecycleTransport('fallback').send('/x', 'POST', {})).resolves.toEqual({
      ok: false,
      error: 'm',
      conflict,
    });
  });

  it('keeps a plain refusal plain, and falls back to the host sentence', async () => {
    respond(422, { error: 'Dados inválidos.' });
    await expect(httpLifecycleTransport('fallback').send('/x', 'POST')).resolves.toEqual({
      ok: false,
      error: 'Dados inválidos.',
    });
    respond(500, {});
    await expect(httpLifecycleTransport('fallback').send('/x', 'POST')).resolves.toEqual({
      ok: false,
      error: 'fallback',
    });
  });
});
