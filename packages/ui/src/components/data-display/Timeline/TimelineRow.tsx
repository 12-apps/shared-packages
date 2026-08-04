import DotIcon from '@mui/icons-material/Circle';
import ExpandIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Fade,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, keyframes,styled } from '@mui/material/styles';
import React from 'react';

import type { TimelineItem, TimelineProps } from './Timeline.types';

const slideInAnimation = keyframes`from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); }`;
const pulseAnimation = keyframes`0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.8; }`;

const TimelineItemContainer = styled(Box, {
  shouldForwardProp: (prop) => !['animated', 'alternating', 'index'].includes(prop as string),
})<{
  animated: boolean;
  alternating: boolean;
  index: number;
  orientation: 'vertical' | 'horizontal';
}>(({ theme, animated, alternating, index, orientation }) => ({
  display: 'flex',
  gap: theme.spacing(2),
  position: 'relative',
  ...(animated && {
    animation: `${slideInAnimation} 0.5s ease ${index * 0.1}s both`,
  }),
  ...(orientation === 'vertical' &&
    alternating && {
      flexDirection: index % 2 === 0 ? 'row' : 'row-reverse',
      textAlign: index % 2 === 0 ? 'left' : 'right',
    }),
  ...(orientation === 'horizontal' && {
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: 280,
  }),
}));

const TimelineConnector = styled(Box, {
  shouldForwardProp: (prop) => !['isLast'].includes(prop as string),
})<{
  orientation: 'vertical' | 'horizontal';
  isLast: boolean;
}>(({ theme, orientation, isLast }) => ({
  position: 'absolute',
  background: `linear-gradient(180deg, ${theme.palette.primary.main} 0%, ${alpha(theme.palette.primary.main, 0.3)} 100%)`,
  ...(orientation === 'vertical'
    ? {
        width: 2,
        height: isLast ? 0 : 'calc(100% + 16px)',
        left: 19,
        top: 40,
      }
    : {
        height: 2,
        width: isLast ? 0 : '240px',
        top: 19,
        left: 40,
      }),
}));

const TimelineDot = styled(Box, {
  shouldForwardProp: (prop) => !['dotColor', 'hasIcon', 'animated'].includes(prop as string),
})<{ dotColor?: string; hasIcon: boolean; animated: boolean }>(({ theme, dotColor, hasIcon, animated }) => ({
  width: 40,
  height: 40,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: dotColor
    ? `linear-gradient(135deg, ${dotColor} 0%, ${alpha(dotColor, 0.8)} 100%)`
    : `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.light} 100%)`,
  boxShadow: `0 4px 12px ${alpha(dotColor || theme.palette.primary.main, 0.3)}`,
  border: `2px solid ${theme.palette.background.paper}`,
  zIndex: 1,
  flexShrink: 0,
  ...(animated && {
    animation: `${pulseAnimation} 2s ease infinite`,
  }),
  '& svg': {
    fontSize: hasIcon ? '1.2rem' : '0.8rem',
    color: theme.palette.background.paper,
  },
}));

