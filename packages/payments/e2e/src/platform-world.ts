import type { Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged PLATFORM-OPERATIONS journeys
 * (FUT-479 / FUT-483, packaged by FUT-573) — the Connect-application consult
 * screen and the platform homologação.
 *
 * A SEPARATE port from {@link import('./world.js').PaymentsWorld}, on purpose.
 * The buyer journeys are for any app that mounts the checkout; these are for
 * the app that operates the PLATFORM (typically a super-admin SPA), and most
 * consumers of the checkout have no such surface. Folding these into
 * `PaymentsWorld` would have broken every existing host on the next version
 * bump; a second opt-in port breaks nobody. The features live under their own
 * globs (`paymentsPlatformFeatures` / `paymentsPlatformSteps`) for the same
 * reason — a host that never lists them never compiles them.
 *
 * Every assertion in the journeys reads a test id the payments package's own
 * platform components render (`connect-env-SANDBOX`, `homologacao-status-chip`,
 * …), so they hold in any app that mounts `ConnectApplicationPanel` /
 * `PlatformHomologacao` from `@12-apps/payments-frontend`.
 */

/**
 * The SHAPE of the deployment a Connect-application scenario is set in.
 *
 * `unconfigured` — no OAuth application credentials for either environment,
 * which is what a fresh e2e stack honestly is. The consult then renders both
 * cards in their "nenhuma aplicação configurada" state with no network call —
 * the screen's baseline value, reachable without stubbing PagBank.
 *
 * Adding a member is a breaking change for hosts, deliberately — same
 * argument as `PaymentsStore`: a shape nobody can build is a scenario that
 * silently never runs.
 */
export type ConnectApplicationShape = 'unconfigured';

/**
 * The SHAPE of the platform a homologação scenario is set in.
 *
 * `unrequested` — no outcome recorded for the provider AND no platform
 * SANDBOX token stored, which again is what a fresh e2e stack is: the screen
 * shows the honest "não solicitada", the outcome form performs the first real
 * write, and the anexo generator refuses with its reason instead of calling
 * the provider.
 *
 * PRODUCING the shape is the host's job, not just navigating to the screen:
 * one scenario records an outcome, so a later `unrequested` opening must
 * clear it again (the same way `PaymentsWorld.open` seeds a store).
 */
export type PlatformHomologacaoShape = 'unrequested';

/** Everything a host supplies to run the packaged platform journeys. */
export interface PaymentsPlatformWorld {
  /**
   * Put a signed-in PLATFORM OPERATOR on the Connect-application screen of a
   * deployment of this shape. Auth is the host's own business — these
   * journeys never see a login form.
   */
  openConnectApplication(page: Page, shape: ConnectApplicationShape): Promise<void>;
  /**
   * Put a signed-in platform operator on the homologação screen of a platform
   * of this shape. The host must wire the screen so a recorded outcome
   * refreshes the `record` the component renders — the journey asserts the
   * status chip flips without a reload.
   */
  openHomologacao(page: Page, shape: PlatformHomologacaoShape): Promise<void>;
}

let installed: PaymentsPlatformWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the
 * host's OWN steps glob — playwright-bdd imports every step file before any
 * scenario runs, so a top-level call there is registered in time, in every
 * worker. Independent of `definePaymentsWorld`: a host may implement either
 * port, or both.
 */
export function definePaymentsPlatformWorld(world: PaymentsPlatformWorld): void {
  installed = world;
}

/**
 * The installed world. Throws rather than degrading, for the same reason as
 * `paymentsWorld()`: a journey against a half-configured world fails deep
 * inside a step, several layers from the actual cause.
 */
export function paymentsPlatformWorld(): PaymentsPlatformWorld {
  if (!installed) {
    throw new Error(
      'No PaymentsPlatformWorld installed. Call definePaymentsPlatformWorld(...) from a ' +
        "module inside this app's bdd `steps` glob — see @12-apps/payments-e2e's README.",
    );
  }
  return installed;
}
