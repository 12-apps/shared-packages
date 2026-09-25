import type { Theme } from '@mui/material/styles/index.js';

import type { WorkflowStepItem, WorkflowStepProps } from './WorkflowStep.types';
import { neutralTones } from '../../../tokens/ink';
import { paletteKey } from '../../../tokens/scales';

type StepColor = NonNullable<WorkflowStepProps['color']>;
type StepSize = NonNullable<WorkflowStepProps['size']>;

const INDICATOR_SIZE: Record<StepSize, number> = {
  xs: 20,
  sm: 24,
  md: 32,
  lg: 40,
  xl: 48,
};

export const indicatorSizeFor = (size?: StepSize): number =>
  INDICATOR_SIZE[size as StepSize] ?? INDICATOR_SIZE.md;

interface StepPalette {
  main: string;
  contrastText: string;
}

/**
 * The step's colour pair, keyed through `paletteKey` so `danger` reads MUI's
 * `error` (the palette has no `danger`). `neutral` lands on `grey`, a ramp with
 * no `main`, so its pair is derived from the ramp — with the contrast computed,
 * not assumed.
 */
export const stepPalette = (theme: Theme, color?: StepColor): StepPalette => {
  const key = paletteKey(color || 'primary');
  if (key === 'grey') {
    const main = neutralTones(theme).emphasis;
    return {
      main,
      contrastText: theme.palette.getContrastText(main),
    };
  }

  return theme.palette[key];
};

export interface StepColors {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

interface StepState {
  isActive: boolean;
  isCompleted: boolean;
  isError: boolean;
  variant?: WorkflowStepProps['variant'];
}

/**
 * An indicator is one of four things, in priority order: failed, done, the step
 * you are on, or still ahead. Only the active one respects `variant` — an active
 * outlined step stays hollow with a coloured rim.
 */
export const stepColors = (
  theme: Theme,
  palette: StepPalette,
  { isActive, isCompleted, isError, variant }: StepState,
): StepColors => {
  if (isError) {
    return {
      backgroundColor: theme.palette.error.main,
      borderColor: theme.palette.error.main,
      textColor: theme.palette.error.contrastText,
    };
  }

  if (isCompleted) {
    return {
      backgroundColor: palette.main,
      borderColor: palette.main,
      textColor: palette.contrastText,
    };
  }

  if (isActive) {
    const filled = variant === 'filled';
    return {
      backgroundColor: filled ? palette.main : theme.palette.background.paper,
      borderColor: palette.main,
      textColor: filled ? palette.contrastText : palette.main,
    };
  }

  return {
    backgroundColor: neutralTones(theme).track,
    borderColor: neutralTones(theme).track,
    textColor: theme.palette.text.secondary,
  };
};

/**
 * A step that declares `error` keeps it; the rest are positioned against
 * `currentStep`, so a caller only has to move one number to advance the workflow.
 */
export const withDerivedStatus = (
  steps: WorkflowStepItem[],
  currentStep: number,
): WorkflowStepItem[] =>
  steps.map((step, index) => {
    const derivable =
      step.status === 'pending' || step.status === 'current' || step.status === 'completed';

    if (!derivable) return { ...step, status: step.status };

    if (index < currentStep) return { ...step, status: 'completed' as const };
    if (index === currentStep) return { ...step, status: 'current' as const };
    return { ...step, status: 'pending' as const };
  });

type WorkflowDefaultedKeys =
  | 'currentStep'
  | 'variant'
  | 'orientation'
  | 'color'
  | 'size'
  | 'showProgress'
  | 'animated'
  | 'interactive'
  | 'showNumbers'
  | 'showIcons'
  | 'disabled';

type ResolvedWorkflowStepProps = WorkflowStepProps &
  Required<Pick<WorkflowStepProps, WorkflowDefaultedKeys>>;

const WORKFLOW_DEFAULTS: Pick<WorkflowStepProps, WorkflowDefaultedKeys> = {
  currentStep: 0,
  variant: 'default',
  orientation: 'horizontal',
  color: 'primary',
  size: 'md',
  showProgress: true,
  animated: true,
  interactive: false,
  showNumbers: true,
  showIcons: false,
  disabled: false,
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: WorkflowStepProps): Partial<WorkflowStepProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<WorkflowStepProps>;

export const resolveWorkflowStepProps = (
  props: WorkflowStepProps,
): ResolvedWorkflowStepProps =>
  ({ ...WORKFLOW_DEFAULTS, ...definedProps(props) }) as ResolvedWorkflowStepProps;