const TimelineCard = styled(Card, {
  shouldForwardProp: (prop) => !['timelineVariant', 'isClickable'].includes(prop as string),
})<{ timelineVariant: 'default' | 'compact' | 'detailed'; isClickable: boolean }>(
  ({ theme, timelineVariant, isClickable }) => ({
    flex: 1,
    background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.8)} 100%)`,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
    transition: theme.transitions.create(['transform', 'box-shadow']),
    ...(isClickable && {
      cursor: 'pointer',
      '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: theme.shadows[8],
      },
    }),
    ...(timelineVariant === 'compact' && {
      padding: theme.spacing(1.5),
      '& .MuiCardContent-root': {
        padding: 0,
        '&:last-child': {
          paddingBottom: 0,
        },
      },
    }),
  }),
);

const TimelineTimestamp = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '0.75rem',
  fontWeight: 500,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
}));

const MetadataChip = styled(Chip)(({ theme }) => ({
  height: 24,
  fontSize: '0.75rem',
  background: alpha(theme.palette.primary.main, 0.08),
  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
}));

// Description, metadata chips and the action button, revealed on expand — or
// always, in the detailed variant.
const TimelineDetails: React.FC<{
  item: TimelineItem;
  isExpanded: boolean;
  variant: NonNullable<TimelineProps['variant']>;
}> = ({ item, isExpanded, variant }) => {
  const open = isExpanded || variant === 'detailed';

  return (
    <Collapse in={open}>
      <Fade in={open}>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {item.description && (
            <Typography variant="body2" color="text.secondary">
              {item.description}
            </Typography>
          )}

          {item.metadata && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(item.metadata).map(([key, value]) => (
                <MetadataChip key={key} label={`${key}: ${value}`} size="small" />
              ))}
            </Box>
          )}

          {item.action && (
            <Box>
              <Button
                size="small"
                variant="contained"
                onClick={(e) => {
                  e.stopPropagation();
                  item.action!.onClick();
                }}
                sx={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                }}
              >
                {item.action.label}
              </Button>
            </Box>
          )}
        </Stack>
      </Fade>
    </Collapse>
  );
};

// Timestamp, title and the expand toggle.
const TimelineCardHeader: React.FC<{
  item: TimelineItem;
  variant: NonNullable<TimelineProps['variant']>;
  isExpanded: boolean;
  onExpandClick: (itemId: string, event: React.MouseEvent) => void;
}> = ({ item, variant, isExpanded, onExpandClick }) => (
  <Box
    sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
  >
    <Box sx={{ flex: 1 }}>
      <TimelineTimestamp data-testid="timeline-timestamp">
        {item.timestamp}
      </TimelineTimestamp>
      <Typography
        variant={variant === 'compact' ? 'body2' : 'h6'}
        fontWeight={variant === 'compact' ? 500 : 600}
        sx={{ mt: 0.5 }}
      >
        {item.title}
      </Typography>
    </Box>
    {item.description && variant !== 'compact' && (
      <IconButton
        size="small"
        onClick={(e) => onExpandClick(item.id, e)}
        aria-label={isExpanded ? 'Collapse item details' : 'Expand item details'}
        sx={{
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s ease',
        }}
      >
        <ExpandIcon />
      </IconButton>
    )}
  </Box>
);

// The card beside the rail: timestamp, title, expand toggle and the collapsible
// detail body.
const TimelineRowCard: React.FC<{
  item: TimelineItem;
  variant: NonNullable<TimelineProps['variant']>;
  isClickable: boolean;
  isExpanded: boolean;
  onItemClick?: (item: TimelineItem) => void;
  onExpandClick: (itemId: string, event: React.MouseEvent) => void;
}> = ({ item, variant, isClickable, isExpanded, onItemClick, onExpandClick }) => (
  <TimelineCard
    timelineVariant={variant}
    isClickable={isClickable}
    onClick={isClickable ? () => onItemClick?.(item) : undefined}
    role="article"
    aria-label={`Timeline item: ${item.title}`}
    data-testid="timeline-card"
  >
    <CardContent>
      <Stack spacing={1}>
        <TimelineCardHeader
          item={item}
          variant={variant}
          isExpanded={isExpanded}
          onExpandClick={onExpandClick}
        />

        {variant === 'compact' && item.description && (
          <Typography variant="caption" color="text.secondary">
            {item.description}
          </Typography>
        )}

        {variant !== 'compact' && (
          <TimelineDetails item={item} isExpanded={isExpanded} variant={variant} />
        )}
      </Stack>
    </CardContent>
  </TimelineCard>
);

// One entry: the dot and connector on the rail, and the card beside it.
export const TimelineRow: React.FC<{
  item: TimelineItem;
  index: number;
  isLast: boolean;
  variant: NonNullable<TimelineProps['variant']>;
  orientation: 'vertical' | 'horizontal';
  showConnector: boolean;
  animated: boolean;
  alternating: boolean;
  isExpanded: boolean;
  onItemClick?: (item: TimelineItem) => void;
  onExpandClick: (itemId: string, event: React.MouseEvent) => void;
}> = ({
  item,
  index,
  isLast,
  variant,
  orientation,
  showConnector,
  animated,
  alternating,
  isExpanded,
  onItemClick,
  onExpandClick,
}) => {

    
  // Determine if item should be clickable:
  // - Has onItemClick callback, OR
  // - Has description and variant is not compact (so it can be expanded)
  const hasExpandableContent = item.description && variant !== 'compact';
  const isClickable = !!onItemClick || !!hasExpandableContent;

  return (
    <TimelineItemContainer
      key={item.id}
      animated={animated}
      alternating={alternating && orientation === 'vertical'}
      index={index}
      orientation={orientation}
      data-testid="timeline-item-container"
    >
      <Box sx={{ position: 'relative' }}>
        <TimelineDot
          dotColor={item.color}
          hasIcon={!!item.icon}
          animated={animated}
          data-testid="timeline-dot"
        >
          {item.icon ? (
            <Box data-testid="item-icon">{item.icon}</Box>
          ) : (
            <DotIcon data-testid="item-icon-default" />
          )}
        </TimelineDot>
        {showConnector && !isLast && (
          <TimelineConnector
            orientation={orientation}
            isLast={isLast}
            data-testid="timeline-connector"
          />
        )}
      </Box>

      <TimelineRowCard
        item={item}
        variant={variant}
        isClickable={isClickable}
        isExpanded={isExpanded}
        onItemClick={onItemClick}
        onExpandClick={onExpandClick}
      />
    </TimelineItemContainer>
  );
};
