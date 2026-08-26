import Box from '@mui/material/Box/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { FC } from 'react';
import React from 'react';
import { TimelineRow } from './TimelineRow';
import type { TimelineProps } from './Timeline.types';

// ---

// --- Styled Components ---
const TimelineContainer = styled(Box)<{ orientation: 'vertical' | 'horizontal' }>(
  ({ theme, orientation }) => ({
    display: 'flex',
    flexDirection: orientation === 'vertical' ? 'column' : 'row',
    gap: theme.spacing(2),
    position: 'relative',
    width: '100%',
    ...(orientation === 'horizontal' && {
      overflowX: 'auto',
      paddingBottom: theme.spacing(2),
      '&::-webkit-scrollbar': {
        height: 8 },
      '&::-webkit-scrollbar-track': {
        background: alpha(theme.palette.action.disabled, 0.1),
        borderRadius: 4 },
      '&::-webkit-scrollbar-thumb': {
        background: alpha(theme.palette.primary.main, 0.3),
        borderRadius: 4,
        '&:hover': {
          background: alpha(theme.palette.primary.main, 0.5) } } }) }),
);


// ---

// Main component
export const Timeline: FC<TimelineProps> = ({
  items,
  variant = 'default',
  orientation = 'vertical',
  showConnector = true,
  animated = true,
  alternating = false,
  onItemClick }) => {
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const handleExpandClick = (itemId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  return (
    <TimelineContainer
      orientation={orientation}
      data-testid="timeline-container"
    >
      {items.map((item, index) => (
        <TimelineRow
          key={item.id}
          item={item}
          index={index}
          isLast={index === items.length - 1}
          variant={variant}
          orientation={orientation}
          showConnector={showConnector}
          animated={animated}
          alternating={alternating}
          isExpanded={expandedItems.has(item.id)}
          onItemClick={onItemClick}
          onExpandClick={handleExpandClick}
        />
      ))}
    </TimelineContainer>
  );
};

export default Timeline;
