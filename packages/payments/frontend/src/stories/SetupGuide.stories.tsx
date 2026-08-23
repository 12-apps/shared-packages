import { Box, Typography } from "@mui/material";
import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type {
  ProviderSetupGuide as Guide,
  SetupGuideContext,
  SetupProgress,
  SetupSection,
} from "@12-apps/payments-backend";

// `DoneRow` is deliberately a DEEP import with no `index.ts` counterpart: it
// is the credential form's internal row, borrowed here only to stand in the
// wrapper's `rows` slot — the same props-only justification as mounting
// `ConfirmCredentialSave` bare in `Settings.stories.tsx`, one component over.
import { DoneRow } from "../components/CredentialFields";
// The published pair, through the published entry point.
import { ProviderSetupGuide, SetupGuideSection } from "../index";

import { settingsAdapter, TAG_FIELD, type SettingsStoryProvider } from "./settings-store-adapter";
import { SettingsStoryHost } from "./settings-story-host";

/**
 * THE ONBOARDING WALKTHROUGH, component by component: `ProviderSetupGuide`
 * (the renderer — stepper, section cards, the step vocabulary) and
 * `SetupGuideSection` (the wrapper that decides WHICH step is on screen, and
 * owns the one step only the OWNER can answer, `CHECKOUT_CONFIRM_ACTION`).
 *
 * Both are genuinely dumb — no client, no transport — so everything here is
 * props. Provenance, stated exactly: the AURORA stories run the same
 * `settingsAdapter` fixture the wire ships (`settings-store-adapter.ts`), so
 * their prose, warning and confirm step are the ones the full-page stories
 * fetch over the mount — minus only the JSON hop. The OTHER guides below
 * (`ANEXO_GUIDE`, `URLS_GUIDE`) are hand-written section literals: they pin
 * step SHAPES the fixture deliberately does not ship (an opaque host action, a
 * copy-field trio), and claim nothing about the wire.
 *
 * `Settings.stories.tsx` pins the guide inside the whole page; these go
 * deeper: all sections at once, each step shape, the no-handler contract, and
 * the wrapper's four clamps (unconfirmed, unstored, editing, no guide at all).
 */
const meta: Meta = {
  title: "Merchant/Setup guide",
  parameters: {
    docs: {
      description: {
        component:
          "`ProviderSetupGuide` renders a provider's onboarding walkthrough — stepper, " +
          "numbered sections, dashboard buttons, copy fields, warnings. `SetupGuideSection` " +
          "wraps it with the state the server cannot see: the step only the owner can " +
          "confirm, the reopened step, the environment tab with nothing stored, and the " +
          "provider that ships no guide at all.",
      },
    },
  },
};
export default meta;

// ---------------------------------------------------------------------------
// The guide — the same fixture the wire ships, built by the same adapter
// ---------------------------------------------------------------------------

const AURORA: SettingsStoryProvider = {
  name: "aurora",
  displayName: "Aurora Pagamentos",
  guide: true,
};

/**
 * The walkthrough exactly as `GET /settings/guides/aurora` would answer it:
 * the adapter's own sections, interpolated with this merchant's context — the
 * same values `settings-store.ts` feeds `setupContextFor`.
 */
function auroraGuide(progress?: SetupProgress): Guide {
  const context: SetupGuideContext = {
    brandName: "Plataforma Exemplo",
    webhookUrl: "https://loja.exemplo/api/payments/webhooks/aurora",
    merchantName: "Loja Exemplo",
    storefrontUrl: "https://loja.exemplo/cardapio",
    ...(progress ? { progress } : {}),
  };
  const guide = settingsAdapter(AURORA).setupGuide?.(context);
  if (!guide) throw new Error("the aurora story adapter always ships a guide");
  return guide;
}

/**
 * What the server reports once the tag is saved and the probe has passed.
 * A hand-written copy of what `settings-store.ts`'s `progressFor` derives from
 * a `stage: "saved"` row — spelled out here because these stories are
 * props-only, and kept this small so a drift against the derivation is a
 * one-line diff, not a hidden one.
 */
const CONNECTED: SetupProgress = { configured: { tag: true }, connected: true, proven: false };

// ---------------------------------------------------------------------------
// The raw renderer — `ProviderSetupGuide`
// ---------------------------------------------------------------------------

/**
 * The renderer draws what it is handed: EVERY section in the guide, stacked —
 * narrowing to the open one is `SetupGuideSection`'s job, and the stage rail
 * is a prop, not read from the data. On screen: the three-stage stepper (one
 * done, one active), the numbered instruction with its external ↗ button, the
 * un-numbered warning callout with its **bold** money sentence, the collapsed
 * reference URL — and NOTHING for the confirm step, because no `actions`
 * handler was supplied for its id. That silence is the documented contract;
 * the wrapper stories below are the host that wires it.
 */
export const AllSections: StoryObj = {
  name: "Todas as seções de uma vez — o renderizador cru",
  render: () => (
    <SettingsStoryHost>
      <ProviderSetupGuide guide={auroraGuide()} activeStage={1} />
    </SettingsStoryHost>
  ),
};

