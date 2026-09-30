/**
 * WORKFLOWSTEP GIVES ONE TAB STOP PER INTERACTIVE STEP, NOT TWO (FUT-2773).
 *
 * FUT-2671 fixed the indicator's own `animated`-leak and its "undefined"
 * `aria-valuetext`; it never touched tab stops. `StepIndicatorComponent` and
 * `StepContentComponent` each rendered their own `role="button"`/`tabIndex`,
 * so one interactive step gave a screen reader two stops for what a caller
 * means as a single clickable step. Only the indicator keeps the role — it
 * already carries `aria-label="Step N: <title>"` — the content block is
 * inert (no `role`, no `tabIndex`).
 *
 * A disabled interactive step keeps `role="button"` (matching a native
 * `<button disabled>`) but gains `aria-disabled="true"`; a non-interactive
 * step omits `tabIndex` entirely instead of setting it to `-1`, so it carries
 * no `tabindex` attribute at all.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkflowStep } from '../WorkflowStep';
import type { WorkflowStepItem, WorkflowStepProps } from '../WorkflowStep.types';

const theme = createTheme();

const steps: WorkflowStepItem[] = [
  { title: 'Pedido', status: 'completed' },
  { title: 'Pagamento', status: 'current' },
  { title: 'Entrega', status: 'pending' },
];

function renderWorkflow(props: Partial<WorkflowStepProps> & { steps: WorkflowStepItem[] }) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkflowStep data-testid="workflow" currentStep={1} {...props} />
    </ThemeProvider>,
  );
}

describe('WorkflowStep tab stops', () => {
  it('exposes exactly one focusable role="button" element per interactive step, not two', () => {
    renderWorkflow({ steps, interactive: true });

    expect(screen.getAllByRole('button')).toHaveLength(steps.length);
  });

  it('keeps the indicator as the single interactive element; its content block is inert', () => {
    renderWorkflow({ steps, interactive: true });

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-label', 'Step 1: Pedido');

    const content = screen.getByTestId('workflow-content-0');
    expect(content).not.toHaveAttribute('role');
    expect(content).not.toHaveAttribute('tabIndex');
  });

  it('marks a disabled interactive step aria-disabled, without giving it tabIndex 0', () => {
    renderWorkflow({ steps, interactive: true, disabled: true });

    const indicator = screen.getByTestId('workflow-indicator-0');
    expect(indicator).toHaveAttribute('role', 'button');
    expect(indicator).toHaveAttribute('aria-disabled', 'true');
    expect(indicator).not.toHaveAttribute('tabIndex', '0');
  });

  it('marks a per-step disabled interactive step aria-disabled too', () => {
    const stepsWithDisabled: WorkflowStepItem[] = [
      { title: 'Pedido', status: 'completed', disabled: true },
      { title: 'Pagamento', status: 'current' },
    ];
    renderWorkflow({ steps: stepsWithDisabled, interactive: true });

    const indicator = screen.getByTestId('workflow-indicator-0');
    expect(indicator).toHaveAttribute('aria-disabled', 'true');
    expect(indicator).not.toHaveAttribute('tabIndex', '0');
  });

  it('omits tabIndex entirely on a non-interactive step, rather than setting it to -1', () => {
    renderWorkflow({ steps }); // interactive defaults to false

    const indicator = screen.getByTestId('workflow-indicator-0');
    const content = screen.getByTestId('workflow-content-0');
    expect(indicator).not.toHaveAttribute('tabIndex');
    expect(content).not.toHaveAttribute('tabIndex');
  });
});
