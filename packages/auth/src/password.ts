import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing and the policy that decides which passwords are accepted.
 *
 * ## Why scrypt and not bcrypt/argon2
 *
 * Both of the usual answers are native addons. `@12-apps/*` packages are
 * installed by hosts we do not control — a Vite SPA's dev container, an Alpine
 * image, a CI runner with no toolchain — and a native build failure there is an
 * install that cannot be fixed by the person hitting it. `node:crypto`'s scrypt
 * is a memory-hard KDF built into the runtime: no addon, no postinstall, no
 * platform matrix, and it is what Node's own docs point at for this job.
 *
 * ## The stored format
 *
 * ```
 * scrypt$16384$8$1$<salt-base64>$<derived-key-base64>
 * ```
 *
 * The parameters travel WITH the hash rather than living in a constant, which
 * is the whole reason a stored password can outlive the policy that made it.
 * Raise {@link SCRYPT_COST} in five years and every existing hash still
 * verifies — it is checked against the cost recorded in its own string — while
 * new ones are written at the new cost. {@link needsRehash} is how a host
 * notices the difference at the one moment it holds the plaintext (a successful
 * sign-in) and can upgrade the row silently.
 *
 * Nothing here is Future Pay's, or any host's: no copy, no domain vocabulary,
 * no database. It is the primitive the email-credentials factory is built on.
 */

/**
 * scrypt CPU/memory cost. 16384 (2^14) with r=8 is Node's documented default
 * pairing and costs ~16 MB and ~50-100ms per hash on a server core — the range
 * that is hostile to an offline attacker and unnoticeable inside an HTTP
 * request. Raising it is safe at any time; see the module docs.
 */
const SCRYPT_COST = 16384;
/** Block size. Multiplies the memory cost together with N. */
const SCRYPT_BLOCK_SIZE = 8;
/** Parallelisation. 1 is the default and the only value worth using here. */
const SCRYPT_PARALLELISM = 1;
/** Derived-key length in bytes. */
const KEY_LENGTH = 64;
/** Salt length in bytes. */
const SALT_LENGTH = 16;

/**
 * `maxmem` for scrypt, in bytes.
 *
 * Node refuses a derivation whose working set exceeds this, and its default
 * (32 MB) sits close enough to the 16 MB the parameters above need that a later
 * cost bump would start failing with `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` — an
 * error that reads like a bad password rather than a ceiling. Stated explicitly
 * with headroom so the failure cannot happen quietly.
 */
const SCRYPT_MAX_MEM = 128 * 1024 * 1024;

/** The algorithm tag every hash this module writes begins with. */
const ALGORITHM = "scrypt";

/** Minimum accepted password length. Below this nothing else is worth checking. */
export const MIN_PASSWORD_LENGTH = 8;
/**
 * Maximum accepted password length.
 *
 * A cap is a denial-of-service control, not a security opinion: scrypt hashes
 * whatever it is handed, so an unbounded field lets one request burn CPU on a
 * megabyte of input. 200 is far past any real passphrase.
 */
export const MAX_PASSWORD_LENGTH = 200;

/** Why a password was refused. Hosts map these to their own user-facing copy. */
export type PasswordPolicyViolation =
  | "too-short"
  | "too-long"
  | "needs-letter"
  | "needs-number"
  | "too-common";

export interface PasswordPolicy {
  /** Minimum length. Defaults to {@link MIN_PASSWORD_LENGTH}. */
  minLength?: number;
  /** Maximum length. Defaults to {@link MAX_PASSWORD_LENGTH}. */
  maxLength?: number;
  /** Require at least one letter. Defaults to `true`. */
  requireLetter?: boolean;
  /** Require at least one digit. Defaults to `true`. */
  requireNumber?: boolean;
  /**
   * Extra values to refuse outright, compared case-insensitively. A host passes
   * the things it knows are guessable in ITS product — the store's own name,
   * the product name — which this package cannot know.
   */
  denyList?: readonly string[];
}

/**
 * The passwords that a leak list would put in the first thousand guesses and
 * that our own length/letter/digit rules happen to admit.
 *
 * Deliberately short. A real breach corpus is megabytes and belongs in a host's
 * own service, not inlined in a package every SPA bundles; what this defends is
 * the narrow, embarrassing case where the policy's own shape suggests the
 * answer ("needs a letter and a number" → `password1`).
 */
