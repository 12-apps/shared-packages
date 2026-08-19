import type { EmailCredentials } from "../email-credentials";
import type { EmailAuthRefusal } from "../email-credentials/types";

import { EMAIL_AUTH_STATUS, type EmailAuthMessages } from "./messages";

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
  /** What each refusal SAYS. `PT_BR_MESSAGES` ships in the box. */
  messages: EmailAuthMessages;
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

/** A refusal, as the wire sees it. */
function refusal(refusalResult: EmailAuthRefusal, messages: EmailAuthMessages): EmailAuthResponse {
  const { reason, violations } = refusalResult;
  const detail = violations && violations.length > 0 ? ` ${violations.join(" ")}` : "";
  return {
    status: EMAIL_AUTH_STATUS[reason],
    body: {
      error: `${messages[reason]}${detail}`,
      reason,
      ...(violations && violations.length > 0 ? { violations } : {}),
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

function optionalStr(body: unknown, key: string): string | undefined {
  const value = fields(body)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
  const refuse = (r: EmailAuthRefusal): EmailAuthResponse => refusal(r, messages);

  return [
    {
      method: "POST",
      path: "/signup",
      handle: async ({ body }) => {
        const email = str(body, "email");
        const name = optionalStr(body, "name");
        const result = await credentials.signUp({ email, password: str(body, "password"), name });
        if (!result.ok) return refuse(result);
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
      handle: async ({ body }) => {
        const result = await credentials.verifyEmail(str(body, "token"));
        return result.ok ? ok(null) : refuse(result);
      },
    },
    {
      method: "POST",
      path: "/resend-verification",
      handle: async ({ body }) => {
        const result = await credentials.resendVerification(str(body, "email"));
        return result.ok ? ok(null) : refuse(result);
      },
    },
    {
      method: "POST",
      path: "/forgot-password",
      handle: async ({ body }) => {
        const result = await credentials.requestPasswordReset(str(body, "email"));
        return result.ok ? ok(null) : refuse(result);
      },
    },
    {
      method: "POST",
      path: "/reset-password",
      handle: async ({ body }) => {
        const result = await credentials.resetPassword(str(body, "token"), str(body, "password"));
        return result.ok ? ok(null) : refuse(result);
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
      handle: async ({ body, userId }) => {
        const result = await credentials.setPassword({
          userId: userId as string,
          password: str(body, "password"),
          currentPassword: optionalStr(body, "currentPassword"),
        });
        return result.ok ? ok(null) : refuse(result);
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
