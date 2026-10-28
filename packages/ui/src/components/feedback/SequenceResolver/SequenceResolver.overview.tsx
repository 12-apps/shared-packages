import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type * as React from 'react';

import { Button } from '../../form/Button';
import { useFocusOnScreen } from './SequenceResolver.parts';
import {
  actionSx,
  categoryDescriptionSx,
  categoryTextSx,
  overviewFooterSx,
  overviewRowSx,
} from './SequenceResolver.styles';
import type { SequenceOverviewCategory } from './SequenceResolver.types';

interface OverviewProps {
  categories: SequenceOverviewCategory[];
  /** Per category: false when none of its problems is left unanswered. */
  canPick: (category: SequenceOverviewCategory) => boolean;
  onPick: (category: SequenceOverviewCategory) => void;
  pickLabel: string;
  continueLabel: string;
  onContinue: () => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  touch: boolean;
  testId: string;
}

/**
 * "Ver todos" inside the run: each kind (its label says how many, as the host writes it) and a pick that jumps
 * there, then "continue in sequence" back to the step it left. The title is
 * in the header row (it names the dialog); focus goes to it on open.
 */
export function SequenceOverviewBody(props: OverviewProps): React.JSX.Element {
  const { categories, canPick, onPick, pickLabel, continueLabel, onContinue, titleRef, touch, testId } = props;
  useFocusOnScreen('overview', titleRef, titleRef);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }} data-testid={`${testId}-overview`}>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {categories.map((category, index) => (
          <Box component="li" key={`${index}-${category.label}`} sx={overviewRowSx}>
            <Box sx={categoryTextSx}>
              <Typography component="span" variant="body2" fontWeight={500}>
                {category.label}
              </Typography>
              {category.description ? (
                <Typography component="span" sx={categoryDescriptionSx}>
                  {category.description}
                </Typography>
              ) : null}
            </Box>
            <Button
              variant="outline"
              color="primary"
              size="md"
              onClick={() => onPick(category)}
              disabled={!canPick(category)}
              aria-label={`${pickLabel}: ${category.label}`}
              sx={actionSx(touch)}
              dataTestId={`${testId}-overview-pick-${index}`}
            >
              {pickLabel}
            </Button>
          </Box>
        ))}
      </Box>
      <Box sx={overviewFooterSx}>
        <Button variant="solid" color="primary" size="md" onClick={onContinue} sx={actionSx(touch)} dataTestId={`${testId}-continue`}>
          {continueLabel}
        </Button>
      </Box>
    </Box>
  );
}
