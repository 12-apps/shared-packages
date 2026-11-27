import { brLocalNumber } from "../phone";
import { ensurePagBankSdk } from "./tokenize";

/**
 * PagBank's 3-D Secure, in the buyer's browser (FUT-3754) — the step a DEBIT
 * card charge cannot skip.
 *
 * Per "Criar e pagar com autenticação 3DS do PagBank": the SDK is pointed at a
 * session the SERVER minted with the seller's token (`setUp`), then
 * `authenticate3DS` runs the issuer's check — silently, or with a challenge the
 * SDK draws itself — and answers an `id` that the debit charge carries as
 * `authentication_method: { type: "THREEDS", id }`.
 *
 * What the statuses mean for a DEBIT card, and therefore what this answers:
 *   AUTH_FLOW_COMPLETED    the id may be charged (authenticated or not — the
 *                          issuer decides, PagBank still processes it)
 *   AUTH_NOT_SUPPORTED     "para débito, a transação deve ser finalizada": the
 *                          card cannot be charged as debit here
 *   CHANGE_PAYMENT_METHOD  PagBank refused the authentication outright
 * `REQUIRE_CHALLENGE` is intermediate — the SDK opens the challenge itself when
 * no `beforeChallenge` is given — so it never reaches the caller.
 */

/** The SDK's request, field for field. Only the shape this package sends. */
export interface PagBankThreeDSRequest {
  data: {
    customer: {
      name: string;
      email: string;
      phones: { country: string; area: string; number: string; type: "MOBILE" }[];
    };
    paymentMethod: {
      type: "DEBIT_CARD" | "CREDIT_CARD";
      installments: number;
      card: { encrypted: string };
    };
    amount: { value: number; currency: "BRL" };
    billingAddress: PagBankThreeDSAddress;
    dataOnly: false;
  };
}

export interface PagBankThreeDSAddress {
  street: string;
  number: string;
  complement?: string;
  regionCode: string;
  country: "BRA";
  city: string;
  postalCode: string;
}

export interface PagBankThreeDSResult {
  status: "AUTH_FLOW_COMPLETED" | "AUTH_NOT_SUPPORTED" | "CHANGE_PAYMENT_METHOD" | "REQUIRE_CHALLENGE";
  authenticationStatus?: "AUTHENTICATED" | "NOT_AUTHENTICATED";
  id?: string;
}

/** Everything a debit authentication needs, in this package's own words. */
export interface ThreeDSInput {
  /** From the server's `3ds-session` answer. */
  session: string;
  environment: "SANDBOX" | "PRODUCTION";
  /** The card, already encrypted with the seller's public key. */
  encryptedCard: string;
  amountCents: number;
  customer: { name: string; email: string; phone: string };
  billingAddress: Omit<PagBankThreeDSAddress, "country">;
  /**
   * Give up after this long, answering `ERROR`. Only for a run nobody types
   * into (the homologation's no-challenge test card): a buyer's challenge may
   * honestly take minutes, so the checkout passes none.
   */
  timeoutMs?: number;
}

/** Why a debit card could not be authenticated — a CODE; the caller words it. */
export type ThreeDSFailure =
  | "SDK_UNAVAILABLE"
  | "NOT_SUPPORTED"
  | "REFUSED"
  | "INVALID_DATA"
  | "ERROR";

/**
 * What PagBank said when the authentication did not complete — kept so a
 * caller can REPORT it. Before this, the SDK's rejection was caught and
 * dropped, and a debit that failed for every card left no reason anywhere:
 * not Sentry, not the server, not the evidence page. Never carries card data:
 * only PagBank's own status, codes and messages.
 */
