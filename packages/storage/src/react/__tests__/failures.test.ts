import { describe, expect, it } from 'vitest';
import { PT_BR_WEB_STORAGE_MESSAGES } from '../pt-BR';

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
    expect(rejectFileUpfront(file('image/png', 1024), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toBeNull();
  });

  it('names the actual size AND the limit when the file is too big', () => {
    const message = rejectFileUpfront(file('image/png', 12 * 1024 * 1024), MAX, PT_BR_WEB_STORAGE_MESSAGES);

    expect(message).toContain('12 MB');
    expect(message).toContain('8 MB');
  });

  it('follows the ceiling it was given rather than a constant of its own', () => {
    expect(rejectFileUpfront(file('image/png', 3 * 1024 * 1024), 2 * 1024 * 1024, PT_BR_WEB_STORAGE_MESSAGES)).toContain(
      '2 MB',
    );
  });

  it('names the rejected type rather than saying only "unsupported"', () => {
    expect(rejectFileUpfront(file('application/pdf', 1024), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('application/pdf');
  });

  it('treats an unidentifiable file as its own case', () => {
    // "Formato não suportado" reads as an accusation about a file the owner knows is
    // a PNG; an empty type means the OS could not identify it at all.
    expect(rejectFileUpfront(file('', 1024), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('identificar');
  });

  it('catches a zero-byte pick before it is uploaded and 413ed', () => {
    expect(rejectFileUpfront(file('image/png', 0), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('vazio');
  });

  /**
   * Every sentence above used to be a LITERAL inside this function — not a
   * default a host could override, but copy a host could not reach at all,
   * inside a package that documents (see `failures.ts`) that "every sentence
   * here reaches a store owner, so it is product copy". A host that overrode
   * `file_too_large` for the server's 413 found its own words replaced two
   * lines later by ours, for the same refusal caught in the browser.
   *
   * These cases pin the seam rather than the wording: an adopter's sentence
   * has to come out, in each of the four upfront refusals, including the two
   * that carry a fact.
   */
  it('lets a host state every upfront refusal in its own words', () => {
    const own = (context: { limit: string }) => ({
      ...PT_BR_WEB_STORAGE_MESSAGES(context),
      empty_file: 'Esse arquivo está vazio.',
      file_too_large_upfront: ({ size, limit }: { size: string; limit: string }) =>
        `${size} passa do teto de ${limit}.`,
      unknown_content_type: 'Não deu para saber o tipo desse arquivo.',
      unsupported_content_type_upfront: ({ contentType }: { contentType: string }) =>
        `Não aceitamos ${contentType} por aqui.`,
    });

    expect(rejectFileUpfront(file('image/png', 0), MAX, own)).toBe('Esse arquivo está vazio.');
    expect(rejectFileUpfront(file('image/png', 12 * 1024 * 1024), MAX, own)).toBe(
      '12 MB passa do teto de 8 MB.',
    );
    expect(rejectFileUpfront(file('', 1024), MAX, own)).toBe(
      'Não deu para saber o tipo desse arquivo.',
    );
    expect(rejectFileUpfront(file('application/pdf', 1024), MAX, own)).toBe(
      'Não aceitamos application/pdf por aqui.',
    );
  });

  it('lets a host restate ONE sentence by spreading the pack it starts from', () => {
    // Rewriting a single sentence is the ordinary case; the spread is what
    // keeps it one line, and — unlike the old Partial merge — the pack is in
    // the host's diff, so choosing pt-BR is visible rather than a silence.
    const partial = (context: { limit: string }) => ({
      ...PT_BR_WEB_STORAGE_MESSAGES(context),
      empty_file: 'Vazio.',
    });
    expect(rejectFileUpfront(file('image/png', 0), MAX, partial)).toBe('Vazio.');
    expect(rejectFileUpfront(file('application/pdf', 1024), MAX, partial)).toContain(
      'application/pdf',
    );
  });
});

describe('uploadFailure', () => {
  it('explains a 403 as a permission the account lacks', async () => {
    expect(await uploadFailure(refusal(403, { error: 'forbidden' }), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('permissão');
  });

  it('explains a 401 as an expired session, which the owner can fix', async () => {
    expect(await uploadFailure(refusal(401, {}), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('sessão expirou');
  });

  it("repeats the server's OWN sentence about the image rather than re-wording it", async () => {
    // The same sentence has to serve a host write carrying bytes for an agent, so
    // re-wording here is how the two entrances start telling one owner two different
    // things about one file.
    const sentence = 'Não foi possível ler a imagem enviada — o arquivo parece estar corrompido.';

    expect(await uploadFailure(refusal(400, { error: sentence }), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toBe(sentence);
  });

  it('reads a size rejection as a size rejection, with the limit', async () => {
    expect(await uploadFailure(refusal(413, { error: 'file_too_large' }), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('8 MB');
  });

  it('keeps an unrecognised code visible alongside the status', async () => {
    // It is what turns a support request from "it failed" into something greppable.
    const message = await uploadFailure(refusal(500, { error: 'kaboom' }), MAX, PT_BR_WEB_STORAGE_MESSAGES);

    expect(message).toContain('500');
    expect(message).toContain('kaboom');
  });

  it('still surfaces the status when the body carries nothing', async () => {
    expect(await uploadFailure(new Response('<html>', { status: 502 }), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('502');
  });
});

describe("the server's own number wins over the browser's default", () => {
  /**
   * The regression for an adversarial finding, from the browser's side.
   *
   * The endpoint now states `file_too_large` as a finished sentence built from the
   * MOUNT's ceiling. This half must relay it rather than mapping it back through
   * its own default — which is what produced "o limite é 8 MB" about a 6 MB file
   * refused by a 4 MB mount.
   */
  it("relays the mount's sentence verbatim even though the local default disagrees", async () => {
    const fromServer = 'A imagem enviada é maior que o limite de 4 MB.';

    // MAX here is the 8 MiB default: the browser's number is deliberately WRONG for
    // this mount, and must not appear.
    const message = await uploadFailure(refusal(413, { error: fromServer }), MAX, PT_BR_WEB_STORAGE_MESSAGES);

    expect(message).toBe(fromServer);
    expect(message).not.toContain('8 MB');
  });

  it('falls back to the local table only for a code with no sentence', async () => {
    expect(await uploadFailure(refusal(413, { error: 'file_too_large' }), MAX, PT_BR_WEB_STORAGE_MESSAGES)).toContain('8 MB');
  });
});

describe('the copy a host can override', () => {
  it('states a 403 as an outcome, naming no role model of its own', async () => {
    // `mayUpload` is one host-computed boolean; this file used to answer it with
    // "é preciso ser OWNER ou ADMIN", asserting one host's roles for every adopter.
    const message = await uploadFailure(refusal(403, { error: 'forbidden' }), MAX, PT_BR_WEB_STORAGE_MESSAGES);

    expect(message).toContain('permissão');
    for (const role of ['OWNER', 'ADMIN']) expect(message).not.toContain(role);
  });

  it('lets the host name its OWN reason for a 403', async () => {
    const message = await uploadFailure(refusal(403, { error: 'forbidden' }), MAX, (context) => ({
      ...PT_BR_WEB_STORAGE_MESSAGES(context),
      forbidden: 'Only a store manager may add photos.',
    }));

    expect(message).toBe('Only a store manager may add photos.');
  });

  it('rewrites one entry by spreading the pack, keeping the rest of the table', async () => {
    const overrides = (context: { limit: string }) => ({
      ...PT_BR_WEB_STORAGE_MESSAGES(context),
      forbidden: 'Sem permissão.',
    });

    expect(await uploadFailure(refusal(404, { error: 'not_found' }), MAX, overrides)).toContain(
      'não está mais disponível',
    );
  });

  it('speaks pt-BR only when the pack is passed — it is product copy, chosen by name', () => {
    expect(transportFailure(PT_BR_WEB_STORAGE_MESSAGES)).toContain('conexão');
  });
});

describe('transportFailure', () => {
  it('points at the connection, the only thing left to check on one origin', () => {
    // A two-hop upload had to hedge with "rede ou CORS", because a blocked
    // cross-origin PUT is indistinguishable from an offline network at the fetch
    // layer. Same-origin, the sentence can be definite.
    expect(transportFailure(PT_BR_WEB_STORAGE_MESSAGES)).toContain('conexão');
    expect(transportFailure(PT_BR_WEB_STORAGE_MESSAGES)).not.toContain('CORS');
  });

  it("is the host's sentence too, so no deployment is stuck with one voice", () => {
    expect(
      transportFailure((context) => ({
        ...PT_BR_WEB_STORAGE_MESSAGES(context),
        transport: 'Sem conexão com o servidor.',
      })),
    ).toBe('Sem conexão com o servidor.');
  });
});
