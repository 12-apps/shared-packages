/**
 * The DataGrid's three PLACEHOLDER states: loading, error, and empty.
 *
 * ## Why they carry `data-testid`
 *
 * They used to not, and it was invisible: `data-testid` is destructured out of
 * the props and was re-applied only on the populated render, so a grid whose
 * first paint was any of these three states rendered with NO test id at all.
 * The grid had booted perfectly and simply could not be found — every spec that
 * landed on a screen with no rows yet waited out its whole budget on an element
 * that would only appear once somebody created a row. `stations.e2e.ts` carries
 * a paragraph about working around exactly this.
 *
 * So all four renders now agree: the id names the GRID, not the grid's data.
 * A test that asks "did the grid mount" gets the same answer in every state,
 * and `data-loading` / `data-error` / `data-empty` say WHICH state it is.
 */
import { Box, CircularProgress, Typography } from '@mui/material';
import type React from 'react';

/** Shared by all three: the same box, the same role, the same id. */
interface PlaceholderProps {
  dataTestId?: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  htmlProps: React.HTMLAttributes<HTMLElement>;
  children: React.ReactNode;
  /** The single state flag this placeholder sets (`data-loading` etc.). */
  flag: 'data-loading' | 'data-error' | 'data-empty';
}

function Placeholder({
  dataTestId,
  ariaLabel,
  className,
  style,
  htmlProps,
  children,
  flag,
}: PlaceholderProps): React.JSX.Element {
  return (
    <Box
      data-ui="datagrid"
      {...{ [flag]: 'true' }}
      data-testid={dataTestId}
      className={className}
      style={style}
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 2,
        height: 200,
      }}
      aria-label={ariaLabel}
      role="grid"
      {...htmlProps}
    >
      {children}
    </Box>
  );
}

type StateProps = Omit<PlaceholderProps, 'children' | 'flag'>;

export function DataGridLoading(props: StateProps): React.JSX.Element {
  return (
    <Placeholder {...props} flag="data-loading">
      <CircularProgress />
    </Placeholder>
  );
}

export function DataGridError(
  props: StateProps & { error: React.ReactNode },
): React.JSX.Element {
  const { error, ...rest } = props;
  return (
    <Placeholder {...rest} flag="data-error">
      <Typography color="error" variant="body1">
        {error}
      </Typography>
    </Placeholder>
  );
}

export function DataGridEmpty(
  props: StateProps & { emptyState?: React.ReactNode },
): React.JSX.Element {
  const { emptyState, ...rest } = props;
  return (
    <Placeholder {...rest} flag="data-empty">
      {emptyState ?? (
        <Typography variant="body1" color="text.secondary">
          No data available
        </Typography>
      )}
    </Placeholder>
  );
}
