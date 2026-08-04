import ArrowForwardIos from '@mui/icons-material/ArrowForwardIos';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Home from '@mui/icons-material/Home';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import NavigateNext from '@mui/icons-material/NavigateNext';
import {
  alpha,
  Box,
  Breadcrumbs as MuiBreadcrumbs,
  Fade,
  Link,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { keyframes,styled } from '@mui/material/styles';
import React from 'react';

import {
  breadcrumbLinkStyles,
  breadcrumbsBarStyles,
  pulse,
  sizeIconMap,
  slideIn,
} from './Breadcrumbs.styles';
import { BreadcrumbEntry } from './BreadcrumbEntry';
import type { BreadcrumbItem,BreadcrumbsProps } from './Breadcrumbs.types';

// Animation keyframes
const StyledBreadcrumbs = styled(MuiBreadcrumbs, {
  shouldForwardProp: (prop) =>
    prop !== 'size' && prop !== 'color' && prop !== 'visualStyle' && prop !== 'elevation',
})<{ size?: string; color?: string; visualStyle?: string; elevation?: number }>(
  ({ theme, size, color, visualStyle, elevation = 0 }) => ({
    ...breadcrumbsBarStyles({ theme, size, color, visualStyle, elevation }),
  }),
);

const AnimatedSeparator = styled(Box)(() => ({
  display: 'flex',
  alignItems: 'center',
  opacity: 0.6,
  transition: 'all 0.2s ease',

  '&:hover': {
    opacity: 1,
    transform: 'scale(1.1)',
  },
}));

const getSeparator = (separatorType: string) => {
  const separatorContent = (() => {
    switch (separatorType) {
      case 'slash':
        return '/';
      case 'arrow':
        return <NavigateNext fontSize="small" />;
      case 'chevron':
        return <ChevronRight fontSize="small" />;
      case 'dot':
        return '•';
      case 'pipe':
        return '|';
      default:
        return <ArrowForwardIos sx={{ fontSize: 12 }} />;
    }
  })();

  return <AnimatedSeparator>{separatorContent}</AnimatedSeparator>;
};

type DisplayItem = BreadcrumbItem & { isEllipsis?: boolean };

// Long trails either hide their middle behind a menu or replace it with an
// ellipsis crumb; short ones pass straight through.
const collapseItems = ({
  items,
  effectiveMaxItems,
  collapseBehavior,
}: {
  items: BreadcrumbItem[];
  effectiveMaxItems: number;
  collapseBehavior: string;
}): { displayItems: DisplayItem[]; collapsedItems: BreadcrumbItem[] } => {
  if (items.length <= effectiveMaxItems) {
    return { displayItems: items, collapsedItems: [] };
  }

  if (collapseBehavior === 'menu') {
    const firstItem = items[0];
    const tail = items.slice(-(effectiveMaxItems - 2));

    return {
      displayItems: firstItem ? [firstItem, ...tail] : tail,
      collapsedItems: items.slice(1, -(effectiveMaxItems - 2)),
    };
  }

  if (collapseBehavior === 'ellipsis') {
    const half = Math.floor(effectiveMaxItems / 2);

    return {
      displayItems: [
        ...items.slice(0, half),
        { label: '...', href: '#', isEllipsis: true },
        ...items.slice(-half),
      ],
      collapsedItems: [],
    };
  }

  return { displayItems: items, collapsedItems: [] };
};

export const Breadcrumbs = React.forwardRef<HTMLElement, BreadcrumbsProps>(
  (
    {
      variant = 'default',
      separatorType = 'default',
      items,
      separator,
      maxItems = 8,
      showHomeIcon = true,
      size = 'md',
      color = 'default',
      elevation = 1,
      collapseBehavior = 'menu',
      mobileMaxItems = 3,
      ariaLabel,
      dataTestId,
      ...props
    },
    ref,
  ) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const finalSeparator = separator || getSeparator(separatorType);
    const iconSize = sizeIconMap[size];

    // Handle mobile collapsing
    const effectiveMaxItems = isMobile ? mobileMaxItems : maxItems;
    const shouldCollapse = items.length > effectiveMaxItems;

    const { displayItems, collapsedItems } = collapseItems({
      items,
      effectiveMaxItems,
      collapseBehavior,
    });

    return (
      <StyledBreadcrumbs
        ref={ref}
        separator={separator}
        maxItems={shouldCollapse ? undefined : effectiveMaxItems}
        size={size}
        color={color}
        visualStyle={variant}
        elevation={elevation}
        aria-label={ariaLabel || 'breadcrumb navigation'}
        role="navigation"
        data-testid={dataTestId || 'breadcrumbs'}
        {...props}
      >
        {displayItems.map((item, index) => (
          <BreadcrumbEntry
            key={index}
            item={item}
            index={index}
            itemCount={displayItems.length}
            collapsedItems={collapsedItems}
            collapseBehavior={collapseBehavior}
            separator={separator}
            showHomeIcon={showHomeIcon}
            iconSize={iconSize}
            size={size}
            variant={variant}
            dataTestId={dataTestId}
          />
        ))}
      </StyledBreadcrumbs>
    );
  },
);

Breadcrumbs.displayName = 'Breadcrumbs';
