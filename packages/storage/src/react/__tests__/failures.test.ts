import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_UPLOAD_BYTES } from '../../limits';
import { rejectFileUpfront, transportFailure, uploadFailure } from '../failures';

/**
 * Why an upload failed, in words the store owner can act on.
 *
 * Collapsing every cause into one sentence is what made a failed upload
 * unreportable: the owner could not tell a file they should shrink from a permission
 * the operator had not granted, and had nothing to paste into a support request. So
 * each case below is a different SENTENCE, not a different log line.
 */

const MAX = DEFAULT_MAX_UPLOAD_BYTES;

function file(type: string, size: number): File {
  return new File([new Uint8Array(size)], 'p.png', { type });
}

function refusal(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('rejectFileUpfront', () => {
  it('accepts a normal PNG', () => {
    expect(rejectFileUpfront(file('image/png', 1024), MAX)).toBeNull();
  });

  it('names the actual size AND the limit when the file is too big', () => {
    const message = rejectFileUpfront(file('image/png', 12 * 1024 * 1024), MAX);

    expect(message).toContain('12 MB');
    expect(message).toContain('8 MB');
  });

  it('follows the ceiling it was given rather than a constant of its own', () => {
    expect(rejectFileUpfront(file('image/png', 3 * 1024 * 1024), 2 * 1024 * 1024)).toContain(
      '2 MB',
    );
  });

  it('names the rejected type rather than saying only "unsupported"', () => {
    expect(rejectFileUpfront(file('application/pdf', 1024), MAX)).toContain('application/pdf');
  });

  it('treats an unidentifiable file as its own case', () => {
    // "Formato não suportado" reads as an accusation about a file the owner knows is
    // a PNG; an empty type means the OS could not identify it at all.
    expect(rejectFileUpfront(file('', 1024), MAX)).toContain('identificar');
  });

  it('catches a zero-byte pick before it is uploaded and 413ed', () => {
    expect(rejectFileUpfront(file('image/png', 0), MAX)).toContain('vazio');
  });
});

describe('uploadFailure', () => {
  it('explains a 403 as a permission the account lacks', async () => {
    expect(await uploadFailure(refusal(403, { error: 'forbidden' }), MAX)).toContain('permissão');
  });

  it('explains a 401 as an expired session, which the owner can fix', async () => {
    expect(await uploadFailure(refusal(401, {}), MAX)).toContain('sessão expirou');
  });

  it("repeats the server's OWN sentence about the image rather than re-wording it", async () => {
    // The same sentence has to serve a host write carrying bytes for an agent, so
    // re-wording here is how the two entrances start telling one owner two different
    // things about one file.
    const sentence = 'Não foi possível ler a imagem enviada — o arquivo parece estar corrompido.';

    expect(await uploadFailure(refusal(400, { error: sentence }), MAX)).toBe(sentence);
  });

  it('reads a size rejection as a size rejection, with the limit', async () => {
    expect(await uploadFailure(refusal(413, { error: 'file_too_large' }), MAX)).toContain('8 MB');
  });

  it('keeps an unrecognised code visible alongside the status', async () => {
    // It is what turns a support request from "it failed" into something greppable.
    const message = await uploadFailure(refusal(500, { error: 'kaboom' }), MAX);

    expect(message).toContain('500');
    expect(message).toContain('kaboom');
  });

  it('still surfaces the status when the body carries nothing', async () => {
    expect(await uploadFailure(new Response('<html>', { status: 502 }), MAX)).toContain('502');
  });
});

describe('transportFailure', () => {
  it('points at the connection, the only thing left to check on one origin', () => {
    // A two-hop upload had to hedge with "rede ou CORS", because a blocked
    // cross-origin PUT is indistinguishable from an offline network at the fetch
    // layer. Same-origin, the sentence can be definite.
    expect(transportFailure()).toContain('conexão');
    expect(transportFailure()).not.toContain('CORS');
  });
});
