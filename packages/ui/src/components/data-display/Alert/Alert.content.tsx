import AlertTitle from '@mui/material/AlertTitle/index.js';
import Box from '@mui/material/Box/index.js';
import React from 'react';

import { sxRem } from '../../../tokens/relative';

import { testIdFor } from './Alert.helpers';
import { DESCRIPTION, ICON_SLOT, TITLE, TITLE_ICON } from './Alert.metrics';
import type { AlertProps } from './Alert.types';

const BREAK_WORDS = {
  wordWrap: 'break-word',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
} as const;

/**
 * The message column: title, description, then whatever the caller put inside.
 *
 * `titleIcon` is the icon when it sits on the title's line
 * (`iconPlacement: 'title'`, see `Alert.placement.ts`). The title then shares
 * a row with it, and the description below is a sibling of that row — so it
 * starts at the column's own edge rather than under the title's first letter.
 */
export const AlertContent: React.FC<{
  title?: AlertProps['title'];
  description?: AlertProps['description'];
  titleIcon?: React.ReactNode;
  dataTestId?: string;
  children?: React.ReactNode;
}> = ({ title, description, titleIcon, dataTestId, children }) => {
  const heading = title ? (
    <AlertTitle
      data-testid={testIdFor(dataTestId, 'title')}
      sx={{
        fontWeight: TITLE.fontWeight,
        fontSize: sxRem(TITLE.fontSize),
        // On the icon's row the title is centred against the glyph, so MUI's
        // 2px lift would only push it off that centre.
        ...(titleIcon ? { margin: 0 } : { marginBottom: description ? TITLE.marginBottomUnits : 0 }),
        ...BREAK_WORDS,
      }}
    >
      {title}
    </AlertTitle>
  ) : null;

  return (
    <>
      {titleIcon && heading ? (
        <Box
          data-testid={testIdFor(dataTestId, 'title-row')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: TITLE_ICON.gapUnits,
            marginBottom: description ? TITLE.marginBottomUnits : 0,
            '& > span': { display: 'flex', flex: 'none', fontSize: sxRem(ICON_SLOT.size) },
          }}
        >
          {titleIcon}
          {heading}
        </Box>
      ) : (
        heading
      )}
      {description && (
        <Box
          component="div"
          data-testid={testIdFor(dataTestId, 'message')}
          sx={{ opacity: DESCRIPTION.opacity, fontSize: sxRem(DESCRIPTION.fontSize), ...BREAK_WORDS }}
        >
          {description}
        </Box>
      )}
      {children}
    </>
  );
};
