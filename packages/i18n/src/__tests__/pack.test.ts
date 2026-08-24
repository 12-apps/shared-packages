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
