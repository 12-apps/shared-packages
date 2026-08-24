import { describe, expect, it } from 'vitest';

import { localeCopy, resolveCopy, selectCopy, type LocalePack } from '../core/pack';
import { assertLocaleParity } from '../testing/index';

interface SampleCopy {
  title: string;
  count: (n: number) => string;
  nested: { save: string };
}

const SAMPLE: LocalePack<SampleCopy> = {
  'pt-BR': { title: 'Titulo', count: (n) => `${n} itens`, nested: { save: 'Salvar' } },
  'en-US': { title: 'Title', count: (n) => `${n} items`, nested: { save: 'Save' } },
};

describe('selectCopy', () => {
  it('answers the asked-for locale', () => {
    expect(selectCopy(SAMPLE, 'en-US').title).toBe('Title');
  });

  it('answers the default when asked for nothing', () => {
    expect(selectCopy(SAMPLE).title).toBe('Titulo');
  });
});

describe('a config field that takes either form', () => {
  it('passes a plain value through, so a single-audience host changes nothing', () => {
    expect(resolveCopy(SAMPLE['pt-BR'], { locale: 'en-US' }).title).toBe('Titulo');
  });

  it('calls a resolver with the locale in hand', () => {
    expect(resolveCopy(localeCopy(SAMPLE), { locale: 'en-US' }).title).toBe('Title');
  });
});

/**
 * What a PACKAGE can put in the bag, which is the case these have to survive.
 *
 * A package holds a structural mirror of `CopyResolver` and forwards whatever
 * its transport carried — `WireRequest.locale` is a raw string off the wire,
 * unnarrowed and often absent. Each of these is that value arriving as-is.
 */
describe('localeCopy, given what a package actually has', () => {
  it('matches a raw wire tag rather than trusting it', () => {
    expect(localeCopy(SAMPLE)({ locale: 'en-US' }).title).toBe('Title');
  });

  it('matches a language-only tag to the region this app ships', () => {
    // `?lang=en` and an `Accept-Language` fragment both arrive like this.
    expect(localeCopy(SAMPLE)({ locale: 'en' }).title).toBe('Title');
  });

  it('answers the default for a language this app does not speak', () => {
    // A stale `es-AR` on a user row must not render an empty screen.
    expect(localeCopy(SAMPLE)({ locale: 'es-AR' }).title).toBe('Titulo');
  });

  it('answers the default when the adapter populated nothing', () => {
    // "Nobody told me" — a host with one audience, or a job with no reader.
    expect(localeCopy(SAMPLE)({}).title).toBe('Titulo');
    expect(localeCopy(SAMPLE)({ locale: undefined }).title).toBe('Titulo');
    expect(localeCopy(SAMPLE)({ locale: null }).title).toBe('Titulo');
  });

  it('answers the default for a tag that is only whitespace', () => {
    expect(localeCopy(SAMPLE)({ locale: '   ' }).title).toBe('Titulo');
  });

  it('resolves per CALL, so two readers of one resolver differ', () => {
    // The property the whole seam exists for: a resolver held on a mount that
    // is built once must still answer two languages.
    const resolver = localeCopy(SAMPLE);
    expect(resolver({ locale: 'pt-BR' }).title).toBe('Titulo');
    expect(resolver({ locale: 'en-US' }).title).toBe('Title');
  });
});

/**
 * The assignment the widening exists for, written the way a package writes it.
 *
 * A package cannot import this module, so it declares these two types itself
 * and types its config field with them. If `CopyContext.locale` is ever
 * narrowed back to a required `Locale`, `localeCopy(...)` stops being
 * assignable to `PackageCopySource` under `strictFunctionTypes` and this file
 * fails to COMPILE — which is the point: the failure has to land on whoever
 * narrows it, not on the next package that tries to adopt the seam.
 */
type PackageCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
type PackageCopySource<T> = T | PackageCopyResolver<T>;

describe('the mirror a package declares locally', () => {
  /** Exactly what a package does: hold the source, resolve at the moment of use. */
  function packageResolve<T>(source: PackageCopySource<T>, locale?: string): T {
    return typeof source === 'function' ? (source as PackageCopyResolver<T>)({ locale }) : source;
  }

  it('accepts a host that passes a plain pack — the pre-adoption call, unchanged', () => {
    const configured: PackageCopySource<SampleCopy> = SAMPLE['pt-BR'];
    expect(packageResolve(configured, 'en-US').title).toBe('Titulo');
  });

  it('accepts a host that passes localeCopy(pack), and follows the reader', () => {
    const configured: PackageCopySource<SampleCopy> = localeCopy(SAMPLE);
    expect(packageResolve(configured, 'en-US').title).toBe('Title');
    expect(packageResolve(configured, 'pt-BR').title).toBe('Titulo');
    expect(packageResolve(configured).title).toBe('Titulo');
  });
});

describe('assertLocaleParity', () => {
  it('passes a pack whose locales match', () => {
    expect(() => assertLocaleParity('SAMPLE', SAMPLE)).not.toThrow();
  });

  it('refuses a pack keyed by something other than the canonical tags', () => {
    const wrong = { 'pt-BR': SAMPLE['pt-BR'] } as unknown as LocalePack<SampleCopy>;
    expect(() => assertLocaleParity('SAMPLE', wrong)).toThrow(/keyed by exactly/);
  });

  it('catches an optional key present in one locale only', () => {
    const drifted = {
      'pt-BR': { ...SAMPLE['pt-BR'], extra: 'so aqui' },
      'en-US': SAMPLE['en-US'],
    } as unknown as LocalePack<SampleCopy>;
    expect(() => assertLocaleParity('SAMPLE', drifted)).toThrow(/missing in en-US/);
  });

  it('catches a translation that dropped an interpolated argument', () => {
    const drifted = {
      'pt-BR': SAMPLE['pt-BR'],
      'en-US': { ...SAMPLE['en-US'], count: () => 'items' },
    } as unknown as LocalePack<SampleCopy>;
    expect(() => assertLocaleParity('SAMPLE', drifted)).toThrow(/count: fn\/1 vs fn\/0/);
  });

  it('catches a nested object stubbed empty', () => {
    const drifted = {
      'pt-BR': SAMPLE['pt-BR'],
      'en-US': { ...SAMPLE['en-US'], nested: {} },
    } as unknown as LocalePack<SampleCopy>;
    expect(() => assertLocaleParity('SAMPLE', drifted)).toThrow(/nested\.save/);
  });
});
