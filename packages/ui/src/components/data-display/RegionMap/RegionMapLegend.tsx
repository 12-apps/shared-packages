import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';

import type { RegionMapCopy } from './RegionMap.types';

/** What the hatch, the dashed circle and the dot mean — in words. */
export function RegionMapLegend({
  copy,
  outermostMetres,
  showCenter,
  theme,
  testId,
}: {
  copy: RegionMapCopy;
  outermostMetres: number | null;
  showCenter: boolean;
  theme: Theme;
  testId: string;
}): React.JSX.Element {
  const swatch = rem(theme, 14);
  const { palette } = theme;
  const stripe = rem(theme, 2);
  return (
    <Box
      data-testid={`${testId}-legend`}
      sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mt: 1, alignItems: 'center' }}
    >
      <LegendItem text={copy.legendExcluded}>
        <Box
          component="span"
          sx={{
            width: swatch,
            height: swatch,
            border: 1,
            borderColor: 'text.secondary',
            borderRadius: 0.5,
            background: `repeating-linear-gradient(135deg, ${palette.text.secondary} 0 ${stripe}, ${alpha(palette.text.primary, 0.1)} ${stripe} ${rem(theme, 5)})`,
          }}
        />
      </LegendItem>
      {outermostMetres !== null && (
        <LegendItem text={copy.legendCircle(outermostMetres)}>
          <Box
            component="span"
            sx={{
              width: swatch,
              height: swatch,
              borderWidth: stripe,
              borderStyle: 'dashed',
              borderColor: 'info.main',
              borderRadius: '50%',
            }}
          />
        </LegendItem>
      )}
      {showCenter && (
        <LegendItem text={copy.legendCenter}>
          <Box
            component="span"
            sx={{ width: rem(theme, 10), height: rem(theme, 10), bgcolor: 'primary.main', borderRadius: '50%' }}
          />
        </LegendItem>
      )}
    </Box>
  );
}

function LegendItem({ text, children }: { text: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      {children}
      <Typography component="span" variant="caption" color="text.secondary">
        {text}
      </Typography>
    </Box>
  );
}
