import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import SearchIcon from '@mui/icons-material/Search';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  InputBase,
  List,
  ListItemButton,
  Paper,
  Typography,
} from '@mui/material';
import React from 'react';

import type { SearchFilterChip, SearchResultLead } from './SearchPalette.types';

/** Bold the first case-insensitive occurrence of `query` within `text`. */
export function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <Box component="span" sx={{ fontWeight: 700 }}>
        {text.slice(at, at + q.length)}
      </Box>
      {text.slice(at + q.length)}
    </>
  );
}

/** The leading visual of a result row (image / avatar / icon). */
export function Lead({ lead }: { lead: SearchResultLead | undefined }): React.JSX.Element | null {
  if (!lead) return null;
  if (lead.kind === 'image') {
    return (
      <Box
        component="img"
        src={lead.src}
        alt={lead.alt ?? ''}
        sx={{ width: 32, height: 32, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  if (lead.kind === 'avatar') {
    return (
      <Avatar src={lead.src} alt={lead.alt ?? ''} sx={{ width: 32, height: 32, fontSize: '0.85rem' }}>
        {lead.fallback}
      </Avatar>
    );
  }
  return (
    <Box sx={{ display: 'flex', width: 32, justifyContent: 'center', flexShrink: 0, color: 'text.secondary' }}>
      {lead.node}
    </Box>
  );
}

/** Compute the ghost-completion remainder of the top result for `query`. */
export function ghostRemainder(topPrimary: string | undefined, query: string): string {
  if (!query || !topPrimary) return '';
  return topPrimary.toLowerCase().startsWith(query.toLowerCase()) && topPrimary.length > query.length
    ? topPrimary.slice(query.length)
    : '';
}

/** The search input row: leading icon, ghost overlay, the field, and a spinner. */
export function PaletteInput(props: {
  value: string;
  ghost: string;
  isLoading: boolean;
  autoFocus: boolean;
  placeholder: string;
  inputAriaLabel?: string;
  hasQuery: boolean;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.5 }}>
      <SearchIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {props.ghost && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              whiteSpace: 'pre',
              overflow: 'hidden',
              fontSize: '1rem',
            }}
          >
            <Box component="span" sx={{ visibility: 'hidden' }}>
              {props.value}
            </Box>
            <Box component="span" sx={{ color: 'text.secondary', opacity: 0.6 }}>
              {props.ghost}
            </Box>
          </Box>
        )}
        <InputBase
          fullWidth
          autoFocus={props.autoFocus}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={props.onKeyDown}
          placeholder={props.placeholder}
          inputProps={{
            role: 'combobox',
            'aria-expanded': props.hasQuery,
            'aria-label': props.inputAriaLabel,
            'aria-autocomplete': 'list',
          }}
          sx={{ fontSize: '1rem' }}
        />
      </Box>
      {props.isLoading && <CircularProgress size={18} sx={{ flexShrink: 0 }} />}
    </Box>
  );
}

/** The toggleable filter-chip row. */
export function FilterChips(props: {
  filters: SearchFilterChip[];
  activeFilterIds: string[];
  onToggleFilter?: (id: string) => void;
}): React.JSX.Element {
  return (
    <Box
      data-testid="search-palette-filters"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        px: 2,
        pb: 1.5,
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
      }}
    >
      {props.filters.map((chip) => {
        const active = props.activeFilterIds.includes(chip.id);
        return (
          <Chip
            key={chip.id}
            label={chip.label}
            icon={chip.icon as React.ReactElement | undefined}
            onClick={() => props.onToggleFilter?.(chip.id)}
            variant={active ? 'filled' : 'outlined'}
            color={active ? 'primary' : 'default'}
            size="small"
            aria-pressed={active}
            data-testid={`search-palette-filter-${chip.id}`}
            sx={{ borderRadius: 2 }}
          />
        );
      })}
    </Box>
  );
}

/** One rich result row. */
export function ResultRow(props: {
  index: number;
  active: boolean;
  query: string;
  lead: SearchResultLead | undefined;
  primary: string;
  secondary: string | undefined;
  trailing: React.ReactNode | undefined;
  onSelect: () => void;
  onHover: () => void;
}): React.JSX.Element {
  return (
    <ListItemButton
      role="option"
      aria-selected={props.active}
      selected={props.active}
      onMouseEnter={props.onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onSelect}
      data-testid={`search-palette-result-${props.index}`}
      sx={{ gap: 1.25, px: 2, py: 1 }}
    >
      <Lead lead={props.lead} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap sx={{ color: 'text.primary' }}>
          {highlight(props.primary, props.query)}
        </Typography>
        {props.secondary && (
          <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
            {props.secondary}
          </Typography>
        )}
      </Box>
      {props.trailing != null && (
        <Box sx={{ flexShrink: 0, color: 'text.secondary', fontSize: '0.75rem' }}>{props.trailing}</Box>
      )}
    </ListItemButton>
  );
}

