import type { Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged impersonation journeys.
 *
 * The journeys themselves are portable: every assertion in them reads a test id
 * this package's own components render, so `impersonation-banner`,
 * `impersonation-confirm`, `impersonation-blocker` and
 * `impersonation-banner-exit` mean the same thing in any app that mounts
 * `createWebImpersonation`. What is NOT portable is everything around them — how
 * this app routes to the screen that starts a session, how it gets back to a
 * known state, and which of its own rows a scenario is allowed to name.
 *
 * That is the whole of this port. A host implements it once, adds two globs to
 * its bdd config, and inherits every scenario the library ships — including the
 * ones added after it integrated. Nothing is copied, so nothing can rot.
 */

/** An account a scenario acts on, as the host's own directory shows it. */
export interface ImpersonationSubjectFixture {
  /** The user id the host's own row action is addressed by. */
  id: string;
  /** The address the directory search matches, and the dialog's title prints. */
  email: string;
  /**
   * What the BANNER names them once a session is running.
   *
   * Not derived from the two above, because how a host resolves a display name
   * is its own business — a name when it has one, an address when it does not,
   * and a last-resort noun the host itself supplies for a subject the server
   * could not resolve at all.
   */
  label: string;
}

/**
 * Facts about the host's own seed that the assertions have to name.
 *
 * These exist because a journey has to talk about SOMETHING — a person to act
 * as, a tenant to be bounded to, a role to preview. None of that can live in the
 * feature file without inventing one host's fixture as though it were
 * everybody's, and none of it can be discovered from the screen without the
 * scenario asserting whatever it happens to find, which is not an assertion at
 * all.
 */
export interface ImpersonationFixtures {
  /** An ordinary tenant user, safe to act as. */
  target: ImpersonationSubjectFixture;
  /**
   * An account that holds PLATFORM authority itself.
   *
   * The refusal this one drives is the one the whole mechanism is built around:
   * a lateral move between full-privilege accounts defeats attribution, because
   * the resulting record says "A acted as B" about actions either could have
   * taken alone, in a place that cannot be corrected afterwards.
   */
  platformTarget: ImpersonationSubjectFixture;
  /** The tenant a session is bounded to. */
  tenant: {
    slug: string;
    /** Exactly what the tenant picker's option reads — `Name (/slug)`. */
    optionLabel: string;
  };
  /** A role the tenant really has, for the preview journey. */
  previewRole: {
    /** The name the SERVER knows it by — what the host's picker is addressed by. */
    name: string;
    /** What the OPERATOR reads on the banner once the preview is running. */
    label: string;
  };
  /** An active member of the tenant, for the read-only preview journey. */
  previewMember: ImpersonationSubjectFixture;
  /** A justification comfortably above the host's configured minimum. */
  validReason: string;
  /** One that is comfortably below it. */
  shortReason: string;
  /**
   * The host's OWN sentences, as a scenario has to read them back off the
   * screen.
   *
   * Stated by the host rather than kept as a table here, for the same reason
   * every other label is: this package ships no copy, so a journey that asserted
   * a sentence out loud would be asserting one product's words in every product
   * that runs it. A host passes the same constants it already gave `labels`, so
   * there is nothing to keep in step.
   */
  copy: {
    /** The blocker shown before a tenant is chosen. */
    tenantMissing: string;
    /** The blocker shown while the justification is too short. */
    reasonTooShort: string;
    /**
     * A distinctive fragment of the refusal the SERVER answers with when the
     * target holds platform authority. Asserted because the point of that
     * scenario is that the server's own sentence reached the screen, not that
     * some error did.
     */
    platformTargetRefusal: string;
    /** The chip that states a session may change nothing. */
    readOnly: string;
  };
}

/** Everything a host supplies to run the packaged journeys. */
export interface ImpersonationWorld {
  /**
   * Back to a known state, signed in as somebody who may start a session, with
   * NO session in force.
   *
   * Every scenario starts here, because a live impersonation cookie is exactly
   * the kind of per-browser state that leaks into whatever runs next.
   */
  reset(page: Page): Promise<void>;
  /**
   * Open the start dialog for one directory row.
   *
   * A port rather than a step, because where a host puts that affordance is the
   * host's product: a row action in a user directory, a button on a tenant page,
   * a command palette. What the dialog looks like once it is open is this
   * package's, and the steps assert that.
   */
  openStartDialog(page: Page, subject: ImpersonationSubjectFixture): Promise<void>;
  /**
   * Start a preview of a role, from wherever the host puts that control.
   *
   * The preview mount takes a role NAME, and picking one is a host screen — this
   * package ships the session, the banner and the exit, not the picker.
   */
  startRolePreview(page: Page, roleName: string): Promise<void>;
  /** The same, for a MEMBER preview — the variant that is read-only whatever
   * the cookie says, because it resolves as somebody else. */
  startMemberPreview(page: Page, memberUserId: string): Promise<void>;
  /**
   * Land on any screen where the banner is mounted, so a scenario can assert
   * that a live session is visible from an ordinary page.
   */
  openGuardedScreen(page: Page): Promise<void>;
  fixtures: ImpersonationFixtures;
}

let installed: ImpersonationWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function defineImpersonationWorld(world: ImpersonationWorld): void {
  installed = world;
}

/**
 * The installed world.
 *
 * Throws rather than degrading: a journey that ran against a half-configured
 * world would fail somewhere deep inside a step with a message about a missing
 * element, and the actual cause — a host that forgot to call
 * {@link defineImpersonationWorld} — would be several layers away from the error.
 */
export function impersonationWorld(): ImpersonationWorld {
  if (!installed) {
    throw new Error(
      'No ImpersonationWorld installed. Call defineImpersonationWorld(...) from a ' +
        "module inside this app's bdd `steps` glob — see @12-apps/impersonation/e2e.",
    );
  }
  return installed;
}
