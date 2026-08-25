import { InvalidCredentialsInputError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import { credentialSchemaOf } from '../core/provider';
import type { CredentialFieldSpec, PaymentEnvironment, ProviderName } from '../core/types';

import type { SaveCredentialsInput } from './types';

/**
 * What a credential write is ALLOWED to say — checked on the server, because
 * the browser is not where this decision can be made.
 *
 * The settings surface is the one place a tenant admin writes into the blob
 * that decides which account gets paid and which host gets told about it, and
 * until this existed the body arrived as a cast: a missing `fields` reached
 * `Object.entries(undefined)` and answered 500, an invented `environment` was
 * persisted as a third key beside SANDBOX/PRODUCTION where nothing downstream
 * can read or clear it, the `pattern` an adapter declares was enforced by the
 * form and nowhere else, and any key at all was written through.
 *
 * That last one is the reason this is not merely tidiness. `redirectUrl` and
 * `notificationUrl` are ORDINARY reads off the credential fields — InfinitePay
 * mints its link with `webhook_url: fields['notificationUrl']`, Stripe returns
 * the buyer to `fields['redirectUrl']` — so a body naming those keys pointed a
 * store's payment callbacks and its post-payment redirect at whatever host the
 * caller chose. `stubOutcome` is the same shape of hole one file over, and
 * `__proto__` is a third: the update loop assigns straight onto an object
 * literal.
 *
 * So there are TWO doors, and they are deliberately not the same width:
 *
 *   - {@link parseSaveCredentialsBody} — the UNTRUSTED one, what a request body
 *     goes through. It refuses a host-owned addressing key by name; the schema
 *     rule needs the adapter and so runs one layer down, on the same input.
 *     This is the door a tenant admin can reach, and it is where FUT-694's hole
 *     was. It refuses SETTING such a key, not CLEARING one — see
 *     {@link assertNoHostOwnedWrites}.
 *   - {@link assertSaveCredentialsInput} — the SERVICE one. Same schema rule,
 *     but a caller already inside the server may WRITE a host-owned addressing
 *     key, because for some merchants that is the only way the address can be
 *     supplied at all (see {@link HOST_OWNED_FIELDS}). A host that mounts its
 *     own settings route must run its body through the parser above rather
 *     than handing it to the service raw — that is why the parser is exported.
 *
 * `required` is deliberately NOT enforced here. The browser's own rule
 * (`allRequiredStored`) gates the PROBE rather than the save, and clearing the
 * last required field is how a store DISCONNECTS a provider — refusing an
 * incomplete set would take that away and reject the half-filled form the
 * settings page is designed to let an owner come back to.
 *
 * Hand-written rather than a schema library, for the same reason `setPriorities`
 * and `setFailoverPolicy` next door are: this package ships with no runtime
 * dependencies, and two shape facts do not justify becoming the first.
 */

const ENVIRONMENTS: readonly string[] = ['SANDBOX', 'PRODUCTION'];

/**
 * The two keys the HOST owns rather than the merchant: where a provider should
 * call back, and where a hosted checkout must return the buyer.
 *
 * Normally neither is stored at all — `core/webhook-url.ts` resolves both PER
 * READ, so a moved domain cannot leave a stale address baked into a row. But
 * that resolver answers `null` for any merchant the host cannot address, and
 * for one of them — the PLATFORM's own acquirer connection, which has no tenant
 * storefront and no tenant-addressed webhook route — `null` is the permanent
 * answer. A stored value is the ONLY way the platform's callback address ever
 * reaches the provider, so refusing these keys everywhere would not close a
 * hole, it would delete the subscription webhook path.
 *
 * Hence: refused on the request body (nobody in a browser has any business
 * naming them), accepted from server-side code, and checked there to be an
 * absolute http(s) URL so the value cannot be a `javascript:` or `data:` URI
 * smuggled into a field other code treats as a destination.
 *
 * A stored value is also no longer able to out-rank the resolver: the read-time
 * decorator now stamps over it wherever the host CAN address the merchant, so
 * one written through the pre-FUT-694 hole is inert as well as clearable.
 */
const HOST_OWNED_FIELDS: ReadonlySet<string> = new Set(['notificationUrl', 'redirectUrl']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The untrusted body of `PUT .../providers/[provider]`, as a
 * {@link SaveCredentialsInput} — or a 400-mapped refusal.
 *
 * Top-level keys other than `environment` and `fields` are IGNORED rather than
 * refused, which is what keeps `stub: true` a smuggling attempt that goes
 * nowhere instead of an error telling the caller the key exists. A host-owned
 * addressing key inside `fields` is the opposite: named and refused, because
 * silently dropping it would let a caller believe the redirect they pointed
 * somewhere else had been accepted.
 */
export function parseSaveCredentialsBody(
  provider: ProviderName,
  raw: unknown,
): SaveCredentialsInput {
  const parsed = parseInput(provider, raw);
  assertNoHostOwnedWrites(provider, parsed.fields);
  return parsed;
}

function parseInput(provider: ProviderName, raw: unknown): SaveCredentialsInput {
  if (!isPlainObject(raw)) {
    throw new InvalidCredentialsInputError(provider, 'The request body must be a JSON object');
  }

  const environment = raw['environment'];
  if (typeof environment !== 'string' || !ENVIRONMENTS.includes(environment)) {
    throw new InvalidCredentialsInputError(
      provider,
      '`environment` must be "SANDBOX" or "PRODUCTION"',
      'environment',
    );
  }

  const fields = raw['fields'];
  if (!isPlainObject(fields)) {
    throw new InvalidCredentialsInputError(
      provider,
      '`fields` must be an object mapping credential keys to strings',
      'fields',
    );
  }

  return { environment: environment as PaymentEnvironment, fields: copyFields(provider, fields) };
}

/**
 * The caller's `fields`, rebuilt onto a NULL-prototype object and TRIMMED.
 *
 * `JSON.parse` puts `__proto__` on its result as an ordinary own property, and
 * copying that onto an object literal would hit `Object.prototype`'s setter
 * instead of creating a key — the value would vanish silently, and one loop
 * later `applyFieldUpdates` assigns onto a literal too. With no prototype in
 * the way it stays an ordinary key, which means the schema check below refuses
 * it by name like any other undeclared one, rather than it being quietly
 * dropped by machinery nobody reading this can see.
 *
 * The trim is what makes the server and the form agree. The browser validates
 * `value.trim()` against the adapter's `pattern` and then submits the raw
 * string, so a handle pasted out of WhatsApp as `" $loja "` passed every gate
 * on screen — enabled button, confirmation dialog showing a value whose padding
 * is invisible — and was then refused by a server judging the untrimmed copy,
 * with no field the form could highlight. Normalizing HERE ends the
 * disagreement in the direction that keeps the paste working, and it is what
 * the value was going to be anyway: `infinitepay-http.ts` already trims the
 * handle before every call, so the padding never reached the provider — it only
 * ever sat in the row deciding who gets paid.
 *
 * A value that is nothing but padding therefore trims to `''`, which is the
 * CLEAR half of the write contract. That is the right reading: whitespace is
 * not a credential.
 */
function copyFields(
  provider: ProviderName,
  raw: Record<string, unknown>,
): Record<string, string | undefined> {
  const fields = Object.create(null) as Record<string, string | undefined>;
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    // `undefined` is the PRESERVE half of the write-only contract. JSON cannot
    // carry it (the key is simply omitted), but a host calling the service
    // directly can, and does.
    if (value !== undefined && typeof value !== 'string') {
      throw new InvalidCredentialsInputError(provider, `\`fields.${key}\` must be a string`, key);
    }
    fields[key] = value === undefined ? undefined : value.trim();
  }
  return fields;
}

/**
 * A request body may not SET a host-owned address. It may still CLEAR one.
 *
 * The asymmetry is the whole point, and it is what makes FUT-694 a fix rather
 * than a freeze. Rows written before this check exists can hold a
 * `notificationUrl` a tenant admin chose, and `maskEnvironment` renders only
 * schema keys, so nothing on the settings page says it is there. Refusing the
 * key outright would leave the one request that removes it — `{ notificationUrl:
 * '' }` — answering 400 forever, with direct SQL as the only remediation left.
 * An erase cannot introduce a destination, so it is always allowed.
 */
function assertNoHostOwnedWrites(
  provider: ProviderName,
  fields: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (!isWrite(value) || !HOST_OWNED_FIELDS.has(key)) continue;
    throw new InvalidCredentialsInputError(
      provider,
      `\`${key}\` is set by the deployment, not by this request`,
      key,
    );
  }
}

