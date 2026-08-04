import CloseIcon from '@mui/icons-material/Close';
import { IconButton } from '@mui/material';
import type { FC, ReactNode } from 'react';
import React from 'react';

import { getSizeStyles } from './Badge.styles';
import type { BadgeSize } from './Badge.types';

// CLOSE_ICON_SIZES already exists in Badge.tsx; the size lookup lives here now.
const CLOSE_ICON_SIZES: Record<string, string> = {
  xs: '0.5rem',
  sm: '0.625rem',
  md: '0.75rem',
  lg: '0.875rem',
};

const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `badge-${suffix}`;

const BadgeIcon: FC<{ icon: ReactNode; size: BadgeSize; testId: string }> = ({
  icon,
  size,
  testId,
}) => (
  <span
    key="icon"
    data-testid={testId}
    style={{
      fontSize: getSizeStyles(size).iconSize,
      display: 'inline-flex',
      alignItems: 'center',
    }}
  >
    {icon}
  </span>
);

const BadgeCloseButton: FC<{ size: BadgeSize; testId: string; onClose: (e: React.MouseEvent) => void }> = ({
  size,
  testId,
  onClose,
}) => (
  <IconButton
    key="close"
    size="small"
    onClick={onClose}
    data-testid={testId}
    sx={{
      p: 0,
      ml: 0.5,
      color: 'inherit',
      '& svg': { fontSize: CLOSE_ICON_SIZES[size] ?? CLOSE_ICON_SIZES.lg },
      '&:hover': { opacity: 0.8 },
    }}
  >
    <CloseIcon />
  </IconButton>
);

// The badge's inner run: optional icon, the content itself, optional close
// button. A dot badge shows none of it.
export const buildBadgeContent = ({
  variant,
  size,
  icon,
  closable,
  dataTestId,
  baseContent,
  onClose,
}: {
  variant: string;
  size: BadgeSize;
  icon?: ReactNode;
  closable?: boolean;
  dataTestId?: string;
  baseContent: ReactNode;
  onClose: (e: React.MouseEvent) => void;
}): ReactNode => {
  if (variant === 'dot') return '';

  const testId = makeTestId(dataTestId);
  const parts: ReactNode[] = [];

  if (icon) parts.push(<BadgeIcon key="icon" icon={icon} size={size} testId={testId('icon')} />);

  if (baseContent !== null && baseContent !== undefined) {
    parts.push(
      <span key="content" data-testid={testId('content')}>
        {baseContent}
      </span>,
    );
  }

  if (closable && !variant.includes('dot')) {
    parts.push(
      <BadgeCloseButton key="close" size={size} testId={testId('close')} onClose={onClose} />,
    );
  }

  if (parts.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>{parts}</span>
  );
};
