import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

export const installPromptStyles = (theme: Theme): CSSObject => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5, 2),
  borderRadius: theme.spacing(1),
  backgroundColor: alpha(theme.palette.primary.main, 0.08),
  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,

  '.install-prompt-icon': {
    flexShrink: 0,
    marginTop: theme.spacing(0.25),
    display: 'flex',
    color: theme.palette.primary.main,
  },

  '.install-prompt-content': {
    flex: 1,
    minWidth: 0,
  },

  '.install-prompt-title': {
    fontWeight: 600,
  },

  '.install-prompt-description': {
    opacity: 0.9,
  },

  '.install-prompt-actions': {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: theme.spacing(1),
  },

  // The actions drop to their own full-width row on a phone, where this
  // component does most of its work.
  [theme.breakpoints.down('sm')]: {
    flexWrap: 'wrap',

    '.install-prompt-actions': {
      width: '100%',
      marginTop: theme.spacing(1),
    },
  },
});
