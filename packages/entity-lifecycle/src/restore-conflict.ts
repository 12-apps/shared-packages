/**
 * Restoring a binned entry whose identity is taken now (FUT-1342): the values
 * a person types, what the host says about the clash, and what
 * `EntityOps.unarchive` is handed.
 */

import type { RecycleBinEntry } from './types';

/**
 * Values a person typed to restore a binned entry under a different identity —
 * a new name, a new code — because the one it had is taken now. Keyed by the
 * host's own field keys ({@link RestoreConflictField.key}); the library only
 * carries them from the bin screen to {@link EntityOps.unarchive}.
 */
export type RestoreOverrides = Readonly<Record<string, string>>;

/**
 * What a bin restore hands `EntityOps.unarchive`: the entry being restored —
 * its snapshot is what the host recorded at deletion — and the values a person
 * typed after a `RestoreConflictError`. A host whose restore can clash throws
 * that error; one that never clashes ignores the request.
 */
export interface RestoreRequest {
  /** The root entry being restored, snapshot included. */
  entry: RecycleBinEntry;
  /** Values typed after a clash; absent on the first try. */
  overrides?: RestoreOverrides;
}

/** One of the two rows a restore clash sets side by side, worded by the host. */
export interface RestoreConflictSide {
  /** "Na lixeira" / "No produto agora". */
  heading: string;
  /** The row's own name. */
  label: string;
  /** One line under it ("Código 0042 · 22 em estoque"). */
  detail: string;
}

/** A value the person may change before restoring again. */
export interface RestoreConflictField {
  /** The override key the retry sends back. */
  key: string;
  label: string;
  /** What the field opens with. */
  value: string;
  /** Why the current value cannot be used, or null when it is free. */
  error: string | null;
  /** True when the field may be left empty. */
  optional: boolean;
}

/**
 * Why a restore was refused, in words the bin screen shows as they are: the
 * library names no rows of anyone's domain, so the host writes every sentence.
 */
export interface RestoreConflict {
  title: string;
  message: string;
  binned: RestoreConflictSide;
  current: RestoreConflictSide;
  fields: readonly RestoreConflictField[];
}
