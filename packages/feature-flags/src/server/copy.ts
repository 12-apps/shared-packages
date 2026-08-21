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
