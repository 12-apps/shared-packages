import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import type * as React from 'react';

import { Progress } from '../../data-display/Progress';
import { Button } from '../../form/Button';
import { seeAllButtonSx, seeAllFrameSx, seeAllGridSx } from './SequenceResolver.header.styles';
import {
  backButtonSx,
  closeButtonSx,
  handleSx,
  headerStartSx,
  headerSx,
  overviewTitleSx,
  stepLabelSx,
} from './SequenceResolver.styles';

interface HeaderProps {
  touch: boolean;
  label: string;
  /** Absent: no back button (intro, first step, or the host turned it off). */
  back?: { label: string; accessible?: string; onClick: () => void; disabled: boolean };
  closeLabel: string;
  onClose: () => void;
  progress: number;
  progressLabel: string;
  testId: string;
  /** "Ver todos (N)": a text button between the label and close. */
  seeAll?: { label: string; onClick: () => void; disabled: boolean };
  /** The overview's title, drawn in the label's place and naming the dialog. */
  title?: { id: string; text: string; ref: React.RefObject<HTMLHeadingElement | null> };
}

function Bar({ progress, progressLabel, testId }: Pick<HeaderProps, 'progress' | 'progressLabel' | 'testId'>): React.JSX.Element {
  return (
    <Progress variant="linear" size="md" color="warning" value={progress} aria-label={progressLabel} dataTestId={`${testId}-progress`} />
  );
}

function CloseButton({ touch, closeLabel, onClose, testId }: Pick<HeaderProps, 'touch' | 'closeLabel' | 'onClose' | 'testId'>) {
  return (
    <IconButton aria-label={closeLabel} onClick={onClose} sx={closeButtonSx(touch)} data-testid={`${testId}-close`} data-sr-close="">
      <CloseIcon />
    </IconButton>
  );
}

/**
 * The header every resolver had before "Ver todos" (FUT-3671): Back and the
 * label (which takes its own row on a narrow sheet rather than squeeze) and
 * close, the bar under them. Over the overview the title takes the label's place.
 */
function PlainHeader(props: HeaderProps): React.JSX.Element {
  const { touch, label, back, testId, title } = props;
  return (
    <>
      <Box sx={headerSx}>
        <Box sx={headerStartSx}>
          {back ? (
            <Button
              variant="text"
              color="primary"
              size="md"
              icon={<ChevronLeftIcon />}
              aria-label={back.accessible}
              onClick={back.onClick}
              disabled={back.disabled}
              sx={backButtonSx(touch)}
              dataTestId={`${testId}-back`}
            >
              {back.label}
            </Button>
          ) : null}
          {title ? (
            <Typography component="h2" id={title.id} tabIndex={-1} ref={title.ref} sx={overviewTitleSx}>
              {title.text}
            </Typography>
          ) : (
            <Typography component="span" sx={stepLabelSx} data-testid={`${testId}-step-label`}>
              {label}
            </Typography>
          )}
        </Box>
        <CloseButton {...props} />
      </Box>
      <Bar {...props} />
    </>
  );
}

/**
 * The header of a run with "Ver todos (N)" (FUT-3825): one grid, so the ONE
 * step label node sits on the header's line or, on a narrow chrome, on its own
 * line under the bar — never beside it. Nothing on the line is cut.
 */
function SeeAllHeader(props: HeaderProps & { seeAll: NonNullable<HeaderProps['seeAll']> }): React.JSX.Element {
  const { touch, label, back, testId, seeAll } = props;
  return (
    <Box sx={seeAllFrameSx}>
      <Box sx={seeAllGridSx} data-testid={`${testId}-header`}>
        {back ? (
          <Button
            variant="text"
            color="primary"
            size="md"
            icon={<ChevronLeftIcon />}
            aria-label={back.accessible ?? back.label}
            onClick={back.onClick}
            disabled={back.disabled}
            sx={backButtonSx(touch)}
            dataTestId={`${testId}-back`}
            data-sr-back=""
          >
            <span data-back-word="">{back.label}</span>
          </Button>
        ) : null}
        <Typography component="span" data-sr-label="" data-testid={`${testId}-step-label`}>
          {label}
        </Typography>
        <Button
          variant="text"
          color="primary"
          size="md"
          onClick={seeAll.onClick}
          disabled={seeAll.disabled}
          sx={seeAllButtonSx(touch)}
          dataTestId={`${testId}-see-all`}
          data-sr-see=""
        >
          {seeAll.label}
        </Button>
        <CloseButton {...props} />
        <Box data-sr-bar="">
          <Bar {...props} />
        </Box>
      </Box>
    </Box>
  );
}

/** The drag handle (phone), the header row and the progress bar. */
export function SequenceHeader(props: HeaderProps): React.JSX.Element {
  const { touch, testId, seeAll } = props;
  return (
    <>
      {touch ? <Box aria-hidden sx={handleSx} data-testid={`${testId}-handle`} /> : null}
      {seeAll ? <SeeAllHeader {...props} seeAll={seeAll} /> : <PlainHeader {...props} />}
    </>
  );
}
