import type { EmailCredentials } from "../email-credentials";
import type { EmailAuthRefusal } from "../email-credentials/types";
import type { PasswordPolicyViolation } from "../password";

import {
  EMAIL_AUTH_STATUS,
  resolveEmailAuthCopy,
  type EmailAuthCopySource,
  type EmailAuthMessages,
} from "./messages";

/**
 * The e-mail + password endpoints, as framework-neutral descriptors.
 *
 * ## Why these are not eight files in every host
 *
 * They were, and each one was the same four lines: read a JSON body, hand it to
 * the factory, turn a refusal into a status and a sentence, wrap success in an
 * envelope. Nothing in that is a decision a host gets to make differently —
 * the paths are the ones the packaged React client builds, the statuses are
 * fixed (see `EMAIL_AUTH_STATUS`), and the envelope is what that client parses.
 * A host writing them by hand is copying, and copying is how one deployment
 * ends up answering 404 where another answers 200 on the same refusal.
 *
 * What IS the host's: who the caller is, and what language to answer in. Those
 * are the two things {@link EmailAuthRoutesConfig} asks for.
 *
 * ## Why descriptors rather than a router
 *
 * The same reason `@12-apps/report-builder` does it: this file names WHAT the
 * endpoints are, and `../hono` adapts them to the framework we happen to use.
 * A host on another framework writes a twenty-line adapter instead of eight
 * handlers, and `hono` stays an optional peer nobody resolves unless they mount
 * the router.
 */

/** What a handler is given. `userId` is null unless the route required a session. */
export interface EmailAuthRequest {
  body: unknown;
  userId: string | null;
  /**
   * The language to answer this caller in, as a BCP-47 tag — the same field
   * `@12-apps/wiring`'s `WireRequest` carries.
   *
   * Populated by the host's adapter, which is the only layer that can negotiate
   * one. Absent is meaningful and not an error: a host with one audience never
   * sets it, and this package must then answer with the words it was configured
   * with rather than invent a language.
   */
  locale?: string;
}

/** What a handler answers with. `body` rides a `{ data }` envelope on success. */
export interface EmailAuthResponse {
  status: number;
  body: unknown;
}

export interface EmailAuthRoute {
  method: "GET" | "POST" | "PUT";
  /**
   * Path relative to the host's mount, e.g. `/signup`.
   *
   * The SHAPE is fixed rather than configurable, because `createEmailAuth` —
   * the packaged browser client — builds exactly these URLs. A host free to
   * rename them would have a client that could not find them.
   */
  path: string;
  /** True when the caller must be signed in; the adapter answers 401 otherwise. */
  session?: boolean;
  handle(request: EmailAuthRequest): Promise<EmailAuthResponse>;
}

export interface EmailAuthRoutesConfig {
  /** The flow itself, from `createEmailCredentials`. */
  credentials: EmailCredentials;
  /**
   * What each refusal SAYS. `PT_BR_MESSAGES` ships in the box.
   *
   * A host serving more than one language passes a RESOLVER instead of the
   * words — the shape `@12-apps/i18n`'s `localeCopy(PACK)` returns — and the
   * sentence is then chosen per request from {@link EmailAuthRequest.locale}.
   * Passing a plain value is unchanged in every respect, which is what keeps a
   * single-audience host from paying for a choice it never makes.
   */
  messages: EmailAuthCopySource<EmailAuthMessages>;
  /**
   * Called after a sign-up succeeds, with the address and name given.
   *
   * The seam exists for one specific reason: an e-mail sign-up is the moment
   * consent is given, and in most hosts that is a row somewhere this package
   * cannot see. Skipping it left accounts that existed but were not "signed
   * up", which every guard then bounced — the bug FUT-873 found the hard way.
   */
  onSignedUp?: (input: { email: string; name?: string }) => Promise<void> | void;
}

/**
 * A refusal, as the wire sees it.
 *
 * The broken password rules are TRANSLATED here, not passed through.
 * `checkPassword` answers in codes — `too-short`, `needs-number` — which is
 * what keeps the policy free of any language; sending them raw put
 * `too-short` in front of a shopper. The `reason` stays a code, deliberately:
 * the screen branches on it, and a sentence cannot be branched on.
 */