/** The stage rail for the hand-built sections below. */
const REVIEW_STAGES = [
  { id: "conta", label: "Conectar a conta" },
  { id: "revisao", label: "Enviar para análise" },
  { id: "vendas", label: "Ativar as vendas" },
];

/**
 * An IN-APP action's id — opaque, agreed between adapter and host out of band
 * (the shipped precedent is PagBank's `homologacao-anexo`, which asks the host
 * to generate the evidence file its review form wants).
 */
const ANEXO_ACTION = "gerar-anexo-de-analise";

const ANEXO_SECTION: SetupSection = {
  id: "revisao",
  title: "Passo 2 · Envie a loja para análise",
  intro: "O provedor analisa a loja antes de liberar cobranças em produção.",
  steps: [
    {
      text: "Preencha o formulário de análise no painel do provedor.",
      button: { label: "Abrir o formulário de análise", url: "https://conta.aurora.exemplo/analise" },
    },
    {
      text: "Anexe o arquivo de evidências — ele reúne os dados que o formulário pede.",
      action: ANEXO_ACTION,
    },
  ],
  doneSummary: { label: "Análise do provedor", value: "Enviada" },
};

const ANEXO_GUIDE: Guide = { stages: REVIEW_STAGES, sections: [ANEXO_SECTION], activeStage: 1 };

/**
 * A step whose primary control is the HOST's: the adapter names an opaque
 * action id, the host supplies a label and a handler, and the step renders a
 * contained button beside its prose. The package neither knows nor cares what
 * the handler does.
 */
export const HostAction: StoryObj = {
  name: "Ação in-app — o id opaco que o host atende",
  render: () => (
    <ProviderSetupGuide
      guide={ANEXO_GUIDE}
      activeStage={1}
      actions={{ [ANEXO_ACTION]: { label: "Gerar o arquivo de evidências", run: () => undefined } }}
    />
  ),
};

/**
 * The same section with NO handler for the id: the button simply does not
 * render, and the step's text still reads correctly on its own — so a host can
 * adopt a provider before implementing its optional conveniences, instead of
 * shipping a button that cannot work.
 */
export const HostActionMissing: StoryObj = {
  name: "Ação sem handler — o texto fica de pé, o botão não",
  render: () => (
    <SettingsStoryHost>
      <ProviderSetupGuide guide={ANEXO_GUIDE} activeStage={1} />
    </SettingsStoryHost>
  ),
};

const URLS_SECTION: SetupSection = {
  id: "urls",
  title: "Passo 2 · Cadastre as URLs da loja",
  intro: "O painel do provedor pede a URL de notificações; a da chave pública é só referência.",
  steps: [
    {
      text: "Cole a URL de notificações no campo Webhook do painel.",
      copy: { label: "URL de notificações", text: "https://loja.exemplo/api/payments/webhooks/aurora" },
    },
    {
      copy: {
        label: "URL da chave pública (referência)",
        text: "https://loja.exemplo/api/payments/keys/aurora",
        collapsible: true,
      },
    },
    {
      text: "Cada campo do painel está descrito no guia do provedor.",
      link: { label: "Ver o guia", url: "https://docs.aurora.exemplo/urls" },
    },
  ],
};

const URLS_GUIDE: Guide = {
  stages: [
    { id: "conta", label: "Conectar a conta" },
    { id: "urls", label: "Cadastrar as URLs" },
    { id: "vendas", label: "Ativar as vendas" },
  ],
  sections: [URLS_SECTION],
  activeStage: 1,
};

/**
 * The two shapes of a copy-paste value. The URL the owner must ACT ON renders
 * open: a full-width read-only field with its copy button (disabled on
 * purpose — nothing here is to be edited). The value that is PURE REFERENCE
 * starts folded behind its own label (`payments-setup-copy-reveal`) — printed
 * open it was the most prominent thing on the step, and owners went hunting
 * for a registration screen that does not exist. Clicking the label reveals
 * the same copy row. The plain docs link is the third, quietest shape.
 */
export const CopyReference: StoryObj = {
  name: "Campos de copiar — o aberto e o recolhido",
  render: () => (
    <SettingsStoryHost>
      <ProviderSetupGuide guide={URLS_GUIDE} activeStage={1} />
    </SettingsStoryHost>
  ),
};

// ---------------------------------------------------------------------------
// The wrapper — `SetupGuideSection`
// ---------------------------------------------------------------------------

/**
 * Stands where the HOST mounts the live credential form (the `sectionFooter`
 * slot). Inside the open section's card when the guide has one; bare when
 * `guide` is null — the slot the wrapper must never swallow.
 */
function HostFormSlot(): JSX.Element {
  return (
    <Box
      data-testid="story-form-slot"
      sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 1.5 }}
    >
      <Typography variant="body2" color="text.secondary">
        Aqui o host monta o formulário de credenciais do provedor.
      </Typography>
    </Box>
  );
}

