import { useEffect, useState, type ComponentType, type JSX, type ReactNode } from 'react';

import { fetchOnboardingState, useOnboarding } from '@12-apps/onboarding';
import type {
  GuidedSectionProps,
  GuidedStep,
  OnboardingStateSnapshot,
} from '@12-apps/onboarding';
import { onboardingManifest } from '@12-apps/onboarding/manifest';
import { onboardingWebManifest } from '@12-apps/onboarding/manifest/web';

import { webWiringHost } from '../wiring-web';

/**
 * `@12-apps/onboarding` mounted the way a host mounts it: the published React half
 * driving the published SERVER half (12-23) — `createApiOnboarding`, served by
 * harness/backend over a real Postgres, reached through the Vite proxy.
 *
 * Both halves matter here, and specifically their SEAM. Until 12-23 the package
 * shipped the provider and a repository, and every host wrote the two endpoints
 * and the store itself; a `PATCH { op: 'save' }` on one side and a
 * `POST { status }` on the other stay green in their own suites forever while
 * never having spoken to each other. This page is the only place they speak.
 *
 * The host keeps exactly its own knowledge: where the surface is mounted, and
 * which feature this screen is about. Everything else — the wire, the three
 * operations, the optimistic reconcile, the stepper, the landing/hero/summary
 * states — is the package's.
 */
const API_BASE = '/api/admin/harness';
const FEATURE_KEY = 'ai_integration';

/**
 * The surface, ADOPTED rather than assembled.
 *
 * This page used to build the store with `createOnboardingApiStore` and wrap it
 * in `OnboardingProvider` itself, threading `FEATURE_KEY` through both — which
 * is the exact three-line assembly `createWebOnboarding` exists to replace, and
 * the exact coupling it closes over: the key has to be the SAME string in the
 * store and the provider, and nothing checked that while the host wrote it
 * twice.
 *
 * Adopting also puts the package in the host's REPORT. Before this the manifest
 * was declared and nothing bound it, and that was invisible rather than red:
 * `assemble()` answers for the packages a host adopted, so a manifest nobody
 * adopts is not an unanswered capability — it is a package the report never
 * hears about.
 *
 * Module scope, because `Provider` and `Section` are component TYPES: rebuilding
 * per render unmounts the tree under them, which for a stepper means losing the
 * step the operator just took.
 */
const { surface } = webWiringHost.adoptWeb({
  manifest: onboardingManifest,
  web: onboardingWebManifest,
  bindings: { surface: { config: { apiBase: API_BASE, featureKey: FEATURE_KEY } } },
});

const { Provider, Section } = surface as {
  Provider: ComponentType<{ initialState: OnboardingStateSnapshot | null; children: ReactNode }>;
  Section: ComponentType<GuidedSectionProps>;
};

/**
 * What actually crossed, rendered into the page.
 *
 * A screenshot of a stepper cannot tell "the step was persisted" from "the step
 * was held in React state", and that difference is the whole point of the server
 * half. So the persisted snapshot is read back from the server and printed beside
 * the live one: an assertion is then a string comparison against the row.
 */
function ProgressProbe(): JSX.Element {
  const { state, pending } = useOnboarding();
  const [persisted, setPersisted] = useState<OnboardingStateSnapshot | null>(null);

  const reread = (): void => {
    void fetchOnboardingState({ apiBase: API_BASE, featureKey: FEATURE_KEY }).then(setPersisted);
  };

  return (
    <dl data-testid="onboarding-probe" style={{ marginTop: 24, fontSize: 13 }}>
      <dt>live status</dt>
      <dd data-testid="probe-status">{state.status}</dd>
      <dt>live step</dt>
      <dd data-testid="probe-step">{state.step ?? '—'}</dd>
      <dt>live data</dt>
      <dd data-testid="probe-data">{JSON.stringify(state.data)}</dd>
      <dt>pending</dt>
      <dd data-testid="probe-pending">{String(pending)}</dd>
      <dt>persisted (re-read from the server)</dt>
      <dd data-testid="probe-persisted">{persisted ? JSON.stringify(persisted) : 'null'}</dd>
      <dd>
        <button type="button" data-testid="probe-reread" onClick={reread}>
          Re-read
        </button>
      </dd>
    </dl>
  );
}

/** The two guided steps — the host's content, the package's flow. */
const STEPS: GuidedStep[] = [
  {
    id: 'choose-host',
    label: 'Escolher assistente',
    render: (nav) => (
      <div data-testid="step-choose-host">
        <button
          type="button"
          data-testid="choose-claude"
          onClick={() => nav.next({ selectedHost: 'claude' })}
        >
          Claude
        </button>
        <span data-testid="chosen-host">{String(nav.data.selectedHost ?? '')}</span>
      </div>
    ),
  },
  {
    id: 'confirm',
    label: 'Confirmar',
    render: (nav) => (
      <div data-testid="step-confirm">
        <button type="button" data-testid="go-back" onClick={() => nav.back()}>
          Voltar
        </button>
        <button
          type="button"
          data-testid="finish"
          onClick={() => nav.complete({ confirmed: true })}
        >
          Concluir
        </button>
      </div>
    ),
  },
];

export function OnboardingGuidedPage(): JSX.Element {
  const [initial, setInitial] = useState<OnboardingStateSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  // The bootstrap read a host performs once, through the package's own reader —
  // `null` before any progress exists is exactly what the provider takes.
  useEffect(() => {
    let alive = true;
    void fetchOnboardingState({ apiBase: API_BASE, featureKey: FEATURE_KEY }).then((snapshot) => {
      if (!alive) return;
      setInitial(snapshot);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded) return <p data-testid="onboarding-loading">carregando…</p>;

  return (
    <section data-testid="onboarding-guided-page">
      <h2>Guided onboarding</h2>
      {/* `featureKey` and the store are already closed over by the factory —
          the host names the feature ONCE, at the adoption above. */}
      <Provider initialState={initial}>
        <Section
          steps={STEPS}
          title="Conecte seu assistente de IA"
          description="Deixe o Claude ou o ChatGPT cuidarem da sua loja."
          startLabel="Começar"
          configuredTitle="Assistente conectado"
          configuredSummary={<span data-testid="configured-summary">Tudo pronto.</span>}
          devReset
          dataTestId="onboarding-guided"
        />
        <ProgressProbe />
      </Provider>
    </section>
  );
}
