import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { ElementType } from 'react';

import { rem } from '../../../tokens/scales';
import { Drawer, DrawerContent, DrawerHeader } from '../../layout/Drawer';

import { Box, CONTROL_RESET, CountedIcon, controlProps, focusRing } from './SectionNav.parts';
import type { SectionNavEntry, SectionNavGroup, SectionNavMenu } from './SectionNav.types';
import type { SectionNavCopy } from '../../../copy';

interface EntryProps {
  entry: SectionNavEntry;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  testId: string;
  onDone: () => void;
}

/** A tile in a `grid` group: icon over a short label. */
function GridEntry({ entry, linkComponent, copy, testId, onDone }: EntryProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      {...controlProps({
        href: entry.href,
        linkComponent,
        onClick: () => {
          entry.onSelect?.();
          onDone();
        },
      })}
      aria-current={entry.active ? 'page' : undefined}
      data-testid={`${testId}-entry-${entry.id}`}
      sx={{
        ...CONTROL_RESET,
        ...focusRing(theme),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        minHeight: rem(theme, 76),
        px: 0.5,
        py: 1,
        borderRadius: 1.5,
        textAlign: 'center',
        bgcolor: entry.active ? 'action.selected' : 'action.hover',
        color: entry.active ? 'primary.main' : 'text.primary',
        '& svg': { color: 'primary.main' },
      }}
    >
      <CountedIcon icon={entry.icon} count={entry.badge} label={copy.badge} testId={`${testId}-badge-${entry.id}`} />
      <Typography component="span" variant="caption" sx={{ lineHeight: 1.2, fontWeight: entry.active ? 700 : 500 }}>
        {entry.label}
      </Typography>
    </Box>
  );
}

/** A row in a `list` group: icon, label, and the description under it. */
function ListEntry({ entry, linkComponent, copy, testId, onDone }: EntryProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      {...controlProps({
        href: entry.href,
        linkComponent,
        onClick: () => {
          entry.onSelect?.();
          onDone();
        },
      })}
      aria-current={entry.active ? 'page' : undefined}
      data-testid={`${testId}-entry-${entry.id}`}
      sx={{
        ...CONTROL_RESET,
        ...focusRing(theme),
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minHeight: rem(theme, 52),
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        textAlign: 'start',
        bgcolor: entry.active ? 'action.selected' : 'action.hover',
        '& svg': { color: 'primary.main' },
      }}
    >
      <CountedIcon icon={entry.icon} count={entry.badge} label={copy.badge} testId={`${testId}-badge-${entry.id}`} />
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
          {entry.label}
        </Typography>
        {entry.description ? (
          <Typography component="span" variant="caption" color="text.secondary">
            {entry.description}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

/** One titled run of entries, as tiles or rows. */
function SheetGroup({
  group,
  linkComponent,
  copy,
  testId,
  onDone,
}: Omit<EntryProps, 'entry'> & { group: SectionNavGroup }): React.JSX.Element {
  const grid = group.layout === 'grid';
  const Entry = grid ? GridEntry : ListEntry;
  return (
    <Box component="section" data-testid={`${testId}-group-${group.id}`} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {group.title ? (
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {group.title}
        </Typography>
      ) : null}
      <Box
        sx={
          grid
            ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }
            : { display: 'flex', flexDirection: 'column', gap: 0.75 }
        }
      >
        {group.entries.map((entry) => (
          <Entry key={entry.id} entry={entry} linkComponent={linkComponent} copy={copy} testId={testId} onDone={onDone} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * A menu opened from the bar: a bottom sheet over the page.
 *
 * Choosing an entry closes it — a link has somewhere to go and an action has
 * something to do, and neither wants the sheet still covering the screen.
 */
export function SectionNavSheet({
  menu,
  open,
  onClose,
  linkComponent,
  copy,
  testId,
  bottomOffset,
}: {
  menu: SectionNavMenu;
  open: boolean;
  onClose: () => void;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  testId: string;
  /** How far above the viewport's foot the sheet stops — the bar's own height, so the bar stays visible. */
  bottomOffset: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Drawer
      open={open}
      onClose={onClose}
      anchor="bottom"
      height="auto"
      dataTestId={testId}
      paperSx={{
        borderTopLeftRadius: rem(theme, Number(theme.shape.borderRadius) * 3),
        borderTopRightRadius: rem(theme, Number(theme.shape.borderRadius) * 3),
        maxHeight: `calc(85dvh - ${bottomOffset})`,
        bottom: bottomOffset,
      }}
    >
      {/* The library Drawer names nothing: the dialog role and its name live
          here, around everything the focus trap holds. */}
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={menu.title}
        sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <DrawerHeader onClose={onClose} closeLabel={copy.close} dataTestId={`${testId}-header`}>
          {menu.title}
        </DrawerHeader>
        <DrawerContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {menu.groups.map((group) => (
              <SheetGroup
                key={group.id}
                group={group}
                linkComponent={linkComponent}
                copy={copy}
                testId={testId}
                onDone={onClose}
              />
            ))}
          </Box>
        </DrawerContent>
      </Box>
    </Drawer>
  );
}
