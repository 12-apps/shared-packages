/**
 * Every string the API surface answers a HUMAN with — required host config,
 * with NO defaults, deliberately (the payments extraction's doctrine, now
 * enforced repo-wide by the copy-portability gate): a default in the origin
 * host's language reads as finished to the next host right up until a user
 * sees it. The machine-readable halves of a failure — the status and the
 * `error` code — stay the package's own; only the sentence is the host's.
 *
 * A pt-BR host imports {@link PT_BR_FEATURE_FLAGS_SERVER_COPY} from
 * `./pt-BR` and passes it by hand — one reviewable line, never a silence.
 */
export interface FeatureFlagsServerCopy {
  /** 401 — no authenticated superadmin on the request. */
  readonly unauthenticated: string;
  /** 422 — the grant path param names no user. */
  readonly invalidUser: string;
  /** 422 — the add-by-email body carries no plausible address. */
  readonly invalidEmail: string;
  /** 422 — the note exceeds the stored column. */
  readonly noteTooLong: string;
  /** 404 — no directory user behind the given e-mail. */
  readonly userNotFound: string;
  /** 422 — the request body is not the JSON object the route reads. */
  readonly invalidBody: string;
  /** 404 — the user holds no grant on this flag. */
  readonly grantNotFound: string;
  /** 404 — the flag key names nothing in the host's catalog. */
  readonly unknownFlag: string;
  /** 422 — the patch's `enabled` is present but not a boolean. */
  readonly invalidEnabled: string;
}

const COPY_KEYS: readonly (keyof FeatureFlagsServerCopy)[] = [
  "unauthenticated",
  "invalidUser",
  "invalidEmail",
  "noteTooLong",
  "userNotFound",
  "invalidBody",
  "grantNotFound",
  "unknownFlag",
  "invalidEnabled",
];

/** Every key present and non-blank — checked at assembly, like the rest. */
export function missingServerCopy(copy: FeatureFlagsServerCopy | undefined): string[] {
  if (copy === undefined) return [...COPY_KEYS];
  return COPY_KEYS.filter((key) => typeof copy[key] !== "string" || copy[key].trim() === "");
}

/**
 * What a copy field takes once its words can follow a reader.
 *
 * Declared here rather than imported from `@12-apps/i18n`: this package must
 * stay liftable into a repo that has never heard of it, so the two agree
 * STRUCTURALLY and nothing forces the dependency. The context is deliberately
 * loose — a raw tag off the wire, unnarrowed — because matching it is the host
 * resolver's job, not this package's.
 */
export type FeatureFlagsCopyResolver<T> = (context: { readonly locale?: string | null }) => T;
export type FeatureFlagsCopySource<T> = T | FeatureFlagsCopyResolver<T>;

/**
 * The copy a field is offering, at the moment it is needed.
 *
 * Call this where the sentence is USED, never where the surface is built: a
 * factory that resolves once and stores the result has re-frozen the language
 * into its mount, and a single-locale host cannot tell the difference.
 */
export function resolveServerCopy(
  source: FeatureFlagsCopySource<FeatureFlagsServerCopy>,
  locale: string | undefined,
): FeatureFlagsServerCopy {
  return typeof source === "function"
    ? (source as FeatureFlagsCopyResolver<FeatureFlagsServerCopy>)({ locale })
    : source;
}
