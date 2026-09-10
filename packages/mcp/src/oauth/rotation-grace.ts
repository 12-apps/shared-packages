import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * The sealed successor that makes refresh rotation IDEMPOTENT for the length of a
 * grace window — the half of `refresh.ts` that lets a legitimate client survive a
 * lost response or a concurrent refresh without losing its session.
 *
 * ## The problem this exists to solve
 *
 * Rotation-on-use plus replay revocation is the OAuth 2.1 rule, and it is right:
 * a stolen refresh token is detected the moment BOTH the thief and the rightful
 * client use it, and the whole lineage dies. What that rule cannot tell apart is
 * a thief from a client that used its token twice for an innocent reason, and
 * there are two of those, both routine:
 *
 *   - **the lost response.** The client rotates, the 200 never arrives (a proxy
 *     timeout, a dropped connection), and it retries with the only token it
 *     still has — the one the server already consumed.
 *   - **the concurrent refresh.** Two of the client's own sessions notice an
 *     expired access token at the same moment and both refresh.
 *
 * Without a grace window both are punished as theft: the lineage is revoked,
 * INCLUDING the successor just handed to whoever won, and the connection is dead
 * until a human re-runs the whole authorization flow. That is the failure this
 * module removes.
 *
 * ## Why a SEALED successor rather than a second one
 *
 * The obvious shortcut — mint a fresh successor for every in-window reuse — is
 * the one thing that must not happen. It leaves one parent with two live
 * successors and two independently rotating families, which is precisely the
 * state replay protection exists to prevent: an attacker holding a stolen token
 * would only have to fire it alongside the real client to walk away with a
 * family of its own. So the window returns *the same* successor to every caller
 * that presents the parent. Reuse becomes idempotent instead of forgiven, and
 * exactly one successor is ever written.
 *
 * ## What detection this actually costs — stated plainly
 *
 * It would be convenient to say detection is merely DEFERRED by one rotation.
 * It is not, and the code does not provide that. Two parties left holding one
 * successor take this same path again at the next rotation, and again after
 * that: whichever of them arrives second is inside a fresh window each time, so
 * they stay in lockstep indefinitely. The honest guarantee is narrower:
 *
 *   **a collision is detected only when the two uses fall more than the window
 *   apart.**
 *
 * A thief who replays a freshly stolen token within the window of the real
 * client's rotation is handed a live token and raises no signal — and that
 * timing is precisely what the window exists to forgive, so it cannot be
 * distinguished. This is the accepted cost, and it is why the window is short
 * by default, why it is configurable, and why `0` restores the strict rule for
 * a deployment that would rather pay in re-authentications.
 *
 * ## Why the key is derived from the parent, and nothing is stored in the clear
 *
 * Returning the same successor means recovering its plaintext, and the plaintext
 * is exactly what `refresh.ts` promises never to persist. So it is not persisted:
 * it is sealed under a key derived by HKDF from the PARENT's own plaintext, and
 * only the sealed blob reaches the store. The consequences are the point:
 *
 *   - the database alone cannot open it. The parent's plaintext is never stored
 *     either, so a dump of the tokens table yields ciphertext and no key — the
 *     "hashed, never plaintext" invariant is unchanged;
 *   - the only party that CAN open it is a caller presenting the parent, which is
 *     the caller we mean to serve. It grants no capability that party lacks: it
 *     already held the parent, and the parent is what mints the successor;
 *   - the grace deadline is sealed INSIDE the blob rather than kept in a column,
 *     so an attacker with write access to the row cannot extend the window
 *     without also being able to forge the AES-GCM tag.
 *
 * One honest limit on that last point. The deadline is enforced by the server
 * when it opens a seal, not by the ciphertext, and a seal is cleared when its
 * token is consumed or revoked — not when its window lapses. So the ONE hop an
 * attacker holding a spent parent plaintext plus a table read can take is bounded
 * by when the successor is next used, which for an idle connection is the refresh
 * token's TTL rather than `graceMs`. Bounded to one hop either way, because every
 * consume and every revoke clears the parent's seal; sweeping lapsed seals would
 * tighten it to the window itself.
 */

/** AEAD, so a tampered blob fails to open rather than decrypting to garbage. */
const ALGORITHM = "aes-256-gcm";

/** 96-bit nonce — the size AES-GCM is specified for. */
const IV_BYTES = 12;

/** AES-256. */
const KEY_BYTES = 32;

/** GCM authentication tag length in bytes. */
const TAG_BYTES = 16;

/** Domain separation for the HKDF expansion, so this key is only ever this key. */
const HKDF_INFO = "12-apps/mcp:refresh-rotation-grace:v1";

