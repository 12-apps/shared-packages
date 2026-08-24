/**
 * `@12-apps/auth` through the CONSUMER, and the one property no journey covers.
 *
 * The package's own Gherkin world drives the sign-in screens in the frontend
 * harness — a real sign-up, the mail this host actually recorded, the link
 * inside it. What none of that can see is the SHAPE of the adoption: which
 * routes the aggregate says need a caller, which mount each of the two
 * manifests claimed, and whether the mailer the flow sends through is the one
 * the binder composed out of this host's delivery port.
 *
 * The first of those is not bookkeeping. Six of the eight sign-in endpoints are
 * anonymous by definition, `kind` defaults to `authenticated`, and a host's
 * gate reads `kind` — so a wire view that stayed silent about it produces a
 * package that mounts cleanly and cannot be signed in to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderWiringReport } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { AUTH_MOUNT_PATH, AUTH_PLATFORM_MOUNT_PATH } from '../src/auth-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

/** The assembled table, as `kind` by `METHOD path`. */
function kinds(): Map<string, string | undefined> {
  return new Map(
    backend.hosts.auth.routes.map((mounted) => [
      `${mounted.route.method} ${mounted.mountPath}${mounted.route.path}`,
      (mounted.route as { kind?: string }).kind,
    ]),
  );
}

describe('the sign-in surface, adopted through @12-apps/wiring', () => {
  it('marks the anonymous endpoints public and the account ones authenticated', () => {
    const table = kinds();

    expect(table.get(`POST ${AUTH_MOUNT_PATH}/signup`)).toBe('public');
    expect(table.get(`POST ${AUTH_MOUNT_PATH}/forgot-password`)).toBe('public');
    expect(table.get(`POST ${AUTH_MOUNT_PATH}/reset-password`)).toBe('public');
    // Read by the LOGIN screen, before anybody is signed in, to decide whether
    // to render the form at all.
    expect(table.get(`GET ${AUTH_MOUNT_PATH}/settings`)).toBe('public');
    // The account's own password card is the pair that genuinely needs a caller.
    expect(table.get(`GET ${AUTH_MOUNT_PATH}/password`)).toBe('authenticated');
    expect(table.get(`PUT ${AUTH_MOUNT_PATH}/password`)).toBe('authenticated');
  });

  it('serves an anonymous sign-up, and refuses the account route to nobody', async () => {
    // The two halves of the mark above, over the real mount. A bridge honouring
    // `kind` — as the contract obliges — would 401 the sign-up too if the wire
    // view stayed silent, and this is that case in the flesh.
    const signUp = await backend.app.request(`${AUTH_MOUNT_PATH}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'wiring@harness.dev', password: 'uma senha boa 42' }),
    });
    expect(signUp.status).toBe(200);

    const card = await backend.app.request(`${AUTH_MOUNT_PATH}/password`);
    expect(card.status).toBe(401);
  });

  it('sends through the mailer the BINDER composed from this host port', async () => {
    // `ports.email` is the host's one delivery port; `email.createMailer` turns
    // it into the package's four semantic sends. The proof is a row in this
    // host's own outbox, written by the recording driver it handed over — with
    // the package's pt-BR pack rendering the words.
    await backend.app.request(`${AUTH_MOUNT_PATH}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mailed@harness.dev', password: 'uma senha boa 42' }),
    });

    const outbox = await backend.app.request('/__harness/auth/mail?email=mailed@harness.dev');
    const { messages } = (await outbox.json()) as { messages: { subject: string; text: string }[] };
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.text).toContain('http');
  });
});

describe('the two manifests, and what the report accounts for', () => {
  it('claims a mount each — one for anybody, one behind the operator gate', () => {
    const mounts = new Set(backend.hosts.auth.routes.map((mounted) => mounted.mountPath));

    expect(mounts).toEqual(new Set([AUTH_MOUNT_PATH, AUTH_PLATFORM_MOUNT_PATH]));
    // The platform pair turns a sign-in method off for EVERYBODY, which is why
    // it is a separate manifest rather than two more rows on the first: a
    // version bump cannot widen the public mount with an operator switch. Both
    // its verbs are session-gated — WHICH sessions may operate the platform is
    // this host's question, asked in front of the mount.
    const platform = backend.hosts.auth.routes.filter(
      (mounted) => mounted.mountPath === AUTH_PLATFORM_MOUNT_PATH,
    );
    expect(platform.map((mounted) => mounted.route.method).sort()).toEqual(['GET', 'PUT']);
    platform.forEach((mounted) => {
      expect((mounted.route as { kind?: string }).kind).toBe('authenticated');
    });
  });

  it('accounts for every capability of both, with none unanswered', () => {
    const byPackage = new Map(
      backend.hosts.auth.report.packages.map((entry) => [entry.packageName, entry]),
    );
    const statusIn = (name: string, kind: string) =>
      byPackage.get(name)?.capabilities.find((entry) => entry.kind === kind)?.status;

    expect(statusIn('@12-apps/auth', 'http')).toBe('bound');
    expect(statusIn('@12-apps/auth', 'email')).toBe('bound');
    expect(statusIn('@12-apps/auth', 'db')).toBe('collected');
    expect(statusIn('@12-apps/auth', 'observability')).toBe('bound');
    // The env answer is the environment this host ACTUALLY runs on, its own
    // AUTH_SECRET default included — an answer that disagreed with the running
    // process would be worse than none.
    expect(statusIn('@12-apps/auth', 'env')).toBe('bound');
    // The world is the web harness's to bind; this host declines in writing.
    expect(statusIn('@12-apps/auth', 'e2e')).toBe('declined');
    expect(statusIn('@12-apps/auth-platform', 'http')).toBe('bound');
    // The web halves are out of scope for a server host, and the report says so
    // rather than going quiet.
    expect(statusIn('@12-apps/auth-platform', 'surface')).toBe('out-of-scope');

    const statuses = backend.hosts.auth.report.packages.flatMap((entry) =>
      entry.capabilities.map((capability) => capability.status),
    );
    expect(statuses).not.toContain('unanswered');
    expect(statuses).not.toContain('unbound');
  });

  it('renders a report naming both mounts', () => {
    const rendered = renderWiringReport(backend.hosts.auth.report);

    expect(rendered).toContain(AUTH_MOUNT_PATH);
    expect(rendered).toContain(AUTH_PLATFORM_MOUNT_PATH);
  });
});
