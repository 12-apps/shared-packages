/**
 * A host that forgets a piece of the closing screens' config fails when it
 * boots, with the piece named — never a blank line or a default on screen.
 */
import { describe, expect, it } from 'vitest';

import { TENANT_COPY_SHAPE } from '../config';
import { TENANT_LIFECYCLE_SCREENS_COPY_SHAPE, validateClosingScreens, validatePlatformArchive } from '../lifecycle/react';
import { TenantConfigError } from '../validate';
import { closingConfig, hostState, platformConfig, withoutKey } from './lifecycle-react-fixtures';

function failure(run: () => void): TenantConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof TenantConfigError) return error;
    throw error;
  }
  throw new Error('expected a TenantConfigError');
}

describe('closing screens config', () => {
  it('accepts a whole config', () => {
    expect(() => validateClosingScreens(closingConfig(hostState()))).not.toThrow();
    expect(() => validatePlatformArchive(platformConfig())).not.toThrow();
  });

  it.each([
    ['statuses.closing'],
    ['refusals.readOnly'],
    ['paths.app'],
    ['paths.api'],
    ['paths.closePage'],
    ['hooks.useClosingView'],
    ['hooks.useReopen'],
    ['hooks.usePin'],
    ['hooks.usePathname'],
    ['components.PinFields'],
    ['components.Link'],
    ['components.Frame'],
    ['components.UndoNote'],
    ['errorAnswer'],
    ['toast'],
    ['shortDay'],
    ['testIdWord'],
    ['nameLocale'],
  ])('names a missing %s', (path) => {
    const error = failure(() => validateClosingScreens(withoutKey(closingConfig(hostState()), path)));
    expect(error.key).toBe(`closingScreens.${path}`);
  });

  it.each([['components.Overlay'], ['components.PinFields'], ['statuses.closableFrom'], ['toast']])(
    'names a missing platform %s',
    (path) => {
      const error = failure(() => validatePlatformArchive(withoutKey(platformConfig(), path)));
      expect(error.key).toBe(`platformArchive.${path}`);
    },
  );

  it('names every missing pack key, the core ones and the screens ones', () => {
    const keys = [...Object.keys(TENANT_COPY_SHAPE), ...Object.keys(TENANT_LIFECYCLE_SCREENS_COPY_SHAPE)];
    for (const key of keys) {
      const error = failure(() => validateClosingScreens(withoutKey(closingConfig(hostState()), `copy.locales.x-hospital.${key}`)));
      expect(error.key).toBe(`closingScreens.copy.locales.x-hospital.${key}`);
    }
  });

  it('refuses a text key that is not text, a sentence that is not a function, and a default locale with no pack', () => {
    const config = closingConfig(hostState());
    const pack = { ...config.copy.locales['x-hospital'], platformCardTitle: '  ', platformArchived: 'not a function' };
    expect(failure(() => validateClosingScreens({ ...config, copy: { ...config.copy, locales: { 'x-hospital': pack } } })).key).toBe(
      'closingScreens.copy.locales.x-hospital.platformCardTitle',
    );
    expect(failure(() => validateClosingScreens({ ...config, copy: { ...config.copy, defaultLocale: 'fr' } })).key).toBe(
      'closingScreens.copy.defaultLocale',
    );
    expect(failure(() => validateClosingScreens({ ...config, components: { ...config.components, Frame: 'section' } })).message).toMatch(
      /React component/u,
    );
  });

  it('keeps the core pack shape as it was: the screens keys are not required by the backend', () => {
    for (const key of Object.keys(TENANT_LIFECYCLE_SCREENS_COPY_SHAPE)) expect(TENANT_COPY_SHAPE).not.toHaveProperty(key);
  });
});
