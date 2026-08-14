'use client';

import { Box } from '@mui/material';

import { CaretGlyph } from './CategoryIcons';
import {
  triggerChevronSx,
  triggerClearSx,
  triggerCountSx,
  triggerSx,
} from './CategorySelect.styles';

interface CategoryTriggerProps {
  /** Text shown when nothing is selected. */
  placeholder: string;
  /** Resolved label when there IS a selection (single mode shows "Pai › Filha"). */
  selectionLabel?: string;
  /** Selection size — rendered as the count pill in multi-select. */
  count?: number;
  open: boolean;
  disabled?: boolean;
  fullWidth: boolean;
  onOpen: () => void;
  /** Absent when there is nothing to clear. */
  onClear?: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  dataTestId: string;
}

/**
 * The closed control.
 *
 * The clear (×) is a real button nested in the trigger button, so "remove the
 * filter" is one click from the closed state — without it, clearing means open,
 * find Clear, apply. Its click is stopped from reaching the trigger, which would
 * otherwise open the panel on the way out.
 */
export function CategoryTrigger({
  placeholder,
  selectionLabel,
  count,
  open,
  disabled,
  fullWidth,
  onOpen,
  onClear,
  triggerRef,
  dataTestId,
}: CategoryTriggerProps): React.JSX.Element {
  const hasSelection = Boolean(selectionLabel) || (count ?? 0) > 0;
  return (
    <Box
      component="button"
      type="button"
      ref={triggerRef}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid={`${dataTestId}-trigger`}
      onClick={onOpen}
      sx={(theme) => ({
        ...triggerSx(theme, hasSelection, open),
        width: fullWidth ? '100%' : 'auto',
      })}
    >
      <Box
        component="span"
        sx={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 190,
          flex: fullWidth ? 1 : '0 1 auto',
          textAlign: 'left',
        }}
      >
        {selectionLabel ?? placeholder}
      </Box>
      {count !== undefined && count > 0 && (
        <Box component="span" sx={triggerCountSx} data-testid={`${dataTestId}-count`}>
          {count}
        </Box>
      )}
      {hasSelection && onClear && (
        <Box
          component="span"
          role="button"
          tabIndex={0}
          aria-label="Limpar seleção"
          data-testid={`${dataTestId}-clear-trigger`}
          sx={triggerClearSx}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onClear();
          }}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            onClear();
          }}
        >
          ×
        </Box>
      )}
      <CaretGlyph style={triggerChevronSx(open) as React.CSSProperties} />
    </Box>
  );
}
