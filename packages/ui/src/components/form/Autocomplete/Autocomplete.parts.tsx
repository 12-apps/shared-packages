import LinkIcon from '@mui/icons-material/Link';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import React from 'react';

import { highlightLabel, type MatchMode } from './Autocomplete.helpers';
import type { SuggestionItemState, SuggestionType } from './Autocomplete.types';
import type { AutocompleteCopy } from '../../../copy';

const StyledPopper = styled(Popper)(({ theme }) => ({
  zIndex: theme.zIndex.tooltip,
  width: '100%',
  maxHeight: 300,
  overflow: 'auto',
  // Popper.js writes the computed position (and stamps `data-popper-placement`)
  // in a layout effect that can land AFTER the first paint. Until it does, the
  // element would paint once unpositioned — at the offset-parent origin, far
  // left and full width — then jump under the input, a visible per-keystroke
  // flash as the list re-renders. Hide that unpositioned first frame; it becomes
  // visible the instant popper assigns a placement.
  '&:not([data-popper-placement])': { visibility: 'hidden' },
}));

const InlineSuggestionDisplay = styled('div')(() => ({
  position: 'absolute',
  pointerEvents: 'none',
  left: '14px', // Match TextField padding
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 'inherit',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  zIndex: 1,
}));

const UserTextTwin = styled('span')({
  visibility: 'hidden',
});

const GhostText = styled('span')(({ theme }) => ({
  color: theme.palette.text.secondary,
  opacity: 0.6,
}));

const ChipContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(0.5),
  marginBottom: theme.spacing(1),
}));

/** Leading icon for a typed suggestion (search vs. link); null for untyped items. */
export function suggestionTypeIcon(type: SuggestionType | undefined): React.ReactNode {
  const sx = { color: 'text.secondary', flexShrink: 0 } as const;
  if (type === 'link') return <LinkIcon fontSize="small" sx={sx} />;
  if (type === 'search') return <SearchIcon fontSize="small" sx={sx} />;
  return null;
}

/** The inline ghost-text overlay: an invisible twin of the typed text + the grey remainder. */
function GhostOverlay({ inputValue, ghost }: { inputValue: string; ghost: string }): React.JSX.Element {
  return (
    <InlineSuggestionDisplay>
      <UserTextTwin>{inputValue}</UserTextTwin>
      <GhostText>{ghost}</GhostText>
    </InlineSuggestionDisplay>
  );
}

export interface AutocompleteInputProps {
  id: string;
  listId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  ghost: string;
  showGhost: boolean;
  isInputFocused: boolean;
  open: boolean;
  activeDescendant: string | undefined;
  isLoading: boolean;
  disabled: boolean;
  autoFocus: boolean;
  placeholder: string;
  startAdornment?: React.ReactNode;
  inputAriaLabel?: string;
  inputClassName?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

/** The combobox text field plus its inline ghost-text overlay. */
export function AutocompleteInput(props: AutocompleteInputProps): React.JSX.Element {
  const showOverlay = Boolean(props.ghost) && props.showGhost && props.isInputFocused;
  return (
    <Box sx={{ position: 'relative' }}>
      {showOverlay && <GhostOverlay inputValue={props.inputValue} ghost={props.ghost} />}
      <TextField
        ref={props.inputRef}
        fullWidth
        value={props.inputValue}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onCompositionStart={props.onCompositionStart}
        onCompositionEnd={props.onCompositionEnd}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        className={props.inputClassName}
        InputProps={{
          startAdornment: props.startAdornment,
          endAdornment: props.isLoading ? <CircularProgress size={20} /> : undefined,
        }}
        inputProps={{
          role: 'combobox',
          'aria-expanded': props.open,
          'aria-controls': props.open ? props.listId : undefined,
          'aria-activedescendant': props.activeDescendant,
          'aria-autocomplete': 'list',
          'aria-label': props.inputAriaLabel,
          id: props.id,
        }}
      />
    </Box>
  );
}

/** Selected-item chips (multiple mode). */
export function ChipList<T>({
  items,
  getKey,
  getLabel,
  onRemove,
  chipClassName,
}: {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onRemove: (item: T) => void;
  chipClassName?: string;
}): React.JSX.Element {
  return (
    <ChipContainer data-testid="selected-items-container">
      {items.map((item, index) => (
        <Chip
          key={`${getKey(item)}-${index}`}
          label={getLabel(item)}
          onDelete={() => onRemove(item)}
          size="small"
          className={chipClassName}
          data-testid={`selected-chip-${index}`}
        />
      ))}
    </ChipContainer>
  );
}

/** Default suggestion row: per-type icon + highlighted label + optional description. */
export function DefaultSuggestion<T>({
  item,
  state,
  getLabel,
  getDescription,
  getSuggestionType,
  matchMode,
}: {
  item: T;
  state: SuggestionItemState;
  getLabel: (item: T) => string;
  getDescription?: (item: T) => string | undefined;
  getSuggestionType: (item: T) => SuggestionType | undefined;
  matchMode: MatchMode;
}): React.JSX.Element {
  const label = getLabel(item);
  const description = getDescription?.(item);
  const displayLabel = highlightLabel(label, state.query, matchMode);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        // Bold the matched prefix (not a yellow <mark> highlight).
        '& mark': { backgroundColor: 'transparent', color: 'inherit', fontWeight: 700 },
      }}
    >
      {suggestionTypeIcon(getSuggestionType(item))}
      <ListItemText
        primary={<span dangerouslySetInnerHTML={{ __html: displayLabel }} />}
        secondary={description}
      />
    </Box>
  );
}

