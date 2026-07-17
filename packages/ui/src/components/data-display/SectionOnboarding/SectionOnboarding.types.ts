import type { ReactNode } from 'react';

import type { Step } from '../Stepper/Stepper.types';

/**
 * Lifecycle of a configurable page section:
 * - `unconfigured` — never set up: show the onboarding hero (why + CTA).
 * - `in-progress`  — actively being set up: show the steps + the real form.
 * - `configured`   — already set up: show a compact summary, form on demand.
 */
export type SectionOnboardingStatus = 'unconfigured' | 'in-progress' | 'configured';

export interface SectionOnboardingAction {
  label: string;
  onClick: () => void;
}

export interface SectionOnboardingHelpLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface SectionOnboardingProps {
  /**
   * Which lifecycle view to render. Derive it on the server from whatever
   * "is this set up?" signal the feature already has (a `null` config, a
   * `status` field, a row count) — no new query is needed.
   */
  status: SectionOnboardingStatus;

  /** Headline for the onboarding hero (unconfigured / in-progress). */
  title: string;

  /** Plain-language explanation of what this section does and why. */
  description?: string;

  /** Optional illustration/icon shown in the hero (unconfigured only). */
  illustration?: ReactNode;

  /**
   * Ordered setup steps. Shown as a non-interactive preview in `unconfigured`
   * and as live progress in `in-progress`. Omit for a single-step section.
   */
  steps?: Step[];

  /** Id of the step currently in progress (used when `status` is in-progress). */
  activeStepId?: string;

  /** Ids of steps already completed (rendered with a check). */
  completedStepIds?: string[];

  /**
   * Primary CTA of the hero — e.g. "Começar configuração". Provide this only
   * when the parent wants to fully control what the button does (e.g. navigate
   * to a dedicated wizard route). When omitted, the component renders a default
   * CTA (see `startLabel`) that reveals the `children` form in place — so a
   * server page can adopt onboarding without any client wrapper of its own.
   */
  primaryAction?: SectionOnboardingAction;

  /**
   * Label of the built-in "start" CTA shown when no `primaryAction` is provided
   * and `children` exist. Clicking it advances the hero to the in-progress view
   * (steps + form) without the parent managing state. @default 'Começar'
   */
  startLabel?: string;

  /** Optional secondary CTA of the hero — e.g. "Ver como funciona". */
  secondaryAction?: SectionOnboardingAction;

  /** Optional help link under the hero actions. */
  helpLink?: SectionOnboardingHelpLink;

  /** Heading for the compact configured summary (defaults to `title`). */
  configuredTitle?: string;

  /**
   * The compact "it's connected" summary shown when `configured` — e.g. a
   * status chip, the account name, the environment. Kept short.
   */
  configuredSummary?: ReactNode;

  /** Label of the reveal toggle in the configured state. @default 'Editar' */
  editLabel?: string;

  /** Label of the reveal toggle while expanded. @default 'Ocultar' */
  collapseLabel?: string;

  /** Start the configured state with the form already revealed. @default false */
  defaultExpanded?: boolean;

  /**
   * The real controls (the credential form / advanced settings). Rendered
   * directly in `in-progress`, and behind the reveal toggle in `configured`.
   */
  children?: ReactNode;

  className?: string;
  dataTestId?: string;
}
