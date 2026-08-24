/**
 * A local mirror of `@12-apps/i18n`'s `assertLocaleParity`.
 *
 * Duplicated ON PURPOSE, and this is the one package where that is not a
 * smell: `payments/no-host-imports` forbids anything under
 * `packages/payments/**` — tests included — from importing a sibling workspace
 * package, because the whole directory has to be liftable into a repo that has
 * never heard of the rest of this one. Importing the shared assertion would
 * make this package's SUITE depend on `@12-apps/i18n`, which is exactly the
 * dependency the rule exists to refuse.
 *
 * It is narrower than the shared one on purpose too — key paths and function
 * arity, which is what a half-finished translation gets wrong. Nothing here
 * ships: the manifest's `files` excludes every `__tests__` directory.
 */

/** Every leaf path in a copy value, with what kind of leaf it is. */
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
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) into.set(path, 'object/empty');
    for (const [key, nested] of entries) {
      describe(nested, path === '' ? key : `${path}.${key}`, into);
    }
    return;
  }
  into.set(path, typeof value);
}

/** The paths that differ between two locales of one pack, as report lines. */
export function localeDrift<T>(pack: { readonly 'pt-BR': T; readonly 'en-US': T }): string[] {
  const reference = new Map<string, string>();
  const candidate = new Map<string, string>();
  describe(pack['pt-BR'], '', reference);
  describe(pack['en-US'], '', candidate);

  return [
    ...[...reference.keys()].filter((path) => !candidate.has(path)).map((p) => `missing in en-US: ${p}`),
    ...[...candidate.keys()].filter((path) => !reference.has(path)).map((p) => `only in en-US: ${p}`),
    ...[...reference.entries()]
      .filter(([path, kind]) => candidate.has(path) && candidate.get(path) !== kind)
      .map(([path, kind]) => `${path}: ${kind} vs ${candidate.get(path)}`),
  ];
}
