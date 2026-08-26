import Box from '@mui/material/Box/index.js';
import type { ReactNode } from 'react';

import { Text } from '../../typography/Text/Text';

export interface DescriptionItemProps {
  /**
   * The label text to display
   */
  label: string;

  /**
   * The value to display - can be text, number, or any React node
   */
  value: ReactNode;

  /**
   * Layout orientation
   * - `vertical`: Label above value (default)
   * - `horizontal`: Label and value side by side
   */
  orientation?: 'vertical' | 'horizontal';

  /**
   * Which edge the label and value line up on.
   *
   * - `start` (default): both flush left, the reading order for a form or a
   *   description list.
   * - `center`: both centred over each other — for a pair sitting in a column
   *   of its own, where a left-flush label over a shorter value looks unhinged
   *   from it.
   * - `end`: both flush right, which is what a numeric column wants so its
   *   digits line up with the value above and below.
   *
   * Applies to `vertical`; a `horizontal` pair is already a single line.
   */
  align?: 'start' | 'center' | 'end';

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Test ID for testing purposes
   */
  'data-testid'?: string;
}

/**
 * DescriptionItem - A label-value pair component for displaying read-only information
 *
 * Used for displaying structured metadata, properties, or descriptive information
 * in a consistent vertical layout with a label above the value.
 *
 * @example
 * ```tsx
 * <DescriptionItem
 *   label="Incident ID"
 *   value="INC-12345"
 * />
 * ```
 *
 * @example
 * ```tsx
 * <DescriptionItem
 *   label="Status"
 *   value={<Chip label="Active" color="success" />}
 * />
 * ```
 */
/** `align` in the terms flexbox and CSS each want it. */
const FLEX_ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

// Vertical stacks the label above the value; horizontal sets them side by side
// with the label sized to its content.
const containerSx = (isHorizontal: boolean, align: 'start' | 'center' | 'end') => ({
  display: 'flex',
  flexDirection: isHorizontal ? ('row' as const) : ('column' as const),
  alignItems: isHorizontal ? 'center' : FLEX_ALIGN[align],
  gap: isHorizontal ? 1 : 0,
  // `alignItems` places the two boxes; `textAlign` handles a label or value
  // that WRAPS, whose second line would otherwise fall back to flush-left
  // inside a box the alignment had already centred.
  textAlign: align,
});

const labelStyle = (isHorizontal: boolean) => ({
  textTransform: 'uppercase' as const,
  marginBottom: isHorizontal ? 0 : '0.25rem',
  minWidth: isHorizontal ? ('fit-content' as const) : undefined,
  flexShrink: isHorizontal ? 0 : undefined,
});

const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `description-item-${suffix}`;

export const DescriptionItem: React.FC<DescriptionItemProps> = ({
  label,
  value,
  orientation = 'vertical',
  align = 'start',
  className,
  'data-testid': dataTestId,
}) => {
  const isHorizontal = orientation === 'horizontal';
  const testId = makeTestId(dataTestId);

  return (
    <Box
      className={className}
      sx={containerSx(isHorizontal, align)}
      data-testid={dataTestId || 'description-item'}
    >
      <Text
        variant="caption"
        size="xs"
        color="secondary"
        style={labelStyle(isHorizontal)}
        data-testid={testId('label')}
      >
        {label}
      </Text>
      <Box data-testid={testId('value')}>
        {/* Plain text gets the component's own typography; anything else is
            rendered as given. */}
        {typeof value === 'string' || typeof value === 'number' ? (
          <Text variant="body" size="sm" weight="semibold">
            {value}
          </Text>
        ) : (
          value
        )}
      </Box>
    </Box>
  );
};

DescriptionItem.displayName = 'DescriptionItem';
