/**
 * Cookie parsing and serialization — the wire half of the request scope.
 *
 * The read side and the write side are handed out TOGETHER, as one codec
 * object, because the only way they can be wrong is by disagreeing. A parser
 * that percent-decodes paired with a serializer that does not encode round-trips
 * every value it was tested with and mangles the first one containing a
 * delimiter. Binding them to one object makes that pairing impossible to get
 * wrong at a call site: there is no "the parse function" to import separately.
 *
 * ## Why encoding is a knob and not a decision
 *
 * RFC 6265 forbids `;`, `,`, whitespace and control characters in a cookie
 * value, so percent-encoding is the correct default — an unencoded `;` silently
 * TRUNCATES the cookie rather than failing. But a host adopting this package
 * already has cookies in browsers, written by whatever it used before. If that
 * was a raw serializer and this codec starts encoding, the two formats meet in
 * the field during a rollout.
 *
 * That meeting is survivable in one direction and not the other, which is why
 * {@link CookieCodecOptions.encode} exists rather than a hardcoded `true`:
 *
 * - **raw value read by the decoding parser** — safe. `decodeURIComponent` is
 *   the identity on anything with no `%` in it, and a malformed escape falls
 *   back to the raw text (see {@link decodeCookieValue}) instead of throwing.
 * - **encoded value read by a raw parser** — NOT safe, and not this package's to
 *   fix: the host's old reader is still out there for as long as the old code
 *   is deployed.
 *
 * So a host with existing raw cookies adopts with `encode: false`, and flips it
 * once nothing reads those cookies by hand any more.
 */

/** The subset of `Set-Cookie` attributes this codec writes. */
export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  domain?: string;
  /** Seconds. `0` is meaningful (expire now) — only `undefined` omits it. */
  maxAge?: number;
  expires?: Date;
}

/** A cookie as read from the request. */
export interface RequestCookie {
  name: string;
  value: string;
}

export interface CookieCodecOptions {
  /**
   * Percent-encode on write and decode on read. Defaults to `true`, which is
   * what RFC 6265 requires of any value that might contain a delimiter.
   *
   * Set `false` only to stay wire-compatible with cookies an earlier
   * implementation wrote raw — see this module's header for which direction of
   * that mismatch is safe.
   */
  encode?: boolean;
}

/** The paired reader and writer. Obtain one from {@link createCookieCodec}. */
export interface CookieCodec {
  /** Build one `Set-Cookie` header value. */
  serialize: (name: string, value: string, options?: CookieOptions) => string;
  /** Build the `Set-Cookie` header value that REMOVES a cookie. */
  serializeDeletion: (name: string, options?: CookieOptions) => string;
  /** Parse an incoming `Cookie` header into name -> value. */
  parse: (header: string | null | undefined) => Map<string, string>;
  /** Whether this codec percent-encodes. Exposed so an adapter can report it. */
  readonly encodes: boolean;
}

const SAME_SITE_LABEL = {
  lax: 'Lax',
  strict: 'Strict',
  none: 'None',
} as const;

/**
 * `decodeURIComponent` that returns the raw value for a malformed escape.
 *
 * A cookie is attacker-supplied: anything can arrive in that header, including a
 * lone `%` that makes `decodeURIComponent` throw `URIError`. Throwing here would
 * turn a junk cookie into a 500 on every request that carries it, and the
 * visitor cannot clear a cookie they cannot see. The raw text is the honest
 * answer for a value that was never encoded in the first place.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Build a reader/writer pair.
 *
 * @param options - See {@link CookieCodecOptions}. Omitted means encoding on.
 */
export function createCookieCodec(options: CookieCodecOptions = {}): CookieCodec {
  const encodes = options.encode ?? true;
  const encodeValue = (value: string): string =>
    encodes ? encodeURIComponent(value) : value;
  const decodeValue = (value: string): string =>
    encodes ? decodeCookieValue(value) : value;

  const serialize = (name: string, value: string, cookie: CookieOptions = {}): string => {
    const parts = [`${name}=${encodeValue(value)}`];
    if (cookie.path) parts.push(`Path=${cookie.path}`);
    if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
    if (cookie.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(cookie.maxAge)}`);
    if (cookie.expires) parts.push(`Expires=${cookie.expires.toUTCString()}`);
    if (cookie.httpOnly) parts.push('HttpOnly');
    if (cookie.secure) parts.push('Secure');
    if (cookie.sameSite) parts.push(`SameSite=${SAME_SITE_LABEL[cookie.sameSite]}`);
    return parts.join('; ');
  };

  return {
    encodes,
    serialize,
    /**
     * A deletion is a write with an empty value and an expiry in the past, and
     * the browser only matches it to the original when `Path` and `Domain`
     * match too — hence the options pass-through rather than a bare name.
     */
    serializeDeletion: (name, cookie: CookieOptions = {}) =>
      serialize(name, '', {
        ...cookie,
        path: cookie.path ?? '/',
        maxAge: 0,
        expires: new Date(0),
      }),
    /**
     * A repeated name keeps the FIRST occurrence: that is the one a browser
     * sends for the most specific path, and it is the value the visitor's own
     * session is keyed by. Keeping the last would silently prefer a
     * broader-scoped cookie an attacker on a sibling subdomain can set.
     *
     * `eq < 1` rather than `eq < 0` drops a nameless `=value` segment as well as
     * a valueless one.
     */
    parse: (header) => {
      const jar = new Map<string, string>();
      if (!header) return jar;
      for (const pair of header.split(';')) {
        const eq = pair.indexOf('=');
        if (eq < 1) continue;
        const name = pair.slice(0, eq).trim();
        if (!name || jar.has(name)) continue;
        jar.set(name, decodeValue(pair.slice(eq + 1).trim()));
      }
      return jar;
    },
  };
}
