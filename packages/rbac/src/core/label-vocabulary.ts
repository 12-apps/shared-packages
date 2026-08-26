/**
 * THE LABEL VOCABULARY A CATALOG COMPOSES — merged per READER, not per mount.
 *
 * Split out of `./compose` because it is the one part of composition that is
 * not decided at composition: every other product of `composePermissions` (the
 * id list, the registry, the governance catalog, the seed rows) is a fact about
 * the host and is fixed the moment the sources are known. The words are not.
 *
 * A host composes its catalog ONCE, at module scope, and shares that object
 * between its API routes and its browser screens — so there is no per-reader
 * composition for a language to hide in. Merging into a static structure would
 * pin every source's words to whatever language that module was first evaluated
 * in, invisibly, because a single-locale host cannot tell the difference.
 */
import { mergeLabelVocabulary, type RbacLabelVocabulary } from './contribution';
import type { PermissionContribution, PermissionSpec } from './contribution';
import { resolveRbacCopy, type RbacCopyResolver } from './copy';

/** One id with its declaration and the source that owns it. */
export interface CatalogEntry {
  id: string;
  spec: PermissionSpec;
  source: string;
}

/**
 * Merge every source's segment words, then layer the per-id overrides on —
 * ONCE PER READER rather than once per composition.
 *
 * The merge itself is unchanged: sources in contribution order, later keys
 * winning, then each spec's whole-id `label` on top. What changed is when it
 * runs. Each source may hand over a resolver, so the answer depends on the
 * locale, and the only honest place to ask is where a label is about to be
 * read. The work is a handful of object spreads over a few dozen keys — the
 * same work the mount used to do at boot, moved rather than multiplied, and the
 * screens memoise the {@link RbacLabels} built from it.
 *
 * A per-id `label` is NOT resolved: it lives on the {@link PermissionSpec},
 * which is mechanism the whole spec type keeps plain (see
 * {@link PermissionContribution.labels}).
 */
export function collectLabels(
  contributions: readonly PermissionContribution<string>[],
  entries: readonly CatalogEntry[],
): RbacCopyResolver<RbacLabelVocabulary> {
  const permissions = Object.fromEntries(
    entries.flatMap((entry) =>
      entry.spec.label === undefined ? [] : [[entry.id, entry.spec.label]],
    ),
  );
  return ({ locale }) => {
    const vocabulary = contributions.reduce<RbacLabelVocabulary>(
      (merged, contribution) =>
        mergeLabelVocabulary(merged, resolveRbacCopy(contribution.labels, locale)),
      {},
    );
    return mergeLabelVocabulary(vocabulary, { permissions });
  };
}

/**
 * The label vocabulary in force, for whoever is reading this render.
 *
 * The accessor rule, on the field the screens use: nothing reads
 * `catalog.labels` directly, because a resolver reached where a value was
 * expected fails at RUNTIME. `locale` absent means "nobody said" — a host with
 * one audience never passes one and gets exactly the words it contributed.
 */
export function labelsOf(
  catalog: { readonly labels: RbacCopyResolver<RbacLabelVocabulary> },
  locale?: string | null,
): RbacLabelVocabulary {
  return catalog.labels({ locale });
}
