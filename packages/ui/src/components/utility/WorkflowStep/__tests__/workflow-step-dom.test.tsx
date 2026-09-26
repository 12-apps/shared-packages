/**
 * WORKFLOWSTEP KEEPS ITS STYLE PROPS OFF THE DOM AND NEVER READS "undefined" (FUT-2671).
 *
 * `animated` is a style prop of the step indicator. It must be filtered by the
 * indicator's `shouldForwardProp`, or React warns that a `<div>` received a
 * non-boolean attribute. React passes the prop name as a `%s` ARGUMENT, not in
 * the format string, so every argument of every call is searched. React also
 * warns only once per prop name per module, so the spy is installed before
 * this file's first render.
 *
 * `aria-valuetext` names the current step's title only when that step exists.
 * An out-of-range `currentStep` (or no steps at all) reads `Step N of M`, with
 * the statuses left as they were.
 *
 * FUT-2773: `StepConnector`'s transition now gates on `animated` too, the same
 * way the indicator's already did. And `aria-valuenow`/`aria-valuemax` are no
 * longer asserted unclamped for an out-of-range `currentStep` — the value is
 * clamped to the valid step range, and with no steps at all both attributes
 * are omitted rather than describing an invalid range (`0 > -1`).
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { WorkflowStep } from '../WorkflowStep';
import type { WorkflowStepItem } from '../WorkflowStep.types';

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterAll(() => {
  consoleError.mockRestore();
});

const theme = createTheme();

const twoSteps: WorkflowStepItem[] = [
  { title: 'Pedido', status: 'pending' },
  { title: 'Pagamento', status: 'pending' },
];

const fourSteps: WorkflowStepItem[] = [
  { title: 'Step One', status: 'completed' },
  { title: 'Step Two', status: 'current' },
  { title: 'Step Three', status: 'pending' },
  { title: 'Step Four', status: 'pending' },
];

function renderWorkflow(props: { steps: WorkflowStepItem[]; currentStep: number; animated?: boolean }) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkflowStep data-testid="workflow" {...props} />
    </ThemeProvider>,
  );
}

function callsMentioning(word: string): unknown[][] {
  return consoleError.mock.calls.filter((args) => args.some((arg) => String(arg).includes(word)));
}

describe('WorkflowStep DOM props', () => {
  it('sends `animated` to no DOM element, whether left at its default or turned off', () => {
    const first = renderWorkflow({ steps: twoSteps, currentStep: 0 });
    first.unmount();
    renderWorkflow({ steps: twoSteps, currentStep: 0, animated: false });

    expect(callsMentioning('animated')).toEqual([]);
  });

  it('keeps the indicator transition: animated by default, none when turned off', () => {
    const animatedView = renderWorkflow({ steps: twoSteps, currentStep: 0 });
    const animatedTransition = getComputedStyle(screen.getByTestId('workflow-indicator-0')).transition;
    expect(animatedTransition).not.toBe('none');
    for (const property of ['background-color', 'border-color', 'transform']) {
      expect(animatedTransition).toContain(property);
    }
    animatedView.unmount();

    renderWorkflow({ steps: twoSteps, currentStep: 0, animated: false });
    expect(getComputedStyle(screen.getByTestId('workflow-indicator-0')).transition).toBe('none');
  });

  it('gates the connector transition on `animated` the same way as the indicator', () => {
    const animatedView = renderWorkflow({ steps: twoSteps, currentStep: 0 });
    const animatedTransition = getComputedStyle(screen.getByTestId('workflow-connector-0')).transition;
    expect(animatedTransition).not.toBe('none');
    expect(animatedTransition).toContain('background-color');
    animatedView.unmount();

    renderWorkflow({ steps: twoSteps, currentStep: 0, animated: false });
    expect(getComputedStyle(screen.getByTestId('workflow-connector-0')).transition).toBe('none');
  });
});

describe('WorkflowStep aria-valuetext', () => {
  it.each([
    { name: 'currentStep one past the last step', steps: twoSteps, currentStep: 2, text: 'Step 3 of 2' },
    { name: 'currentStep below zero', steps: twoSteps, currentStep: -1, text: 'Step 0 of 2' },
    { name: 'no steps at all', steps: [], currentStep: 0, text: 'Step 1 of 0' },
  ])('reads $text with $name, and never "undefined"', ({ steps, currentStep, text }) => {
    renderWorkflow({ steps, currentStep });

    const valueText = screen.getByRole('progressbar').getAttribute('aria-valuetext');
    expect(valueText).toBe(text);
    expect(valueText).not.toContain('undefined');
  });

  it('clamps aria-valuenow to the highest valid step when currentStep is past the last index', () => {
    renderWorkflow({ steps: twoSteps, currentStep: 2 });

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '1');
    expect(progressBar).toHaveAttribute('aria-valuemax', '1');
  });

  it('clamps aria-valuenow to the lowest valid step when currentStep is negative', () => {
    renderWorkflow({ steps: twoSteps, currentStep: -1 });

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '1');
  });

  it('omits aria-valuenow and aria-valuemax entirely when there are no steps', () => {
    renderWorkflow({ steps: [], currentStep: 0 });

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).not.toHaveAttribute('aria-valuenow');
    expect(progressBar).not.toHaveAttribute('aria-valuemax');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
  });

  it('still names the current step when it exists', () => {
    renderWorkflow({ steps: fourSteps, currentStep: 1 });

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 2 of 4: Step Two');
  });
});
