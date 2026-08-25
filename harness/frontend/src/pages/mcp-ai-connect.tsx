import { useCallback, useMemo, useState, type JSX } from 'react';

import {
  AiIntegrationOnboarding,
  MCP_AI_COPY,
  PT_BR_AI_CAPABILITIES,
  PT_BR_AI_CONNECT_PROMPT,
  PT_BR_AI_HOST_GUIDES,
  PT_BR_AI_PERMISSION_MODEL,
  type AiConnection,
} from '@12-apps/mcp/react';
import { mcpManifest } from '@12-apps/mcp/manifest';
import type { OnboardingSavePatch, OnboardingStateSnapshot, OnboardingStore } from '@12-apps/onboarding';

import { webWiringHost } from '../wiring-web';

import { HARNESS_MCP_ENDPOINT } from './mcp-ai-connect-endpoint';

/**
 * `@12-apps/mcp` — the AI-connect walkthrough, adopted through `./react`.
 *
 * This page exists because the flow it mounts was tested NOWHERE. The package
 * ships the landing, the assistant picker, the endpoint to copy, the configure
 * and connect steps and the confirmation — twenty test ids — and until now not
 * one of them was driven by any suite in either repo. The origin host's
 * `ai.e2e.ts` covers its OWN plan lock and upsell modal, reaching
 * `ai-onboarding` only in passing.
 *
 * ## What this host supplies, and why each piece cannot be the package's
 *
 * - **the endpoint URL** — derived by an app from its own public origin;
 * - **the assistants** — REQUIRED config since FUT-760. They used to default to
 *   this package's pt-BR walkthrough, so a host that said nothing shipped one
 *   product's Portuguese to its own users. The harness passes the package's own
 *   pt-BR pack rather than retyping it, which is what a pt-BR host does;
 * - **the persistence** — `@12-apps/onboarding`'s store seam. A real adopter
 *   points it at its backend; this page keeps it in memory, because what the
 *   journeys assert is the WIZARD's behaviour and an HTTP round trip would only
 *   add a way for them to flake;
 * - **the live connections** — empty here, deliberately. That is what makes the
 *   confirmation step assert `ai-confirm-waiting` rather than `connected`:
 *   reaching the last step is not evidence that anything connected, and the
 *   packaged journey says so.
 */

/**
 * The web half of this package's adoption — the SHARED manifest only.
 *
 * There is no `web` inventory and no surface binding, and that is the
 * manifest's own settled position: `./react` exports components a host mounts
 * with its own props rather than a `createWeb*` factory, and inventing one to
 * have something to declare would freeze a props table three hosts pass
 * differently. `adoptWeb` takes that shape — the web capabilities resolve to
 * none, `http` is reported out-of-scope as the other runtime's, and `e2e`,
 * being shared, is the one thing left to answer.
 *
 * BOUND, not declined: the package ships the AI-connect journeys plus the
 * `McpConnectWorld` port, and this harness implements that port in
 * `tests/e2e/steps/mcp-connect-world.ts`. The backend declines the same
 * capability — it has no browser — so this is the half that has to say yes,
 * and a scenario added upstream runs here on the next bump rather than being
 * quietly missed.
 */
webWiringHost.adoptWeb({
  manifest: mcpManifest,
  e2e: { featuresRoot: '.features-gen' },
});

/** The namespace the flow's progress is stored under (the host's own key). */
const FEATURE_KEY = 'ai_integration';


/**
 * An in-memory `OnboardingStore`.
 *
 * The journeys reset between scenarios by RELOADING this page, so state that
 * lives in a component's own closure is exactly the lifetime they need: a fresh
 * mount is a fresh first run, with no endpoint to call and nothing to clean up.
 */
function useMemoryStore(): {
  store: OnboardingStore;
  snapshot: OnboardingStateSnapshot | null;
} {
  const [snapshot, setSnapshot] = useState<OnboardingStateSnapshot | null>(null);

  const commit = useCallback((next: OnboardingStateSnapshot): OnboardingStateSnapshot => {
    setSnapshot(next);
    return next;
  }, []);

  const store = useMemo<OnboardingStore>(
    () => ({
      save: (patch: OnboardingSavePatch) =>
        Promise.resolve(
          commit({
            feature: FEATURE_KEY,
            step: patch.step ?? null,
            data: { ...(snapshot?.data ?? {}), ...(patch.data ?? {}) },
            dismissed: snapshot?.dismissed ?? false,
            completed: patch.completed ?? snapshot?.completed ?? false,
          } as OnboardingStateSnapshot),
        ),
      dismiss: () =>
        Promise.resolve(
          commit({ ...(snapshot ?? { feature: FEATURE_KEY, data: {} }), dismissed: true } as OnboardingStateSnapshot),
        ),
      reset: () => Promise.resolve(commit(null as unknown as OnboardingStateSnapshot)),
    }),
    [commit, snapshot],
  );

  return { store, snapshot };
}

/** No assistant is connected here — see the docblock above. */
const NO_CONNECTIONS: readonly AiConnection[] = [];

/**
 * The platform this harness stands in for.
 *
 * `PT_BR_AI_HOST_GUIDES` is a FUNCTION of it, not a constant, and that is the
 * copy-portability rule showing through: the guides' prose names the platform
 * out loud ("cole a URL do servidor MCP da sua loja"), so a frozen array would
 * be one product's brand baked into every adopter's walkthrough.
 */
const PLATFORM_NAME = 'Harness';

/** Resolved once — the guides are rebuilt per call, and the flow reads by identity. */
const HOST_GUIDES = PT_BR_AI_HOST_GUIDES(PLATFORM_NAME);

/**
 * The prompt an owner pastes to prove the connection works, built from the
 * tools this harness actually serves. `PT_BR_AI_CONNECT_PROMPT` is likewise a
 * function: which tool announces a connection and which one reads something
 * back are facts about the HOST's surface, not about this package.
 */
const CONNECT_PROMPT = PT_BR_AI_CONNECT_PROMPT({
  announceTool: 'announceAiConnection',
  probeTool: 'listProducts',
  probeSubject: 'o catálogo da loja',
  identifierName: 'o identificador da loja',
});

export function McpAiConnectPage(): JSX.Element {
  const { store, snapshot } = useMemoryStore();
  const copy = MCP_AI_COPY['pt-BR'];

  return (
    <AiIntegrationOnboarding
      store={store}
      endpointUrl={HARNESS_MCP_ENDPOINT}
      initialState={snapshot}
      connections={NO_CONNECTIONS}
      featureKey={FEATURE_KEY}
      hosts={HOST_GUIDES}
      capabilities={PT_BR_AI_CAPABILITIES}
      permissionModel={PT_BR_AI_PERMISSION_MODEL}
      connectPrompt={CONNECT_PROMPT}
      copy={copy}
    />
  );
}
