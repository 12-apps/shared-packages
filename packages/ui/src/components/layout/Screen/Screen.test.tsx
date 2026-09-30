import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Screen } from './Screen';

describe('Screen (web)', () => {
  it('bounds a scroll viewport and keeps spacing inside it', () => {
    render(<Screen dataTestId="page" p={2} gap={1}><span>Content</span></Screen>);
    const viewport = screen.getByTestId('page-viewport');
    expect(viewport).toHaveStyle({ overflowY: 'auto', minHeight: '0' });
    expect(viewport.firstElementChild).toHaveStyle({ paddingTop: '16px', gap: '8px', flexGrow: '1' });
    expect(screen.getByTestId('page')).toHaveStyle({ flex: '1', overflow: 'hidden' });
  });
  it('turns scrolling off and back on without remounting the screen', () => {
    const { rerender } = render(<Screen testID="page" />);
    rerender(<Screen testID="page" scroll={false} />);
    expect(screen.getByTestId('page-viewport')).toHaveStyle({ overflowY: 'hidden' });
    expect(screen.getByTestId('page-viewport').firstElementChild).toHaveStyle({ flex: '1', minHeight: '0', minWidth: '0' });
    rerender(<Screen testID="page" scroll />);
    expect(screen.getByTestId('page-viewport')).toHaveStyle({ overflowY: 'auto' });
  });
  it('forwards root accessibility, id and ref without leaking native props', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Screen ref={ref} data-testid="root" aria-label="Workout" keyboardAvoiding={false} keyboardVerticalOffset={50} />);
    const root = screen.getByTestId('root');
    expect(ref.current).toBe(root);
    expect(root).toHaveAttribute('aria-label', 'Workout');
    expect(root).not.toHaveAttribute('keyboardAvoiding');
    expect(root).not.toHaveAttribute('keyboardVerticalOffset');
    expect(screen.getAllByTestId('root')).toHaveLength(1);
  });
  it('uses host spacing, dark background and explicit content overrides', () => {
    const theme = createTheme({ spacing: 4, palette: { mode: 'dark' } });
    render(<ThemeProvider theme={theme}><Screen dataTestId="page" p={2} contentSx={{ gap: 3 }} /></ThemeProvider>);
    expect(screen.getByTestId('page')).toHaveStyle({ backgroundColor: theme.palette.background.default });
    expect(screen.getByTestId('page-viewport').firstElementChild).toHaveStyle({ paddingTop: '8px', gap: '12px' });
  });
  it('can opt out of every safe-area edge for an inset navigator', () => {
    render(<Screen dataTestId="page" safeAreaEdges={[]} />);
    expect(screen.getByTestId('page')).toHaveStyle({ paddingTop: '0', paddingBottom: '0' });
  });
});
