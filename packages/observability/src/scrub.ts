/**
 * Strip anything that identifies a BUYER or an OPERATOR before an event leaves
 * the browser.
 *
 * ## Why this is stricter than the server's copy
 *
 * The server's scrub (FUT-716) guards one known leak: `ProviderRequestError`
 * retains the provider's parsed response body, which on a PagBank rejection
 * carries the payer's name, e-mail and CPF.
 *
 * In the browser the exposure is broader and more ordinary. The storefront IS
 * the checkout screen: the payer's name, e-mail, CPF and card fields live in
 * React state and in the DOM, within reach of any automatic breadcrumb. The
 * admin knows the operator's e-mail from the session. And a URL is itself
 * evidence — `/loja/acme/pedido/abc123` names a store and an order before any
 * payload is considered.
 *
 * So there are two passes here, not one: {@link scrub} for structured values,
 * and {@link scrubUrl} for the strings that arrive as breadcrumbs.
 *
 * Redaction is BY KEY at any depth rather than by matching value shapes. The
 * server's note applies unchanged and is the whole argument: a CPF is eleven
 * digits, and so are plenty of ids worth keeping.
 */

/**
 * Field names never sent, whatever produced them.
 *
 * Lower-cased at comparison time so `taxId`, `tax_id` and `TaxID` are one
 * entry. Adding a name here is cheap; finding a leak in a vendor's UI is not.
 */
const PII_KEYS = new Set([
  "taxid",
  "cpf",
  "cnpj",
  "document",
  "email",
  "phone",
  "phonenumber",
  "buyeremail",
  "buyerphone",
  "buyername",
  "customer",
  "customername",
  "card",
  "cardnumber",
  "cvv",
  "cvc",
  "holder",
  "holdername",
  "token",
  "authorization",
  "password",
  "secret",
  "address",
  "postalcode",
  "zipcode",
  "name",
]);

/** How deep to walk before giving up. Matches the server's ceiling. */
const MAX_DEPTH = 6;

export const REDACTED = "[redacted]";

/** Normalize a key so `tax_id`, `taxId` and `TaxID` all collapse to one entry. */
function normalizeKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

/**
 * Deep-redact by key.
 *
 * Cycles are handled with a `seen` set rather than by depth alone: an event
 * object that references itself is not exotic (a React error carries the fiber
 * tree), and a reporter that stack-overflows while preparing an error report
 * turns one broken page into a broken tab.
 */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = PII_KEYS.has(normalizeKey(key)) ? REDACTED : scrub(item, depth + 1, seen);
  }
  return out;
}

/**
 * Drop the query string and fragment from a URL, keeping the path.
 *
 * The path is what makes an event triageable ("every /checkout crashed"); the
 * query string is where a session token, an e-mail in a `?next=` and a
 * one-time code end up. Keeping the path and discarding the rest is the split
 * that preserves the signal and none of the exposure.
 *
 * Relative URLs and outright junk are handled by the `catch`: a breadcrumb is
 * never worth throwing over.
 */
export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    const origin = url.startsWith("http") ? parsed.origin : "";
    return `${origin}${parsed.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}
