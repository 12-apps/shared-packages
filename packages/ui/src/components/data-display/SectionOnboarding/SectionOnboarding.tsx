'use client';

import CheckCircle from '@mui/icons-material/CheckCircle';
import { Box, Button, Collapse, Stack, Typography, useTheme } from '@mui/material';
import React from 'react';

import { EmptyState } from '../EmptyState/EmptyState';
import { Stepper } from '../Stepper/Stepper';
import type { SectionOnboardingProps } from './SectionOnboarding.types';

/** The setup steps rendered above the hero / form. Returns null when omitted. */
const OnboardingSteps: React.FC<
  Pick<SectionOnboardingProps, 'steps' | 'activeStepId' | 'completedStepIds'> & {
    dataTestId: string;
  }
> = ({ steps, activeStepId, completedStepIds, dataTestId }) => {
  if (!steps || steps.length === 0) return null;
  // Preview mode (no active step): highlight the first so the flow reads L→R.
  const activeId = activeStepId ?? steps[0]?.id ?? '';
  return (
    <Box sx={{ width: '100%', overflowX: 'auto', pb: 1 }}>
      <Stepper
        steps={steps}
        activeId={activeId}
        completed={new Set(completedStepIds ?? [])}
        size="sm"
        data-testid={`${dataTestId}-steps`}
      />
    </Box>
  );
};

/** The compact "already connected" header shown in the configured state. */
const ConfiguredSummary: React.FC<
  Pick<SectionOnboardingProps, 'configuredTitle' | 'title' | 'configuredSummary'> & {
    dataTestId: string;
    expanded: boolean;
    onToggle: () => void;
    editLabel: string;
    collapseLabel: string;
    hasChildren: boolean;
  }
> = ({
  configuredTitle,
  title,
  configuredSummary,
  dataTestId,
  expanded,
  onToggle,
  editLabel,
  collapseLabel,
  hasChildren,
}) => {
  const theme = useTheme();
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      data-testid={`${dataTestId}-summary`}
    >
      <CheckCircle sx={{ color: theme.palette.success.main }} aria-hidden />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" component="h3" fontWeight="medium">
          {configuredTitle ?? title}
        </Typography>
        {configuredSummary && (
          <Typography variant="body2" color="text.secondary" component="div">
            {configuredSummary}
          </Typography>
        )}
      </Box>
      {hasChildren && (
        <Button
          variant="outlined"
          size="small"
          onClick={onToggle}
          aria-expanded={expanded}
          data-testid={`${dataTestId}-edit-toggle`}
        >
          {expanded ? collapseLabel : editLabel}
        </Button>
      )}
    </Stack>
  );
};

/**
 * Per-section onboarding wrapper: the same config surface renders three ways
 * depending on `status`, so a first-time user meets a friendly hero + CTA
 * instead of a wall of empty fields, while a returning user sees a compact
 * "it's connected" summary with the form tucked behind an "Editar" toggle.
 *
 * Composes the existing {@link EmptyState} (the hero) and {@link Stepper} (the
 * progress preview) — drop it onto any settings/integration page and drive it
 * from whatever "is this configured?" signal the feature already has.
 */
/** Configured state: compact success summary + the form behind an "Editar" toggle. */
const ConfiguredView: React.FC<SectionOnboardingProps> = ({
  title,
  configuredTitle,
  configuredSummary,
  editLabel = 'Editar',
  collapseLabel = 'Ocultar',
  defaultExpanded = false,
  children,
  className,
  dataTestId = 'section-onboarding',
}) => {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  return (
    <Box
      className={className}
      data-testid={dataTestId}
      data-status="configured"
      sx={{ p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}
    >
      <ConfiguredSummary
        configuredTitle={configuredTitle}
        title={title}
        configuredSummary={configuredSummary}
        dataTestId={dataTestId}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
        editLabel={editLabel}
        collapseLabel={collapseLabel}
        hasChildren={Boolean(children)}
      />
      {children && (
        <Collapse in={expanded} unmountOnExit>
          <Box sx={{ mt: 3 }} data-testid={`${dataTestId}-content`}>
            {children}
          </Box>
        </Collapse>
      )}
    </Box>
  );
};

/** In-progress state (or a started hero): the live stepper + the form. */
const InProgressView: React.FC<SectionOnboardingProps & { statusAttr: string }> = ({
  steps,
  activeStepId,
  completedStepIds,
  children,
  className,
  statusAttr,
  dataTestId = 'section-onboarding',
}) => (
  <Stack className={className} data-testid={dataTestId} data-status={statusAttr} spacing={3}>
    <OnboardingSteps
      steps={steps}
      activeStepId={activeStepId}
      completedStepIds={completedStepIds}
      dataTestId={dataTestId}
    />
    {children && <Box data-testid={`${dataTestId}-content`}>{children}</Box>}
  </Stack>
);

/** Unconfigured hero: optional step preview + the EmptyState hero + CTA. */
const HeroView: React.FC<SectionOnboardingProps & { onStart: () => void }> = ({
  title,
  description,
  illustration,
  steps,
  activeStepId,
  completedStepIds,
  primaryAction,
  startLabel,
  secondaryAction,
  helpLink,
  children,
  className,
  onStart,
  dataTestId = 'section-onboarding',
}) => {
  // With no custom primaryAction, offer a built-in CTA that reveals the form.
  const heroPrimary =
    primaryAction ?? (children ? { label: startLabel, onClick: onStart } : undefined);
  return (
    <Stack className={className} data-testid={dataTestId} data-status="unconfigured" spacing={1}>
      <OnboardingSteps
        steps={steps}
        activeStepId={activeStepId}
        completedStepIds={completedStepIds}
        dataTestId={dataTestId}
      />
      <EmptyState
        variant={illustration ? 'illustrated' : 'action'}
        title={title}
        description={description}
        illustration={illustration}
        primaryAction={heroPrimary}
        secondaryAction={secondaryAction}
        helpLink={helpLink}
        dataTestId={`${dataTestId}-hero`}
      />
    </Stack>
  );
};

export const SectionOnboarding: React.FC<SectionOnboardingProps> = (props) => {
  // Lets the hero reveal the form in place, so a server page can adopt
  // onboarding by passing `status` + children alone — no client wrapper.
  const [started, setStarted] = React.useState(false);

  if (props.status === 'configured') {
    return <ConfiguredView {...props} />;
  }
  if (props.status === 'in-progress' || started) {
    return (
      <InProgressView
        {...props}
        statusAttr={props.status === 'in-progress' ? 'in-progress' : 'started'}
      />
    );
  }
  return <HeroView {...props} onStart={() => setStarted(true)} />;
};

SectionOnboarding.displayName = 'SectionOnboarding';

export default SectionOnboarding;