/** A "Loading…" row shown while async suggestions resolve. */
export function LoadingRow({ label }: { label: string }): React.JSX.Element {
  return (
    <ListItem>
      <Box display="flex" alignItems="center" gap={1}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </Box>
    </ListItem>
  );
}

/** The empty "No results found" row. */
export function NoResultsRow({ label }: { label: string }): React.JSX.Element {
  return (
    <ListItem>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </ListItem>
  );
}

/** Keep the Popper the same width as its anchor input. */
const SAME_WIDTH_MODIFIER = {
  name: 'sameWidth',
  enabled: true,
  fn: ({ state }: { state: { elements: { reference?: unknown }; styles: { popper?: Record<string, string> }; rects: { reference: { width: number } } } }) => {
    if (state.elements.reference && state.styles.popper) {
      state.styles.popper.width = `${state.rects.reference.width}px`;
    }
  },
  phase: 'beforeWrite' as const,
  requires: ['computeStyles'],
};

export interface SuggestionListBoxProps<T> {
  copy: AutocompleteCopy;
  open: boolean;
  anchorEl: HTMLElement | null;
  portal: boolean | { container?: HTMLElement };
  listRef: React.RefObject<HTMLUListElement | null>;
  listId: string;
  optionIdPrefix: string;
  items: T[];
  activeIndex: number;
  isLoading: boolean;
  showNoResults: boolean;
  getKey: (item: T) => string;
  onSelect: (item: T) => void;
  onHover: (index: number) => void;
  renderItem: (item: T, active: boolean) => React.ReactNode;
  listClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
}

/** The suggestions dropdown: a same-width Popper with the option list + loading/empty rows. */
export function SuggestionListBox<T>({
  copy,
  open,
  anchorEl,
  portal,
  listRef,
  listId,
  optionIdPrefix,
  items,
  activeIndex,
  isLoading,
  showNoResults,
  getKey,
  onSelect,
  onHover,
  renderItem,
  listClassName,
  itemClassName,
  activeItemClassName,
}: SuggestionListBoxProps<T>): React.JSX.Element {
  return (
    <StyledPopper
      open={open}
      anchorEl={anchorEl}
      placement="bottom-start"
      disablePortal={!portal}
      modifiers={[SAME_WIDTH_MODIFIER]}
    >
      <Paper elevation={8} className={listClassName} data-testid="suggestions-dropdown">
        <List
          ref={listRef}
          role="listbox"
          id={listId}
          dense
          sx={{ maxHeight: 300, overflow: 'auto' }}
          data-testid="suggestions-list"
        >
          {items.map((item, index) => (
            <ListItem
              key={getKey(item)}
              id={`${optionIdPrefix}-${index}`}
              role="option"
              component="div"
              sx={{
                cursor: 'pointer',
                backgroundColor: index === activeIndex ? 'action.hover' : 'transparent',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
              aria-selected={index === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onHover(index)}
              className={`${itemClassName} ${index === activeIndex ? activeItemClassName : ''}`}
              data-testid={`suggestion-item-${index}`}
            >
              {renderItem(item, index === activeIndex)}
            </ListItem>
          ))}
          {isLoading && <LoadingRow label={copy.loading} />}
          {showNoResults && <NoResultsRow label={copy.noResults} />}
        </List>
      </Paper>
    </StyledPopper>
  );
}
