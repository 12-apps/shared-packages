import type { FeatureFlagsCopy } from "./copy";
import { EN_US_FEATURE_FLAGS_COPY } from "./en-US";
import { PT_BR_FEATURE_FLAGS_COPY } from "./pt-BR";

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * `LocalePack` is mirrored here rather than imported: this package must stay
 * liftable into a repo that has never heard of `@12-apps/i18n`, and the mirror
 * buys the same key-checking for one line. The named single-language packs stay
 * exported and unchanged.
 */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const FEATURE_FLAGS_COPY = {
  "pt-BR": PT_BR_FEATURE_FLAGS_COPY,
  "en-US": EN_US_FEATURE_FLAGS_COPY,
} as const satisfies LocalePack<FeatureFlagsCopy>;