/** The value semantics a save carries: omitted preserves, `''` clears. */
function isWrite(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * A host-owned address has to be an absolute http(s) URL.
 *
 * Everything downstream treats these as destinations — one becomes PagBank's
 * `notification_urls`, the other the page a paid shopper is sent to — so a
 * `javascript:` or `data:` value is the one shape that turns a settings write
 * into something other than a settings write.
 */
function assertAbsoluteHttpUrl(provider: ProviderName, key: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidCredentialsInputError(provider, `\`${key}\` must be an absolute URL`, key);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidCredentialsInputError(provider, `\`${key}\` must be an http(s) URL`, key);
  }
}

/**
 * Every key the caller WRITES must be one the adapter DECLARES, and every value
 * it writes must be the shape that adapter declared for it.
 *
 * Clearing comes FIRST, and applies to any key at all. A row that predates this
 * check can hold a key no schema declares — that is exactly what FUT-694 closed
 * the door on, and closing it does nothing for the rows already through — so
 * `{ notificationUrl: '' }` has to keep working or a planted field could never
 * be removed through the settings service by anyone. Blocking new writes while
 * making the existing ones permanent is the one outcome worse than the hole.
 *
 * The value is checked as it will be STORED: `copyFields` has already trimmed
 * it, so what passes the pattern is what lands in the row.
 */
