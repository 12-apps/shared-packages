import { isValidCpfOrCnpj, taxIdHasLetters } from './tax-id';
import type { PaymentMethodKind } from './types';

/**
 * BUYER-REQUIREMENTS descriptors (FUT-595) — which `CustomerInfo` fields a
 * provider asks of the buyer, per payment method, and how each one validates.
 *
 * Each provider wants different things: PagBank's `criar-pedido` schema marks
 * `customer.tax_id` (CPF/CNPJ) required and everything else optional;
 * InfinitePay's checkout page demands a phone and has nowhere to put a CPF at
 * all; Stripe wants a tax id only for boleto. `CustomerInfo` used to encode one
 * answer for everyone in its TypeScript optionality — `name`/`email` mandatory
 * though no provider demands them, `taxId`/`phone` optional though they are the
 * two fields a live provider actually requires — so the checkout could only ask
 * the union of everything, or the wrong thing.
 *
 * The declaration therefore moves into the adapter descriptor
 * (`PaymentProviderAdapter.customerSchema`), the same move FUT-557 made for
 * provider identity and `credentialSchema` made for connection forms: the
 * adapter owns the facts, hosts render and validate FROM the declaration, and a
 * new vendor changes nothing outside its own adapter.
 *
 * Three states per field, exactly as the ticket asks:
 *   - REQUIRED   — a spec with `required: true`
 *   - OPTIONAL   — a spec with `required: false` (asked, forwarded when usable)
 *   - NOT ASKED  — no spec for that key (never validated, never blocks)
 *
 * Validation follows the field TYPE, not the adapter: the type names the rule
 * once ({@link validateCustomer}), so "CPF by check digits" cannot drift
 * between providers that both ask for one.
 */

/**
 * Buyer identity an adapter forwards to the provider — whatever the host
 * collected, with EVERY field optional on purpose (FUT-595).
 *
 * Requiredness is NOT encoded here, because it is not one fact: PagBank
 * requires the tax id, InfinitePay a phone, Stripe a tax id only for boleto,
 * and nobody requires name or e-mail. Each adapter declares its own answer in
 * `customerSchema` below, which is the single source of truth: hosts render
 * the buyer form from it, and the gateway validates against it before a
 * charge is attempted. This type merely carries the values; adapters forward
 * what is present and omit what is not.
 */
export interface CustomerInfo {
  name?: string;
  email?: string;
  /**
   * The CPF or CNPJ — a CNPJ may carry letters since July 2026 (FUT-590), so
   * read it with `taxIdCharacters`, never by stripping it to digits. Required
   * only where a schema says so (e.g. PagBank).
   */
  taxId?: string;
  phone?: string;
}

/** The `CustomerInfo` keys a schema may speak about. */
export type CustomerFieldKey = keyof CustomerInfo;

/**
 * Which validation rule a field carries.
 *
 * `CPF` accepts a CNPJ as well **at this API surface**: the underlying `taxId`
 * field is documented as "CPF/CNPJ digits" and every Brazilian provider here
 * forwards either, so a charge raised through the gateway is not refused by us
 * for a document the provider accepts. Both are verified by their own
 * check-digit algorithm. The claim stops at this boundary on purpose — the
 * shipped storefront widgets (`@12-apps/spa-shared`'s `formatCpf`/`validateCpf`,
 * used by the buyer-info and profile forms) mask and validate 11 digits only,
 * so a CNPJ is today reachable through the API/gateway and NOT through the
 * checkout form. FUT-596, which rebuilds that form from this declaration, is
 * where the widget catches up; until then "company card" is an API promise.
 *
 * `PHONE` vs `MOBILE` is a deliberate distinction, not a duplicate:
 *
 *   - `PHONE` mirrors PagBank's payload splitter (`customerPhones`,
 *     pagbank-http.ts, FUT-488) exactly — DDD plus an 8-digit landline or a
 *     9-digit mobile. The splitter forwards either, so validating tighter than
 *     it does would reject a number the wire code would happily send.
 *   - `MOBILE` is the strictly narrower rule (11-digit local, leading `9`) for
 *     providers whose own page insists on a mobile — InfinitePay's checkout
 *     does, and a landline pre-fill there stalls the buyer on the provider's
 *     page, making them type the phone twice.
 *
 * One shared rule cannot express both, and the mismatch is not hypothetical:
 * the same declaration feeds the FUT-596 buyer form.
 */
export type CustomerFieldType = 'NAME' | 'EMAIL' | 'PHONE' | 'MOBILE' | 'CPF';

/**
 * One buyer field a provider asks for. Same shape and spirit as
 * `CredentialFieldSpec`: the library declares WHAT is needed, the host decides
 * how to collect it. No label on purpose — buyer-facing copy is the host's.
 */
