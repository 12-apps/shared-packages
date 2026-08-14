import type {
  FeatureDef,
  FeatureRegistry,
  ResolvedFeatureDef,
} from './types';

/**
 * Build a feature registry from the host's catalog. Mirrors `@12-apps/rbac`'s
 * `definePermissions`: pass a `const` map so the derived union is a string
 * literal union and an unknown feature key fails typecheck rather than
 * silently resolving to "not entitled" at runtime.
 *
 * A feature key is a wire to a CODE GATE. Plans can only reference keys that
 * already exist here — they can never mint new ones (the same rule `@12-apps/rbac`
 * applies to custom roles composing permissions).
 *
 * @example
 * const FEATURES = defineFeatures({
 *   'webhooks.outbound': { onRevoke: 'disable' },
 *   'exports.bulk':      { onRevoke: 'hide' },
 *   'seats.included':    { kind: 'quota', onRevoke: 'readonly' },
 * } as const);
 *
 * type AppFeature = (typeof FEATURES.list)[number];
 */
export function defineFeatures<const M extends Record<string, FeatureDef>>(
  features: M,
): FeatureRegistry<keyof M & string> {
  type F = keyof M & string;

  const list = Object.keys(features) as F[];
  // An empty catalog is refused HERE, at the only place a registry is built,
  // rather than only where a surface is assembled.
  //
  // "Declare nothing" does not lock the app down — it OPENS it. Every key
  // resolves `not-supported`, the browser snapshot is `{}`, and
  // `withEntitlement` renders a `not-supported` page UNLOCKED on purpose (a
  // stale client must never paywall a page the tenant owns). The backend
  // surface refuses it at assembly, but `createEntitlements` is exported from
  // the package root and is the path ADOPTING.md §4 actually walks an adopter
  // through — so the assertion one layer up was not on the documented way in.
  // Refusing at construction is what makes an empty registry unreachable from
  // every path at once, `resolveEntitlement`/`resolveAll` included.
  if (list.length === 0) {
    throw new Error(
      'defineFeatures: the catalog declares no feature keys. An empty catalog does not ' +
        'gate anything — every key resolves `not-supported`, which the page gate renders ' +
        'UNLOCKED, so it opens every plan-gated page instead of closing one. Declare the ' +
        'keys this build gates on.',
    );
  }
  const set = new Set<string>(list);
  const defs = new Map<string, ResolvedFeatureDef>();

  for (const [key, def] of Object.entries(features) as [F, FeatureDef][]) {
    defs.set(key, {
      kind: def.kind ?? 'boolean',
      onRevoke: def.onRevoke ?? 'hide',
      defaultWhenEntitled: def.defaultWhenEntitled ?? true,
      retainWhenRestricted: def.retainWhenRestricted ?? false,
      description: def.description ?? null,
    });
  }

  return {
    list,
    has(feature: string): feature is F {
      return set.has(feature);
    },
    def(feature: F): ResolvedFeatureDef {
      const def = defs.get(feature);
      if (!def) {
        throw new Error(`Unknown feature: "${String(feature)}"`);
      }
      return def;
    },
  };
}
