import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Separator } from '../Separator';
import type { SeparatorOrientation } from '../Separator.types';

// FUT-2674: the labelled branch (rule, label, rule) rendered a plain group, so
// assistive tech heard the label with nothing marking a boundary, while the
// same component without a label was a `separator`. The group now carries the
// plain branch's role and orientation, as MUI's `Divider` does with children.
const theme = createTheme();

function renderLabelled(orientation: SeparatorOrientation) {
  render(
    <ThemeProvider theme={theme}>
      <Separator orientation={orientation} className="labelled-class" data-testid="labelled">
        OR
      </Separator>
    </ThemeProvider>,
  );
}

describe.each<SeparatorOrientation>(['horizontal', 'vertical'])(
  'a labelled %s Separator (FUT-2674)',
  (orientation) => {
    it('is a separator with the orientation it was given', () => {
      renderLabelled(orientation);
      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('aria-orientation', orientation);
    });

    it('carries the role on the group that holds the caller’s class and test id', () => {
      renderLabelled(orientation);
      const separator = screen.getByRole('separator');
      expect(separator).toBe(screen.getByTestId('labelled'));
      expect(separator).toHaveClass('labelled-class');
    });

    it('keeps the label inside it and gives neither the rules nor the label a role', () => {
      renderLabelled(orientation);
      const separator = screen.getByRole('separator');
      expect(separator).toHaveTextContent('OR');
      expect(separator.children).toHaveLength(3);
      for (const child of Array.from(separator.children)) {
        expect(child).not.toHaveAttribute('role');
        expect(child).not.toHaveAttribute('aria-orientation');
      }
    });
  },
);
