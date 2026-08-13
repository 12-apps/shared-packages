import type { RbacLabelVocabulary } from '../core/contribution';
import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

/**
 * Presentation helpers + catalog grouping for the role screens (12-13). Pure,
 * no React.
 *
 * The DICTIONARIES are not here. A generic package shipping one locale's copy
 * for another application's domain is the same mistake as shipping its
 * catalog: `Produtos`, `Mesas`, `Cozinha`, `Comprador` describe a restaurant,
 * not authorization. They now arrive with the contribution that owns the ids
 * they label, are merged by `composePermissions`, and reach the screens as
 * `catalog.labels` — this file is the composer, and the words this package
 * does own (`Papéis`, `Equipe`) ride in its own contribution beside its ids.
 *
 * The composer's promise is unchanged: a label is built from the permission's
 * colon-separated SEGMENTS, and an unknown segment falls back to its raw text,
 * so a permission nobody has translated still renders (untranslated) rather
 * than vanishing from the picker.
 */

export interface RbacLabels {
  domainLabel(domain: string): string;
  /** A friendly label for a permission's action + scope (domain omitted). */
  permissionActionLabel(permission: string): string;
  /** The label for a role name, or the raw name. */
  roleLabel(role: string): string;
}

/** Sort one permission's segments into the three buckets the label composes. */
function segmentBuckets(
  segments: readonly string[],
  vocabulary: RbacLabelVocabulary,
): { actions: string[]; nouns: string[]; scopes: string[] } {
  const actions: string[] = [];
  const nouns: string[] = [];
  const scopes: string[] = [];
  for (const segment of segments) {
    const action = vocabulary.actions?.[segment];
    const noun = vocabulary.nouns?.[segment];
    const scope = vocabulary.scopes?.[segment];
    if (action !== undefined) actions.push(action);
    else if (noun !== undefined) nouns.push(noun);
    else if (scope !== undefined) scopes.push(scope);
    // Unlabelled: the raw segment, so an untranslated permission still reads.
    else actions.push(segment);
  }
  return { actions, nouns, scopes };
}

export function createRbacLabels(
  vocabulary: RbacLabelVocabulary = {},
): RbacLabels {
  return {
    domainLabel: (domain) => vocabulary.domains?.[domain] ?? domain,
    permissionActionLabel(permission) {
      // A whole-id label (a spec's `label`) wins over segment composition, for
      // the ids whose parts compose into something nobody says out loud.
      const exact = vocabulary.permissions?.[permission];
      if (exact !== undefined) return exact;
      const [, ...rest] = permission.split(':');
      const { actions, nouns, scopes } = segmentBuckets(rest, vocabulary);
      const base = [...actions, ...nouns].join(' ') || permission;
      return scopes.length > 0 ? `${base} (${scopes.join(', ')})` : base;
    },
    roleLabel: (role) => vocabulary.roles?.[role] ?? role,
  };
}

/** A domain bucket of the catalog — the permission picker's layout. */
export interface PermissionGroup {
  domain: string;
  permissions: string[];
}

const domainOf = (permission: string): string => permission.split(':')[0] ?? permission;

/** The catalog grouped by domain — computed from the HOST's registry. */
export function groupPermissions(
  permissions: Pick<PermissionRegistry<string>, 'list'>,
): PermissionGroup[] {
  const byDomain = new Map<string, string[]>();
  for (const permission of permissions.list) {
    const domain = domainOf(permission);
    const bucket = byDomain.get(domain) ?? [];
    bucket.push(permission);
    byDomain.set(domain, bucket);
  }
  return [...byDomain.entries()].map(([domain, list]) => ({ domain, permissions: list }));
}

/** The separation-of-duties counterpart of `permission`, if any. */
export function sodCounterpart(
  governance: Pick<GovernanceCatalog, 'sodPairs'>,
  permission: string,
): string | undefined {
  for (const [a, b] of governance.sodPairs) {
    if (a === permission) return b;
    if (b === permission) return a;
  }
  return undefined;
}
