import Box from '@mui/material/Box/index.js';
import React, { forwardRef, useId } from 'react';

import { Icon } from '../../../icons';
import { Button } from '../../form/Button';

import { useSettingCard } from './SettingCard.hooks';
import { LearnMore, PendingSpinner, SaveError, SettingHeader, partTestId } from './SettingCard.parts';
import { SETTING_CARD_OPEN_ATTR, actionsStyles, summaryStyles, surfaceStyles, withCallerSx } from './SettingCard.styles';
import type { SettingCardCopy, SettingCardProps } from './SettingCard.types';

interface OpenBodyProps {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  titleId: string;
  errorId: string;
  copy: SettingCardCopy;
  learnMore?: React.ReactNode;
  children: React.ReactNode;
  saving: boolean;
  error: string | null;
  saveDisabled: boolean;
  onSave: () => void;
  onCancel: () => void;
  dataTestId?: string;
}

/**
 * The open card: the host's form, the disclosure, the failure line, and the
 * two actions.
 *
 * Save is NOT `disabled` while it saves — it is `aria-disabled` and ignores
 * the click. A disabled button drops the focus it holds, so a keyboard user
 * who pressed Save would land on `<body>` and, if the save then failed, have
 * to find their way back to the form from the top of the page.
 */
const OpenBody: React.FC<OpenBodyProps> = ({
  bodyRef, titleId, errorId, copy, learnMore, children, saving, error, saveDisabled, onSave, onCancel, dataTestId,
}) => {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onCancel();
  };

  return (
    <Box
      ref={bodyRef}
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}
      data-testid={partTestId(dataTestId, 'body')}
    >
      <Box>{children}</Box>
      {learnMore && (
        <LearnMore label={copy.learnMore} dataTestId={dataTestId}>
          {learnMore}
        </LearnMore>
      )}
      <SaveError id={errorId} message={error} dataTestId={dataTestId} />
      <Box sx={(theme) => actionsStyles(theme)}>
        <Button variant="ghost" color="neutral" onClick={onCancel} disabled={saving} dataTestId={partTestId(dataTestId, 'cancel')}>
          {copy.cancel}
        </Button>
        <Button
          variant="solid"
          onClick={onSave}
          disabled={saveDisabled}
          aria-disabled={saving || undefined}
          aria-describedby={error ? errorId : undefined}
          icon={saving ? <PendingSpinner dataTestId={dataTestId} /> : undefined}
          iconPosition="left"
          dataTestId={partTestId(dataTestId, 'save')}
        >
          {saving ? copy.saving : copy.save}
        </Button>
      </Box>
    </Box>
  );
};

/**
 * A setting, summarised while closed and edited in place.
 *
 * Closed: title, status pill, a one-line summary and Edit. Edit opens the card
 * where it is — no dialog, no route — around the host's form, a "learn more"
 * disclosure and Cancel / Save. Save may be async: the card holds its saving
 * state while the promise is pending, closes when it resolves, and stays open
 * with the error when it rejects. Focus moves into the card as it opens and
 * back to Edit as it closes.
 */
interface EditTriggerProps {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  id: string;
  titleId: string;
  label: string;
  disabled: boolean;
  onOpen: () => void;
  dataTestId?: string;
}

/** Edit. Its accessible name is "Edit" AND the card's title, so a grid of them is not a list of "Edit, Edit, Edit". */
const EditTrigger: React.FC<EditTriggerProps> = ({ triggerRef, id, titleId, label, disabled, onOpen, dataTestId }) => (
  <Button
    ref={triggerRef}
    id={id}
    variant="outline"
    color="neutral"
    size="sm"
    icon={<Icon name="Edit" size="xs" />}
    iconPosition="left"
    disabled={disabled}
    aria-labelledby={`${id} ${titleId}`}
    onClick={onOpen}
    dataTestId={partTestId(dataTestId, 'edit')}
  >
    {label}
  </Button>
);

/**
 * A setting, summarised while closed and edited in place.
 *
 * Closed: title, status pill, a one-line summary and Edit. Edit opens the card
 * where it is — no dialog, no route — around the host's form, a "learn more"
 * disclosure and Cancel / Save. Save may be async: the card holds its saving
 * state while the promise is pending, closes when it resolves, and stays open
 * with the error when it rejects. Focus moves into the card as it opens and
 * back to Edit as it closes.
 */
export const SettingCard = forwardRef<HTMLElement, SettingCardProps>(function SettingCard(props, ref) {
  const { title, headingLevel = 'h3', icon, status, summary, children, learnMore, copy, dataTestId, className, sx } = props;
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const card = useSettingCard(props);
  const { open } = card;

  return (
    <Box
      component="section"
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={card.saving || undefined}
      data-state={open ? 'open' : 'closed'}
      {...{ [SETTING_CARD_OPEN_ATTR]: open ? '' : undefined }}
      data-testid={dataTestId}
      className={className}
      sx={withCallerSx((theme) => surfaceStyles(theme, open), sx)}
    >
      <SettingHeader
        titleId={titleId}
        title={title}
        headingLevel={headingLevel}
        icon={icon}
        status={status}
        trailing={
          open ? null : (
            <EditTrigger
              triggerRef={card.editRef}
              id={`${baseId}-edit`}
              titleId={titleId}
              label={copy.edit}
              disabled={card.disabled}
              onOpen={card.openCard}
              dataTestId={dataTestId}
            />
          )
        }
        dataTestId={dataTestId}
      />
      {!open && summary != null && (
        <Box component="p" sx={summaryStyles} data-testid={partTestId(dataTestId, 'summary')}>
          {summary}
        </Box>
      )}
      {open && (
        <OpenBody
          bodyRef={card.bodyRef}
          titleId={titleId}
          errorId={`${baseId}-error`}
          copy={copy}
          learnMore={learnMore}
          saving={card.saving}
          error={card.error}
          saveDisabled={card.saveDisabled}
          onSave={card.save}
          onCancel={card.cancel}
          dataTestId={dataTestId}
        >
          {children}
        </OpenBody>
      )}
    </Box>
  );
});

SettingCard.displayName = 'SettingCard';
