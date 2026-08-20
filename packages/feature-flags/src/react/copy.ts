/**
 * Every string the management surface renders — REQUIRED host config, with
 * no defaults (the payments doctrine, FUT-760, enforced repo-wide by the
 * copy-portability gate). A pt-BR host imports
 * `PT_BR_FEATURE_FLAGS_COPY` from `./pt-BR` and passes it by hand — one
 * reviewable line, never a silence.
 */

export interface FeatureFlagsCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly flagsEmpty: string;
  readonly selectPrompt: string;
  readonly grantsEmpty: string;
  readonly loadError: string;
  readonly addEmailLabel: string;
  readonly addNoteLabel: string;
  readonly addSubmit: string;
  readonly adding: string;
  readonly enable: string;
  readonly disable: string;
  readonly revoke: string;
  readonly statusOn: string;
  readonly statusOff: string;
  readonly thUser: string;
  readonly thNote: string;
  readonly thStatus: string;
  readonly thActions: string;
  readonly grantedByPrefix: string;
  readonly prev: string;
  readonly next: string;
  /** Placeholders: `{page}`, `{pages}`, `{total}`. */
  readonly pageOf: string;
  readonly orphansTitle: string;
  readonly orphansHint: string;
  /** Placeholders: `{enabled}`, `{total}`. */
  readonly tally: string;
}

export function formatCopy(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}