export interface CustomerFieldSpec {
  key: CustomerFieldKey;
  /** Which validation rule applies — see {@link validateCustomer}. */
  type: CustomerFieldType;
  /** The provider refuses (or its page stalls) without this field. */
  required: boolean;
  /**
   * Methods this spec applies to; omitted means every method the adapter
   * supports. This is what makes the schema resolvable PER PAYMENT METHOD:
   * Stripe wants a tax id for BOLETO and nothing for CARD, which one flat
   * required/optional flag cannot say. At most one spec per (key, method).
   */
  methods?: readonly PaymentMethodKind[];
  /**
   * `CPF` only: the provider documents a CNPJ of DIGITS only for this field,
   * so an alphanumeric CNPJ (FUT-590) is refused for it here, before anything
   * is sent, rather than cut down to its digits. Stripe's boleto `tax_id` is
   * the one today. The browser's form does not narrow on it: the list asks the
   * document once for every method, and a letter only blocks this one.
   */
  numericOnly?: boolean;
}

export type CustomerSchema = readonly CustomerFieldSpec[];

/**
 * The fields a provider asks for when charging via `method` — the per-method
 * resolution of the declaration. An adapter with no schema asks for nothing:
 * absence and `[]` mean the same thing, so an undeclared adapter can never
 * block a charge on a field nobody agreed to collect.
 */
export function customerFieldsFor(
  schema: CustomerSchema | undefined,
  method: PaymentMethodKind,
): readonly CustomerFieldSpec[] {
  return (schema ?? []).filter((field) => !field.methods || field.methods.includes(method));
}

/** Why one buyer field failed validation against the resolved schema. */
export interface CustomerFieldIssue {
  field: CustomerFieldKey;
  /** MISSING: empty/absent on a required field. INVALID: present but malformed. */
  reason: 'MISSING' | 'INVALID';
  /** Carried so callers can tell a blocking issue from an advisory one. */
  required: boolean;
  /**
   * Why an INVALID value is invalid, when it is not malformed: a valid
   * alphanumeric CNPJ for a provider that documents digits only (FUT-590).
   */
  detail?: 'LETTERS_UNSUPPORTED';
}

const WHITESPACE = /\s/;

/**
 * Shape check only — exactly one `@`, no whitespace, and a domain carrying a
 * dot with something either side. Deliberately not one regex: the natural
 * `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` is quadratic, because `[^\s@]` also matches
 * `.` and so the class either side of the literal dot can claim the same
 * characters. On a non-matching input like `!@` followed by many `!.` the
 * engine walks every split (CodeQL js/polynomial-redos). Scanning for the
 * separators directly is linear and says the same thing.
 */
function hasEmailShape(value: string): boolean {
  if (WHITESPACE.test(value)) return false;
  const at = value.indexOf('@');
  // exactly one `@`, with a non-empty local part
  if (at <= 0 || value.indexOf('@', at + 1) !== -1) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/**
 * Whether a VALID document is still refused for this field: an alphanumeric
 * CNPJ where the provider documents a CNPJ of digits only (`numericOnly`,
 * FUT-590). The check digits themselves are `./tax-id`'s, the one validator.
 */
/** One issue as an operator reads it: `taxId (INVALID: LETTERS_UNSUPPORTED)`. */
export function describeCustomerIssue(issue: CustomerFieldIssue): string {
  return `${issue.field} (${issue.reason}${issue.detail ? `: ${issue.detail}` : ''})`;
}

function lettersRefused(field: CustomerFieldSpec, value: string): boolean {
  return field.type === 'CPF' && field.numericOnly === true && taxIdHasLetters(value);
}

/**
 * The DDD + local part of a Brazilian number, in whatever shape the buyer
 * typed or their phone autofilled it (FUT-3955): `+55 31 99449-4408`,
 * `5531994494408`, `0031…`, `(31) 99449-4408`, a trunk `0` (`031 99449-4408`).
 * `null` when the value cannot be one. A leading `+` or `00` is an explicit
 * country code and must be honoured (a `+1` number is not Brazilian), and
 * 12–13 bare digits cannot be a local number so they must carry one, which
 * keeps DDD 55 (Santa Maria/RS) from being eaten as a duplicate DDI. The one
 * exception is a single trunk `0` before an 11- or 10-digit national number.
 * The PagBank splitter and the InfinitePay payload read the number through
 * this same function.
 */
export function brLocalNumber(value: string): string | null {
  const { digits, international } = withoutPrefixes(value);
  const prefixed = international || digits.length === 12 || digits.length === 13;
  if (!prefixed) return digits;
  return digits.startsWith('55') ? digits.slice(2) : null;
}

/**
 * The digits after an international `00` or `+` (flagged, so the country code
 * is then required), or the national digits once a single trunk `0` before a
 * 10- or 11-digit number is dropped.
 */
function withoutPrefixes(value: string): { digits: string; international: boolean } {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) return { digits: digits.slice(2), international: true };
  if (trimmed.startsWith('+')) return { digits, international: true };
  const trunk = digits.startsWith('0') && (digits.length === 11 || digits.length === 12);
  return { digits: trunk ? digits.slice(1) : digits, international: false };
}

