import { ACCEPTED_CONTENT_TYPES } from '../content-types';
import { megabytes } from '../limits';

/**
 * Why an upload failed, in words the store owner can act on.
 *
 * Collapsing every cause into one "Falha ao enviar a imagem." is what made a
 * failed upload unreportable: the owner saw a message that named no cause, could
 * not tell a file they should shrink from a permission the operator had not
 * granted, and had nothing to paste into a support request.
 *
 * The upload being a SINGLE same-origin POST is what let this shrink to one rule.
 * A two-hop version had to explain a presign step, a signed grant that could age
 * out, a bucket's own `<Code>` coming back to the browser, and — the honest but
 * useless one — "rede ou CORS", because a blocked cross-origin PUT is deliberately
 * indistinguishable from an offline network at the `fetch` layer. None of those
 * can happen: the browser talks to our own origin, and the server is the only
 * thing that talks to storage.
 *
 * What remains is one rule: **whatever the response DOES say is said out loud.**
 */

/** The refusals the endpoint states as a CODE rather than as a sentence. */
function codeMessages(limit: string): Readonly<Record<string, string>> {
  return {
    forbidden:
      'Sua conta não tem permissão para enviar imagens nesta loja (é preciso ser OWNER ou ADMIN).',
    unsupported_content_type: 'Formato não suportado. Envie PNG, JPG, WebP ou GIF.',
    file_too_large: `Imagem muito grande. O limite é ${limit}.`,
    invalid_key: 'Não foi possível localizar essa imagem.',
    not_found: 'Essa imagem não está mais disponível.',
  };
}

/**
 * Refuse a file before any request leaves the browser, or `null` to proceed.
 *
 * Measured against the bytes that would ACTUALLY be sent, which is why it runs
 * after `optimizeImage` and not before: a 12 MB phone photo is a perfectly good
 * product image once it is 1280px of WebP, and refusing it against the cap first
 * was sending owners off to find an image editor for a file we can fix here.
 *
 * An empty `file.type` means the OS could not identify the file at all (an
 * extensionless drop, most often) — worth its own sentence, because "formato não
 * suportado" reads as an accusation about a file the owner knows is a PNG.
 */
export function rejectFileUpfront(file: File, maxBytes: number): string | null {
  if (file.size === 0) {
    return 'Arquivo vazio (0 bytes). Escolha a imagem novamente.';
  }
  if (file.size > maxBytes) {
    return `Imagem muito grande: ${megabytes(file.size)}. O limite é ${megabytes(
      maxBytes,
    )} — reduza a imagem e tente de novo.`;
  }
  if (file.type === '') {
    return 'Não foi possível identificar o tipo do arquivo. Envie um PNG, JPG ou WebP.';
  }
  if (!ACCEPTED_CONTENT_TYPES.includes(file.type)) {
    return `Formato não suportado (${file.type}). Envie PNG, JPG, WebP ou GIF.`;
  }
  return null;
}

/** The `error` field of a JSON refusal, or `null` when there isn't one. */
async function statedError(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const error = (parsed as { error: unknown }).error;
      return typeof error === 'string' ? error : null;
    }
    return null;
  } catch {
    // An unreadable or non-JSON body tells us nothing extra; the status still does.
    return null;
  }
}

/**
 * Explain a refusal from the upload endpoint.
 *
 * The server answers the IMAGE-shaped failures — unreadable file, wrong format for
 * the declared type, storage not configured — as a finished pt-BR sentence, because
 * the same sentence has to serve a host write carrying bytes for an agent. Those
 * are surfaced verbatim rather than re-worded here, so the two entrances cannot
 * drift into telling one store owner two different things about one file.
 */
export async function uploadFailure(response: Response, maxBytes: number): Promise<string> {
  if (response.status === 401) {
    return 'Sua sessão expirou. Entre novamente e repita o envio.';
  }
  const stated = await statedError(response);
  const known = stated ? codeMessages(megabytes(maxBytes))[stated] : undefined;
  if (known) return known;
  // A sentence rather than a code: the server already phrased it for the owner.
  if (stated && /\s/.test(stated)) return stated;
  // An unrecognised CODE is still the most useful string in the response — it is
  // what turns a support request from "it failed" into something greppable — so it
  // rides along with the status rather than being mapped away.
  const detail = stated ? ` (${stated})` : '';
  return `Não foi possível enviar a imagem (HTTP ${response.status}${detail}). Tente de novo em instantes.`;
}

/**
 * `fetch` rejected outright — no response ever arrived.
 *
 * One sentence, and it can afford to be definite: the upload goes to our own
 * origin, so there is no cross-origin case to hedge about.
 */
export function transportFailure(): string {
  return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.';
}
