import { describe, expect, it } from 'vitest';

import { TENANT_COPY_KEYS } from '../config';
import { TenantConfigError } from '../index';
import { TENANT_PORT_METHODS } from '../port';
import { createWebTenant } from '../react';
import { createApiTenant } from '../server';
import { coreConfig, leafPaths, serverConfig, withValue } from './fixtures';

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
  it('returns the frozen config, the port, no routes yet and the readings', () => {
    const config = serverConfig();
    const tenant = createApiTenant(config);
    expect(tenant.config).toEqual(config);
    expect(Object.isFrozen(tenant.config)).toBe(true);
    expect(tenant.port).toBe(config.port);
    expect(tenant.routes).toEqual([]);
  });

  it.each(leafPaths(serverConfig()).map((path) => [path.join('.'), path] as const))(
    'names "%s" when it is missing',
    (key, path) => {
      const error = errorOf(api(withValue(serverConfig(), path, undefined)));
      expect(error.key).toBe(key);
      expect(error.message).toBe(`@12-apps/tenant: config "${error.key}" is required and missing.`);
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
    const tenant = createWebTenant(coreConfig());
    expect(tenant.config).toEqual(coreConfig());
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

  it('acts only on the three lifecycle statuses, whatever else the host has', () => {
    const tenant = createWebTenant(coreConfig());
    expect(['OPEN', 'WINDING_DOWN', 'SHUT'].every((s) => tenant.isLifecycleStatus(s))).toBe(true);
    expect(tenant.isLifecycleStatus('ON_HOLD')).toBe(false);
    expect(tenant.isLifecycleStatus('AWAITING_REVIEW')).toBe(false);
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

describe('the copy packs', () => {
  it('ships no copy: every key of every locale is the host’s', () => {
    expect(TENANT_COPY_KEYS.length).toBeGreaterThan(0);
    const error = errorOf(web(withValue(coreConfig(), ['copy', 'locales', 'pt-BR', 'closeWarning'], undefined)));
    expect(error.key).toBe('copy.locales.pt-BR.closeWarning');
  });

  it('refuses no locale at all, and a default locale with no pack', () => {
    expect(errorOf(web(withValue(coreConfig(), ['copy', 'locales'], {}))).key).toBe('copy.locales');
    const error = errorOf(web(withValue(coreConfig(), ['copy', 'defaultLocale'], 'fr-FR')));
    expect(error.key).toBe('copy.defaultLocale');
  });

  it('answers the asked locale, else the default one', () => {
    const tenant = createWebTenant(coreConfig());
    expect(tenant.copyFor('pt-BR').closeTitle).toBe('pt-BR: closeTitle sentence.');
    expect(tenant.copyFor('de-DE').closeTitle).toBe('en-GB: closeTitle sentence.');
    expect(tenant.copyFor(null).closeTitle).toBe('en-GB: closeTitle sentence.');
    expect(tenant.copyFor('toString').closeTitle).toBe('en-GB: closeTitle sentence.');
  });
});
