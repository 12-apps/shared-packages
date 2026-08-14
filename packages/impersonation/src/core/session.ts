import { z } from 'zod';

import type {
  ImpersonationCookie,
  ImpersonationKind,
  ImpersonationSession,
  ImpersonationState,
  OperatorSession,
  PreviewSession,
} from './types';

/**
 * The impersonation session cookie: minting it, reading it back, and ending it.
 *
 * WHY A SEPARATE COOKIE rather than a claim on the host's auth session. A signed
 * session token is typically long-lived and re-stamped only at sign-in; carrying
 * the impersonation flag inside it would mean re-issuing the real human's own
 * session every time one starts or ends — the one operation that signs them out
 * if anything goes wrong mid-flight. This cookie is strictly ADDITIVE: starting
 * plants it, ending deletes it, and the actor's own session is never touched.
 *
 * WHY THE HOST SUPPLIES THE CODEC. Integrity is what is being bought: a payload
 * that was edited, truncated, or minted under a different key must fail to
 * decode, and every function here answers `null` rather than throwing.
 * Confidentiality rides along and is welcome (the payload names the target user
 * and the real human). An authenticated cipher the host already uses for values
 * that must come back untampered is the right thing to pass in — and rotating
 * its key ENDS every live session, which is the right failure mode for a thing
 * whose whole point is a hard time box.
 *
 * The functions here are pure: the caller plants or drops the returned cookie
 * descriptor on its own response object.
 */

/**
 * Root path, and NOT configurable.
 *
 * Every guarded route has to see the cookie (the guard runs on all of them), not
 * just the start/stop endpoints — and a host serving several apps behind one
 * origin needs all of them to see it. A narrower path is not a policy choice, it
 * is a broken session.
 */
const COOKIE_PATH = '/';

/** An authenticated codec for the cookie payload. Both directions may throw. */
export interface ImpersonationCodec {
  encrypt(plaintext: string): string;
  /** Must THROW (or return garbage) for a payload it did not produce. */
  decrypt(ciphertext: string): string;
}

/**
 * The hard time box, per kind — absolute, from the instant of minting, with no
 * renewal, sliding or otherwise (see {@link TimeBoxIsServerOwned}).
 *
 * REQUIRED, both of them, and deliberately not defaulted: how long a person may
 * wear somebody else's account is a policy every host has to state out loud. A
 * preview is usually far shorter than an operator session because it answers one
 * question ("what does this role actually see?"), and whoever wants another look
 * starts another one — a cheap, audited action.
 */
export type ImpersonationTimeBoxConfig = Record<ImpersonationKind, number>;

/** What {@link createSessionCodec} needs to mint and read a session. */
export interface SessionConfig {
  /** The cookie's name. The host's own naming convention decides it. */
  cookieName: string;
  /** HTTPS-only. The host knows whether it is serving over TLS. */
  secure: boolean;
  codec: ImpersonationCodec;
  timeBox: ImpersonationTimeBoxConfig;
}

/** Which SPA an operator session lands in — validated against the host's list. */
const targetApp = z.string().min(1).max(64);

const previewSubject = z.discriminatedUnion('as', [
  z.object({ as: z.literal('role'), roleName: z.string().min(1).max(120) }),
  z.object({ as: z.literal('member'), memberUserId: z.string().min(1).max(64) }),
]);

/**
 * The absolute time box, carried IN the payload rather than left to the cookie's
 * `Max-Age`. A browser is free to keep sending an expired cookie; the
 * server-side check against these two numbers is the one that decides.
 */
const timeBox = {
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
};

/**
 * `tenantId` is REQUIRED on both variants, deliberately. A nullable scope would
 * read as "impersonate everywhere", which is precisely the capability this must
 * not hand out: every session is bounded to one tenant, and impersonating in a
 * second one is a second, separately audited start.
 */
const sessionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('operator'),
    realUserId: z.string().min(1),
    targetUserId: z.string().min(1),
    targetApp,
    tenantId: z.string().min(1),
    reason: z.string().min(1).max(1000),
    allowWrites: z.boolean(),
    ...timeBox,
  }),
  z.object({
    kind: z.literal('preview'),
    realUserId: z.string().min(1),
    tenantId: z.string().min(1),
    previewOf: previewSubject,
    ...timeBox,
  }),
]);

/**
 * The reason NO SLIDING RENEWAL is structural here rather than merely
 * un-implemented.
 *
 * `issuedAt`/`expiresAt` are typed `?: never` on the writer's input, so a
 * decoded {@link ImpersonationSession} — which carries both as `number` — is NOT
 * assignable to it. `start(read(…))` does not compile. There is therefore no
 * expression that takes a live session and re-stamps its window; the only thing
 * that produces a cookie is a mint, which computes a fresh absolute window and,
 * for an operator session, requires a reason that gets audited. "Extending" is
 * not a cheaper operation than starting over — it is the same operation, with
 * the same paper trail.
 */
