import type { FeatureFlagsCopy } from "./copy";

/**
 * The en-US pack — a NAMED export a host passes by hand
 * (`copy: EN_US_FEATURE_FLAGS_COPY`), never a default.
 *
 * `{page}`, `{pages}`, `{total}`, `{enabled}` are the package's own
 * substitution tokens and are NOT translated: the surface fills them in, so a
 * renamed token is a sentence that renders its own placeholder. Their ORDER is
 * free — that is the point of naming them — and English puts the tally the
 * other way round from the Portuguese for exactly that reason.
 */
export const EN_US_FEATURE_FLAGS_COPY: FeatureFlagsCopy = {
  title: "Beta features",
  subtitle: "Grant features under test to named users.",
  flagsEmpty: "No beta features in the catalog.",
  selectPrompt: "Pick a feature to manage its testers.",
  grantsEmpty: "No users on this feature.",
  loadError: "Could not load.",
  addEmailLabel: "User e-mail",
  addNoteLabel: "Note (optional)",
  addSubmit: "Grant access",
  adding: "Granting...",
  enable: "Enable",
  disable: "Disable",
  revoke: "Revoke",
  statusOn: "On",
  statusOff: "Off",
  thUser: "User",
  thNote: "Note",
  thStatus: "Status",
  thActions: "Actions",
  grantedByPrefix: "granted by",
  prev: "Previous",
  next: "Next",
  pageOf: "Page {page} of {pages} — {total} grants",
  orphansTitle: "Orphaned grants",
  orphansHint:
    "Grants for features that have left the catalog. Revoke them when you retire a feature.",
  tally: "{enabled} of {total} on",
};
