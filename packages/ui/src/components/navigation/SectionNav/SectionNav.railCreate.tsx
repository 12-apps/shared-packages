import Button from '@mui/material/Button/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import ListSubheader from '@mui/material/ListSubheader/index.js';
import Menu from '@mui/material/Menu/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import { useId, useState, type ElementType, type ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';
import { rem } from '../../../tokens/scales';

import { CountedIcon } from './SectionNav.parts';
import type { SectionNavEntry, SectionNavMenu } from './SectionNav.types';

/** One entry of the open menu: a link through the host's router, or an act. */
function entryItem(
  groupId: string,
  entry: SectionNavEntry,
  linkComponent: ElementType | undefined,
  copy: SectionNavCopy,
  testId: string,
  close: () => void,
): ReactNode {
  const link =
    entry.href === undefined || entry.disabled === true
      ? {}
      : { component: linkComponent ?? 'a', href: entry.href };
  const itemTestId = entry.dataTestId ?? `${testId}-entry-${entry.id}`;
  return (
    <MenuItem
      key={`${groupId}:${entry.id}`}
      {...link}
      disabled={entry.disabled === true}
      selected={entry.active === true}
      aria-current={entry.active === true ? 'page' : undefined}
      data-testid={itemTestId}
      onClick={() => {
        entry.onSelect?.();
        close();
      }}
      sx={{ gap: 1.5, py: 1, whiteSpace: 'normal' }}
    >
      <ListItemIcon sx={{ minWidth: 0, color: 'primary.main' }}>
        <CountedIcon
          icon={entry.icon}
          count={entry.badge}
          label={copy.badge}
          attentionLabel={copy.attention}
          testId={`${itemTestId}-badge`}
        />
      </ListItemIcon>
      <ListItemText
        primary={entry.label}
        secondary={entry.description}
        slotProps={{
          primary: { variant: 'body2', fontWeight: 500 },
          secondary: { variant: 'caption' },
        }}
        sx={{ my: 0 }}
      />
    </MenuItem>
  );
}

/** The button's icon and names: the icon in front of the label, or — compact — the icon alone, named by the label. */
function createButtonForm(
  menu: SectionNavMenu,
  compact: boolean,
): { startIcon: ReactNode; 'aria-label': string | undefined; title: string | undefined } {
  if (!compact) return { startIcon: menu.icon, 'aria-label': undefined, title: undefined };
  return { startIcon: undefined, 'aria-label': menu.label, title: menu.label };
}

/** Where the button's content sits: the label's start, or — compact — the icon centred. */
function createButtonLayoutSx(compact: boolean): SxProps<Theme> {
  return compact ? { justifyContent: 'center', minWidth: 0, px: 0 } : { justifyContent: 'flex-start', px: 1.75 };
}

/**
 * A rail's `primary` menu as ONE button at the top of the rail, opening an
 * anchored menu of its groups (FUT-3015).
 *
 * The rail lists `more` in full, but a create menu listed that way costs a
 * heading and a two-line row per entry above the fold, for acts a person takes
 * once in a while. Folded behind '+ Criar' it costs one row. The button
 * carries the menu's `label`; the open menu is named by its `title`.
 *
 * `MenuList` skips the group subheaders when the keyboard moves, and the
 * popover hands focus back to the button when it closes on Escape or an
 * outside click. Choosing an entry closes it too, and the entry's link or act
 * takes over.
 */
export function RailCreateMenu({
  menu,
  linkComponent,
  copy,
  testId,
  compact = false,
}: {
  menu: SectionNavMenu;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  testId: string;
  /** The button as its icon only — the label stays its name and its tooltip. */
  compact?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const close = (): void => setAnchor(null);
  const paperTestId: Record<string, string> = { 'data-testid': `${testId}-menu` };
  // One flat list: MUI's MenuList walks its direct children, so a group's
  // subheader and entries cannot sit inside a wrapper.
  const items: ReactNode[] = menu.groups.flatMap((group) => [
    group.title ? (
      <ListSubheader key={`${group.id}-title`} disableSticky sx={{ lineHeight: 2.5, bgcolor: 'transparent' }}>
        {group.title}
      </ListSubheader>
    ) : null,
    ...group.entries.map((entry) => entryItem(group.id, entry, linkComponent, copy, testId, close)),
  ]);
  return (
    <>
      <Button
        variant="contained"
        fullWidth
        {...createButtonForm(menu, compact)}
        disabled={menu.disabled === true}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={menu.dataTestId ?? testId}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          my: 1,
          minHeight: rem(theme, 40),
          ...(createButtonLayoutSx(compact) as object),
          fontWeight: 600,
          // A place in the rail reads in sentence case, like the rows under it.
          textTransform: 'none',
          // The ring outside the filled button, where it can be seen.
          '&.Mui-focusVisible': { outline: `${rem(theme, 2)} solid ${theme.palette.primary.main}`, outlineOffset: rem(theme, 2) },
        }}
      >
        {compact ? menu.icon : menu.label}
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={close}
        variant="menu"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          list: { 'aria-label': menu.title },
          // A data attribute is not a declared slot prop, so it rides a spread.
          paper: { ...paperTestId, sx: { minWidth: rem(theme, 260), maxWidth: rem(theme, 340) } },
        }}
      >
        {items}
      </Menu>
    </>
  );
}
