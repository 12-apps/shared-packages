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
 *   'mcp':             { onRevoke: 'disable' },
 *   'audit':           { onRevoke: 'hide' },
 *   'stock.locations': { kind: 'quota', onRevoke: 'readonly' },
 * } as const);
 *
 * type AppFeature = (typeof FEATURES.list)[number];
 */
export function defineFeatures<const M extends Record<string, FeatureDef>>(
  features: M,
): FeatureRegistry<keyof M & string> {
  type F = keyof M & string;

  const list = Object.keys(features) as F[];
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