function refusal(refusalResult: EmailAuthRefusal, messages: EmailAuthMessages): EmailAuthResponse {
  const { reason } = refusalResult;
  const violations = (refusalResult.violations ?? []).map(
    (code) => messages.violations[code as PasswordPolicyViolation] ?? code,
  );
  const detail = violations.length > 0 ? ` ${violations.join(" ")}` : "";
  return {
    status: EMAIL_AUTH_STATUS[reason],
    body: {
      error: `${messages[reason]}${detail}`,
      reason,
      ...(violations.length > 0 ? { violations } : {}),
    },
  };
}

/** A success, in the envelope the packaged client parses. */
function ok(data: unknown): EmailAuthResponse {
  return { status: 200, body: { data } };
}

/** Narrow an untrusted body to a record without reaching for `any`. */
function fields(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function str(body: unknown, key: string): string {
  const value = fields(body)[key];
  return typeof value === "string" ? value : "";
}

/**
 * An optional string field, TRIMMED.
 *
 * The trim is not tidiness: `name` reaches a display name, and " Ana " renders
 * with the padding wherever it is shown. Every host that wrote these handlers
 * by hand trimmed it in its own schema, so leaving it here would have made the
 * mount a quiet regression rather than a like-for-like replacement.
 *
 * Whitespace-only therefore collapses to `undefined`, which is the right
 * answer: it is a name nobody typed.
 */
function optionalStr(body: unknown, key: string): string | undefined {
  const value = fields(body)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build the eight descriptors.
 *
 * Validation is deliberately thin here — presence and type, nothing more. The
 * flow itself refuses an implausible address (`invalid-email`) and a weak
 * password (`weak-password`) with reasons the screens already render, so a
 * second schema in front of it would answer the same cases in a different
 * vocabulary and the two would drift.
 */
export function emailAuthRoutes(config: EmailAuthRoutesConfig): EmailAuthRoute[] {
  const { credentials, messages, onSignedUp } = config;
  // Resolved per REFUSAL, not per mount: these routes are built once and the
  // language changes per caller, so a `messages` read here would answer every
  // reader in whichever language the process was started with.
  const refuse = (r: EmailAuthRefusal, locale: string | undefined): EmailAuthResponse =>
    refusal(r, resolveEmailAuthCopy(messages, locale));

  return [
    {
      method: "POST",
      path: "/signup",
      handle: async ({ body, locale }) => {
        const email = str(body, "email");
        const name = optionalStr(body, "name");
        const result = await credentials.signUp({ email, password: str(body, "password"), name });
        if (!result.ok) return refuse(result, locale);
        await onSignedUp?.({ email, name });
        // `user` is deliberately absent: on the `verification-sent` branch there
        // may not be one, and answering with it on the other branch would make
        // the two distinguishable by shape alone.
        return ok({ status: result.status });
      },
    },
    {
      method: "POST",
      path: "/verify",
      handle: async ({ body, locale }) => {
        const result = await credentials.verifyEmail(str(body, "token"));
        return result.ok ? ok(null) : refuse(result, locale);
      },
    },
    {
      method: "POST",
      path: "/resend-verification",
      handle: async ({ body, locale }) => {
        const result = await credentials.resendVerification(str(body, "email"));
        return result.ok ? ok(null) : refuse(result, locale);
      },
    },
    {
      method: "POST",
      path: "/forgot-password",
      handle: async ({ body, locale }) => {
        const result = await credentials.requestPasswordReset(str(body, "email"));
        return result.ok ? ok(null) : refuse(result, locale);
      },
    },
    {
      method: "POST",
      path: "/reset-password",
      handle: async ({ body, locale }) => {
        const result = await credentials.resetPassword(str(body, "token"), str(body, "password"));
        return result.ok ? ok(null) : refuse(result, locale);
      },
    },
    {
      method: "GET",
      path: "/password",
      session: true,
      handle: async ({ userId }) => ok(await credentials.accountSecurity(userId as string)),
    },
    {
      method: "PUT",
      path: "/password",
      session: true,
      handle: async ({ body, userId, locale }) => {
        const result = await credentials.setPassword({
          userId: userId as string,
          password: str(body, "password"),
          currentPassword: optionalStr(body, "currentPassword"),
        });
        return result.ok ? ok(null) : refuse(result, locale);
      },
    },
    {
      method: "GET",
      path: "/settings",
      // Public on purpose: the login screen reads it BEFORE anyone is signed in,
      // to decide whether to render the form at all.
      handle: async () => ok(await credentials.readSettings()),
    },
  ];
}
