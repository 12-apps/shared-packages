/* eslint-disable test-flakiness/no-unmocked-fs -- the installed package's own
   manifest IS the subject: this asserts that every subpath the tarball ADVERTISES
   actually resolves and carries the symbol its consumers import. Every path read
   is inside `node_modules/@12-apps/notifications`. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as core from '@12-apps/notifications';
import * as server from '@12-apps/notifications/server';
import * as hono from '@12-apps/notifications/hono';
import * as webPush from '@12-apps/notifications/web-push';
import * as manifest from '@12-apps/notifications/manifest';
import * as manifestServer from '@12-apps/notifications/manifest/server';

/**
 * Every published subpath, imported from the INSTALLED tarball and touched.
 *
 * This exists because a package can advertise an entry point it does not ship.
 * PR #150 published a dead `./coverage` subpath: a `.gitignore` entry named
 * `coverage` silently kept the folder out of the commit, so `exports` pointed at
 * files the tarball did not contain and nothing failed until a consumer imported
 * it. `files` globs, `exports` keys and `.gitignore` are three lists that have to
 * agree, and no tool in the repo compares them.
 *
 * So the manifest is read for its OWN `exports` keys and every one of them is
 * asserted to be covered here — a new subpath cannot ship untested, and the
 * static imports above are what prove each one resolves and is not empty.
 *
 * `./react` is deliberately NOT in this file: it is JSX against the DOM, and the
 * consumer that proves it is the SPA in `harness/frontend` (page
 * `notifications-center`), which imports it through Vite the way a browser host
 * does. It is listed as covered below so the count still adds up.
 */
const manifestPath = fileURLToPath(
  new URL('../node_modules/@12-apps/notifications/package.json', import.meta.url),
);

/** Subpaths proven elsewhere, with where. */
const COVERED_ELSEWHERE: Record<string, string> = {
  './react': 'harness/frontend — pages/notifications-center.tsx',
  './package.json': 'read by this very test',
};

describe('@12-apps/notifications — every advertised subpath resolves', () => {
  it('covers every `exports` key the tarball advertises', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      exports: Record<string, unknown>;
    };
    const advertised = Object.keys(manifest.exports).sort();
    const proven = [
      ...['.', './server', './hono', './web-push', './manifest', './manifest/server'],
      ...Object.keys(COVERED_ELSEWHERE),
    ].sort();
    expect(advertised).toEqual(proven);
  });

  it('the MANIFEST subpaths carry the wiring declaration a host adopts', () => {
    // The subpath a consumer's `adoptServer` reads, imported from the TARBALL
    // rather than from source — which is the only place the `files` globs,
    // the `exports` keys and `.gitignore` are made to agree.
    expect(manifest.notificationsManifest.name).toBe('@12-apps/notifications');
    expect(manifest.notificationsManifest.contract).toBe(1);
    expect(manifest.notificationsManifest.server).toEqual(['http']);

    // The runtime half, and its wire view: a factory, not data.
    expect(manifestServer.notificationsServerManifest.name).toBe('@12-apps/notifications');
    expect(typeof manifestServer.createWireApiNotifications).toBe('function');
    expect(typeof manifestServer.notificationsServerManifest.http.create).toBe('function');
  });

  it('the ROOT entry carries the framework-free core', () => {
    expect(core.NOTIFICATION_CHANNELS).toEqual(['EMAIL', 'SMS', 'WHATSAPP', 'WEB_PUSH']);
    // No `NOTIFICATION_CATEGORIES`: the preference categories are the HOST's
    // product vocabulary and this package ships none. Asserted as an absence,
    // beside the sets it DOES own — `NOTIFICATION_CHANNELS` is the library's
    // own closed set and stays.
    expect(core).not.toHaveProperty('NOTIFICATION_CATEGORIES');
    // Nor `DEFAULT_NOTIFICATION_MESSAGES`, for the same reason and one release
    // later: it was ~40 sentences of the extraction origin's copy, labelled in
    // its own source as that product's "exact copy", spread UNDER whatever a
    // host passed. Asserted from a REPACKED TARBALL, so this says what npm
    // actually uploads rather than what the working tree happens to contain.
    expect(core).not.toHaveProperty('DEFAULT_NOTIFICATION_MESSAGES');
    // The country is the CALLER's, always: this package assumes none, so a US
    // adopter that forgets it cannot text a Brazilian stranger their customer's
    // order. That makes the second argument required, which is the shape below.
    expect(core.normalizePhoneE164('31999998888', { defaultCountryCode: '55' })).toBe(
      '+5531999998888',
    );
    expect(core.defaultChannelMatrix(['orders']).orders?.EMAIL).toBe(true);
    expect(typeof core.createGeneratorRegistry).toBe('function');
    expect(typeof core.inboxWire).toBe('function');
    expect(core.UnknownNotificationTypeError.name).toBe('UnknownNotificationTypeError');
  });

  it('the SERVER entry carries the factory, the transports and the drivers', () => {
    expect(typeof server.createApiNotifications).toBe('function');
    expect(typeof server.createTransportRegistry).toBe('function');
    expect(Object.keys(server.EMAIL_DRIVERS).sort()).toEqual(['log', 'resend']);
    expect(Object.keys(server.SMS_DRIVERS).sort()).toEqual(['log', 'twilio']);
    expect(Object.keys(server.WHATSAPP_DRIVERS).sort()).toEqual(['log', 'meta']);
    expect(Object.keys(server.WEB_PUSH_DRIVERS).sort()).toEqual(['log', 'vapid']);
    expect(typeof server.formatEmail).toBe('function');
    expect(server.absoluteLink('/x', 'https://a.test')).toBe('https://a.test/x');
  });

  it('the HONO entry carries the mountable router factory', () => {
    expect(typeof hono.notificationsRouter).toBe('function');
  });

  it('the WEB-PUSH entry resolves the optional `web-push` peer and signs', () => {
    // The one subpath that reaches a node-only vendor dependency. It exists
    // separately for exactly that reason, so "does it resolve at all" is the
    // question — a bundle that never mentions web push must never resolve it,
    // and a host that DOES must get a working signer.
    expect(typeof webPush.vapidPushSender).toBe('function');
    const sender = webPush.vapidPushSender({
      subject: 'mailto:ops@harness.test',
      // A real VAPID pair, generated once for this fixture — the signer refuses
      // a partially configured config at construction, which is the point.
      publicKey:
        'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      privateKey: 'wJdKnLBMJPBnDrPCVXbwqPRLoc1LtQmYCXPYm8kZ1cE',
    });
    expect(typeof sender).toBe('function');
    expect(() =>
      webPush.vapidPushSender({ subject: '', publicKey: 'x', privateKey: 'y' }),
    ).toThrow(/needs `subject`/);
  });

  it('does NOT ship its tests or its eslint config', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { files: string[] };
    // A tarball carrying `__tests__` ships the in-memory doubles as if they were
    // API, and one carrying `eslint.config.js` makes every consumer resolve the
    // dev plugins it names.
    expect(manifest.files).toContain('!**/__tests__/**');
    expect(manifest.files).toContain('!eslint.config.js');
    // The assets a host actually needs.
    expect(manifest.files).toContain('prisma');
    expect(manifest.files).toContain('scripts');
  });
});