export interface ThreeDSFailureDetail {
  /** The SDK's answered `status` when it answered one (e.g. `AUTH_NOT_SUPPORTED`). */
  sdkStatus?: string;
  /** From a rejection's `detail`: the HTTP status PagBank answered the SDK. */
  httpStatus?: number;
  /** From a rejection's `detail`: PagBank's trace id, what its support asks for. */
  traceId?: string;
  /** From a rejection's `detail`: PagBank's field-level reasons, verbatim. */
  errorMessages?: { code?: string; description?: string; parameterName?: string }[];
  /** The rejection's own message, when it carried no `detail`. */
  message?: string;
  /** The caller's `timeoutMs` passed before the SDK answered. */
  timedOut?: boolean;
}

type ThreeDSOutcome =
  | { ok: true; authenticationId: string; authenticated: boolean }
  | { ok: false; failure: ThreeDSFailure; detail?: ThreeDSFailureDetail };

/**
 * A Brazilian phone as the SDK's `{ country, area, number }`; null when it
 * cannot be split. PagBank requires at least one MOBILE phone on the request.
 */
function mobileOf(phone: string): PagBankThreeDSRequest["data"]["customer"]["phones"][number] | null {
  const local = brLocalNumber(phone);
  if (local === null || local.length < 10 || local.length > 11) return null;
  return { country: "55", area: local.slice(0, 2), number: local.slice(2), type: "MOBILE" };
}

/** The SDK's request, or null when the buyer's data cannot fill it. */
export function threeDSRequestOf(input: ThreeDSInput): PagBankThreeDSRequest | null {
  const mobile = mobileOf(input.customer.phone);
  if (!mobile) return null;
  return {
    data: {
      customer: { name: input.customer.name.trim(), email: input.customer.email.trim(), phones: [mobile] },
      paymentMethod: { type: "DEBIT_CARD", installments: 1, card: { encrypted: input.encryptedCard } },
      amount: { value: input.amountCents, currency: "BRL" },
      billingAddress: {
        ...input.billingAddress,
        postalCode: input.billingAddress.postalCode.replace(/\D/g, ""),
        country: "BRA",
      },
      dataOnly: false,
    },
  };
}

/** What the SDK answered, as this package's outcome. */
export function threeDSOutcomeOf(result: PagBankThreeDSResult): ThreeDSOutcome {
  if (result.status === "AUTH_FLOW_COMPLETED" && result.id) {
    return {
      ok: true,
      authenticationId: result.id,
      authenticated: result.authenticationStatus === "AUTHENTICATED",
    };
  }
  const detail: ThreeDSFailureDetail = { sdkStatus: result.status };
  if (result.status === "AUTH_NOT_SUPPORTED") return { ok: false, failure: "NOT_SUPPORTED", detail };
  if (result.status === "CHANGE_PAYMENT_METHOD") return { ok: false, failure: "REFUSED", detail };
  return { ok: false, failure: "ERROR", detail };
}

/** A string or a number that is not empty, else undefined. */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** PagBank's field-level reasons, keeping only the three documented keys. */
function errorMessagesOf(value: unknown): ThreeDSFailureDetail["errorMessages"] {
  if (!Array.isArray(value)) return undefined;
  const messages = value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      ...(textOf(entry.code) ? { code: textOf(entry.code) } : {}),
      ...(textOf(entry.description) ? { description: textOf(entry.description) } : {}),
      ...(textOf(entry.parameterName ?? entry.parameter_name)
        ? { parameterName: textOf(entry.parameterName ?? entry.parameter_name) }
        : {}),
    }))
    .filter((entry) => Object.keys(entry).length > 0);
  return messages.length > 0 ? messages : undefined;
}

/**
 * What the SDK's rejection says, as {@link ThreeDSFailureDetail}. The SDK
 * rejects with `{ detail: { httpStatus, traceId, errorMessages } }`; anything
 * else keeps only its message.
 */
export function threeDSRejectionDetail(error: unknown, timedOut = false): ThreeDSFailureDetail {
  const record = recordOf(error);
  const inner = recordOf(record.detail);
  const message = error instanceof Error ? error.message : textOf(record.message);
  return {
    ...httpStatusOf(inner),
    ...present("traceId", textOf(inner.traceId ?? inner.trace_id)),
    ...present("errorMessages", errorMessagesOf(inner.errorMessages ?? inner.error_messages)),
    ...present("message", message),
    ...(timedOut ? { timedOut: true } : {}),
  };
}

