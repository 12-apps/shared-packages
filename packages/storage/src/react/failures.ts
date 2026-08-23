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
 *
 * ## Why this table is overridable
 *
 * Every sentence here reaches a store owner, so it is product copy and it is
 * pt-BR — but two of these refusals are decided by rules the PACKAGE does not
 * know. `forbidden` is the sharp one: `mayUpload` is deliberately one host-computed
 * boolean, and this file once answered it with *"é preciso ser OWNER ou ADMIN"* —
 * naming a role model that belongs to one host. An adopter whose roles are
 * `manager`/`staff`, or who gates on an `@12-apps/rbac` permission, would show an
 * owner two role names that do not exist in their product, with no knob to change
 * it. So the copy states the OUTCOME ("your account may not") and the host
 * supplies the CAUSE if it wants one, through `messages` — the same escape hatch
 * the server's refusals already have.
 */

/**
 * The browser-side refusal copy, as one table a host may override.
 *
 * Mirrors the server's `StorageMessages` deliberately: same shape, same reason,
 * so a host that overrides a sentence on one side can find the other.
 *
 * These are the refusals the browser has to phrase ITSELF — a bare code, or a
 * status with no body at all. Anything the server states as a finished sentence is
 * surfaced verbatim instead and never reaches this table (see {@link uploadFailure}).
 */
export interface WebStorageMessages {
  /**
   * 403. States the outcome only: the reason is the host's rule, and naming a
   * role model here would be wrong for every host but the first.
   */
  forbidden: string;
  unsupported_content_type: string;
  /** Carries the ceiling, so a host overriding it states its own number. */
  file_too_large: string;
  invalid_key: string;
  not_found: string;
  /** 401 — the session went away between picking the file and sending it. */
  session_expired: string;
  /** `fetch` rejected outright; no response ever arrived. */
  transport: string;

  /**
   * THE FIVE BELOW ARE THE REFUSALS THAT USED TO HAVE NO KNOB AT ALL.
   *
   * They are decided in the browser before a request leaves it (see
   * {@link rejectFileUpfront}) or after a response nothing could parse, and they
   * were written as literals inside those functions — not defaults a host could
   * override, but sentences a host could not reach. The docstring at the top of
   * this file already argued they should be here ("every sentence here reaches a
   * store owner, so it is product copy"); these four simply never arrived.
   *
   * A host overriding `file_too_large` and finding its own words replaced two
   * lines later by ours is the specific failure this closes.
   *
   * Three take the fact they are about, because the sentence is worthless
   * without it: the size that was refused, the type that was refused. Functions
   * rather than tokens in a string, so a host writing "8,4 MB é grande demais"
   * can put the number where its own grammar wants it.
   */

  /** A 0-byte file — an interrupted copy or an unreadable share. */
  empty_file: string;
  /** Over the ceiling, before any request. Both sizes already formatted. */
  file_too_large_upfront: (context: { size: string; limit: string }) => string;
  /** The OS identified no type at all — an extensionless drop, most often. */
  unknown_content_type: string;
  /** A type we do not accept. Carries it, because the owner will dispute it. */
  unsupported_content_type_upfront: (context: { contentType: string }) => string;
  /** 2xx with no key in the body — accepted, and unusable. */
  missing_key: string;
  /**
   * A refusal whose body carried no sentence and no code this table knows —
   * the status (and the raw code, when there was one) ride along, because
   * they are what turns "it failed" into something greppable.
   */
  upload_failed_http: (context: { status: number; detail: string }) => string;
  /** Anything thrown on the way. The last resort, and it says so. */
  upload_failed: string;

  /**
   * The standalone upload page's own chrome — heading, the one-line
   * instruction (which carries the ceiling, same rule as the refusals), the
   * field label, its helper, and the button that clears a chosen image.
   * These rendered as literals inside `createWebStorage` until copy became
   * required config.
   */
  pageTitle: string;
  pageIntro: string;
  fieldLabel: string;
  fieldHelper: string;
  fieldRemove: string;
}

/** Copy that only makes sense with the configured ceiling in it. */
export interface WebStorageMessageContext {
  /** `8 MB`, already formatted. */
  limit: string;
}

