/**
 * A PER-STEP `disabled` INDICATOR MUST NOT ACTIVATE ON CLICK OR ENTER/SPACE (FUT-2863).
 *
 * FUT-2773 wired the already-computed `isDisabled` (`disabled || step.disabled`)
 * into the indicator's `tabIndex` and `aria-disabled`, but left `handleClick`
 * and `handleKeyDown` gated on the narrower component-level `disabled` alone.
 * So a step whose OWN `disabled: true` rendered `tabIndex="-1"` and
 * `aria-disabled="true"` (correct) yet still ran `onClick` on a `click` or an
 * `Enter`/`Space` `keydown` (wrong) — `tabIndex={-1}` only removes an element
 * from the tab sequence, it does not stop it from being clicked or activated.
 *
 * `StepIndicatorComponent` — not the public `WorkflowStep` wrapper — is
 * rendered directly here, with a plain `onClick` mock standing in for the
 * `onClick` prop it is given. The public wrapper's own `handleStepClick`
 * (`WorkflowStep.tsx`) has ALWAYS re-checked `step.disabled` itself, so a
 * story or test that goes through `<WorkflowStep onStepClick={...}>` cannot
 * observe this component's own gating defect — that outer re-check papers
 * over it. `StepIndicatorComponent`'s `onClick` prop carries no such
 * assumption (a caller composing it directly gets exactly what the indicator
 * itself decides to call), which is the surface this ticket is about.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StepIndicatorComponent } from '../WorkflowStep.parts';
import type { StepIndicatorProps } from '../WorkflowStep.types';

const theme = createTheme();

function renderIndicator(props: Partial<StepIndicatorProps> & { step: StepIndicatorProps['step'] }) {
  return render(
    <ThemeProvider theme={theme}>
      <StepIndicatorComponent
        index={0}
        isActive={false}
        isCompleted={false}
        isError={false}
        variant="default"
        color="primary"
        size="md"
        showNumbers
        showIcons={false}
        interactive
        animated={false}
        disabled={false}
        data-testid="indicator"
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('StepIndicatorComponent per-step disabled click/keydown gating', () => {
  it('marks a per-step-disabled indicator tabIndex="-1" and aria-disabled="true" (regression, FUT-2773)', () => {
    renderIndicator({ step: { title: 'Pedido', status: 'current', disabled: true } });

    const indicator = screen.getByTestId('indicator');
    expect(indicator).toHaveAttribute('tabIndex', '-1');
    expect(indicator).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onClick on click when only the STEP itself is disabled', () => {
    const onClick = vi.fn();
    renderIndicator({ step: { title: 'Pedido', status: 'current', disabled: true }, onClick });

    fireEvent.click(screen.getByTestId('indicator'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not call onClick on Enter when only the STEP itself is disabled', () => {
    const onClick = vi.fn();
    renderIndicator({ step: { title: 'Pedido', status: 'current', disabled: true }, onClick });

    fireEvent.keyDown(screen.getByTestId('indicator'), { key: 'Enter' });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not call onClick on Space when only the STEP itself is disabled', () => {
    const onClick = vi.fn();
    renderIndicator({ step: { title: 'Pedido', status: 'current', disabled: true }, onClick });

    fireEvent.keyDown(screen.getByTestId('indicator'), { key: ' ' });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('guard: component-level disabled still suppresses onClick, whatever step.disabled is', () => {
    const onClick = vi.fn();
    renderIndicator({
      step: { title: 'Pedido', status: 'current', disabled: false },
      disabled: true,
      onClick,
    });

    fireEvent.click(screen.getByTestId('indicator'));
    fireEvent.keyDown(screen.getByTestId('indicator'), { key: 'Enter' });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('guard: an enabled step still fires onClick on click and on Enter/Space', () => {
    const onClick = vi.fn();
    renderIndicator({ step: { title: 'Pedido', status: 'current' }, onClick });

    fireEvent.click(screen.getByTestId('indicator'));
    fireEvent.keyDown(screen.getByTestId('indicator'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('indicator'), { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(3);
    expect(onClick).toHaveBeenCalledWith(0, expect.objectContaining({ title: 'Pedido' }));
  });
});