interface TimeBoxIsServerOwned {
  issuedAt?: never;
  expiresAt?: never;
}

/**
 * What a caller supplies to start a session: everything except the time box,
 * which only the server decides. `allowWrites` is optional and defaults to
 * FALSE — a session that can write is the exceptional case and has to be asked
 * for explicitly.
 */
export type StartImpersonationInput =
  | (Omit<OperatorSession, 'issuedAt' | 'expiresAt' | 'allowWrites'> & {
      allowWrites?: boolean;
    } & TimeBoxIsServerOwned)
  | (Omit<PreviewSession, 'issuedAt' | 'expiresAt'> & TimeBoxIsServerOwned);

/** A minted session and the cookie that carries it. */
export interface StartedImpersonation {
  session: ImpersonationSession;
  cookie: ImpersonationCookie;
}

/** What {@link ImpersonationSessionCodec.read} is given. */
export interface ReadImpersonationInput {
  /** Raw cookie value, or undefined when absent. */
  cookieValue: string | undefined;
  /**
   * True when this request authenticated with a machine/agent token rather than
   * a browser session. Such a request may NOT inherit an impersonation: a token
   * is issued for one operator's own identity, and honouring the cookie there
   * would let it act as the impersonated user, with neither the banner nor the
   * human at the keyboard that this cookie's whole context assumes.
   */
  isMachineToken?: boolean;
  /** Epoch ms; defaults to `Date.now()`. Injected for deterministic tests. */
  now?: number;
}

/** The cookie codec, bound to one host's configuration. */
export interface ImpersonationSessionCodec {
  cookieName: string;
  start(input: StartImpersonationInput, options?: { now?: number }): StartedImpersonation;
  read(input: ReadImpersonationInput): ImpersonationSession | null;
  end(): ImpersonationCookie;
  /**
   * Is there a session cookie on this raw `Cookie` header at all?
   *
   * A pure header test that exists to keep the authoritative resolution — a
   * decode plus a user lookup — off the ~100% of traffic that is not
   * impersonated. The substring match is deliberately loose in the one direction
   * that costs nothing: a cookie whose name merely ENDS in this one yields a
   * false positive, and a false positive only buys a full resolution that then
   * answers `null`. A false NEGATIVE would need the header to be absent, in
   * which case the jar is empty and the resolution would have answered `null`
   * anyway.
   */
  present(cookieHeader: string | null | undefined): boolean;
}