/**
 * The messages in force for a mount's ceiling.
 *
 * Exported because `use-upload` needs the same table for the two refusals it
 * phrases itself, and a second `{ ...defaults, ...overrides }` there would be
 * the exact drift this file exists to prevent.
 */
export function messagesOf(
  maxBytes: number,
  factory: (context: WebStorageMessageContext) => WebStorageMessages,
): WebStorageMessages {
  return factory({ limit: megabytes(maxBytes) });
}

const resolve = messagesOf;

/**
 * The sentence for a refusal CODE, or `undefined` for a code with no entry.
 *
 * An own-property check rather than a bare `in`: the code arrives from a response
 * body, so `constructor` or `toString` would otherwise resolve through the
 * prototype and be shown to a store owner as an explanation.
 */
function sentenceFor(messages: WebStorageMessages, code: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(messages, code)) return undefined;
  const entry = messages[code as keyof WebStorageMessages];
  // Only the plain-string entries are reachable by a server CODE. The three
  // that take a fact are browser-side refusals with no server equivalent, and
  // a response naming one would otherwise render a function at a store owner.
  return typeof entry === 'string' ? entry : undefined;
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
export function rejectFileUpfront(
  file: File,
  maxBytes: number,
  factory: (context: WebStorageMessageContext) => WebStorageMessages,
): string | null {
  const messages = resolve(maxBytes, factory);
  if (file.size === 0) {
    return messages.empty_file;
  }
  if (file.size > maxBytes) {
    return messages.file_too_large_upfront({
      size: megabytes(file.size),
      limit: megabytes(maxBytes),
    });
  }
  if (file.type === '') {
    return messages.unknown_content_type;
  }
  if (!ACCEPTED_CONTENT_TYPES.includes(file.type)) {
    return messages.unsupported_content_type_upfront({ contentType: file.type });
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
 * **The server's own sentence wins.** Every refusal the mount can phrase — an
 * unreadable file, a format that contradicts the bytes, a ceiling, an unsupported
 * type, storage not configured — arrives as a finished pt-BR sentence built from
 * the mount's OWN `maxBytes` and through the mount's OWN `messages` overrides.
 * Those are surfaced verbatim rather than re-worded here, so the two entrances
 * cannot drift into telling one store owner two different things about one file,
 * and so a limit named on screen is the limit something enforces.
 *
 * That last point is why the table below is a FALLBACK and not the primary path.
 * The endpoint used to answer `file_too_large` as a bare code, and the browser
 * re-derived the number from its own default: a mount capped at 4 MB refusing a
 * 6 MB file produced *"o limite é 8 MB"* — a ceiling nothing applied. The codes
 * that remain are the ones no `StorageMessages` entry exists for (`forbidden`,
 * `invalid_key`, `not_found`) plus any older mount still answering a code.
 */
export async function uploadFailure(
  response: Response,
  maxBytes: number,
  factory: (context: WebStorageMessageContext) => WebStorageMessages,
): Promise<string> {
  const messages = resolve(maxBytes, factory);
  if (response.status === 401) return messages.session_expired;
  const stated = await statedError(response);
  // A sentence rather than a code: the server already phrased it for the owner,
  // with its own number and its own overrides in it. Checked BEFORE the table so a
  // mount that states a limit is never second-guessed by a local default.
  if (stated && /\s/.test(stated)) return stated;
  const known = stated ? sentenceFor(messages, stated) : undefined;
  if (known) return known;
  // An unrecognised CODE is still the most useful string in the response — it is
  // what turns a support request from "it failed" into something greppable — so it
  // rides along with the status rather than being mapped away.
  const detail = stated ? ` (${stated})` : '';
  return messages.upload_failed_http({ status: response.status, detail });
}

/**
 * `fetch` rejected outright — no response ever arrived.
 *
 * One sentence, and it can afford to be definite: the upload goes to our own
 * origin, so there is no cross-origin case to hedge about.
 */
export function transportFailure(
  factory: (context: WebStorageMessageContext) => WebStorageMessages,
): string {
  // No ceiling to interpolate on this one, so the factory is read without a
  // limit rather than through a table built from a number that would be a lie.
  return factory({ limit: '' }).transport;
}
