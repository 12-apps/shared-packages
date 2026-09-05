import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Link from '@mui/material/Link/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { type ActionIconName, type ActionSpec, actionsOf, makeTestId } from './EmptyState.helpers';
import {
  ACTION_MIN_WIDTH,
  ACTIONS_GAP_UNITS,
  ACTIONS_MARGIN_TOP_UNITS,
  CONTENT_GAP_UNITS,
  DESCRIPTION_LINE_HEIGHT,
  DESCRIPTION_MAX_WIDTH,
  EMPTY_STATE_GAP_UNITS,
  EMPTY_STATE_MIN_HEIGHT,
  EMPTY_STATE_PADDING_UNITS,
  EXTERNAL_LINK_MARK,
  HELP_LINK_MARGIN_TOP_UNITS,
  illustrationMaxWidth,
  illustrationOpacity,
  TITLE_MAX_WIDTH,
} from './EmptyState.metrics';
import type { EmptyStateProps, EmptyStateVariant } from './EmptyState.types';
import { resolveTestId } from '../../../platform/test-id';

/** The shared action list names its glyph; the web draws it with MUI's icon. */
const ACTION_ICONS: Record<ActionIconName, React.ReactNode> = {
  Add: <AddIcon />,
  Refresh: <RefreshIcon />,
};

const Illustration: React.FC<{
  illustration: React.ReactNode;
  variant: EmptyStateVariant;
  testId: string;
}> = ({ illustration, variant, testId }) => (
  <Box
    data-testid={testId}
    sx={{
      maxWidth: illustrationMaxWidth(variant),
      width: '100%',
      height: 'auto',
      opacity: illustrationOpacity(variant),
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
      spacing={ACTIONS_GAP_UNITS}
      alignItems="center"
      sx={{ mt: theme.spacing(ACTIONS_MARGIN_TOP_UNITS) }}
    >
      {specs.map((spec) => (
        <Button
          key={spec.key}
          variant={spec.variant}
          onClick={spec.onClick}
          startIcon={spec.icon && ACTION_ICONS[spec.icon]}
          data-testid={testId(spec.key)}
          sx={{ minWidth: ACTION_MIN_WIDTH }}
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
        mt: theme.spacing(HELP_LINK_MARGIN_TOP_UNITS),
        color: theme.palette.primary.main,
        textDecoration: 'none',
        '&:hover': {
          textDecoration: 'underline',
        },
      }}
    >
      {helpLink.label}
      {helpLink.external && EXTERNAL_LINK_MARK}
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
    <Stack spacing={CONTENT_GAP_UNITS} alignItems="center">
      <Typography
        id={titleId}
        variant="h6"
        component="h3"
        data-testid={testId('title')}
        sx={{
          fontWeight: theme.typography.fontWeightMedium,
          color: theme.palette.text.primary,
          maxWidth: TITLE_MAX_WIDTH,
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
            maxWidth: DESCRIPTION_MAX_WIDTH,
            lineHeight: DESCRIPTION_LINE_HEIGHT,
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
  } = props;
  const theme = useTheme();
  const titleId = React.useId();
  // `dataTestId` is the documented spelling; `testID`, the shared contract's
  // other one, resolves to the same id.
  const dataTestId = resolveTestId(props);
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
        padding: theme.spacing(EMPTY_STATE_PADDING_UNITS),
        minHeight: EMPTY_STATE_MIN_HEIGHT,
        gap: theme.spacing(EMPTY_STATE_GAP_UNITS),
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
