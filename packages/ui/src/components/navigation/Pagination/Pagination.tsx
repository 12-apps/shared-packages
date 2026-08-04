import FirstPage from '@mui/icons-material/FirstPage';
import LastPage from '@mui/icons-material/LastPage';
import NavigateBefore from '@mui/icons-material/NavigateBefore';
import NavigateNext from '@mui/icons-material/NavigateNext';
import type { PaginationRenderItemParams } from '@mui/material';
import {
  alpha,
  Box,
  FormControl,
  MenuItem,
  Pagination as MuiPagination,
  PaginationItem,
  Select,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import { paginationStyles } from './Pagination.styles';
import type { PaginationProps } from './Pagination.types';

const StyledPagination = styled(MuiPagination, {
  shouldForwardProp: (prop) => !['customVariant', 'customSize'].includes(prop as string),
})<{ customVariant?: string; customSize?: string }>(({ theme, customVariant, customSize }) => ({
  ...paginationStyles({ theme, customVariant, customSize }),
}));

const PageInfoContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  marginLeft: theme.spacing(2),
}));

const ItemsPerPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  marginRight: theme.spacing(2),
}));

const PaginationContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: theme.spacing(1),
}));

// Arrow items get a short suffix, pages carry their number. This was two
// parallel switch statements that differed only in whether the prefix came from
// dataTestId or the literal 'pagination'.
const ITEM_TEST_SUFFIX: Record<string, string> = {
  first: 'first',
  last: 'last',
  previous: 'prev',
  next: 'next',
};

const paginationItemTestId = (
  base: string | undefined,
  item: PaginationRenderItemParams,
): string | undefined => {
  const prefix = base ?? 'pagination';

  if (item.type === 'page') return `${prefix}-page-${item.page}`;

  const suffix = ITEM_TEST_SUFFIX[item.type];
  return suffix ? `${prefix}-${suffix}` : undefined;
};

// A dots-variant page renders as a bare dot; everything else uses MUI's item
// with our own arrow icons.
const renderPaginationItem = ({
  item,
  variant,
  size,
  dataTestId,
  icons,
}: {
  item: PaginationRenderItemParams;
  variant: string;
  size: string;
  dataTestId?: string;
  icons: {
    firstIcon?: React.ReactNode;
    lastIcon?: React.ReactNode;
    previousIcon?: React.ReactNode;
    nextIcon?: React.ReactNode;
  };
}) => {
  const { firstIcon, lastIcon, previousIcon, nextIcon } = icons;

    const itemTestId = paginationItemTestId(dataTestId, item);

    if (variant === 'dots') {
      if (item.type === 'page') {
        return (
          <PaginationItem
            {...item}
            data-testid={itemTestId}
            sx={{
              '&.MuiPaginationItem-page': {
                fontSize: 0,
                overflow: 'hidden',
                textIndent: '-9999px',
              },
            }}
          />
        );
      }
      return null; // Hide navigation buttons for dots
    }

    // Map custom icons to components
    const iconMap: Record<string, React.ReactElement> = {
      first: firstIcon as React.ReactElement,
      last: lastIcon as React.ReactElement,
      previous: previousIcon as React.ReactElement,
      next: nextIcon as React.ReactElement,
    };

    return (
      <PaginationItem
        {...item}
        data-testid={itemTestId}
        components={{
          first: () => iconMap.first || <FirstPage />,
          last: () => iconMap.last || <LastPage />,
          previous: () => iconMap.previous || <NavigateBefore />,
          next: () => iconMap.next || <NavigateNext />,
        }}
      />
    );
  
};

export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (
    {
      variant = 'default',
      size = 'md',
      page,
      count,
      onChange,
      boundaryCount = 1,
      siblingCount = 1,
      hideNextButton = false,
      hidePrevButton = false,
      showFirstButton = false,
      showLastButton = false,
      firstIcon = <FirstPage />,
      lastIcon = <LastPage />,
      previousIcon = <NavigateBefore />,
      nextIcon = <NavigateNext />,
      disabled = false,
      color = 'primary',
      showPageInfo = false,
      pageInfoFormat = (page, count) => `Page ${page} of ${count}`,
      showItemsPerPage = false,
      itemsPerPageOptions = [10, 25, 50, 100],
      itemsPerPage = 10,
      onItemsPerPageChange,
      className,
      dataTestId,
      ...props
    },
    ref,
  ) => {
    // For dots variant, we show fewer pages
    const adjustedBoundaryCount = variant === 'dots' ? 0 : boundaryCount;
    const adjustedSiblingCount = variant === 'dots' ? 0 : siblingCount;

    const renderItem = (item: PaginationRenderItemParams) =>
      renderPaginationItem({
        item,
        variant,
        size,
        dataTestId,
        icons: { firstIcon, lastIcon, previousIcon, nextIcon },
      });

    return (
      <PaginationContainer className={className} data-testid={dataTestId || 'pagination'}>
        {showItemsPerPage && onItemsPerPageChange && (
          <ItemsPerPageContainer>
            <Typography variant="body2" color="text.secondary">
              Show:
            </Typography>
            <FormControl size="small" sx={{ minWidth: 80 }}>
              <Select
                value={itemsPerPage}
                onChange={(e) => onItemsPerPageChange(e.target.value as number)}
                disabled={disabled}
                data-testid={dataTestId ? `${dataTestId}-items-per-page` : 'pagination-items-per-page'}
                sx={{
                  '& .MuiSelect-select': {
                    fontSize: size === 'sm' ? '0.875rem' : size === 'lg' ? '1.125rem' : '1rem',
                    py: size === 'sm' ? 0.5 : size === 'lg' ? 1.5 : 1,
                  },
                }}
              >
                {itemsPerPageOptions.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </ItemsPerPageContainer>
        )}

        <StyledPagination
          ref={ref}
          page={page}
          count={count}
          onChange={onChange}
          customVariant={variant}
          customSize={size}
          variant="outlined"
          size={size === 'sm' ? 'small' : size === 'lg' ? 'large' : 'medium'}
          boundaryCount={adjustedBoundaryCount}
          siblingCount={adjustedSiblingCount}
          hideNextButton={hideNextButton || variant === 'dots'}
          hidePrevButton={hidePrevButton || variant === 'dots'}
          showFirstButton={showFirstButton && variant !== 'dots'}
          showLastButton={showLastButton && variant !== 'dots'}
          disabled={disabled}
          color={color}
          renderItem={renderItem}
          {...props}
        />

        {showPageInfo && (
          <PageInfoContainer>
            <Typography
              variant="body2"
              color="text.secondary"
              fontSize={size === 'sm' ? '0.75rem' : size === 'lg' ? '1rem' : '0.875rem'}
              data-testid={dataTestId ? `${dataTestId}-info` : 'pagination-info'}
            >
              {pageInfoFormat(page, count)}
            </Typography>
          </PageInfoContainer>
        )}
      </PaginationContainer>
    );
  },
);

Pagination.displayName = 'Pagination';
