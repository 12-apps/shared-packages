/**
 * Binding types — what a host answers for each capability a manifest
 * declares.
 *
 * Every declared capability must be answered: bound with the package's own
 * config, or DECLINED with a written reason. The mapped types below are what
 * makes that a compile-time property — a manifest whose literal type carries
 * an `http` contribution produces a bindings type whose `http` key is
 * required, and the config type is inferred from the contribution's own
 * `create` signature, so the host writes the same typed config object it
 * writes today.
 *
 * A declined capability is not a silent hole: the reason lands in the wiring
 * report, the way `.payments-surface.json` demands a written `why` for an
 * `app-specific` file — a label is not an argument, a sentence is.
 */

import type { EmailPort } from "../contract/email";
import type { WireJobContext } from "../contract/jobs";
import type { WireRoute, WireRouteAnswer } from "../contract/http";

/** The explicit refusal: this host will not wire this capability, because. */
export interface DeclinedBinding {
  declined: string;
}

/** Answer for an `http` contribution: where it mounts, and its config. */
export interface HttpBindingValue<TConfig> {
  mountPath: string;
  config: TConfig;
}

/** Answer for a `jobs` contribution: the deps its blueprints close over. */
export interface JobsBindingValue<TDeps> {
  deps: TDeps;
}

/** Answer for an `email` contribution; omitting `port` uses the host's. */
export interface EmailBindingValue {
  port?: EmailPort;
}

/** Answer for a web `surface` contribution: its config. */
export interface SurfaceBindingValue<TConfig> {
  config: TConfig;
}

type EmptyBindings = Record<never, never>;

type HttpSlot<TManifest> = TManifest extends {
  http: { create(config: infer TConfig): { routes: readonly WireRoute<never, WireRouteAnswer>[] } };
}
  ? { http: HttpBindingValue<TConfig> | DeclinedBinding }
  : EmptyBindings;

type JobsSlot<TManifest> = TManifest extends {
  jobs: {
    blueprints: Readonly<
      Record<
        string,
        { handle(payload: never, deps: infer TDeps, context: WireJobContext): Promise<void> }
      >
    >;
  };
}
  ? { jobs: JobsBindingValue<TDeps> | DeclinedBinding }
  : EmptyBindings;

type EmailSlot<TManifest> = TManifest extends {
  email: { createMailer(port: EmailPort): unknown };
}
  ? { email: EmailBindingValue | DeclinedBinding }
  : EmptyBindings;

/** The typed bindings a server adoption must supply. */
export type ServerBindings<TManifest> = HttpSlot<TManifest> &
  JobsSlot<TManifest> &
  EmailSlot<TManifest>;

type SurfaceSlot<TManifest> = TManifest extends {
  surface: { create(config: infer TConfig): unknown };
}
  ? { surface: SurfaceBindingValue<TConfig> | DeclinedBinding }
  : EmptyBindings;

/** The typed bindings a web adoption must supply (`areas` is data — collected). */
export type WebBindings<TManifest> = SurfaceSlot<TManifest>;

/** The mailer type an email contribution builds, recovered for adopt's return. */
export type MailerOf<TManifest> = TManifest extends {
  email: { createMailer(port: EmailPort): infer TMailer };
}
  ? TMailer
  : undefined;

/** The surface type a web contribution builds, recovered for adopt's return. */
export type SurfaceOf<TManifest> = TManifest extends {
  surface: { create(config: never): infer TSurface };
}
  ? TSurface
  : undefined;

/** Runtime view of a bindings object, whatever its compile-time shape. */
export type RuntimeBindings = Readonly<
  Record<string, DeclinedBinding | Record<string, unknown> | undefined>
>;

/** Whether a binding value is the explicit refusal. */
export function isDeclined(binding: unknown): binding is DeclinedBinding {
  return (
    typeof binding === "object" &&
    binding !== null &&
    typeof (binding as { declined?: unknown }).declined === "string"
  );
}
