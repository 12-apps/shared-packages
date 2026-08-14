'use client';

import { Box, Button } from '@mui/material';

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
}: MultiFootProps): React.JSX.Element {
  return (
    <Box sx={footerSx} data-testid={`${dataTestId}-footer`}>
      <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        <strong>{count}</strong> selecionada{count === 1 ? '' : 's'}
      </Box>
      <Box sx={{ display: 'flex', gap: '6px' }}>
        <Button
          variant="outlined"
          disabled={count === 0}
          sx={buttonSx(sheet)}
          onClick={onClear}
          data-testid={`${dataTestId}-clear`}
        >
          Limpar
        </Button>
        <Button
          variant="contained"
          sx={buttonSx(sheet)}
          onClick={onApply}
          data-testid={`${dataTestId}-apply`}
        >
          {changed ? 'Aplicar' : 'Fechar'}
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
}: {
  sheet: boolean;
  onCancel: () => void;
  dataTestId: string;
}): React.JSX.Element {
  return (
    <Box sx={footerSx} data-testid={`${dataTestId}-footer`}>
      <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        Escolha uma categoria
      </Box>
      <Button
        variant="outlined"
        sx={buttonSx(sheet)}
        onClick={onCancel}
        data-testid={`${dataTestId}-cancel`}
      >
        Cancelar
      </Button>
    </Box>
  );
}
