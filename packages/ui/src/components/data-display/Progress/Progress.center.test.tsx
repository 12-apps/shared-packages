import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Progress } from './Progress';

describe('Progress circular center (web)', () => {
  it('composes a stationary center without replacing the progressbar semantics', () => {
    render(
      <Progress variant="circular" value={40} showLabel label="Fallback" aria-label="Task progress" aria-valuemin={0} aria-valuemax={100}
        centerContent={<div><span>Working</span><strong>00:40</strong><span>Step 1 of 4</span></div>} />,
    );
    expect(screen.getByTestId('progress-center')).toHaveTextContent('Working00:40Step 1 of 4');
    const bar = screen.getByRole('progressbar', { name: 'Task progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).not.toContainElement(screen.getByTestId('progress-center'));
    expect(screen.queryAllByTestId('progress-label')).toHaveLength(0);
    expect(bar).not.toHaveAttribute('centerContent');
  });

  it('shows custom content without showLabel, also while indeterminate', () => {
    render(<Progress variant="circular" centerContent={<>Waiting {2}</>} testID="pending" />);
    expect(screen.getByTestId('pending-center')).toHaveTextContent('Waiting 2');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('renders zero and restores the legacy label when custom content becomes null', () => {
    const { rerender } = render(<Progress variant="circular" value={75} showLabel centerContent={0} />);
    expect(screen.getByTestId('progress-center')).toHaveTextContent('0');
    rerender(<Progress variant="circular" value={75} showLabel centerContent={null} />);
    expect(screen.getByTestId('progress-label')).toHaveTextContent('75%');
    expect(screen.queryAllByTestId('progress-center')).toHaveLength(0);
  });

  it.each(['linear', 'segmented', 'gradient', 'glass'] as const)('ignores centerContent for %s without forwarding it', (variant) => {
    render(<Progress variant={variant} value={60} showLabel centerContent="Not circular" />);
    expect(screen.getByTestId('progress-label')).toHaveTextContent('60%');
    expect(screen.queryAllByText('Not circular')).toHaveLength(0);
    expect(document.querySelectorAll('[centercontent]')).toHaveLength(0);
  });
});
