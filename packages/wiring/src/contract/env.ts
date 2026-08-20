/**
 * The ENVIRONMENT capability: the variables a package reads, declared.
 *
 * Eleven of the packages this contract serves read `process.env` directly —
 * one of them thirteen variables deep — and every host re-derives that
 * contract by hand, each in a different style with a different failure
 * posture: some return `null` and silently switch a channel off, some throw
 * at first use, some default to a sandbox. Nothing gates any of it: a
 * missing variable is a boot-time surprise or, worse, a silent degradation
 * (a ticket secret that no longer matches its twin, a `Number(undefined)`
 * retention window).
 *
 * The declaration ends the re-deriving. A package lists what it reads; the
 * host answers with its environment (or declines, in writing); a `required`
 * variable that is unset is a named unbound capability `assemble()` refuses
 * — at boot, where the operator is, never at the one request that needed it.
 * Deploy tooling gets the union of every adopted package's declared names
 * from the same data.
 *
 * Like the db contribution, the declaration is MIRRORED into the package's
 * `package.json` under `"wiring": { "env": ... }` (plain JSON host tooling
 * can read from `node_modules`), pinned by `assertEnvMirror` in the
 * package's own test run.
 */

/** Which runtime reads the variable. `server` also covers workers. */
export type WireEnvScope = "server" | "web" | "worker";

/** One environment variable a package reads. */
export interface WireEnvVar {
  /** UPPER_SNAKE, exactly as read from `process.env`. */
  readonly name: string;
  /**
   * `true` ⇒ the package cannot serve its purpose without it, and an unset
   * value fails `assemble()`. Absent/false ⇒ the package degrades gracefully
   * (a channel stays off); the report still shows whether it was set.
   */
  readonly required?: boolean;
  /** Never echo the value anywhere — reports and errors carry the NAME only. */
  readonly secret?: boolean;
  /** Defaults to `server`. */
  readonly scope?: WireEnvScope;
  /** What it does, for the report and the operator. */
  readonly description?: string;
}

/** The values a host answers the declaration with — usually `process.env`. */
export type WireEnvValues = Readonly<Record<string, string | undefined>>;

/** The scopes a host kind answers for. */
export function envScopesOf(kind: "server" | "web"): readonly WireEnvScope[] {
  return kind === "server" ? ["server", "worker"] : ["web"];
}
