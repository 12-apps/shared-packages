import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box/index.js';
import ButtonBase from '@mui/material/ButtonBase/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useEffect, useRef } from 'react';

import { Alert } from '../../data-display/Alert';
import { Progress } from '../../data-display/Progress';
import { Button } from '../../form/Button';
import {
  actionSx,
  backButtonSx,
  categoryDescriptionSx,
  categoryRowSx,
  categoryTextSx,
  closeButtonSx,
  countBadgeSx,
  doneConfirmSx,
  doneIconSx,
  doneSx,
  doneTitleSx,
  footerSx,
  handleSx,
  headerStartSx,
  headerSx,
  introListSx,
  stepLabelSx,
  startAllSx,
  tertiarySx,
  titleSx,
} from './SequenceResolver.styles';
import type { SequenceAction, SequenceDone, SequenceIntro, SequenceStep } from './SequenceResolver.types';

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
}

/** The drag handle (phone), the header row and the progress bar. */
export function SequenceHeader(props: HeaderProps): React.JSX.Element {
  const { touch, label, back, closeLabel, onClose, progress, progressLabel, testId } = props;
  return (
    <>
      {touch ? <Box aria-hidden sx={handleSx} data-testid={`${testId}-handle`} /> : null}
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
          <Typography component="span" sx={stepLabelSx} data-testid={`${testId}-step-label`}>
            {label}
          </Typography>
        </Box>
        <IconButton aria-label={closeLabel} onClick={onClose} sx={closeButtonSx(touch)} data-testid={`${testId}-close`}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Progress
        variant="linear"
        size="md"
        color="warning"
        value={progress}
        aria-label={progressLabel}
        dataTestId={`${testId}-progress`}
      />
    </>
  );
}

/**
 * Moves focus to `target` (else `fallback`) whenever `screenKey` changes — and
 * on mount, which happens inside the dialog's portal, before MUI's focus trap
 * looks: finding focus already inside, the trap and `focusDialogOnEntered`
 * both leave it there.
 */
export function useFocusOnScreen(
  screenKey: string,
  target: React.RefObject<HTMLElement | null>,
  fallback: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    (target.current ?? fallback.current)?.focus();
  }, [screenKey, target, fallback]);
}

/**
 * A button that disables itself under the pointer drops focus to the page
 * behind the dialog. While busy, focus that fell out lands on the step body
 * (`aria-busy`) instead, so a screen reader stays in the dialog.
 */
function useKeepFocusWhileBusy(busy: boolean, body: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!busy) return undefined;
    const rescue = (): void => {
      const node = body.current;
      const active = node?.ownerDocument.activeElement;
      if (node && (!active || active === node.ownerDocument.body)) node.focus();
    };
    rescue();
    const frame = requestAnimationFrame(rescue);
    return () => cancelAnimationFrame(frame);
  }, [busy, body]);
}

interface IntroProps {
  intro: SequenceIntro;
  titleId: string;
  testId: string;
  screenKey: string;
}

/** The kinds with their counts, and "resolve them all". */
export function SequenceIntroBody({ intro, titleId, testId, screenKey }: IntroProps): React.JSX.Element {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  useFocusOnScreen(screenKey, titleRef, titleRef);
  const last = intro.categories.length - 1;
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography component="h2" id={titleId} tabIndex={-1} ref={titleRef} sx={titleSx}>
          {intro.title}
        </Typography>
        {intro.description ? (
          <Typography variant="body2" color="text.secondary">
            {intro.description}
          </Typography>
        ) : null}
      </Box>
      <Box component="ul" sx={introListSx}>
        {intro.categories.map((category, index) => (
          <li key={`${index}-${category.label}`}>
            <ButtonBase
              onClick={category.onPick}
              sx={categoryRowSx(index === last)}
              data-testid={`${testId}-category-${index}`}
            >
              <Box component="span" sx={countBadgeSx}>
                {category.count}
              </Box>
              <Box component="span" sx={categoryTextSx}>
                <Typography component="span" variant="body2" fontWeight={500}>
                  {category.label}
                </Typography>
                {category.description ? (
                  <Typography component="span" sx={categoryDescriptionSx}>
                    {category.description}
                  </Typography>
                ) : null}
              </Box>
              <ChevronRightIcon aria-hidden sx={{ color: 'text.secondary' }} />
            </ButtonBase>
          </li>
        ))}
      </Box>
      <Button
        variant="solid"
        color="primary"
        size="lg"
        fullWidth
        onClick={intro.onStartAll}
        dataTestId={`${testId}-start-all`}
        sx={startAllSx}
      >
        {intro.startAllLabel}
      </Button>
    </>
  );
}

