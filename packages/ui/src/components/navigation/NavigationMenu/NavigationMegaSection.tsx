import { Box, List, Typography } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { MegaSection } from './NavigationMenu.shell';
import { slideIn } from './NavigationMenu.styles';
import type { NavigationMenuItem } from './NavigationMenu.types';
import { renderMenuItem } from './NavigationMenuItem';

const SECTION_TITLE_SX = {
  mb: 2.5,
  color: 'primary.main',
  fontWeight: 600,
  position: 'relative',
  paddingBottom: 1,
  // The short rule under each section heading.
  '&::after': {
    content: '""',
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '40px',
    height: '3px',
    background: (theme: { palette: { primary: { main: string } } }) =>
      `linear-gradient(90deg, ${theme.palette.primary.main} 0%, transparent 100%)`,
    borderRadius: '2px',
  },
} as const;

export interface NavigationMegaSectionProps {
  section: NavigationMenuItem;
  sectionIndex: number;
  variant?: string;
  size?: string;
  minimal?: boolean;
}

// One column of the mega menu: a heading and its children, each staggered so the
// grid fills in rather than appearing all at once.
export const NavigationMegaSection: FC<NavigationMegaSectionProps> = ({
  section,
  sectionIndex,
  variant,
  size,
  minimal,
}) => (
  <MegaSection>
    <Typography variant="h6" sx={SECTION_TITLE_SX}>
      {section.label}
    </Typography>
    <List sx={{ p: 0 }}>
      {section.children?.map((item, itemIndex) => (
        <Box
          key={item.id}
          sx={{
            animation: `${slideIn} 0.4s ease-out`,
            animationDelay: `${sectionIndex * 0.1 + itemIndex * 0.05}s`,
            animationFillMode: 'both',
          }}
        >
          {renderMenuItem(item, variant, size, false, minimal, 0)}
        </Box>
      ))}
    </List>
  </MegaSection>
);
