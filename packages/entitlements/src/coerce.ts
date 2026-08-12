/**
 * Coercion of untrusted JSON columns into the library's map types.
 *
 * A host stores overrides and tenant switches in JSON columns (or a frozen
 * subscription snapshot), and a hand-edited, legacy or frozen-months-ago
 * column is untrusted input: an unknown key would resolve `not-supported`
 * anyway, and a garbage value could otherwise be read as a ceiling. Dropping
 * both is the safe reading — and it is a security rule, not a convenience: a
 * garbage value read as a ceiling is a quota bypass.
 *
 * Lives in the CORE (zero dependencies, no ports) so both the host's resolver
 * and its billing layer can narrow through exactly the same rule. Two copies
 * of "what counts as a valid entitlement value" is how the rule drifts.
 */
import type {
  EntitlementMap,
  EntitlementValue,
  FeatureRegistry,
  SettingsMap,
} from './core/types';

/** A JSON column as a driver hands it back, before anything in it is trusted. */
export type JsonColumn = unknown;

/** Narrow a JSON column to a plain object, or `{}` for null/array/scalar. */
export function asRecord(value: JsonColumn): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Keep only DECLARED feature keys carrying a well-typed value.
 *
 * Note what this means for a stored snapshot: a feature RETIRED from the code
 * catalog since the snapshot was frozen is dropped here rather than honoured.
 * That is the right way round — the host can no longer serve it at all.
 */
export function toEntitlementMap<F extends string>(
  features: FeatureRegistry<F>,
  value: JsonColumn,
): EntitlementMap<F> {
  const raw = asRecord(value);
  const map: EntitlementMap<F> = {};
  for (const feature of features.list) {
    const entry = raw[feature];
    if (
      typeof entry === 'boolean' ||
      typeof entry === 'number' ||
      entry === 'unlimited'
    ) {
      map[feature] = entry as EntitlementValue;
    }
  }
  return map;
}

/** Same, for the boolean-only tenant layer. */
export function toSettingsMap<F extends string>(
  features: FeatureRegistry<F>,
  value: JsonColumn,
): SettingsMap<F> {
  const raw = asRecord(value);
  const map: SettingsMap<F> = {};
  for (const feature of features.list) {
    if (typeof raw[feature] === 'boolean') map[feature] = raw[feature];
  }
  return map;
}