interface StepProps {
  step: SequenceStep;
  /** The default secondary: skip. */
  skip: SequenceAction;
  busy: boolean;
  error: string | null;
  touch: boolean;
  testId: string;
  screenKey: string;
  titleRef: React.RefObject<HTMLElement | null>;
}

function ActionButton({
  action,
  busy,
  touch,
  variant,
  testId,
}: {
  action: SequenceAction;
  busy: boolean;
  touch: boolean;
  variant: 'solid' | 'outline' | 'text';
  testId: string;
}): React.JSX.Element {
  return (
    <Button
      variant={variant}
      color={variant === 'outline' ? 'neutral' : 'primary'}
      size="md"
      onClick={action.onClick}
      disabled={busy || action.disabled}
      dataTestId={testId}
      sx={variant === 'text' ? tertiarySx(touch) : actionSx(touch)}
    >
      {action.label}
    </Button>
  );
}

/** The host's body, its error, the tertiary text button and the footer. */
export function SequenceStepBody(props: StepProps): React.JSX.Element {
  const { step, skip, busy, error, touch, testId, screenKey, titleRef } = props;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useFocusOnScreen(screenKey, titleRef, bodyRef);
  useKeepFocusWhileBusy(busy, bodyRef);
  const secondary = step.secondary === false ? undefined : (step.secondary ?? skip);
  const hasFooter = Boolean(secondary || step.primary);
  return (
    <>
      <Box ref={bodyRef} tabIndex={-1} aria-busy={busy} sx={{ outline: 'none', minWidth: 0 }}>
        {step.content}
      </Box>
      {error ? (
        <Alert variant="danger" announce="assertive" description={error} dataTestId={`${testId}-error`} />
      ) : null}
      {step.tertiary ? (
        <ActionButton action={step.tertiary} busy={busy} touch={touch} variant="text" testId={`${testId}-tertiary`} />
      ) : null}
      {hasFooter ? (
        <Box sx={footerSx(touch, step.footer ?? 'end')} data-testid={`${testId}-footer`}>
          {secondary ? (
            <ActionButton action={secondary} busy={busy} touch={touch} variant="outline" testId={`${testId}-secondary`} />
          ) : null}
          {step.primary ? (
            <ActionButton action={step.primary} busy={busy} touch={touch} variant="solid" testId={`${testId}-primary`} />
          ) : null}
        </Box>
      ) : null}
    </>
  );
}

interface DoneProps {
  done: SequenceDone;
  titleId: string;
  error: string | null;
  touch: boolean;
  onConfirm: () => void;
  testId: string;
  screenKey: string;
}

/** The end screen: a check, the host's title and sentence, one button that closes. */
export function SequenceDoneBody({ done, titleId, error, touch, onConfirm, testId, screenKey }: DoneProps): React.JSX.Element {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  useFocusOnScreen(screenKey, titleRef, titleRef);
  return (
    <Box sx={doneSx} data-testid={`${testId}-done`}>
      <CheckCircleOutlineIcon aria-hidden sx={doneIconSx} />
      <Typography component="h2" id={titleId} tabIndex={-1} ref={titleRef} sx={doneTitleSx}>
        {done.title}
      </Typography>
      {done.description ? (
        <Typography variant="body2" color="text.secondary">
          {done.description}
        </Typography>
      ) : null}
      {error ? (
        <Alert variant="danger" announce="assertive" description={error} dataTestId={`${testId}-error`} />
      ) : null}
      <Button
        variant="solid"
        color="primary"
        size="md"
        fullWidth={touch}
        onClick={onConfirm}
        dataTestId={`${testId}-done-confirm`}
        sx={doneConfirmSx()}
      >
        {done.confirmLabel}
      </Button>
    </Box>
  );
}
