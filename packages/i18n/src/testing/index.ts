/**
 * The assertion every bilingual package's suite makes about its pack.
 *
 * TypeScript already refuses a pack that is MISSING a key — the packs are
 * typed `satisfies LocalePack<XCopy>` against the same interface, so a
 * forgotten sentence is a compile error rather than a test failure. Three
 * things it does not refuse, and all three are the shape of a half-finished
 * translation:
 *
 *  - an OPTIONAL key present in one locale and absent in the other, which
 *    renders as `undefined` for exactly one audience;
 *  - a nested object stubbed as `{}` — structurally assignable when every
 *    field under it is optional;
 *  - an interpolating function whose translation dropped a parameter, so the
 *    fact it was given ("3 selected") stops reaching the sentence.
 *
 * So this walks the actual VALUES and compares key paths and arities across
 * locales. It throws plain `Error`s rather than using a matcher, because it is
 * called from suites in packages that must stay free of a shared dependency —
 * every runner understands a thrown error.
 */
import { LOCALES, type Locale } from '../core/locale';
import { DEFAULT_LOCALE } from '../core/locale';
import type { LocalePack } from '../core/pack';

/** A plain object, as opposed to a function, array or primitive. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every leaf path in a copy value, with what kind of leaf it is.
 *
 * A function's arity rides along in the descriptor (`fn/2`) so a translation
 * that dropped an argument reads as a differing path rather than needing a
 * second pass. Arrays are compared by LENGTH and then by element, because a
 * pack's arrays are fixed tables (a list of bands, a set of steps) rather than
 * data — two locales offering different numbers of them is a defect.
 */
function describe(value: unknown, path: string, into: Map<string, string>): void {
  if (typeof value === 'function') {
    into.set(path, `fn/${value.length}`);
    return;
  }
  if (Array.isArray(value)) {
    into.set(path, `array/${value.length}`);
    value.forEach((item, index) => describe(item, `${path}[${index}]`, into));
    return;
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) into.set(path, 'object/empty');
    for (const [key, nested] of Object.entries(value)) {
      describe(nested, path === '' ? key : `${path}.${key}`, into);
    }
    return;
  }
  into.set(path, typeof value);
}

/** The paths one side has and the other does not, as report lines. */
function missingPaths(expected: Map<string, string>, actual: Map<string, string>): string[] {
  return [...expected.keys()].filter((path) => !actual.has(path));
}

/** The paths both sides have but describe differently, as report lines. */
function divergentPaths(expected: Map<string, string>, actual: Map<string, string>): string[] {
  return [...expected.entries()]
    .filter(([path, kind]) => actual.has(path) && actual.get(path) !== kind)
    .map(([path, kind]) => `${path}: ${kind} vs ${actual.get(path)}`);
}

function report(label: string, lines: readonly string[]): string {
  return lines.length === 0 ? '' : `\n  ${label}:\n    ${lines.join('\n    ')}`;
}

/**
 * That a pack speaks every canonical locale, and speaks them the same way.
 *
 * `name` is the pack's exported identifier and appears in every message — a
 * suite asserting six packs must say WHICH one drifted.
 */
export function assertLocaleParity<T>(name: string, pack: LocalePack<T>): void {
  const keys = Object.keys(pack).sort();
  const canonical = [...LOCALES].sort();
  if (keys.join(',') !== canonical.join(',')) {
    throw new Error(
      `${name}: a locale pack must be keyed by exactly [${canonical.join(', ')}], got [${keys.join(', ')}].`,
    );
  }

  const reference = new Map<string, string>();
  describe(pack[DEFAULT_LOCALE], '', reference);

  for (const locale of LOCALES.filter((entry): entry is Locale => entry !== DEFAULT_LOCALE)) {
    const candidate = new Map<string, string>();
    describe(pack[locale], '', candidate);

    const problems =
      report(`missing in ${locale}`, missingPaths(reference, candidate)) +
      report(`only in ${locale}`, missingPaths(candidate, reference)) +
      report('differing shape', divergentPaths(reference, candidate));

    if (problems !== '') {
      throw new Error(`${name}: ${locale} does not match ${DEFAULT_LOCALE}.${problems}`);
    }
  }
}
