"use client";

import { Button } from "@12-apps/ui/form/Button";
import { SectionOnboarding } from "@12-apps/ui/data-display/SectionOnboarding";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import type { ReactNode } from "react";

import { useOnboarding } from "./onboarding-context";
import type { GuidedNav, GuidedStep, OnboardingStateSnapshot } from "./types";

type SectionStatus = "unconfigured" | "in-progress" | "configured";

interface SectionView {
  firstStepId: string;
  activeStepId: string;
  activeIndex: number;
  completedStepIds: string[];
  isLanding: boolean;
  sectionStatus: SectionStatus;
}

/** Derive the stepper position + which shell state to show from persisted state. */
function computeSectionView(steps: GuidedStep[], state: OnboardingStateSnapshot): SectionView {
  const firstStepId = steps[0]?.id ?? "";
  const activeStepId = steps.some((s) => s.id === state.step) ? state.step! : firstStepId;
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);
  const completedStepIds = steps.slice(0, Math.max(activeIndex, 0)).map((s) => s.id);
  const isLanding = state.status === "not_started" || state.status === "dismissed";
  const sectionStatus: SectionStatus = isLanding
    ? "unconfigured"
    : state.status === "completed"
      ? "configured"
      : "in-progress";
  return { firstStepId, activeStepId, activeIndex, completedStepIds, isLanding, sectionStatus };
}

/** Build the per-step navigation that persists progress on every move. */
function buildNav(
  steps: GuidedStep[],
  view: SectionView,
  onboarding: ReturnType<typeof useOnboarding>,
): GuidedNav {
  const { activeStepId, activeIndex } = view;
  const { state, pending, setStep, complete, dismiss } = onboarding;
  return {
    activeStepId,
    data: state.data,
    pending,
    goTo: (stepId, data) => setStep(stepId, { data }),
    next: (data) => {
      const nextStep = steps[activeIndex + 1];
      if (nextStep) setStep(nextStep.id, { data });
      else complete(data);
    },
    back: () => {
      const prevStep = steps[activeIndex - 1];
      if (prevStep) setStep(prevStep.id);
    },
    complete: (data) => complete(data),
    restart: () => dismiss(),
  };
}

export interface GuidedSectionProps {
  /** Ordered steps of the flow. */
  steps: GuidedStep[];
  /** Hero headline (landing / not-started state). */
  title: string;
  description?: string;
  illustration?: ReactNode;
  /** Landing CTA label — begins the flow at step 1. @default 'Começar' */
  /** The landing hero's begin action — REQUIRED, the host's words. */
  startLabel: string;
  /** Marketing shown BELOW the default hero on the landing (e.g. capability cards). */
  landingExtra?: ReactNode;
  /**
   * Full custom landing (homepage-style) shown when not started — receives a
   * `start` callback to begin the flow. Overrides the default `EmptyState` hero
   * + `landingExtra`. Use for a rich marketing first screen.
   */
  renderLanding?: (start: () => void) => ReactNode;
  /** Compact summary shown once completed. */
  configuredTitle?: string;
  configuredSummary?: ReactNode;
  /**
   * Label for the button that reveals `completedContent` in the configured
   * state. @default 'Editar' (from the shell).
   */
  editLabel?: string;
  /** Optional editable content revealed behind the edit toggle when completed. */
  completedContent?: (nav: GuidedNav) => ReactNode;
  /**
   * Show a dev-only "reset onboarding" button (wipes progress → fresh first-run).
   * The consumer decides dev-ness (e.g. `process.env.NODE_ENV !== 'production'`);
   * the matching server action also refuses in production.
   */
  devReset?: boolean;
  dataTestId?: string;
}

/** The content for the current state: completed editor, active step, or none. */
function computeBody(
  sectionStatus: SectionStatus,
  activeStep: GuidedStep | undefined,
  nav: GuidedNav,
  completedContent?: (nav: GuidedNav) => ReactNode,
): ReactNode {
  if (sectionStatus === "configured") return completedContent?.(nav);
  if (sectionStatus === "in-progress") return activeStep?.render(nav);
  return null;
}

