/**
 * The HOST half of a merchant-settings story: the client, the OAuth state
 * mint and the provider selection a real admin app supplies — written once so
 * each story is only its own store.
 *
 * Deliberately the same amount of glue the origin host's admin page writes
 * (`apps/admin/src/pages/config/payments`): a `createPaymentsSettingsClient`
 * bound to the merchant's prefix, a `prepareConnect` that mints the CSRF
 * state, and a selection the HOST owns — there a URL segment, here story
 * state, so a pinned page still lets you click around.
 */
import { useMemo, useState, type JSX } from "react";

import {
  createPaymentsSettingsClient,
  PaymentProviderSettings,
  type PaymentProviderSettingsProps,
  type PaymentsSettingsClient,
} from "../index";
import type { PaymentEnvironment } from "../index";

import {
  createSettingsStoryStore,
  SETTINGS_BASE_URL,
  type SettingsStorySpec,
} from "./settings-store";

/**
 * The host's OAuth state mint. The REAL one is a server endpoint that pins
 * the state to the admin's session and compares it on the callback
 * (the origin host: `POST …/oauth/prepare`); the COMPONENT sees only this shape,
 * so a story — being its own host — mints locally. The fictional consent URL
 * the mount then answers with carries the state back visibly: that echo is
 * the CSRF round trip the connect button exists to start.
 */
async function prepareConnect(
  provider: string,
  environment: PaymentEnvironment,
): Promise<{ state: string; redirectUri: string; environment: PaymentEnvironment }> {
  return {
    state: `estado-csrf-${provider}`,
    redirectUri: `https://loja.exemplo/api/payments/oauth/callback/${provider}`,
    environment,
  };
}

/**
 * What the `/settings` read does — `host.tsx`'s `withConfigRead`, for the
 * OTHER side of the till. The two states a live mount cannot be asked to
 * produce:
 *
 *   - `pending` — never answers, so the page's loading gate stays on screen;
 *   - `failing` — answers 500, which the page turns into its error alert
 *     rather than a blank screen.
 *
 * Only the `GET /settings` view read is affected; every other route still
 * reaches the real mount.
 */
type SettingsRead = "ok" | "pending" | "failing";

/** Wrap the mount's fetch so the settings view read can stall or refuse. */
function withSettingsRead(inner: typeof fetch, mode: SettingsRead | undefined): typeof fetch {
  if (!mode || mode === "ok") return inner;
  const shim = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) !== `${SETTINGS_BASE_URL}/settings`) return inner(input, init);
    if (mode === "failing") {
      // The same body shape `host.tsx`'s config shim refuses with. What the
      // page then RENDERS is the client error's message — today the raw JSON
      // envelope, a package-level presentation finding the failing story
      // documents rather than papers over.
      return new Response(JSON.stringify({ error: "indisponível", code: "SERVER_ERROR" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    // Never settles: the story is about what the screen shows WHILE it waits.
    return new Promise<Response>(() => undefined);
  };
  return shim as typeof fetch;
}

/** One store, one client over it — built once per mount. */
function settingsClient(
  spec: SettingsStorySpec = {},
  read?: SettingsRead,
): PaymentsSettingsClient {
  const world = createSettingsStoryStore(spec);
  return createPaymentsSettingsClient({
    baseUrl: SETTINGS_BASE_URL,
    fetchImpl: withSettingsRead(world.fetchImpl, read),
  });
}

interface SettingsSceneProps {
  spec?: SettingsStorySpec;
  /** The provider page open on mount; null (the default) lands on the list. */
  provider?: string | null;
  /** What the `/settings` view read does. Default: the real mount answers. */
  settingsRead?: SettingsRead;
  /**
   * Whether this host registered a provider application (default true). A
   * deployment without one has no working connect button to offer, and the
   * component must fall back to the manual-credentials form — a state only
   * the HOST's wiring can produce, so only the host knob can stage it.
   */
  withPrepareConnect?: boolean;
  /**
   * The host's activation step (`renderVerification`) — the origin host's
   * pay-R$1,01-and-activate card. The PACKAGE decides only where the slot
   * appears and which facts it is handed; what a story passes here is a stand-in
   * card that makes those facts visible.
   */
  renderVerification?: PaymentProviderSettingsProps["renderVerification"];
}

/**
 * One story = one merchant + the whole settings page over it.
 *
 * The selection is CONTROLLED, exactly as the shipped admin drives it — there
 * the segment lives in the URL, here in story state — so `provider` pins a
 * specific page while clicking through the catalog still navigates, and the
 * component's canonical-slug correction still has a host to ask.
 */
export function SettingsScene({
  spec,
  provider = null,
  settingsRead,
  withPrepareConnect = true,
  renderVerification,
}: SettingsSceneProps): JSX.Element {
  // Built once per mount: the client is a prop, and a fresh object on every
  // render would refetch the settings after each keystroke.
  const client = useMemo(() => settingsClient(spec, settingsRead), []);
  const [selected, setSelected] = useState<string | null>(provider);
  return (
    <PaymentProviderSettings
      client={client}
      prepareConnect={withPrepareConnect ? prepareConnect : undefined}
      selectedProvider={selected}
      onProviderChange={(next) => setSelected(next)}
      renderVerification={renderVerification}
    />
  );
}
