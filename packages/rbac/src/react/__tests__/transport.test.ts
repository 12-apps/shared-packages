/**
 * A refused write keeps what the server answered (FUT-3137).
 *
 * The forms show `error`; a host that recognises the answer — a plan denial
 * it can sell an upgrade for — needs the status and the body beside it, which
 * the transport used to drop.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { httpRbacTransport } from '../transport';

function answering(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
}

describe('httpRbacTransport.send', () => {
  it("keeps a refusal's status and body beside its sentence", async () => {
    const body = { error: 'Sem vagas.', code: 'quota_exceeded', feature: 'team.seats' };
    answering(402, body);

    const result = await httpRbacTransport('Falhou.').send('/team', 'POST', { email: 'a@b.c' });

    expect(result).toEqual({ ok: false, error: 'Sem vagas.', status: 402, body });
  });

  it("falls back to the host's sentence and still reports the status", async () => {
    answering(500, {});

    const result = await httpRbacTransport('Falhou.').send('/team', 'POST');

    expect(result).toEqual({ ok: false, error: 'Falhou.', status: 500, body: {} });
  });

  it('a request that never reached the server carries no status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    const result = await httpRbacTransport('Falhou.').send('/team', 'POST');

    expect(result).toEqual({ ok: false, error: 'Falhou.' });
  });

  it('a success is unchanged', async () => {
    answering(200, { data: { status: 'added' } });

    const result = await httpRbacTransport('Falhou.').send('/team', 'POST');

    expect(result).toEqual({ ok: true, data: { status: 'added' } });
  });
});