export function assertFieldsMatchSchema(
  provider: ProviderName,
  schema: readonly CredentialFieldSpec[],
  fields: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    // Preserve and clear are always allowed — neither can introduce a value.
    if (!isWrite(value)) continue;
    const spec = schema.find((field) => field.key === key);
    if (!spec) {
      const declared = schema.map((field) => field.key).join(', ');
      throw new InvalidCredentialsInputError(
        provider,
        `\`${key}\` is not a credential of ${provider}` +
          (declared ? `; it accepts ${declared}` : ''),
        key,
      );
    }
    if (!spec.pattern) continue;
    if (!new RegExp(spec.pattern).test(value)) {
      throw new InvalidCredentialsInputError(
        provider,
        `\`${key}\` (${spec.label}) is not in the format ${provider} requires`,
        key,
      );
    }
  }
}

/**
 * The whole check for a caller that reaches the settings service directly
 * rather than through the HTTP surface, and the NORMALIZED input it should
 * write — re-parsing a body the handler already parsed costs nothing measurable
 * and is what makes the service, not one route, the place this contract holds.
 *
 * Wider than {@link parseSaveCredentialsBody} by exactly the host-owned
 * addressing keys. In-process callers are the only ones that can know those
 * values (`savePlatformCredentials` in the host stamps the platform's own
 * billing callback on every save, because no read-time resolver can address the
 * platform merchant), and a request body reaching here without going through
 * the parser first is a host bug, not a contract this can express.
 */
export function assertSaveCredentialsInput(
  adapter: PaymentProviderAdapter,
  input: SaveCredentialsInput,
): SaveCredentialsInput {
  const parsed = parseInput(adapter.name, input);
  // The host-owned addresses are checked as URLs and taken OUT of what the
  // schema rule sees; everything left is a credential and is judged as one.
  // Splitting them here rather than inside `assertFieldsMatchSchema` keeps that
  // exported helper strict, so a host guarding its own route with it refuses
  // the same bodies `parseSaveCredentialsBody` does.
  const credentials = Object.create(null) as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(parsed.fields)) {
    if (HOST_OWNED_FIELDS.has(key) && isWrite(value)) {
      assertAbsoluteHttpUrl(adapter.name, key, value);
      continue;
    }
    credentials[key] = value;
  }
  assertFieldsMatchSchema(adapter.name, credentialSchemaOf(adapter), credentials);
  return parsed;
}