const COMMON_PASSWORDS: readonly string[] = [
  "password1",
  "password123",
  "senha123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "abc12345",
  "iloveyou1",
  "admin123",
  "letmein1",
  "welcome1",
  "monkey123",
  "football1",
  "trustno1",
];

/** Every way a candidate password fails the policy, in reading order. */
export function checkPasswordPolicy(
  password: string,
  policy: PasswordPolicy = {},
): PasswordPolicyViolation[] {
  const {
    minLength = MIN_PASSWORD_LENGTH,
    maxLength = MAX_PASSWORD_LENGTH,
    requireLetter = true,
    requireNumber = true,
    denyList = [],
  } = policy;

  const violations: PasswordPolicyViolation[] = [];
  if (password.length < minLength) violations.push("too-short");
  if (password.length > maxLength) violations.push("too-long");
  if (requireLetter && !/\p{L}/u.test(password)) violations.push("needs-letter");
  if (requireNumber && !/\d/u.test(password)) violations.push("needs-number");

  const normalized = password.trim().toLowerCase();
  const denied = [...COMMON_PASSWORDS, ...denyList].some(
    (entry) => entry.trim().toLowerCase() === normalized,
  );
  if (denied) violations.push("too-common");

  return violations;
}

/** `true` when {@link checkPasswordPolicy} finds nothing to complain about. */
export function isPasswordAcceptable(
  password: string,
  policy: PasswordPolicy = {},
): boolean {
  return checkPasswordPolicy(password, policy).length === 0;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      // NFKC first: the same passphrase typed on two keyboards can arrive as
      // two different byte strings (é as one code point or as e + U+0301), and
      // without normalising, a password set on macOS fails to verify on Linux.
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelism, maxmem: SCRYPT_MAX_MEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

/**
 * Hash a password for storage. Never store, log or return the plaintext.
 *
 * The result is self-describing (see the module docs), so it is the only thing
 * a host needs to persist — there is no separate salt or parameter column.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(
    password,
    salt,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
  );
  return [
    ALGORITHM,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

interface ParsedHash {
  cost: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  derived: Buffer;
}

/** Split a stored hash back into its parts, or `null` if it is not one of ours. */
function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [algorithm, cost, blockSize, parallelism, salt, derived] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== ALGORITHM) return null;
  const parsed = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt, "base64"),
    derived: Buffer.from(derived, "base64"),
  };
  const numbersOk = [parsed.cost, parsed.blockSize, parsed.parallelism].every(
    (value) => Number.isInteger(value) && value > 0,
  );
  if (!numbersOk || parsed.salt.length === 0 || parsed.derived.length === 0) return null;
  return parsed;
}

/**
 * Verify a password against a stored hash. Constant-time, and `false` for
 * anything malformed rather than throwing.
 *
 * **Falsehood is not a fast path.** A caller that skips this when the user has
 * no password hash leaks, in its response time, which e-mails have accounts —
 * which is why {@link dummyVerify} exists and why the credentials flow calls it.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsync(
      password,
      parsed.salt,
      parsed.cost,
      parsed.blockSize,
      parsed.parallelism,
    );
  } catch {
    // A hash written with parameters this runtime refuses (e.g. a cost beyond
    // `maxmem`) must read as "wrong password", never as a 500 that tells the
    // caller their guess was interesting.
    return false;
  }
  if (derived.length !== parsed.derived.length) return false;
  return timingSafeEqual(derived, parsed.derived);
}

/**
 * Burn one hash's worth of CPU on nothing.
 *
 * Called on the paths where there is no hash to check — an unknown e-mail, an
 * account that only ever signed in with Google — so that "no such user" and
 * "wrong password" take the same time. Without it, sign-in is a user-enumeration
 * oracle that needs no more than a stopwatch.
 */
export async function dummyVerify(): Promise<false> {
  await scryptAsync(
    "dummy-password-for-timing-equalisation",
    Buffer.alloc(SALT_LENGTH),
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
  );
  return false;
}

/**
 * Should this hash be rewritten at the current parameters?
 *
 * A host calls this right after a successful {@link verifyPassword} — the one
 * moment it legitimately holds the plaintext — and re-hashes if it answers
 * `true`. That is how a cost increase reaches passwords that already exist,
 * without ever asking anyone to change one.
 */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return (
    parsed.cost < SCRYPT_COST ||
    parsed.blockSize !== SCRYPT_BLOCK_SIZE ||
    parsed.parallelism !== SCRYPT_PARALLELISM ||
    parsed.derived.length !== KEY_LENGTH
  );
}
