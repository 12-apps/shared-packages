import { labelsOf } from '../core/label-vocabulary';
import type { RbacCopyResolver } from '../core/copy';
import type { RbacLabelVocabulary } from '../core/contribution';
import type { TenantRoleSeed } from '../tenant-role-seeds';

import type { RoleRow } from './db';

/**
 * THE WORDS A ROLE IS READ BY, as opposed to the value it is keyed by.
 *
 * A role row carries two strings that look alike and are not. `name` is an
 * IDENTITY: it keys the seeded rows, it is what `validateGrant` decides on, and
 * it is the path segment the override, reset and roster links are built from —
 * translating it would break every one of those. `description` is a SENTENCE,
 * but a sentence stored per tenant, copied in at seed time and replaceable by
 * the tenant, so it is data as much as it is copy.
 *
 * The catalog carries the reader's words for both (`labels.roles`,
 * `labels.roleDescriptions`). This module is the one place that decides which
 * of the two a screen shows for a given row, and it applies the same rule to
 * every layout and to the search and the sort — which is the point of it being
 * one place. Get that rule right in the grid alone and a store owner can still
 * fail to find, by typing the word on their screen, the row that word is on.
 *
 * ## The rule, and the one case that decides its shape
 *
 * A tenant's OWN words always win.
 *
 *  - A CUSTOM role is the tenant's from the start — they named it and wrote its
 *    description — so nothing here touches either field.
 *  - A SYSTEM role starts as a copy of the host's catalog seed. While it is
 *    still that copy, the row is saying what the catalog says, and the catalog
 *    can say it in the reader's language.
 *  - A SYSTEM role whose description the tenant replaced through an override is
 *    no longer the catalog's sentence. It is theirs, in whatever language they
 *    wrote it, and it stays exactly as typed.
 *
 * That third case is why this compares against the SEED rather than simply
 * preferring the localized string. Preferring it unconditionally is a line
 * shorter and silently discards the words a store deliberately wrote — the kind
 * of loss nobody reports as a bug, because the screen looks right.
 */

/** What a row is READ by, beside the `name` it is keyed by. */
export interface RoleDisplayWords {
  /** The role's name in the reader's language, or the raw name. */
  displayName: string;
  /** The sentence this row should read as — the tenant's, or the catalog's. */
  displayDescription: string | null;
}

/** The row fields the rule reads. Structural, so callers pass whole rows. */
export type RoleWordsInput = Pick<RoleRow, 'name' | 'description' | 'kind'>;

/** A seeded row — the only kind the catalog has words for. */
const SYSTEM_KIND = 'SYSTEM';

/** What {@link createRoleDisplay} hands back: one reader's words for one row. */
export type RoleDisplay = (row: RoleWordsInput) => RoleDisplayWords;

/**
 * The display resolver for ONE reader.
 *
 * Built per call rather than per store for the reason every other resolved
 * value in this half is: the store lives for the process, so a vocabulary
 * resolved once would answer every reader in the language the process started
 * in — and a single-locale host cannot tell the difference, which is what makes
 * that mistake survive review.
 */
export function createRoleDisplay(
  catalog: { readonly labels: RbacCopyResolver<RbacLabelVocabulary> },
  seeds: readonly TenantRoleSeed[],
  locale?: string | null,
): RoleDisplay {
  const vocabulary = labelsOf(catalog, locale);
  const seedDescriptions = new Map(seeds.map((seed) => [seed.name, seed.description]));
  return (row) => {
    if (row.kind !== SYSTEM_KIND) {
      // The tenant's own role: their name, their words, in every language.
      return { displayName: row.name, displayDescription: row.description };
    }
    const seeded = seedDescriptions.get(row.name);
    // `??` and not `||`: a seed description of '' is a real value the catalog
    // may have since given words to, and an empty stored description matching
    // it is the untouched state, not a missing one.
    const untouched = seeded !== undefined && (row.description ?? '') === seeded;
    const translated = vocabulary.roleDescriptions?.[row.name];
    return {
      displayName: vocabulary.roles?.[row.name] ?? row.name,
      displayDescription:
        untouched && translated !== undefined ? translated : row.description,
    };
  };
}
