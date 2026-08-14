/**
 * THE test vocabulary — one value, in a domain this package was not extracted
 * from.
 *
 * The suites around it exercise generic machinery: the writer's attribution
 * rules, the tenancy predicate, the gate, the wire parsing, the adapter. None of
 * that needs a real product's actions, and using one is how a package ends up
 * with a host's nouns in every test name — which is where they were, and where
 * the sweep in `../../__tests__/packed-artifact.test.ts` would not have caught
 * them, because `files` excludes `__tests__`.
 *
 * A lighthouse service: lamps, keepers, a supply run. Chosen for having no word
 * in common with the origin, and pinned as such by the portability suite's
 * fixture check.
 */
import { defineAuditVocabulary } from '../../core/vocabulary';

export const TEST_VOCABULARY = defineAuditVocabulary({
  actions: {
    'lamp.relight': { label: 'Lamp relit' },
    'lamp.extinguish': { label: 'Lamp extinguished' },
    'supply.deliver': { label: 'Supply run delivered' },
    'keeper.assign': { label: 'Keeper assigned' },
  },
  resources: {
    lamp: {
      label: 'Lamp',
      fields: ['lumens', 'state', 'litAt', 'keeperUserId', 'characteristic', 'note'],
    },
    supply: { label: 'Supply run', fields: ['crates', 'vessel', 'landedAt'] },
    keeper: { label: 'Keeper', fields: ['userId', 'watch', 'previousWatch'] },
  },
});

/** An action id no fixture declares — the "unknown value" every suite needs. */
export const UNKNOWN_ACTION = 'lamp.vanish';
/** A resource id no fixture declares. */
export const UNKNOWN_RESOURCE = 'foghorn';
