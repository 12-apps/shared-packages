'use client';

import CheckIcon from '@mui/icons-material/Check';
import ChevronDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Divider from '@mui/material/Divider/index.js';
import ListSubheader from '@mui/material/ListSubheader/index.js';
import Menu from '@mui/material/Menu/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useState } from 'react';

import type {
  SortByDropdownProps,
  SortFieldDefinition,
  SortOrderOption,
} from './ContentToolbar.types';

function findActiveField<TField extends string>(
  fields: SortFieldDefinition<TField>[] | undefined,
  activeField: TField,
): SortFieldDefinition<TField> | undefined {
  return fields?.find((field) => field.value === activeField);
}

function findActiveOrder(
  fieldDef: SortFieldDefinition | undefined,
  activeOrder: string | undefined,
): SortOrderOption | undefined {
  const options = fieldDef?.orderOptions;
  if (!options?.length) return undefined;
  return options.find((option) => option.value === activeOrder) ?? options[0];
}

function resolveArrowDirection(option: SortOrderOption | undefined, indexInList: number): 'up' | 'down' {
  if (option?.arrowDirection) return option.arrowDirection;
  // A missing (<0) or first index sorts "down"; any later option sorts "up".
  return indexInList <= 0 ? 'down' : 'up';
}

function buildTriggerLabel(
  fieldDef: SortFieldDefinition | undefined,
  orderOption: SortOrderOption | undefined,
): string {
  if (!fieldDef) return '';
  if (fieldDef.showOrderInTrigger === false || !orderOption) return fieldDef.label;
  if (fieldDef.triggerLabelStyle === 'range' && fieldDef.orderOptions?.length === 2) {
    const other = fieldDef.orderOptions.find((option) => option.value !== orderOption.value);
    if (other) return `${fieldDef.label} (${orderOption.label.toLowerCase()}-${other.label.toLowerCase()})`;
  }
  return `${fieldDef.label} (${orderOption.label.toLowerCase()})`;
}

/** The trigger's full label (md+), short label (mobile), and direction arrow. */
function resolveTriggerParts(
  fieldDef: SortFieldDefinition | undefined,
  orderOption: SortOrderOption | undefined,
  orderOptions: SortOrderOption[],
): { full: string; short: string; arrowSuffix: string } {
  const useRangeLabel = fieldDef?.triggerLabelStyle === 'range' && orderOptions.length === 2;
  const orderIndex = orderOptions.findIndex((option) => option.value === orderOption?.value);
  const arrow = resolveArrowDirection(orderOption, orderIndex);
  const arrowSuffix = orderOptions.length > 0 && !useRangeLabel ? ` ${arrow === 'down' ? '↓' : '↑'}` : '';
  const full = buildTriggerLabel(fieldDef, orderOption);
  return { full, short: fieldDef?.label ?? full, arrowSuffix };
}

