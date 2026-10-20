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
}

/** Why a debit card could not be authenticated — a CODE; the caller words it. */
export type ThreeDSFailure =
  | "SDK_UNAVAILABLE"
  | "NOT_SUPPORTED"
  | "REFUSED"
  | "INVALID_DATA"
  | "ERROR";

type ThreeDSOutcome =
  | { ok: true; authenticationId: string; authenticated: boolean }
  | { ok: false; failure: ThreeDSFailure };

/**
 * A Brazilian phone as the SDK's `{ country, area, number }`; null when it
 * cannot be split. PagBank requires at least one MOBILE phone on the request.
 */
function mobileOf(phone: string): PagBankThreeDSRequest["data"]["customer"]["phones"][number] | null {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length < 10 || local.length > 11) return null;
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
  if (result.status === "AUTH_NOT_SUPPORTED") return { ok: false, failure: "NOT_SUPPORTED" };
  if (result.status === "CHANGE_PAYMENT_METHOD") return { ok: false, failure: "REFUSED" };
  return { ok: false, failure: "ERROR" };
}

/** Authenticate a debit card with PagBank's SDK. Never throws. */
export async function authenticatePagBankDebit(input: ThreeDSInput): Promise<ThreeDSOutcome> {
  const request = threeDSRequestOf(input);
  if (!request) return { ok: false, failure: "INVALID_DATA" };
  if (!(await ensurePagBankSdk())) return { ok: false, failure: "SDK_UNAVAILABLE" };
  const sdk = typeof window === "undefined" ? undefined : window.PagSeguro;
  if (!sdk?.setUp || !sdk.authenticate3DS) return { ok: false, failure: "SDK_UNAVAILABLE" };
  try {
    sdk.setUp({ session: input.session, env: input.environment === "PRODUCTION" ? "PROD" : "SANDBOX" });
    return threeDSOutcomeOf(await sdk.authenticate3DS(request));
  } catch {
    // The SDK rejects with `{ detail: { httpStatus, traceId, errorMessages } }`
    // — a bad field or an expired session. Neither can be fixed by the buyer
    // retrying the same card in the same second.
    return { ok: false, failure: "ERROR" };
  }
}
