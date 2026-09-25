/**
 * EVERY `ColorValue` RENDERS A WORKFLOW (FUT-2635).
 *
 * `color` is typed `ColorValue`, which includes `danger` — but MUI's palette has
 * no `danger` key, so indexing `theme.palette[color]` handed the step and its
 * connector `undefined` and the first `.main` took the tree down. The step and
 * the connector must resolve the colour through `paletteKey`, the package's one
 * `danger → error` mapping.
 *
 * `currentStep={1}` leaves step 0 COMPLETED, so both paths run: the indicator's
 * palette and the connector's, which is only read once a step is done.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { neutralTones } from '../../../../tokens/ink';
import { COLOR_VALUES } from '../../../../tokens/scales';
import type { ColorValue } from '../../../../tokens/scales';
import { WorkflowStep } from '../WorkflowStep';
import { stepPalette } from '../WorkflowStep.helpers';

const theme = createTheme();

const steps = [
  { title: 'Pedido', status: 'pending' as const },
  { title: 'Pagamento', status: 'pending' as const },
  { title: 'Entrega', status: 'pending' as const },
];

/** What a completed step's colour should be, spelled out rather than re-derived. */
const EXPECTED_MAIN: Record<ColorValue, string> = {
  primary: theme.palette.primary.main,
  secondary: theme.palette.secondary.main,
  success: theme.palette.success.main,
  warning: theme.palette.warning.main,
  info: theme.palette.info.main,
  danger: theme.palette.error.main,
  neutral: neutralTones(theme).emphasis,
};

function renderWorkflow(color: ColorValue) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkflowStep steps={steps} currentStep={1} color={color} data-testid="workflow" />
    </ThemeProvider>,
  );
}

describe('WorkflowStep colours', () => {
  it.each(COLOR_VALUES)('renders a completed %s step and its connector', (color) => {
    expect(() => renderWorkflow(color)).not.toThrow();

    expect(screen.getByTestId('workflow-indicator-0')).toHaveStyle({
      backgroundColor: EXPECTED_MAIN[color],
    });
    expect(screen.getByTestId('workflow-connector-0')).toHaveStyle({
      backgroundColor: EXPECTED_MAIN[color],
    });
  });

  it('maps danger onto the palette error entry', () => {
    expect(stepPalette(theme, 'danger').main).toBe(theme.palette.error.main);
    expect(stepPalette(theme, 'danger').contrastText).toBe(theme.palette.error.contrastText);
  });

  it('keeps neutral on grey 600 with a computed contrast text', () => {
    const main = neutralTones(theme).emphasis;
    expect(stepPalette(theme, 'neutral')).toEqual({
      main,
      contrastText: theme.palette.getContrastText(main),
    });
  });
});