function cookieOptions(
  config: SessionConfig,
  maxAgeSeconds: number,
): ImpersonationCookie['options'] {
  return {
    httpOnly: true,
    secure: config.secure,
    // 'lax', not 'strict': a preview typically opens the previewed screen in a
    // NEW TAB, a top-level navigation a strict cookie would not be sent with —
    // the preview would open as the operator's own account, which is the one
    // outcome this must never produce.
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

/** Assemble the payload for `now`, with the server-owned fields applied LAST. */
function toPayload(
  input: StartImpersonationInput,
  now: number,
  timeBoxMs: ImpersonationTimeBoxConfig,
): unknown {
  const span = { issuedAt: now, expiresAt: now + timeBoxMs[input.kind] };
  return input.kind === 'operator'
    ? { ...input, allowWrites: input.allowWrites ?? false, ...span }
    : { ...input, ...span };
}

/**
 * Enforce the time box at READ time, against the same constants that minted it
 * so the two can never drift.
 *
 * The ceiling check is not redundant with the expiry check: it means a payload
 * claiming a longer window than this configuration allows — an older cookie from
 * when the constant was larger, or one produced by a bug — is refused rather
 * than honoured. The shortest of {what was minted, what this build permits} wins.
 */
function withinTimeBox(
  session: ImpersonationSession,
  now: number,
  timeBoxMs: ImpersonationTimeBoxConfig,
): boolean {
  if (now >= session.expiresAt) return false;
  const span = session.expiresAt - session.issuedAt;
  return span > 0 && span <= timeBoxMs[session.kind];
}

/** Decrypt + validate, answering null for anything that is not a session we minted. */
function decode(value: string, codec: ImpersonationCodec): ImpersonationSession | null {
  try {
    const parsed: unknown = JSON.parse(codec.decrypt(value));
    const result = sessionSchema.safeParse(parsed);
    return result.success ? (result.data as ImpersonationSession) : null;
  } catch {
    // The codec throws on a malformed payload, a failed authentication tag
    // (tampering), or a payload from a rotated key; JSON.parse throws on garbage
    // plaintext. All of them mean the same thing: no session.
    return null;
  }
}

/**
 * Bind the codec to one host's cookie name, TLS posture, cipher and time boxes.
 *
 * Reading is a pure function of (cookie, now) and returns NO cookie instruction,
 * so there is no code path from a read to a `Set-Cookie` — a read cannot extend
 * a session even by accident. See {@link TimeBoxIsServerOwned}.
 */
export function createSessionCodec(config: SessionConfig): ImpersonationSessionCodec {
  return {
    cookieName: config.cookieName,

    /**
     * The spread order in {@link toPayload} is the runtime twin of the
     * type-level block on {@link TimeBoxIsServerOwned}: a caller's bag is spread
     * FIRST, so a smuggled `issuedAt`/`expiresAt` — cast past the type, or
     * arriving from a request body someone forgot to narrow — is overwritten by
     * the server's window rather than overriding it.
     *
     * Throws (via zod) on an input that cannot make a valid session. Minting is
     * always initiated by trusted route code, so a malformed payload is a bug to
     * surface loudly, not a `null` to swallow — the opposite of the read path.
     */
    start(input, options) {
      const now = options?.now ?? Date.now();
      const session = sessionSchema.parse(
        toPayload(input, now, config.timeBox),
      ) as ImpersonationSession;
      return {
        session,
        cookie: {
          name: config.cookieName,
          value: config.codec.encrypt(JSON.stringify(session)),
          // Max-Age lines the browser's copy up with the server's window. It is
          // the belt; the payload's `expiresAt` is the braces — a client is free
          // to keep replaying a cookie past its Max-Age, and only the
          // server-side check actually decides.
          options: cookieOptions(config, Math.ceil((session.expiresAt - now) / 1000)),
        },
      };
    },

    /**
     * Null — never a throw, never a partial answer — for: no cookie, a machine
     * token, a payload whose authentication tag fails, one whose shape does not
     * parse, and one whose absolute window has closed. Every one of those means
     * the caller acts as their own, unelevated self, the only safe default.
     */
    read(input) {
      if (!input.cookieValue || input.isMachineToken === true) return null;
      const session = decode(input.cookieValue, config.codec);
      if (!session) return null;
      return withinTimeBox(session, input.now ?? Date.now(), config.timeBox)
        ? session
        : null;
    },

    /**
     * The cookie instruction that ENDS an impersonation: an empty value with
     * `Max-Age: 0`, on the same name and path, so the browser drops it.
     *
     * Ending is exactly this and nothing more. The human's own session cookie is
     * untouched, so stopping never costs them their sign-in — the property that
     * made a separate cookie the right shape in the first place.
     */
    end() {
      return { name: config.cookieName, value: '', options: cookieOptions(config, 0) };
    },

    present(cookieHeader) {
      return (
        cookieHeader !== null &&
        cookieHeader !== undefined &&
        cookieHeader.includes(`${config.cookieName}=`)
      );
    },
  };
}

/**
 * Collapse a decoded cookie into an {@link ImpersonationState}, or refuse it.
 *
 * Two refusals, both security-critical:
 *
 * 1. NO RESOLVABLE USER ID for the real human. A host may authenticate an
 *    identity that has no row of its own (an env allowlist, a directory-only
 *    admin). Letting such an actor impersonate produces a session whose "real
 *    human" is unrecordable: the trail would name the target and nobody else,
 *    i.e. an action attributable to nobody but the person who did not perform
 *    it.
 *
 * 2. THE COOKIE NAMES SOMEONE ELSE. `realUserId` is baked into the payload at
 *    mint time, so a cookie replayed into a different browser session (a shared
 *    machine, a copied header) is refused rather than elevating whoever happens
 *    to be signed in there. The cookie is httpOnly and authenticated, so this is
 *    defence in depth — but it is one comparison, and the failure it prevents is
 *    "the wrong human gets recorded as the impersonator".
 */
export function toImpersonationState(
  session: ImpersonationSession,
  realUserId: string | null,
): ImpersonationState | null {
  if (!realUserId || session.realUserId !== realUserId) return null;
  const bounds = {
    tenantId: session.tenantId,
    realUserId,
    expiresAt: session.expiresAt,
  };
  if (session.kind === 'operator') {
    return {
      ...bounds,
      kind: session.kind,
      subjectUserId: session.targetUserId,
      allowWrites: session.allowWrites,
      previewRoleName: null,
    };
  }
  const { previewOf } = session;
  return {
    ...bounds,
    kind: session.kind,
    // A member preview substitutes the member, which resolves their real
    // instance assignments for free — the reason a bare role-holder preview
    // shows a populated screen instead of an empty one that reads as a bug.
    subjectUserId: previewOf.as === 'member' ? previewOf.memberUserId : realUserId,
    allowWrites: false,
    previewRoleName: previewOf.as === 'role' ? previewOf.roleName : null,
  };
}
