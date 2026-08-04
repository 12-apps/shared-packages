import { Box } from '@mui/material';
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
// Vertical stacks the label above the value; horizontal sets them side by side
// with the label sized to its content.
const containerSx = (isHorizontal: boolean) => ({
  display: 'flex',
  flexDirection: isHorizontal ? ('row' as const) : ('column' as const),
  alignItems: isHorizontal ? 'center' : 'flex-start',
  gap: isHorizontal ? 1 : 0,
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
  className,
  'data-testid': dataTestId,
}) => {
  const isHorizontal = orientation === 'horizontal';
  const testId = makeTestId(dataTestId);

  return (
    <Box
      className={className}
      sx={containerSx(isHorizontal)}
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