/** The value as a plain record, or an empty one. */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** `{ [key]: value }` when there is a value, else nothing to spread. */
function present<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** The HTTP status PagBank answered the SDK, when it is a real one. */
function httpStatusOf(inner: Record<string, unknown>): { httpStatus?: number } {
  const httpStatus = Number(inner.httpStatus ?? inner.status);
  return Number.isInteger(httpStatus) && httpStatus > 0 ? { httpStatus } : {};
}

/** The longest {@link threeDSFailureSummary} answers — it travels in a request body. */
const SUMMARY_MAX = 480;

/**
 * One line a person can read and a support ticket can quote:
 * `HTTP 400 · 40002 invalid_parameter (paymentMethod.card) · trace 9f3a…`,
 * `AUTH_NOT_SUPPORTED`, `timed out`. Empty when PagBank said nothing.
 */
export function threeDSFailureSummary(detail: ThreeDSFailureDetail | undefined): string {
  if (!detail) return "";
  const reasons = (detail.errorMessages ?? []).map((reason) =>
    [reason.code, reason.description, reason.parameterName ? `(${reason.parameterName})` : undefined]
      .filter(Boolean)
      .join(" "),
  );
  const parts = [
    detail.sdkStatus,
    detail.httpStatus ? `HTTP ${detail.httpStatus}` : undefined,
    ...reasons,
    detail.timedOut ? "timed out" : undefined,
    !reasons.length && !detail.timedOut ? detail.message : undefined,
    detail.traceId ? `trace ${detail.traceId}` : undefined,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.join(" · ").slice(0, SUMMARY_MAX);
}

/** The rejection {@link withTimeout} raises, so the caller can tell it from PagBank's. */
class ThreeDSTimeoutError extends Error {
  constructor() {
    super("3-D Secure timed out");
    this.name = "ThreeDSTimeoutError";
  }
}

/** The SDK's answer, or a rejection once `ms` have passed (never, without `ms`). */
function withTimeout<T>(pending: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return pending;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ThreeDSTimeoutError()), ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        // Passed through AS IS: the SDK rejects with a plain
        // `{ detail: { httpStatus, traceId, errorMessages } }`, and wrapping it
        // in `new Error(String(error))` turned PagBank's reason into
        // "[object Object]" on every timed run (the homologation's).
        reject(error);
      },
    );
  });
}

/** Authenticate a debit card with PagBank's SDK. Never throws. */
export async function authenticatePagBankDebit(input: ThreeDSInput): Promise<ThreeDSOutcome> {
  const request = threeDSRequestOf(input);
  if (!request) return { ok: false, failure: "INVALID_DATA", detail: { message: "customer.phones: no MOBILE phone" } };
  if (!(await ensurePagBankSdk())) return { ok: false, failure: "SDK_UNAVAILABLE" };
  const sdk = typeof window === "undefined" ? undefined : window.PagSeguro;
  if (!sdk?.setUp || !sdk.authenticate3DS) return { ok: false, failure: "SDK_UNAVAILABLE" };
  try {
    sdk.setUp({ session: input.session, env: input.environment === "PRODUCTION" ? "PROD" : "SANDBOX" });
    return threeDSOutcomeOf(await withTimeout(sdk.authenticate3DS(request), input.timeoutMs));
  } catch (error) {
    // The SDK rejects with `{ detail: { httpStatus, traceId, errorMessages } }`
    // — a bad field or an expired session. Neither can be fixed by the buyer
    // retrying the same card in the same second, but both must be REPORTABLE:
    // dropping them here is what left a debit failing for every card with no
    // reason recorded anywhere.
    return { ok: false, failure: "ERROR", detail: threeDSRejectionDetail(error, error instanceof ThreeDSTimeoutError) };
  }
}
