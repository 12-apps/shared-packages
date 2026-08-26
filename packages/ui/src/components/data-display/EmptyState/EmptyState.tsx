import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import React from 'react';

import type { EmptyStateProps } from './EmptyState.types';

type EmptyStateVariant = NonNullable<EmptyStateProps['variant']>;

const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `empty-state-${suffix}`;

interface ActionSpec {
  key: string;
  variant: 'contained' | 'outlined';
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}

// The four buttons are one button with different props. Listing them keeps their
// order — primary, create, secondary, refresh — visible in one place.
const actionsOf = (
  props: EmptyStateProps,
  refreshLabel: string,
  createLabel: string,
): ActionSpec[] => {
  const { primaryAction, secondaryAction, onCreate, onRefresh } = props;
  const specs: ActionSpec[] = [];

  if (primaryAction) {
    specs.push({
      key: 'primary-action',
      variant: 'contained',
      onClick: primaryAction.onClick,
      label: primaryAction.label,
    });
  }
  if (onCreate) {
    specs.push({
      key: 'create-button',
      variant: 'contained',
      onClick: onCreate,
      label: createLabel,
      icon: <AddIcon />,
    });
  }
  if (secondaryAction) {
    specs.push({
      key: 'secondary-action',
      variant: 'outlined',
      onClick: secondaryAction.onClick,
      label: secondaryAction.label,
    });
  }
  if (onRefresh) {
    specs.push({
      key: 'refresh-button',
      variant: 'outlined',
      onClick: onRefresh,
      label: refreshLabel,
      icon: <RefreshIcon />,
    });
  }

  return specs;
};

const Illustration: React.FC<{
  illustration: React.ReactNode;
  variant: EmptyStateVariant;
  testId: string;
}> = ({ illustration, variant, testId }) => (
  <Box
    data-testid={testId}
    sx={{
      maxWidth: variant === 'illustrated' ? 240 : 120,
      width: '100%',
      height: 'auto',
      opacity: variant === 'minimal' ? 0.6 : 0.8,
      display: variant === 'minimal' ? 'none' : 'block',
    }}
  >
    {illustration}
  </Box>
);

const Actions: React.FC<{
  specs: ActionSpec[];
  testId: (suffix: string) => string;
}> = ({ specs, testId }) => {
  const theme = useTheme();

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      alignItems="center"
      sx={{ mt: theme.spacing(2) }}
    >
      {specs.map((spec) => (
        <Button
          key={spec.key}
          variant={spec.variant}
          onClick={spec.onClick}
          startIcon={spec.icon}
          data-testid={testId(spec.key)}
          sx={{ minWidth: 120 }}
        >
          {spec.label}
        </Button>
      ))}
    </Stack>
  );
};

const HelpLink: React.FC<{
  helpLink: NonNullable<EmptyStateProps['helpLink']>;
  testId: string;
}> = ({ helpLink, testId }) => {
  const theme = useTheme();

  return (
    <Link
      href={helpLink.href}
      target={helpLink.external ? '_blank' : undefined}
      rel={helpLink.external ? 'noopener noreferrer' : undefined}
      data-testid={testId}
      sx={{
        mt: theme.spacing(1),
        color: theme.palette.primary.main,
        textDecoration: 'none',
        '&:hover': {
          textDecoration: 'underline',
        },
      }}
    >
      {helpLink.label}
      {helpLink.external && ' ↗'}
    </Link>
  );
};

const Content: React.FC<{
  title: string;
  description?: string;
  titleId: string;
  testId: (suffix: string) => string;
  actions: ActionSpec[];
  showActions: boolean;
  helpLink?: EmptyStateProps['helpLink'];
}> = ({ title, description, titleId, testId, actions, showActions, helpLink }) => {
  const theme = useTheme();

  return (
    <Stack spacing={2} alignItems="center">
      <Typography
        id={titleId}
        variant="h6"
        component="h3"
        data-testid={testId('title')}
        sx={{
          fontWeight: theme.typography.fontWeightMedium,
          color: theme.palette.text.primary,
          maxWidth: 400,
        }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid={testId('description')}
          sx={{
            maxWidth: 480,
            lineHeight: 1.6,
          }}
        >
          {description}
        </Typography>
      )}

      {showActions && <Actions specs={actions} testId={testId} />}

      {helpLink && <HelpLink helpLink={helpLink} testId={testId('help-link')} />}
    </Stack>
  );
};

export const EmptyState: React.FC<EmptyStateProps> = React.memo((props) => {
  const {
    variant = 'default',
    title,
    description,
    illustration,
    helpLink,
    refreshLabel = 'Refresh',
    createLabel = 'Create New',
    className,
    dataTestId,
  } = props;
  const theme = useTheme();
  const titleId = React.useId();
  const testId = makeTestId(dataTestId);

  const actions = actionsOf(props, refreshLabel, createLabel);
  // The `action` variant reserves the action row even when nothing fills it.
  const showActions = variant === 'action' || actions.length > 0;

  return (
    <Box
      role="region"
      aria-labelledby={titleId}
      className={className}
      data-testid={dataTestId || 'empty-state'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: theme.spacing(6),
        minHeight: 200,
        gap: theme.spacing(3),
      }}
    >
      {/* Illustration */}
      {illustration && (
        <Illustration
          illustration={illustration}
          variant={variant}
          testId={testId('icon')}
        />
      )}

      {/* Content */}
      <Content
        title={title}
        description={description}
        titleId={titleId}
        testId={testId}
        actions={actions}
        showActions={showActions}
        helpLink={helpLink}
      />
    </Box>
  );
});

EmptyState.displayName = 'EmptyState';

export default EmptyState;
