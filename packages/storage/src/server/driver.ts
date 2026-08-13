/**
 * The DRIVER port: the only thing the rest of the package knows about where
 * bytes live.
 *
 * Three operations, and a fourth that is deliberately optional:
 *
 *   - `put`    — store bytes at a key, world-readable, FROM THE SERVER. The only
 *                way anything is ever written; there is no address a driver can
 *                hand a browser to PUT at, which is what makes the CORS class of
 *                failure described in the root entry unreachable rather than
 *                merely avoided.
 *   - `delete` — remove an object. Deleting one that is already gone is SUCCESS:
 *                the caller is reconciling "nothing references this key any
 *                more", and an absent object satisfies that.
 *   - `publicUrl` — a stored key as something a browser can load. Synchronous,
 *                because it is called during render.
 *   - `read`   — OPTIONAL, and its presence is what tells the serve route which
 *                of its two behaviours applies. A driver that keeps objects on
 *                the app server's own disk implements it and the route streams
 *                bytes; a bucket-backed driver does not, and the route redirects
 *                to `publicUrl` instead. That used to be an environment flag
 *                read inside the route, which is the same fact stated somewhere
 *                it could disagree with the driver actually in use.
 *
 * A second vendor is a second factory satisfying this interface plus a config
 * entry naming it — no host code, and nothing in the upload path changes.
 */

/** An object read back from a driver that holds its own bytes. */
export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface StorageDriver {
  /** Which driver this is, for log lines and for the mount's own reporting. */
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  /** Present only on drivers whose objects the app server can serve itself. */
  read?(key: string): Promise<StoredObject | null>;
}
