import { describe, expect, it } from 'vitest';

interface RawGlob {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}

const SOURCES = (import.meta as unknown as RawGlob).glob('../../src/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FORBIDDEN_PREFIXES = [
  'apps/',
  '../apps/',
  '../../apps/',
  '@12-apps/shared-helpers',
  '@12-apps/prisma',
  '@12-apps/auth',
  '@12-apps/jobs',
  '@prisma/client',
  'next',
] as const;

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

describe('@12-apps/shift host boundary', () => {
  it('checks at least one source file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(SOURCES))('%s imports no host infrastructure', (_name, source) => {
    for (const specifier of importsOf(source)) {
      expect(
        FORBIDDEN_PREFIXES.some((prefix) => specifier.startsWith(prefix)),
        `Forbidden host import "${specifier}". Extend ShiftDb instead.`,
      ).toBe(false);
    }
  });
});
