import * as Sentry from '@sentry/node';
import Transport from 'winston-transport';

/**
 * Error reporting for the one environment nobody can attach a debugger to.
 *
 * ## Why this exists
 *
 * A production failure used to leave exactly one trace: a line on stdout inside
 * a container, which dies with it and is reachable only over SSH. So the only
 * way to learn WHY a buyer's checkout broke was to reason about the source and
 * guess — and a run of four consecutive wrong diagnoses on FUT-669 is what that
 * costs. The line that would have ended it on the first try (`[payments] order
 * creation failed: the provider returned no hosted-checkout URL`) existed the
 * whole time; nobody could read it.
 *
 * ## Why it hangs off the LOGGER rather than each call site
 *
 * `createFeatureLogger` is already the funnel — every feature's `log.error`
 * goes through one Winston instance, tagged with its `feature`. Attaching here
 * means a new module is covered the moment it logs, with nothing to remember.
 * The alternative (a `captureException` beside every throw) is a rule that
 * decays the first time someone forgets it.
 *
 * ## It is OFF unless a DSN is set
 *
 * No DSN, no transport, no network: dev, CI and every test run stay silent and
 * offline. Enabling is a deployment decision (`SENTRY_DSN` from Doppler), never
 * a code one, which is also what keeps a test suite from filling an issue
 * tracker with its own deliberate failures.
 */

/** Fields we never send, whatever a logger was handed. */
const PII_KEYS = new Set([
  'taxId',
  'tax_id',
  'cpf',
  'document',
  'email',
  'phone',
  'phone_number',
  'buyerEmail',
  'buyerPhone',
  'buyerName',
  'customer',
  'card',
  'token',
  'authorization',
  'password',
  'secret',
]);

/**
 * Strip anything that identifies a BUYER before it leaves the building.
 *
 * Not defensive decoration — the leak it prevents is documented in this repo:
 * `ProviderRequestError` retains the provider's parsed response body, which on
 * a PagBank rejection carries the payer's name, e-mail and CPF. `charge.ts`
 * already stringifies errors (`reason()`) for exactly this reason, and a
 * reporter that re-serialized the object would undo that care on every call
 * site that has not adopted it yet.
 *
 * Redacts by KEY at any depth rather than pattern-matching values: a CPF is
 * eleven digits, and so are plenty of ids worth keeping.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = PII_KEYS.has(key) ? '[redacted]' : scrub(item, depth + 1);
  }
  return out;
}

/** Whether reporting is configured for this process. */
export function sentryEnabled(): boolean {
  return Boolean(process.env['SENTRY_DSN']);
}

/**
 * Start the SDK. Safe to call more than once and a no-op without a DSN, so the
 * caller never has to ask whether reporting is on.
 *
 * Deliberately NOT exported: {@link sentryTransport} is the only way in, which
 * keeps "reporting is initialised" and "reporting is attached to the logger"
 * from becoming two states that can disagree.
 */
function initSentry(): void {
  if (!sentryEnabled() || Sentry.getClient()) return;
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'production',
    release: process.env['SENTRY_RELEASE'],
    // Traces cost money per span and answer a different question (how slow),
    // while this exists to answer "what threw". Opt in per deployment.
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
    // The SDK's own PII switch, held OFF regardless of DSN: it is what decides
    // whether request bodies, cookies and IPs ride along with an event.
    sendDefaultPii: false,
    beforeSend: (event) => scrub(event) as typeof event,
  });
}

/** The shape Winston hands a transport (`info`), narrowed to what we read. */
interface LogInfo {
  level: string;
  message: unknown;
  feature?: string;
  [key: string]: unknown;
}

/**
 * A Winston transport that forwards `error` (and `warn`) to Sentry.
 *
 * The MESSAGE is sent as a string, never the raw meta object: Winston's own
 * formatter runs `util.inspect(…, { depth: 5 })` over extra arguments, so an
 * error object passed as a second argument is precisely how a provider payload
 * would reach a third party. {@link scrub} is the second line of defence, and
 * `beforeSend` a third.
 */
class SentryTransport extends Transport {
  override log(info: LogInfo, next: () => void): void {
    setImmediate(() => this.emit('logged', info));
    // `info.level` arrives COLORIZED (the logger's format includes
    // `winston.format.colorize()`), so it reads as an escape-wrapped `error`
    // rather than a bare one. Matched by SUBSTRING rather than by stripping
    // the escape codes, which keeps a control character out of the source.
    const level = String(info.level);
    const isWarn = level.includes('warn');
    if (!level.includes('error') && !isWarn) return next();
    Sentry.withScope((scope) => {
      if (info.feature) scope.setTag('feature', info.feature);
      scope.setLevel(isWarn ? 'warning' : 'error');
      // A real Error anywhere in the extras gives Sentry a stack to group on;
      // without one an event groups by message alone, which buries distinct
      // failures under a shared prefix.
      const cause = Object.values(info).find((value): value is Error => value instanceof Error);
      if (cause) Sentry.captureException(cause);
      else Sentry.captureMessage(String(info.message));
    });
    next();
  }
}

/** The transport to install, or null when reporting is off. */
export function sentryTransport(): Transport | null {
  if (!sentryEnabled()) return null;
  initSentry();
  return new SentryTransport({ level: 'warn' });
}

/**
 * Wait for queued events to reach Sentry. Call before a deliberate exit.
 *
 * The SDK batches and sends asynchronously, so `log.error(…)` followed by
 * `process.exit(1)` tears the process down with the event still in memory. That
 * silently loses exactly the report worth having most — a process that died on
 * boot leaves nothing else behind, and the crash that killed it is the whole
 * reason anyone would look.
 *
 * A no-op returning `true` when reporting is off, so a caller never has to ask
 * whether it is on. Never throws: a failure to flush must not replace the exit
 * code that describes what actually went wrong.
 */
export async function flushReporter(timeoutMs = 2000): Promise<boolean> {
  if (!sentryEnabled()) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}