interface DefaultSectionProps {
  sectionStatus: SectionStatus;
  title: string;
  description?: string;
  isLanding: boolean;
  illustration?: ReactNode;
  steps: GuidedStep[];
  activeStepId: string;
  completedStepIds: string[];
  startLabel: string;
  onStart: () => void;
  configuredTitle?: string;
  configuredSummary?: ReactNode;
  editLabel?: string;
  landingExtra?: ReactNode;
  stepBody: ReactNode;
  dataTestId: string;
}

/** The default (non-custom-landing) shell: EmptyState hero / stepper + form / summary. */
function DefaultSection(p: DefaultSectionProps): React.JSX.Element {
  // The stepper is progress UI — hidden on the marketing landing.
  const sectionSteps = p.isLanding ? [] : p.steps.map((s) => ({ id: s.id, label: s.label }));
  return (
    <>
      <SectionOnboarding
        status={p.sectionStatus}
        title={p.title}
        description={p.description}
        illustration={p.isLanding ? p.illustration : undefined}
        steps={sectionSteps}
        activeStepId={p.activeStepId}
        completedStepIds={p.completedStepIds}
        primaryAction={{ label: p.startLabel, onClick: p.onStart }}
        configuredTitle={p.configuredTitle}
        configuredSummary={p.configuredSummary}
        editLabel={p.editLabel}
        dataTestId={`${p.dataTestId}-section`}
      >
        {p.stepBody}
      </SectionOnboarding>
      {p.isLanding && p.landingExtra}
    </>
  );
}

/**
 * Binds the persisted onboarding state (`useOnboarding`) to the
 * `SectionOnboarding` three-state shell + its stepper: a landing hero that
 * begins the flow, a per-step wizard whose position is saved on every move
 * (resume-safe), and a completed summary. Feature pages provide the per-step
 * content; this component owns the state<->UI wiring so any guided feature
 * reuses it.
 */
export function GuidedSection({
  steps,
  title,
  description,
  illustration,
  startLabel,
  landingExtra,
  configuredTitle,
  configuredSummary,
  editLabel,
  completedContent,
  renderLanding,
  devReset = false,
  dataTestId = "guided-section",
}: GuidedSectionProps): React.JSX.Element {
  const onboarding = useOnboarding();
  const { state, setStep, reset } = onboarding;

  const view = computeSectionView(steps, state);
  const { firstStepId, activeStepId, activeIndex, completedStepIds, isLanding, sectionStatus } = view;
  const nav = buildNav(steps, view, onboarding);

  const activeStep = steps[Math.max(activeIndex, 0)];
  const body = computeBody(sectionStatus, activeStep, nav, completedContent);
  const startFlow = () => setStep(firstStepId, { status: "in_progress" });
  const customLanding = isLanding && renderLanding ? renderLanding(startFlow) : null;
  const stepBody = body ? (
    <Box data-testid={`${dataTestId}-step-${activeStepId}`}>{body}</Box>
  ) : null;

  return (
    <Stack spacing={5} data-testid={dataTestId}>
      {customLanding ?? (
        <DefaultSection
          sectionStatus={sectionStatus}
          title={title}
          description={description}
          isLanding={isLanding}
          illustration={illustration}
          steps={steps}
          activeStepId={activeStepId}
          completedStepIds={completedStepIds}
          startLabel={startLabel}
          onStart={startFlow}
          configuredTitle={configuredTitle}
          configuredSummary={configuredSummary}
          editLabel={editLabel}
          landingExtra={landingExtra}
          stepBody={stepBody}
          dataTestId={dataTestId}
        />
      )}

      {devReset && (
        <Box sx={{ pt: 2, borderTop: 1, borderColor: "divider", textAlign: "center" }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            data-testid={`${dataTestId}-dev-reset`}
          >
            ↺ Resetar onboarding (dev)
          </Button>
        </Box>
      )}
    </Stack>
  );
}