/**
 * `PHONE`: a 2-digit DDD plus an 8-digit landline or a 9-digit mobile —
 * exactly the range {@link brLocalNumber}'s model (and the splitter) forwards.
 * Deliberately NOT the mobile rule: PagBank's splitter sends a landline
 * unchanged, so refusing one here would reject a number the wire code accepts.
 */
function isValidBrPhone(value: string): boolean {
  const local = brLocalNumber(value);
  return local !== null && (local.length === 10 || local.length === 11);
}

/**
 * `MOBILE`: strictly narrower than {@link isValidBrPhone} — 11 digits with the
 * mandatory leading `9` (the "nono dígito"). Declared by providers whose own
 * page demands a mobile (InfinitePay); see the `CustomerFieldType` doc for why
 * this is a separate rule rather than a tightening of `PHONE`.
 */
function isValidBrMobile(value: string): boolean {
  const local = brLocalNumber(value);
  return local !== null && local.length === 11 && local[2] === '9';
}

const VALIDATORS: Record<CustomerFieldType, (value: string) => boolean> = {
  NAME: (value) => value.trim().length > 0,
  EMAIL: (value) => hasEmailShape(value.trim()),
  PHONE: isValidBrPhone,
  MOBILE: isValidBrMobile,
  CPF: isValidCpfOrCnpj,
};

/**
 * Validate what the host collected against the provider's resolved schema.
 *
 * Only fields the provider ASKS FOR are looked at — a field outside the schema
 * is never validated and can never block, which is the property the old
 * hardcoded `CustomerInfo` optionality could not express. An empty value on an
 * optional field is simply "not given" (no issue); on a required field it is
 * MISSING. A present-but-malformed value is INVALID either way, with
 * `required` carried so callers can decide which issues block — see the
 * charge-walk gate in `charge-attempt.ts` for the one place that decision is
 * made server-side.
 */
export function validateCustomer(
  schema: CustomerSchema | undefined,
  method: PaymentMethodKind,
  customer: CustomerInfo,
): CustomerFieldIssue[] {
  const issues: CustomerFieldIssue[] = [];
  for (const field of customerFieldsFor(schema, method)) {
    const value = (customer[field.key] ?? '').trim();
    if (value.length === 0) {
      if (field.required) issues.push({ field: field.key, reason: 'MISSING', required: true });
      continue;
    }
    if (!VALIDATORS[field.type](value)) {
      issues.push({ field: field.key, reason: 'INVALID', required: field.required });
      continue;
    }
    if (lettersRefused(field, value)) {
      issues.push({ field: field.key, reason: 'INVALID', required: field.required, detail: 'LETTERS_UNSUPPORTED' });
    }
  }
  return issues;
}

/**
 * The union of several providers' asked fields for one method — what a
 * checkout should collect UP FRONT when the merchant's enabled chain spans
 * providers with different requirements.
 *
 * This is the documented failover decision (FUT-595): collect the union before
 * the first attempt, rather than re-ask on failover. A charge that fails over
 * mid-payment cannot go back to the buyer for a field nobody collected, so the
 * form asks once for everything any chain member needs; the walk then attempts
 * each provider with what it has, and a provider whose REQUIRED field is still
 * absent is skipped with proof rather than sent a charge it will refuse.
 * `required` is the strictest answer across the chain, and so is the TYPE: see
 * {@link narrowerType}. `methods` scoping is already resolved and dropped.
 */
export function unionCustomerFields(
  schemas: ReadonlyArray<CustomerSchema | undefined>,
  method: PaymentMethodKind,
): CustomerFieldSpec[] {
  const byKey = new Map<CustomerFieldKey, CustomerFieldSpec>();
  for (const field of schemas.flatMap((schema) => customerFieldsFor(schema, method))) {
    const existing = byKey.get(field.key);
    if (!existing) {
      byKey.set(field.key, { key: field.key, type: field.type, required: field.required });
      continue;
    }
    byKey.set(field.key, {
      ...existing,
      type: narrowerType(existing.type, field.type),
      required: existing.required || field.required,
    });
  }
  return [...byKey.values()];
}

/**
 * Which type accepts a SUBSET of the other's values. Only one such pair exists
 * today: `MOBILE` ⊂ `PHONE` (see the `CustomerFieldType` doc).
 *
 * A chain that mixes them must publish the narrower rule, for the same reason
 * `required` takes the strictest answer: the form is filled ONCE, before the
 * first attempt, and a value that satisfies only the laxer member strands the
 * buyer on the stricter one — a landline collected for a PagBank→InfinitePay
 * chain passes here and then stalls on InfinitePay's page, which is the double
 * typing the up-front collection exists to remove. Unrelated types cannot
 * legitimately collide on one key, so the first declaration simply stands.
 */
function narrowerType(a: CustomerFieldType, b: CustomerFieldType): CustomerFieldType {
  if (a === 'PHONE' && b === 'MOBILE') return 'MOBILE';
  return a;
}
