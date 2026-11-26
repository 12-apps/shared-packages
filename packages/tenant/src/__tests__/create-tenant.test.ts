import { describe, expect, it } from 'vitest';

import { TENANT_COPY_KEYS, type TENANT_COPY_SHAPE, type TenantCopyKey, type TenantCopyPack } from '../config';
import { TenantConfigError } from '../index';
import { TENANT_PORT_METHODS } from '../port';
import { createWebTenant } from '../react';
import { createApiTenant } from '../server';
import { coreConfig, leafPaths, serverConfig, withValue, type FakeTx, type PortCall } from './fixtures';

/**
 * Both factories validate the WHOLE config at startup: a missing or bad piece
 * throws a TenantConfigError naming its dotted key, never a default.
 */

function errorOf(run: () => unknown): TenantConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof TenantConfigError) return error;
    throw error;
  }
  throw new Error('expected a TenantConfigError, nothing was thrown');
}

const api = (config: unknown) => () => createApiTenant(config as never);
const web = (config: unknown) => () => createWebTenant(config as never);

describe('createApiTenant', () => {
  it('returns the config data, the port, no routes yet and the readings', () => {
    const config = serverConfig();
    const tenant = createApiTenant(config);
    expect(tenant.config.statuses).toEqual(config.statuses);
    expect(tenant.config.ids).toEqual(config.ids);
    expect(tenant.config.copy.locales['pt-BR']?.noticeDayBody).toBe(config.copy.locales['pt-BR']?.noticeDayBody);
    expect(tenant.config).not.toHaveProperty('port');
    expect(tenant.port).toBe(config.port);
    expect(tenant.routes).toEqual([]);
  });

  it('deep-freezes a copy of the data, and never freezes the host objects', () => {
    const config = serverConfig();
    const tenant = createApiTenant(config);
    for (const part of [
      tenant.config,
      tenant.config.statuses,
      tenant.config.statuses.all,
      tenant.config.statuses.closableFrom,
      tenant.config.ids.refusals,
      tenant.config.copy.locales,
      tenant.config.copy.locales['en-GB'],
    ]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
    expect(Object.isFrozen(config.statuses.all)).toBe(false);
    expect(Object.isFrozen(config.port)).toBe(false);
    (config.ids.refusals as { gone: string }).gone = 'CHANGED_LATER';
    expect(tenant.refusalKind('CLINIC_GONE')).toBe('gone');
    expect(tenant.config.ids.refusals.gone).toBe('CLINIC_GONE');
  });

  it.each(leafPaths(serverConfig()).map((path) => [path.join('.'), path] as const))(
    'names "%s" when it is missing',
    (key, path) => {
      const error = errorOf(api(withValue(serverConfig(), path, undefined)));
      expect(error.key).toBe(key);
      expect(error.message).toMatch(/is required and missing\.$/u);
    },
  );

  it.each(TENANT_PORT_METHODS)('refuses a port.%s that is not a function', (method) => {
    const error = errorOf(api(withValue(serverConfig(), ['port', method], 'nope')));
    expect(error.key).toBe(`port.${method}`);
    expect(error.message).toContain('must be a function');
  });

  it('refuses a missing port, and a missing config, by name', () => {
    expect(errorOf(api(withValue(serverConfig(), ['port'], undefined))).key).toBe('port');
    expect(errorOf(api(undefined)).key).toBe('config');
  });
});

describe('createWebTenant', () => {
  it('takes no port and validates the same shared half', () => {
    const config = coreConfig();
    const tenant = createWebTenant(config);
    expect(tenant.config.statuses).toEqual(config.statuses);
    expect(Object.isFrozen(tenant.config.copy.locales['pt-BR'])).toBe(true);
    expect(errorOf(web(withValue(coreConfig(), ['ids', 'refusals', 'gone'], undefined))).key).toBe(
      'ids.refusals.gone',
    );
  });

  it.each(leafPaths(coreConfig()).map((path) => [path.join('.'), path] as const))(
    'names "%s" when it is missing',
    (key, path) => {
      expect(errorOf(web(withValue(coreConfig(), path, undefined))).key).toBe(key);
    },
  );
});

describe('the status set', () => {
  it('refuses an empty set, a repeated status, and a role the set does not list', () => {
    expect(errorOf(web(withValue(coreConfig(), ['statuses', 'all'], []))).message).toContain('non-empty array');
    expect(
      errorOf(web(withValue(coreConfig(), ['statuses', 'all'], ['OPEN', 'WINDING_DOWN', 'SHUT', 'OPEN']))).key,
    ).toBe('statuses.all[3]');
    const unknown = errorOf(web(withValue(coreConfig(), ['statuses', 'closed'], 'GONE')));
    expect(unknown.key).toBe('statuses.closed');
    expect(unknown.message).toContain('statuses.all does not list');
  });

  it('refuses two lifecycle roles on one status', () => {
    const error = errorOf(web(withValue(coreConfig(), ['statuses', 'closed'], 'WINDING_DOWN')));
    expect(error.key).toBe('statuses.closed');
    expect(error.message).toContain('statuses.closing');
  });

  it('acts only on the lifecycle statuses and closableFrom, whatever else the host has', () => {
    const tenant = createWebTenant(coreConfig());
    expect(['OPEN', 'WINDING_DOWN', 'SHUT', 'ON_HOLD'].every((s) => tenant.isLifecycleStatus(s))).toBe(true);
    expect(tenant.isLifecycleStatus('AWAITING_REVIEW')).toBe(false);
    expect(tenant.isClosableFrom('ON_HOLD')).toBe(true);
    expect(tenant.isClosableFrom('OPEN')).toBe(true);
    expect(tenant.isClosableFrom('AWAITING_REVIEW')).toBe(false);
    expect(tenant.isClosableFrom('WINDING_DOWN')).toBe(false);
  });

  it('refuses a closableFrom that is empty, unlisted, or names closing or closed', () => {
    expect(errorOf(web(withValue(coreConfig(), ['statuses', 'closableFrom'], []))).message).toContain(
      'non-empty array',
    );
    expect(errorOf(web(withValue(coreConfig(), ['statuses', 'closableFrom'], ['OPEN', 'GONE']))).message).toContain(
      'statuses.all does not list',
    );
    for (const status of ['WINDING_DOWN', 'SHUT']) {
      const error = errorOf(web(withValue(coreConfig(), ['statuses', 'closableFrom'], ['OPEN', status])));
      expect(error.key).toBe('statuses.closableFrom');
      expect(error.message).toContain('cannot start from');
    }
  });
});

describe('the transaction-bound port', () => {
  it("moves the status on the caller's transaction, and reads on it", async () => {
    const calls: PortCall[] = [];
    const tenant = createApiTenant(serverConfig(calls));
    const tx: FakeTx = { label: 'the close transaction' };
    expect(await tenant.setStatusIf('t-1', 'OPEN', 'WINDING_DOWN', tx)).toBe(true);
    expect(await tenant.setStatusIf('t-1', 'OPEN', 'WINDING_DOWN', tx)).toBe(false);
    expect(await tenant.byId('t-1', tx)).toMatchObject({ status: 'WINDING_DOWN' });
    expect(calls).toEqual([
      ['setStatusIf', 't-1', 'OPEN', 'WINDING_DOWN', tx],
      ['setStatusIf', 't-1', 'OPEN', 'WINDING_DOWN', tx],
      ['byId', 't-1', tx],
    ]);
    expect(calls.every((call) => call[call.length - 1] === tx)).toBe(true);
  });

  it('reads without a transaction when none is given', async () => {
    const calls: PortCall[] = [];
    await createApiTenant(serverConfig(calls)).byId('t-1');
    expect(calls).toEqual([['byId', 't-1', undefined]]);
  });

  it('refuses a move naming a status outside the set, and never reaches the port', async () => {
    const calls: PortCall[] = [];
    const tenant = createApiTenant(serverConfig(calls));
    const tx: FakeTx = { label: 'tx' };
    await expect(tenant.setStatusIf('t-1', 'OPEN', 'ARCHIVED' as never, tx)).rejects.toThrow(RangeError);
    await expect(tenant.setStatusIf('t-1', 'LIVE' as never, 'SHUT', tx)).rejects.toThrow(/"from" is "LIVE"/u);
    expect(calls).toEqual([]);
  });
});

describe('the ids', () => {
  it('refuses an empty id and two acts sharing one id', () => {
    expect(errorOf(web(withValue(coreConfig(), ['ids', 'permissions', 'close'], '  '))).message).toContain(
      'non-empty string',
    );
    const shared = errorOf(web(withValue(coreConfig(), ['ids', 'audit', 'closePurged'], 'clinic_close.scheduled')));
    expect(shared.key).toBe('ids.audit.closePurged');
    expect(shared.message).toContain('ids.audit.closeScheduled');
  });

  it("maps the host's own refusal codes back to their kind", () => {
    const tenant = createApiTenant(serverConfig());
    expect(tenant.refusalKind('CLINIC_GONE')).toBe('gone');
    expect(tenant.refusalKind('CLINIC_READ_ONLY')).toBe('readOnly');
    expect(tenant.refusalKind('SOMETHING_ELSE')).toBeNull();
  });
});

// The shape the validator reads and the pack type a host writes name the same
// keys, and agree on which are plain text: `tsc` fails this file otherwise.
type TextKeys = { [K in TenantCopyKey]: (typeof TENANT_COPY_SHAPE)[K] extends 'text' ? K : never }[TenantCopyKey];
type StringKeys = { [K in keyof TenantCopyPack]: TenantCopyPack[K] extends string ? K : never }[keyof TenantCopyPack];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const SHAPE_MATCHES_PACK: Same<TenantCopyKey, keyof TenantCopyPack> & Same<TextKeys, StringKeys> = true;

describe('the copy packs', () => {
  it('validates exactly the keys the pack type declares', () => {
    expect(SHAPE_MATCHES_PACK).toBe(true);
  });

  it('ships no copy: every key of every locale is the host’s', () => {
    expect(TENANT_COPY_KEYS.length).toBeGreaterThan(0);
    const error = errorOf(web(withValue(coreConfig(), ['copy', 'locales', 'pt-BR', 'closeExplain'], undefined)));
    expect(error.key).toBe('copy.locales.pt-BR.closeExplain');
  });

  it('refuses a sentence key given as a plain string, and a text key given as a function', () => {
    const sentence = errorOf(web(withValue(coreConfig(), ['copy', 'locales', 'pt-BR', 'refusalBlocked'], 'Blocked.')));
    expect(sentence.key).toBe('copy.locales.pt-BR.refusalBlocked');
    expect(sentence.message).toContain('must be a function');
    const text = errorOf(web(withValue(coreConfig(), ['copy', 'locales', 'pt-BR', 'refusalPurged'], () => 'Gone.')));
    expect(text.key).toBe('copy.locales.pt-BR.refusalPurged');
    expect(text.message).toContain('non-empty string');
  });

  it("lets the host's sentence take its values: a count, a name, a day", () => {
    const pack = createWebTenant(coreConfig()).copyFor('pt-BR');
    expect(pack.refusalBlocked(2)).toBe('pt-BR: refusalBlocked(2).');
    expect(pack.blocker('open-visits', 3)).toBe('pt-BR: blocker(open-visits, 3).');
    expect(pack.noticeScheduledBody('North', '19/12/2026')).toBe('pt-BR: noticeScheduledBody(North, 19/12/2026).');
  });

  it('refuses no locale at all, and a default locale with no pack', () => {
    expect(errorOf(web(withValue(coreConfig(), ['copy', 'locales'], {}))).key).toBe('copy.locales');
    const error = errorOf(web(withValue(coreConfig(), ['copy', 'defaultLocale'], 'fr-FR')));
    expect(error.key).toBe('copy.defaultLocale');
  });

  it('answers the asked locale, else the default one', () => {
    const tenant = createWebTenant(coreConfig());
    expect(tenant.copyFor('pt-BR').closeTitle).toBe('pt-BR: closeTitle.');
    expect(tenant.copyFor('de-DE').closeTitle).toBe('en-GB: closeTitle.');
    expect(tenant.copyFor(null).closeTitle).toBe('en-GB: closeTitle.');
    expect(tenant.copyFor('toString').closeTitle).toBe('en-GB: closeTitle.');
  });
});
