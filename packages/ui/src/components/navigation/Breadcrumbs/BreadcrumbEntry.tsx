import Home from '@mui/icons-material/Home';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import { alpha, Box, Fade, Link, Tooltip, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import { breadcrumbLinkStyles } from './Breadcrumbs.styles';
import type { BreadcrumbItem } from './Breadcrumbs.types';

const BreadcrumbLink = styled(Link, {
  shouldForwardProp: (prop) => prop !== 'size' && prop !== 'active' && prop !== 'visualStyle' })<{ size?: string; active?: boolean; visualStyle?: string }>(
  ({ theme, size, active, visualStyle }) => ({
    ...breadcrumbLinkStyles({ theme, size, active, visualStyle }) }),
);

const BreadcrumbText = styled(Typography, {
  shouldForwardProp: (prop) => prop !== 'size' && prop !== 'visualStyle' })<{ size?: string; visualStyle?: string }>(({ theme, size, visualStyle }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  fontSize: size === 'sm' ? '0.875rem' : size === 'lg' ? '1.125rem' : '1rem',
  fontWeight: 600,
  color: theme.palette.primary.main,
  padding: theme.spacing(0.5, 0.75),
  borderRadius: theme.spacing(0.75),
  position: 'relative',

  ...(visualStyle === 'glass' && {
    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
    backdropFilter: 'blur(4px)',
    border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}` }),

  '& .breadcrumb-icon': {
    color: theme.palette.primary.main },

  // Mobile responsiveness
  [theme.breakpoints.down('sm')]: {
    fontSize: size === 'lg' ? '1rem' : size === 'sm' ? '0.75rem' : '0.875rem',
    padding: theme.spacing(0.375, 0.5) } }));

// Animated separator wrapper

// Mobile collapsed menu component
// The list that drops down from the "..." trigger.
const CollapsedItemsPopover: React.FC<{
  open: boolean;
  items: BreadcrumbItem[];
  size: string;
  visualStyle?: string;
  dataTestId?: string;
  onSelect: () => void;
}> = ({ open, items, dataTestId, onSelect }) => (
<Fade in={open}>
    <Box
      sx={{
        background: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgba(17, 24, 39, 0.95)'
            : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderRadius: 1,
        boxShadow: 3,
        p: 1,
        minWidth: 150 }}
    >
      {items.map((item, index) => (
        <Box
          key={index}
          component="a"
          href={item.href || '#'}
          onClick={(e) => {
            onSelect();
            item.onClick?.(e);
          }}
          sx={{
            display: 'block',
            px: 2,
            py: 1,
            color: 'text.secondary',
            textDecoration: 'none',
            borderRadius: 0.5,
            transition: 'all 0.2s',
            '&:hover': {
              backgroundColor: 'action.hover',
              color: 'primary.main' } }}
          data-testid={dataTestId ? `${dataTestId}-collapsed-item-${index}` : `breadcrumbs-collapsed-item-${index}`}
        >
          {item.label}
        </Box>
      ))}
    </Box>
  </Fade>
);

const CollapsedMenu = ({
  items,
  size,
  visualStyle,
  dataTestId }: {
  items: BreadcrumbItem[];
  size: string;
  visualStyle?: string;
  dataTestId?: string;
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <Tooltip title="Show more" arrow>
        <BreadcrumbLink
          onClick={handleClick}
          size={size}
          visualStyle={visualStyle}
          sx={{ cursor: 'pointer' }}
          data-testid={dataTestId ? `${dataTestId}-collapsed-menu` : 'breadcrumbs-collapsed-menu'}
        >
          <MoreHoriz className="breadcrumb-icon" />
        </BreadcrumbLink>
      </Tooltip>
      <Box
        sx={{
          position: 'absolute',
          top: '100%',
          left: 0,
          mt: 1,
          display: open ? 'block' : 'none',
          zIndex: 1000 }}
        data-testid={dataTestId ? `${dataTestId}-collapsed-menu-items` : 'breadcrumbs-collapsed-menu-items'}
      >
        <CollapsedItemsPopover
          open={open}
          items={items}
          size={size}
          visualStyle={visualStyle}
          dataTestId={dataTestId}
          onSelect={handleClose}
        />
      </Box>
    </>
  );
};

// The leading crumb gets a house unless it brings its own icon; everything else
// shows only what it supplies.
const crumbIcon = ({
  item,
  isFirst,
  showHomeIcon,
  iconSize }: {
  item: BreadcrumbItem;
  isFirst: boolean;
  showHomeIcon: boolean;
  iconSize: 'small' | 'medium';
}) => {
  if (isFirst && showHomeIcon && !item.icon) {
    return <Home className="breadcrumb-icon" fontSize={iconSize} />;
  }

  if (!item.icon) return null;

  return (
    <Box component="span" className="breadcrumb-icon" sx={{ display: 'flex', alignItems: 'center' }}>
      {item.icon}
    </Box>
  );
};

const EllipsisCrumb: React.FC<{ label: string; dataTestId?: string }> = ({
  label,
  dataTestId }) => (
  <Tooltip title="More items" arrow>
            <Box
              sx={{
                px: 1,
                color: 'text.disabled',
                cursor: 'default',
                userSelect: 'none' }}
              data-testid={dataTestId ? `${dataTestId}-ellipsis` : 'breadcrumbs-ellipsis'}
            >
              {label}
            </Box>
          </Tooltip>
);

// The same conditional test id was written at each crumb variant. An item that
// names its OWN id wins: see `BreadcrumbItem.dataTestId`.
const makeTestId =
  (dataTestId?: string) =>
  (suffix: string, own?: string): string =>
    own ?? (dataTestId ? `${dataTestId}-${suffix}` : `breadcrumbs-${suffix}`);

const ClickableCrumb: React.FC<{
  item: BreadcrumbItem;
  index: number;
  icon: React.ReactNode;
  size: string;
  variant: string;
  isActive: boolean;
  testId: (suffix: string, own?: string) => string;
}> = ({ item, index, icon, size, variant, isActive, testId }) => (
  <Tooltip title={item.tooltip || item.label} arrow disableHoverListener={!item.tooltip}>
    <BreadcrumbLink
      href={item.href || '#'}
      onClick={item.onClick}
      size={size}
      visualStyle={variant}
      active={isActive}
      underline="none"
      aria-label={item.ariaLabel || item.label}
      data-testid={testId(`link-${index}`, item.dataTestId)}
    >
      {icon}
      <span>{item.label}</span>
    </BreadcrumbLink>
  </Tooltip>
);

// One crumb: the collapsed-menu stand-in, the ellipsis, the active tail item or
// a plain link.
export const BreadcrumbEntry: React.FC<{
  item: BreadcrumbItem & { isEllipsis?: boolean };
  index: number;
  itemCount: number;
  collapsedItems: BreadcrumbItem[];
  collapseBehavior: string;
  separator: React.ReactNode;
  showHomeIcon: boolean;
  iconSize: 'small' | 'medium';
  size: string;
  variant: string;
  dataTestId?: string;
}> = ({
  item,
  index,
  itemCount,
  collapsedItems,
  collapseBehavior,
  separator,
  showHomeIcon,
  iconSize,
  size,
  variant,
  dataTestId }) => {
  const testId = makeTestId(dataTestId);
  const isLast = index === itemCount - 1;
  // The tail crumb is the current page unless it is the ellipsis placeholder.
  const isActive = item.active || (isLast && !item.isEllipsis);

  const isCollapsePoint =
    index === 1 && collapsedItems.length > 0 && collapseBehavior === 'menu';

  if (isCollapsePoint) {
    return (
      <>
        <CollapsedMenu
          items={collapsedItems}
          size={size}
          visualStyle={variant}
          dataTestId={dataTestId}
        />
        {separator}
      </>
    );
  }

  if (item.isEllipsis) {
    return <EllipsisCrumb label={item.label} dataTestId={dataTestId} />;
  }

  const icon = crumbIcon({ item, isFirst: index === 0, showHomeIcon, iconSize });

  if (isActive) {
    return (
      <BreadcrumbText
        size={size}
        visualStyle={variant}
        aria-current="page"
        data-testid={testId(`item-${index}`, item.dataTestId)}
      >
        {icon}
        <span>{item.label}</span>
      </BreadcrumbText>
    );
  }

  return (
    <ClickableCrumb
      item={item}
      index={index}
      icon={icon}
      size={size}
      variant={variant}
      isActive={isActive}
      testId={testId}
    />
  );
};
