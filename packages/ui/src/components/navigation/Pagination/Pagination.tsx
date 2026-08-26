import FirstPage from '@mui/icons-material/FirstPage';
import LastPage from '@mui/icons-material/LastPage';
import NavigateBefore from '@mui/icons-material/NavigateBefore';
import NavigateNext from '@mui/icons-material/NavigateNext';
import type { PaginationRenderItemParams } from '@mui/material/Pagination';
import Box from '@mui/material/Box';
import MuiPagination from '@mui/material/Pagination';
import PaginationItem from '@mui/material/PaginationItem';
import { styled } from '@mui/material/styles';
import React from 'react';

import type { ResolvedPaginationProps } from './Pagination.helpers';
import { makeTestId, muiSizeFor, resolvePaginationProps } from './Pagination.helpers';
import { paginationStyles } from './Pagination.styles';
import type { PaginationProps } from './Pagination.types';
import { ItemsPerPageSelect, PageInfo } from './PaginationParts';

const StyledPagination = styled(MuiPagination, {
  shouldForwardProp: (prop) => !['customVariant', 'customSize'].includes(prop as string) })<{ customVariant?: string; customSize?: string }>(({ theme, customVariant, customSize }) => ({
  ...paginationStyles({ theme, customVariant, customSize }) }));

const PaginationContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: theme.spacing(1) }));

// Arrow items get a short suffix, pages carry their number. This was two
// parallel switch statements that differed only in whether the prefix came from
// dataTestId or the literal 'pagination'.
const ITEM_TEST_SUFFIX: Record<string, string> = {
  first: 'first',
  last: 'last',
  previous: 'prev',
  next: 'next' };

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
  size: _size,
  dataTestId,
  icons }: {
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
                textIndent: '-9999px' } }}
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
      next: nextIcon as React.ReactElement };

    return (
      <PaginationItem
        {...item}
        data-testid={itemTestId}
        components={{
          first: () => iconMap.first || <FirstPage />,
          last: () => iconMap.last || <LastPage />,
          previous: () => iconMap.previous || <NavigateBefore />,
          next: () => iconMap.next || <NavigateNext /> }}
      />
    );
  
};

// The control itself. Local because StyledPagination cannot cross a module
// boundary (TS2742).
const PaginationControl: React.FC<
  ResolvedPaginationProps & {
    innerRef: React.Ref<HTMLElement>;
    renderItem: (item: PaginationRenderItemParams) => React.ReactNode;
    rest: Record<string, unknown>;
  }
> = ({ innerRef, renderItem, rest, ...p }) => {
  // The dots variant is a position indicator, not a control: no page numbers
  // around the current one, and no step buttons.
  const isDots = p.variant === 'dots';

  return (
    <StyledPagination
      ref={innerRef}
      page={p.page}
      count={p.count}
      onChange={p.onChange}
      customVariant={p.variant}
      customSize={p.size}
      variant="outlined"
      size={muiSizeFor(p.size)}
      boundaryCount={isDots ? 0 : p.boundaryCount}
      siblingCount={isDots ? 0 : p.siblingCount}
      hideNextButton={p.hideNextButton || isDots}
      hidePrevButton={p.hidePrevButton || isDots}
      showFirstButton={p.showFirstButton && !isDots}
      showLastButton={p.showLastButton && !isDots}
      disabled={p.disabled}
      // MUI spells the unaccented pagination colour `standard`; ours is
      // `neutral`, translated here rather than carried as a second name.
      color={p.color === undefined ? undefined : p.color === 'neutral' ? 'standard' : p.color}
      renderItem={renderItem}
      {...rest}
    />
  );
};

export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (componentProps, ref) => {
    const resolved = resolvePaginationProps(componentProps);
    const {
      pageSizeLabel,
      variant,
      size,
      page,
      count,
      onChange: _onChange,
      boundaryCount: _boundaryCount,
      siblingCount: _siblingCount,
      hideNextButton: _hideNextButton,
      hidePrevButton: _hidePrevButton,
      showFirstButton: _showFirstButton,
      showLastButton: _showLastButton,
      firstIcon,
      lastIcon,
      previousIcon,
      nextIcon,
      disabled,
      color: _color,
      showPageInfo,
      pageInfoFormat,
      showItemsPerPage,
      itemsPerPageOptions,
      itemsPerPage,
      onItemsPerPageChange,
      className,
      dataTestId,
      ...props
    } = resolved;

    const testId = makeTestId(dataTestId);

    const renderItem = (item: PaginationRenderItemParams) =>
      renderPaginationItem({
        item,
        variant,
        size,
        dataTestId,
        icons: { firstIcon, lastIcon, previousIcon, nextIcon } });

    return (
      <PaginationContainer className={className} data-testid={dataTestId || 'pagination'}>
        {showItemsPerPage && onItemsPerPageChange && (
          <ItemsPerPageSelect
            pageSizeLabel={pageSizeLabel}
            value={itemsPerPage}
            options={itemsPerPageOptions}
            size={size}
            disabled={disabled}
            testId={testId('items-per-page')}
            onChange={onItemsPerPageChange}
          />
        )}

        <PaginationControl
          {...resolved}
          innerRef={ref}
          renderItem={renderItem}
          rest={props as unknown as Record<string, unknown>}
        />

        {showPageInfo && (
          <PageInfo size={size} testId={testId('info')}>
            {pageInfoFormat(page, count)}
          </PageInfo>
        )}
      </PaginationContainer>
    );
  },
);

Pagination.displayName = 'Pagination';
