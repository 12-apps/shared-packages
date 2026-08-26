import Box from '@mui/material/Box';
import React from 'react';

import { EmptyState } from '../EmptyState/EmptyState';
import { ErrorState } from '../ErrorState/ErrorState';
import { LoadingState } from '../LoadingState/LoadingState';

import type { AsyncStateContainerProps } from './AsyncStateContainer.types';

/**
 * AsyncStateContainer - A composition-based wrapper for handling async data states
 *
 * Priority order: loading > error > empty > children
 *
 * @example
 * // With component props (composition pattern)
 * <AsyncStateContainer
 *   isLoading={isLoading}
 *   error={error}
 *   isEmpty={data.length === 0}
 *   loadingComponent={<LoadingState variant="skeleton" />}
 *   errorComponent={<ErrorState message={error} onRetry={refetch} />}
 *   emptyComponent={<EmptyState title="No items" onCreate={handleCreate} />}
 * >
 *   <DataGrid data={data} />
 * </AsyncStateContainer>
 *
 * @example
 * // With render props for more control
 * <AsyncStateContainer
 *   isLoading={isLoading}
 *   error={error}
 *   isEmpty={data.length === 0}
 *   renderLoading={() => <CustomLoader />}
 *   renderError={(error) => <CustomError error={error} />}
 *   renderEmpty={() => <CustomEmpty />}
 * >
 *   <DataGrid data={data} />
 * </AsyncStateContainer>
 */
// The four states render the same wrapper, differing only in data-state and
// what goes inside it.
const StateBox: React.FC<{
  state: 'loading' | 'error' | 'empty' | 'success';
  className?: string;
  dataTestId?: string;
  children: React.ReactNode;
}> = ({ state, className, dataTestId, children }) => (
  <Box
    className={className}
    data-testid={dataTestId || 'async-state-container'}
    data-state={state}
  >
    {children}
  </Box>
);

const errorMessageOf = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
};

// Each state takes a ready-made node, else a render function, else the default.
const pickNode = (
  node: React.ReactNode,
  render: (() => React.ReactNode) | undefined,
  fallback: React.ReactNode,
): React.ReactNode => node || render?.() || fallback;

export const AsyncStateContainer: React.FC<AsyncStateContainerProps> = React.memo(
  ({
    isLoading = false,
    error,
    isEmpty = false,
    children,
    loadingComponent,
    renderLoading,
    errorComponent,
    renderError,
    emptyComponent,
    emptyTitle,
    renderEmpty,
    className,
    dataTestId,
  }) => {
    const box = { className, dataTestId };

    // Priority: loading > error > empty > children
    if (isLoading) {
      return (
        <StateBox state="loading" {...box}>
          {pickNode(loadingComponent, renderLoading, <LoadingState />)}
        </StateBox>
      );
    }

    if (error) {
      const message = errorMessageOf(error);
      return (
        <StateBox state="error" {...box}>
          {errorComponent || renderError?.(message) || <ErrorState message={message} />}
        </StateBox>
      );
    }

    if (isEmpty) {
      return (
        <StateBox state="empty" {...box}>
          {pickNode(emptyComponent, renderEmpty, <EmptyState title={emptyTitle} />)}
        </StateBox>
      );
    }

    return (
      <StateBox state="success" {...box}>
        {children}
      </StateBox>
    );
  },
);

AsyncStateContainer.displayName = 'AsyncStateContainer';

export default AsyncStateContainer;