/** Version prefix, so a future format change is recognisable rather than corrupt. */
const SEAL_VERSION = "v1";

/** How long a just-rotated token keeps answering with its successor. */
export const DEFAULT_ROTATION_GRACE_MS = 30_000;

/**
 * What a successfully opened seal yields.
 *
 * Not exported: `refresh.ts` is the only caller and reads it through inference,
 * so exporting it would only widen the package's public surface with a name
 * nobody imports.
 */
interface OpenedSuccessor {
  /** The successor's opaque plaintext — the token to hand back. */
  successor: string;
  /** Epoch milliseconds after which the seal must be refused. */
  graceUntil: number;
}

/**
 * Derive the sealing key from the parent's plaintext.
 *
 * No salt: an opaque refresh token is already 256 bits of CSPRNG output, so HKDF
 * is used here for domain separation and length adjustment rather than to
 * concentrate entropy that is not there.
 */
function sealingKey(parentPlaintext: string): Buffer {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(parentPlaintext, "utf8"),
    Buffer.alloc(0),
    Buffer.from(HKDF_INFO, "utf8"),
    KEY_BYTES,
  );
  return Buffer.from(derived);
}

/** base64url without padding, so the blob is safe in any column or URL. */
function encode(value: Buffer): string {
  return value.toString("base64url");
}

/**
 * Seal `successorPlaintext` so that only a caller holding `parentPlaintext` can
 * recover it, carrying `graceUntil` inside the sealed blob.
 *
 * The deadline is DATA here, not enforcement: {@link openSuccessor} returns it
 * rather than acting on it, and the caller (`refresh.ts`) is what refuses a
 * lapsed one. Sealing it inside the AEAD blob is what stops it being edited in
 * the row; it is not a claim that the ciphertext stops opening on its own. A
 * seal therefore stays openable-by-its-parent until the row is consumed or
 * revoked, which for an idle connection is the token's TTL rather than the
 * window — see the note in the module docblock.
 */
export function sealSuccessor(
  parentPlaintext: string,
  successorPlaintext: string,
  graceUntil: number,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, sealingKey(parentPlaintext), iv);
  const payload = JSON.stringify({ successor: successorPlaintext, graceUntil });
  const sealed = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return [SEAL_VERSION, encode(iv), encode(cipher.getAuthTag()), encode(sealed)].join(".");
}

/** Parse the four-part wire form, or `null` when it is not one. */
function parts(seal: string): { iv: Buffer; tag: Buffer; body: Buffer } | null {
  const segments = seal.split(".");
  if (segments.length !== 4) return null;
  const [version, iv, tag, body] = segments;
  if (version !== SEAL_VERSION) return null;

  const decoded = {
    iv: Buffer.from(iv ?? "", "base64url"),
    tag: Buffer.from(tag ?? "", "base64url"),
    body: Buffer.from(body ?? "", "base64url"),
  };
  // Lengths are fixed by the algorithm; a wrong one is a malformed blob, and
  // `createDecipheriv` would throw on it rather than return.
  if (decoded.iv.length !== IV_BYTES || decoded.tag.length !== TAG_BYTES) return null;
  return decoded;
}

/**
 * Open a seal with the parent's plaintext.
 *
 * `null` for every failure — a wrong parent, a tampered or truncated blob, an
 * unknown version, a payload that is not the expected shape. The caller treats
 * `null` as "no grace applies" and falls through to the replay rule, so a
 * failure here is never the difference between secure and insecure; it only
 * costs the client its retry.
 */
export function openSuccessor(parentPlaintext: string, seal: string): OpenedSuccessor | null {
  const parsed = parts(seal);
  if (!parsed) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, sealingKey(parentPlaintext), parsed.iv);
    decipher.setAuthTag(parsed.tag);
    const opened = Buffer.concat([decipher.update(parsed.body), decipher.final()]);
    const payload: unknown = JSON.parse(opened.toString("utf8"));
    return readPayload(payload);
  } catch {
    // A wrong key fails the GCM tag check, which throws. That is the expected
    // path for "this is not the parent that sealed it", not an error to report.
    return null;
  }
}

/** Narrow the decrypted JSON to {@link OpenedSuccessor}, or `null`. */
function readPayload(payload: unknown): OpenedSuccessor | null {
  if (payload === null || typeof payload !== "object") return null;
  const { successor, graceUntil } = payload as Record<string, unknown>;
  if (typeof successor !== "string" || successor === "") return null;
  if (typeof graceUntil !== "number" || !Number.isFinite(graceUntil)) return null;
  return { successor, graceUntil };
}
