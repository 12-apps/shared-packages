import { InvalidCredentialsInputError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
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
 * caller chose. Neither key is in any `credentialSchema`; both are stamped by
 * the host at READ time (`core/webhook-url.ts`) precisely so a moved domain
 * cannot leave a stale address baked into a row. `stubOutcome` is the same
 * shape of hole one file over, and `__proto__` is a third: the update loop
 * assigns straight onto an object literal.
 *
 * So the rule is the adapter's schema, with no allowlist beside it. Every
 * operational key already has a door that is not a tenant-admin request body —
 * the host resolver for the two URLs, the E2E State API (which writes through
 * the config store, deliberately bypassing this service) for the stub script.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The untrusted body of `PUT .../providers/[provider]`, as a
 * {@link SaveCredentialsInput} — or a 400-mapped refusal.
 *
 * Top-level keys other than these two are IGNORED rather than refused, which
 * is what keeps `stub: true` a smuggling attempt that goes nowhere instead of
 * an error telling the caller the key exists.
 */
export function parseSaveCredentialsBody(
  provider: ProviderName,
  raw: unknown,
): SaveCredentialsInput {
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
 * The caller's `fields`, rebuilt onto a NULL-prototype object.
 *
 * `JSON.parse` puts `__proto__` on its result as an ordinary own property, and
 * copying that onto an object literal would hit `Object.prototype`'s setter
 * instead of creating a key — the value would vanish silently, and one loop
 * later `applyFieldUpdates` assigns onto a literal too. With no prototype in
 * the way it stays an ordinary key, which means the schema check below refuses
 * it by name like any other undeclared one, rather than it being quietly
 * dropped by machinery nobody reading this can see.
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
    fields[key] = value;
  }
  return fields;
}

/** The value semantics a save carries: omitted preserves, `''` clears. */
function isWrite(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * Every key the caller named must be one the adapter DECLARES, and every value
 * it writes must be the shape that adapter declared for it.
 *
 * The pattern is checked against the value verbatim — no trimming. The browser
 * trims before testing, and it can afford to: it is looking at what someone is
 * typing. This stores what it validated, so accepting `" $loja "` on the
 * strength of a trimmed copy and then writing the padded one back is how a
 * handle that names nobody ends up on record for the field that decides who
 * gets paid.
 */
export function assertFieldsMatchSchema(
  provider: ProviderName,
  schema: readonly CredentialFieldSpec[],
  fields: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(fields)) {
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
    if (!isWrite(value) || !spec.pattern) continue;
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
 * The whole check, for callers that reach the settings service directly rather
 * than through the HTTP surface. Re-parsing a body the handler already parsed
 * costs nothing measurable and is what makes the service — not one route — the
 * place this contract holds.
 */
export function assertSaveCredentialsInput(
  adapter: PaymentProviderAdapter,
  input: SaveCredentialsInput,
): void {
  const parsed = parseSaveCredentialsBody(adapter.name, input);
  assertFieldsMatchSchema(adapter.name, adapter.credentialSchema, parsed.fields);
}