/** The "see all results — Press ENTER" footer row. */
export function SubmitAllFooter(props: {
  label: string;
  keyLabel: string;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}): React.JSX.Element {
  return (
    <ListItemButton
      selected={props.selected}
      onMouseEnter={props.onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onSelect}
      data-testid="search-palette-submit-all"
      sx={{ gap: 1.25, px: 2, py: 1, borderTop: (theme) => `1px solid ${theme.palette.divider}` }}
    >
      <SearchIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
        {props.label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
        <Typography variant="caption">{props.keyLabel}</Typography>
        <KeyboardReturnIcon sx={{ fontSize: 14 }} />
      </Box>
    </ListItemButton>
  );
}

/** Resolved view state shared by the body renderer. */
export interface BodyView<T> {
  hasQuery: boolean;
  emptyQueryContent: React.ReactNode;
  visible: T[];
  isLoading: boolean;
  noResultsLabel: string;
  showFooter: boolean;
  footerIndex: number;
  activeIndex: number;
  trimmed: string;
  submitAllLabel: (q: string) => string;
  submitKeyLabel: string;
  getKey: (item: T) => string;
  getPrimary: (item: T) => string;
  getSecondary?: (item: T) => string | undefined;
  getLead?: (item: T) => SearchResultLead | undefined;
  getTrailing?: (item: T) => React.ReactNode | undefined;
  onSelect: (item: T) => void;
  onSubmitAll?: (query: string) => void;
  setActiveIndex: (i: number) => void;
}

/** The results list (or the empty-query slot / no-results message) + footer. */
export function PaletteBody<T>(view: BodyView<T>): React.JSX.Element | null {
  if (!view.hasQuery) {
    return view.emptyQueryContent ? (
      <Box data-testid="search-palette-empty-query">{view.emptyQueryContent}</Box>
    ) : null;
  }
  const empty = view.visible.length === 0;
  return (
    <>
      {!empty && (
        <List dense disablePadding role="listbox" data-testid="search-palette-results">
          {view.visible.map((item, index) => (
            <ResultRow
              key={view.getKey(item)}
              index={index}
              active={index === view.activeIndex}
              query={view.trimmed}
              lead={view.getLead?.(item)}
              primary={view.getPrimary(item)}
              secondary={view.getSecondary?.(item)}
              trailing={view.getTrailing?.(item)}
              onSelect={() => view.onSelect(item)}
              onHover={() => view.setActiveIndex(index)}
            />
          ))}
        </List>
      )}
      {empty && !view.isLoading && (
        <Box sx={{ px: 2, py: 1.5 }} data-testid="search-palette-no-results">
          <Typography variant="body2" color="text.secondary">
            {view.noResultsLabel}
          </Typography>
        </Box>
      )}
      {view.showFooter && (
        <SubmitAllFooter
          label={view.submitAllLabel(view.trimmed)}
          keyLabel={view.submitKeyLabel}
          selected={view.activeIndex === view.footerIndex}
          onSelect={() => view.onSubmitAll?.(view.trimmed)}
          onHover={() => view.setActiveIndex(view.footerIndex)}
        />
      )}
    </>
  );
}

/**
 * The palette card: a flex column capped at the height its container allows, so
 * the input and the filter chips stay pinned while only the results scroll and a
 * long result set can never push the palette past the bottom of the viewport.
 */
export const PALETTE_CARD_SX = {
  width: '100%',
  maxWidth: 640,
  maxHeight: '100%',
  borderRadius: 2,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
} as const;

/** The scrolling region of the card — the results, and nothing above them. */
export function PaletteScrollArea({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Box sx={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>{children}</Box>
  );
}

export { Paper };

/** Context for the keydown handler builder. */
export interface KeyCtx<T> {
  rowCount: number;
  activeIndex: number;
  footerIndex: number;
  visible: T[];
  hasQuery: boolean;
  ghost: string;
  top: T | undefined;
  trimmed: string;
  getPrimary: (item: T) => string;
  onChange: (v: string) => void;
  onSelect: (item: T) => void;
  onSubmitAll?: (query: string) => void;
  onClose?: () => void;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
}

/** Build the input's keydown handler (nav / select / ghost-accept / close). */
export function createKeyDownHandler<T>(ctx: KeyCtx<T>): (e: React.KeyboardEvent) => void {
  const move = (delta: number): void =>
    ctx.setActiveIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(ctx.rowCount - 1, 0)));
  const commit = (): void => {
    if (!ctx.hasQuery) return;
    if (ctx.activeIndex === ctx.footerIndex) {
      ctx.onSubmitAll?.(ctx.trimmed);
      return;
    }
    const item = ctx.visible[ctx.activeIndex];
    if (item) ctx.onSelect(item);
  };
  // A lookup keeps the handler itself flat (low complexity). Tab/→ is special —
  // it must only swallow the event when there is a ghost to accept, otherwise
  // Tab keeps its native focus behavior.
  const actions: Record<string, (() => void) | undefined> = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    Enter: commit,
    Escape: () => ctx.onClose?.(),
  };
  return (e) => {
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && ctx.ghost && ctx.top) {
      e.preventDefault();
      ctx.onChange(ctx.getPrimary(ctx.top));
      return;
    }
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };
}
