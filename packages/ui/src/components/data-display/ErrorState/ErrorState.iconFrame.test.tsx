import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ErrorState } from './ErrorState';

describe('ErrorState iconFrame', () => {
  const icon = <svg data-testid="mascot" />;

  it('keeps the dimmed disc by default', () => {
    render(<ErrorState message="x" icon={icon} />);
    expect(screen.getByTestId('error-state-icon')).toHaveStyle({ opacity: '0.9', borderRadius: '50%' });
  });

  it('draws the icon bare and at full opacity with iconFrame="none"', () => {
    render(<ErrorState message="x" icon={icon} iconFrame="none" />);
    const frame = screen.getByTestId('error-state-icon');
    expect(frame).not.toHaveStyle({ opacity: '0.9' });
    expect(frame).not.toHaveStyle({ borderRadius: '50%' });
    expect(frame).toContainElement(screen.getByTestId('mascot'));
  });
});