const sectionLabelSx = { px: 1, py: 0.75, fontSize: '0.75rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.5 } as const;

/** A fixed-width check slot (empty when unchecked) so labels align. */
function SortCheck({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <Box component="span" sx={{ display: 'flex', width: 16, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
      {checked ? <CheckIcon sx={{ fontSize: 14 }} /> : null}
    </Box>
  );
}

/** One `id`/`label` menu row with a leading check + testid. */
function SortRow({
  value,
  label,
  checked,
  onSelect,
}: {
  value: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <MenuItem data-testid={`sort-${value}-option`} onClick={onSelect} sx={{ gap: 1 }}>
      <SortCheck checked={checked} />
      <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        {label}
      </Box>
    </MenuItem>
  );
}

interface SortMenuProps<TField extends string> {
  anchorEl: HTMLElement | null;
  open: boolean;
  close: () => void;
  orderOptions: SortOrderOption[];
  activeOrderValue: string | undefined;
  onOrderSelect: (value: string) => void;
  fields: SortFieldDefinition<TField>[];
  activeField: TField;
  onFieldSelect: (field: TField) => void;
  orderHeading: string;
  sortHeading: string;
}

/** The Order + Sort sections of the dropdown menu. */
function SortMenu<TField extends string>({
  anchorEl,
  open,
  close,
  orderOptions,
  activeOrderValue,
  onOrderSelect,
  fields,
  activeField,
  onFieldSelect,
  orderHeading,
  sortHeading,
}: SortMenuProps<TField>): React.JSX.Element {
  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { minWidth: 180 } } }}
    >
      {orderOptions.length > 0 && [
        <ListSubheader key="order-label" sx={sectionLabelSx}>
          {orderHeading}
        </ListSubheader>,
        ...orderOptions.map((option) => (
          <SortRow
            key={`order-${option.value}`}
            value={option.value}
            label={option.label}
            checked={activeOrderValue === option.value}
            onSelect={() => onOrderSelect(option.value)}
          />
        )),
        <Divider key="order-divider" />,
      ]}
      <ListSubheader sx={sectionLabelSx}>{sortHeading}</ListSubheader>
      {fields.map((field) => (
        <SortRow
          key={field.value}
          value={field.value}
          label={field.label}
          checked={activeField === field.value}
          onSelect={() => onFieldSelect(field.value)}
        />
      ))}
    </Menu>
  );
}

/**
 * Generic "Sort By" dropdown: a "Sort By:" label + a trigger whose menu has an
 * **Order** section (direction within the active field) and a **Sort** section
 * (which field). The Order section is hidden when the field defines no order
 * options. Faithful MUI port of the reference control.
 */
export function SortByDropdown<TField extends string = string>({
  fields,
  activeField,
  activeOrder,
  onFieldChange,
  onOrderChange,
  orderHeading,
  sortHeading,
  triggerPrefix,
  'data-testid': testId,
}: SortByDropdownProps<TField>): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const close = (): void => setAnchorEl(null);

  const safeFields = fields ?? [];
  const activeFieldDef = findActiveField(fields, activeField);
  const orderOptions = activeFieldDef?.orderOptions ?? [];
  const activeOrderOption = findActiveOrder(activeFieldDef, activeOrder);
  const trigger = resolveTriggerParts(activeFieldDef, activeOrderOption, orderOptions);

  function handleFieldChange(field: TField): void {
    // Switch field in ONE callback. Previously this also fired `onOrderChange`
    // to reset the order, but a consumer whose `onOrderChange` derives the field
    // from its own (now-stale) prop would re-apply the OLD field — silently
    // reverting the field change (e.g. picking "E-mail" snapped back to "Nome").
    // The field-change consumer owns the resulting order.
    onFieldChange(field);
    close();
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.875rem' }}>
      <Typography
        component="span"
        sx={{ display: { xs: 'none', md: 'inline' }, color: 'text.secondary', fontSize: '0.875rem' }}
      >
        {triggerPrefix}
      </Typography>
      <Button
        variant="text"
        size="small"
        color="inherit"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ minWidth: 0, height: 32, px: 1, gap: 0.5, color: 'text.primary', textTransform: 'none', fontWeight: 600 }}
      >
        {/* Full "Nome (crescente)" on md+; just the field name on mobile — the
            arrow already conveys the direction, so the parenthetical is dropped. */}
        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
          {trigger.full}
        </Box>
        <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>
          {trigger.short}
        </Box>
        {trigger.arrowSuffix}
        <ChevronDownIcon sx={{ fontSize: 14 }} />
      </Button>
      <SortMenu
        orderHeading={orderHeading}
        sortHeading={sortHeading}
        anchorEl={anchorEl}
        open={open}
        close={close}
        orderOptions={orderOptions}
        activeOrderValue={activeOrderOption?.value}
        onOrderSelect={(value) => {
          onOrderChange?.(value);
          close();
        }}
        fields={safeFields}
        activeField={activeField}
        onFieldSelect={handleFieldChange}
      />
    </Box>
  );
}
