import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { Text, View } from 'react-native';
import { describe, expect, it } from 'vitest';

import { Progress } from './Progress.native';

describe('Progress circular center (native)', () => {
  it('composes a stationary center without replacing the progressbar semantics', () => {
    render(
      <Progress variant="circular" value={40} showLabel label="Fallback" aria-label="Task progress"
        centerContent={<View><Text>Working</Text><Text>00:40</Text><Text>Step 1 of 4</Text></View>} />,
    );
    expect(screen.getByTestId('progress-center')).toHaveTextContent('Working00:40Step 1 of 4');
    const bar = screen.getByRole('progressbar', { name: 'Task progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).not.toContainElement(screen.getByTestId('progress-center'));
    expect(screen.queryAllByTestId('progress-label')).toHaveLength(0);
  });

  it('bounds the center to the dial even when the outer wrapper is stretched', () => {
    render(<Progress variant="circular" circularSize={90} value={50}
      style={{ width: 600 }} centerContent="Center" />);
    const dial = screen.getByTestId('progress-circular');
    const center = screen.getByTestId('progress-center');
    expect(screen.getByTestId('progress').style.width).toBe('600px');
    expect(center.parentElement).toBe(dial.parentElement);
    expect(center.parentElement?.style.width).toBe('90px');
    expect(center.parentElement?.style.height).toBe('90px');
    expect(dial.style.width).toBe('90px');
    expect(dial.style.height).toBe('90px');
  });

  it('wraps raw text and fragments in Text without showLabel, including indeterminate', () => {
    render(<Progress variant="circular" centerContent={<>Waiting {2}</>} testID="pending" />);
    const center = screen.getByTestId('pending-center');
    expect(center).toHaveTextContent('Waiting 2');
    expect(center.childNodes).toHaveLength(1);
    expect(center.firstChild?.nodeType).toBe(Node.ELEMENT_NODE);
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
