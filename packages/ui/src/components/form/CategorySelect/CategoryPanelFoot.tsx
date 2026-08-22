'use client';

import { Box, Button } from '@mui/material';

import type { CategorySelectCopy } from '../../../copy';
import { footerSx, METRICS } from './CategorySelect.styles';

const buttonSx = (sheet: boolean) =>
  ({
    height: sheet ? METRICS.sheetFooterButton : METRICS.footerButton,
    padding: '0 13px',
    borderRadius: '8px',
    fontSize: 12.5,
    fontWeight: 600,
    textTransform: 'none',
    minWidth: 0,
  }) as const;

interface MultiFootProps {
  count: number;
  /** False once the draft matches what is already applied — Apply becomes Close. */
  changed: boolean;
  sheet: boolean;
  onClear: () => void;
  onApply: () => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}

/**
 * Multi-select footer: the running count, Clear, and the Apply that publishes
 * the draft. The primary button reads "Fechar" when nothing changed, so it never
 * promises an update it would not make.
 */
export function CategoryMultiFoot({
  count,
  changed,
  sheet,
  onClear,
  onApply,
  dataTestId,
  copy,
}: MultiFootProps): React.JSX.Element {
  return (
    <Box sx={footerSx} data-testid={`${dataTestId}-footer`}>
      <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        {copy.footer.selectedCount(count)}
      </Box>
      <Box sx={{ display: 'flex', gap: '6px' }}>
        <Button
          variant="outlined"
          disabled={count === 0}
          sx={buttonSx(sheet)}
          onClick={onClear}
          data-testid={`${dataTestId}-clear`}
        >
          {copy.footer.clear}
        </Button>
        <Button
          variant="contained"
          sx={buttonSx(sheet)}
          onClick={onApply}
          data-testid={`${dataTestId}-apply`}
        >
          {changed ? copy.footer.apply : copy.footer.close}
        </Button>
      </Box>
    </Box>
  );
}

/** Single-select footer: a hint and a way out. Picking a row commits directly. */
export function CategorySingleFoot({
  sheet,
  onCancel,
  dataTestId,
  copy,
}: {
  sheet: boolean;
  onCancel: () => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}): React.JSX.Element {
  return (
    <Box sx={footerSx} data-testid={`${dataTestId}-footer`}>
      <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        {copy.footer.singleHint}
      </Box>
      <Button
        variant="outlined"
        sx={buttonSx(sheet)}
        onClick={onCancel}
        data-testid={`${dataTestId}-cancel`}
      >
        {copy.footer.cancel}
      </Button>
    </Box>
  );
}
