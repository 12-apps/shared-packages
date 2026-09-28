/**
 * FUT-3008 — `density` with no `densityTheme` applies no density at all.
 *
 * app-shell no longer value-imports `densityThemeOptions` from
 * `@12-apps/ui/tokens` (see `theme.eager-imports.test.ts` for that source
 * guard). The implication for `createAppTheme` itself: given `density` but no
 * `densityTheme`, there is nothing to build density WITH, so the factory
 * builds exactly the no-density theme and warns once, in development, naming
 * the option that would have applied it — it does not throw, and it does not
 * reach for the implementation on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ThemeModule = typeof import('../theme');

describe('createAppTheme: density with no densityTheme (FUT-3008)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let createAppTheme: ThemeModule['createAppTheme'];

  // The once-only flag is module state, so every case imports a FRESH module:
  // otherwise whichever case warned first would silence the rest.
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'development');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.resetModules();
    ({ createAppTheme } = await import('../theme'));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('builds exactly the no-density theme, field by field, and warns once naming the missing option', () => {
    const withoutDensityTheme = createAppTheme('light', { density: 'compact' });
    const noDensity = createAppTheme('light');

    expect(withoutDensityTheme.typography.fontSize).toBe(noDensity.typography.fontSize);
    expect(withoutDensityTheme.spacing(1)).toBe(noDensity.spacing(1));
    expect(withoutDensityTheme.fieldHeight).toBe(noDensity.fieldHeight);
    expect(Object.keys(withoutDensityTheme.components ?? {})).toEqual(
      Object.keys(noDensity.components ?? {}),
    );
    // No density implementation ran, so `theme.density` stays unset — same as
    // the no-density path.
    expect(withoutDensityTheme.density).toBeUndefined();

    // The plain `createAppTheme('light')` call above builds the no-density
    // path directly and never touches the warning — it is the `density: 'compact'`
    // call, alone, that is missing `densityTheme` and warns.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/densityTheme/);
  });

  it('warns once however many themes are built without it', () => {
    createAppTheme('light', { density: 'compact' });
    createAppTheme('dark', { density: 'comfortable' });
    createAppTheme('light', { density: 'compact' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    createAppTheme('light', { density: 'compact' });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