/** The saved credential's one-line row — a step finished elsewhere (`rows`). */
function SavedTagRow(): JSX.Element {
  return (
    <DoneRow
      testId="story-tag-salva"
      label={TAG_FIELD.label}
      value="$aurora-matriz"
      mono
      onEdit={() => undefined}
    />
  );
}

interface GuideSceneProps {
  guide: Guide | null;
  /** The browser's remembered answer to the owner-confirm step, at mount. */
  confirmedAtStart?: boolean;
  /** Render the saved credential's row above the card. */
  savedTag?: boolean;
  /** The owner reopened the credential step (the host form's edit state). */
  editing?: boolean;
  /** The environment on screen holds its credentials. */
  stored?: boolean;
}

/**
 * The host state around the wrapper. The real page persists the confirmation
 * per store AND per provider (`useSetupConfirmation`, keyed on the client's
 * `baseUrl` plus the provider's name — the pair is what keeps two providers'
 * answers apart on one store); a story only needs it to survive the click —
 * so confirming and reopening really move the walkthrough, they just forget
 * on remount.
 */
function GuideScene({
  guide,
  confirmedAtStart = false,
  savedTag = false,
  editing = false,
  stored = true,
}: GuideSceneProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(confirmedAtStart);
  return (
    <SettingsStoryHost>
      <SetupGuideSection
        guide={guide}
        confirmed={confirmed}
        onConfirm={() => setConfirmed(true)}
        onReopen={() => setConfirmed(false)}
        rows={savedTag ? <SavedTagRow /> : undefined}
        sectionFooter={<HostFormSlot />}
        editing={editing}
        stored={stored}
      />
    </SettingsStoryHost>
  );
}

/** One story = one state of the wrapper. */
function scene(name: string, props: GuideSceneProps): StoryObj {
  return { name, render: () => <GuideScene {...props} /> };
}

/**
 * The step only the OWNER can answer, holding the walkthrough. The server
 * reports the probe passed (`connected`), so its own number says stage 3 —
 * but section 2 ends in `CHECKOUT_CONFIRM_ACTION` and the owner has not
 * confirmed, so the wrapper clamps the guide to that step: no API reports the
 * provider-side switch, and skipping the question would tick off a step
 * nobody answered. The button and its label ("Já habilitei o Checkout
 * Integrado") are the WRAPPER's own wiring, not the adapter's. Pressing it
 * advances the stepper and collapses the section into its one-line row.
 */
export const ConfirmStepHolds: StoryObj = scene("O passo que só o dono responde — segurando o guia", {
  guide: auroraGuide(CONNECTED),
  savedTag: true,
});

/**
 * After the answer: the confirmed step collapses to a ✓ row — kept, not
 * removed, because "I told you this was on" is exactly the claim the
 * activation step is about to test, and when the provider then refuses to
 * mint a link the owner needs the row still there to press Revisar on.
 * Pressing Revisar withdraws the confirmation and puts the question back.
 * With no section left to show, the section footer is gone too — it lives
 * inside the open card.
 */
export const ConfirmedCollapsed: StoryObj = scene("Confirmado — a linha com Revisar, o guia adiante", {
  guide: auroraGuide(CONNECTED),
  savedTag: true,
  confirmedAtStart: true,
});

/**
 * No walkthrough at all — the PagBank-under-Connect case: the platform is
 * reviewed centrally, the owner has nothing to follow, and the adapter ships
 * no guide. The wrapper renders no stepper and no card — but the SLOTS still
 * render, because they are the credential row and the credential form, and
 * swallowing them left a provider with a status chip, a pair of environment
 * tabs and no way to type anything in.
 */
export const NoGuide: StoryObj = scene("Sem passo a passo — os slots continuam no lugar", {
  guide: null,
  savedTag: true,
});

/**
 * The environment-tab clamp. The server's progress was computed from the
 * environment the store actually charges with — and this tab (`stored:
 * false`) holds nothing. So the walkthrough goes back to step 1, whatever the
 * other tab has achieved: a guide claiming steps 1 and 2 were done over an
 * empty Produção field would be lying on the screen whose whole subject is
 * which account receives the money.
 */
export const UnstoredEnvironment: StoryObj = scene("Aba sem credenciais — o guia volta ao passo 1", {
  guide: auroraGuide(CONNECTED),
  stored: false,
});

/**
 * `editing` beats everything: the owner pressed Alterar on the saved
 * credential, so the walkthrough returns to THAT step — even though the
 * server's progress says everything is done (`proven`) and the confirmation
 * stands. The confirmed step's ✓ row is withheld while editing, so the screen
 * reads as one question at a time; the value being retyped decides who gets
 * paid, and the guide's step is the context it is retyped in.
 */
export const EditingCredential: StoryObj = scene("Revendo a credencial — o guia volta ao passo dela", {
  guide: auroraGuide({ configured: { tag: true }, connected: true, proven: true }),
  confirmedAtStart: true,
  editing: true,
});
