import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { UploadProgress } from './UploadProgress';
import type { UploadProgressCopy, UploadProgressValue } from './UploadProgress.types';

const COPY: UploadProgressCopy = {
  preparing: 'Adjusting the photo',
  sending: 'Sending photo',
  saving: 'Photo sent, saving…',
  step: (n, of) => `${n} of ${of}`,
  secondsLeft: (n) => `About ${n} s left`,
  totalSecondsLeft: (n) => `About ${n} s left in all`,
  percent: (n) => `${n}%`,
};

const preparing = (over: Partial<UploadProgressValue> = {}): UploadProgressValue => ({
  stage: 'preparing',
  fraction: 0.3,
  secondsLeft: 2.2,
  step: 1,
  totalSecondsLeft: 6.4,
  ...over,
});
const sending = (over: Partial<UploadProgressValue> = {}): UploadProgressValue => ({
  stage: 'sending',
  fraction: 0.62,
  secondsLeft: 4.1,
  step: 2,
  totalSecondsLeft: 4.1,
  ...over,
});
const saving: UploadProgressValue = { stage: 'saving', fraction: null, secondsLeft: null, step: 3, totalSecondsLeft: null };

const text = (id: string) => screen.queryByTestId(id)?.textContent ?? null;

describe('UploadProgress — what each stage says', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<UploadProgress progress={null} copy={COPY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('preparing: the stage word, its step, and the total time when it is known', () => {
    render(<UploadProgress progress={preparing()} copy={COPY} />);
    expect(text('upload-progress-stage')).toBe('Adjusting the photo');
    expect(text('upload-progress-figure')).toBe('1 of 3');
    expect(text('upload-progress-time')).toBe('About 7 s left in all');
  });

  it("preparing with no sending rate: only the stage's own time", () => {
    render(<UploadProgress progress={preparing({ totalSecondsLeft: null })} copy={COPY} />);
    expect(text('upload-progress-time')).toBe('About 3 s left');
  });

  it('sending: the percentage and the time left, rounded up', () => {
    render(<UploadProgress progress={sending()} copy={COPY} />);
    expect(text('upload-progress-stage')).toBe('Sending photo');
    expect(text('upload-progress-figure')).toBe('62%');
    expect(text('upload-progress-time')).toBe('About 5 s left');
  });

  it('sending before the first measurement: the bar, no time', () => {
    render(<UploadProgress progress={sending({ secondsLeft: null, totalSecondsLeft: null })} copy={COPY} />);
    expect(text('upload-progress-figure')).toBe('62%');
    expect(text('upload-progress-time')).toBeNull();
  });

  it('saving: a spinner and the stage word, no bar and no number', () => {
    render(<UploadProgress progress={saving} copy={COPY} />);
    expect(text('upload-progress-stage')).toBe('Photo sent, saving…');
    expect(screen.getByTestId('upload-progress-spinner')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Photo sent, saving…' })).toBeNull();
    expect(text('upload-progress-figure')).toBeNull();
    expect(text('upload-progress-time')).toBeNull();
  });
});

describe('UploadProgress — the bar', () => {
  it('is a determinate progressbar named by the stage while the fraction is known', () => {
    render(<UploadProgress progress={sending()} copy={COPY} />);
    const bar = screen.getByRole('progressbar', { name: 'Sending photo' });
    expect(bar).toHaveAttribute('aria-valuenow', '62');
  });

  it('is indeterminate, with no number, when the fraction is unknown', () => {
    render(<UploadProgress progress={sending({ fraction: null, secondsLeft: null })} copy={COPY} />);
    const bar = screen.getByRole('progressbar', { name: 'Sending photo' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(text('upload-progress-figure')).toBeNull();
  });

  it('compact: the bar alone, the stage still in the live region', () => {
    render(<UploadProgress progress={sending()} copy={COPY} size="compact" />);
    expect(screen.getByRole('progressbar', { name: 'Sending photo' })).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByRole('status')).toHaveTextContent('Sending photo');
    expect(text('upload-progress-figure')).toBeNull();
    expect(text('upload-progress-time')).toBeNull();
  });
});

describe('UploadProgress — the live region', () => {
  it('holds only the stage word, and is the SAME node across stages', () => {
    const { rerender } = render(<UploadProgress progress={preparing()} copy={COPY} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toBe('Adjusting the photo');

    rerender(<UploadProgress progress={sending({ fraction: 0.1 })} copy={COPY} />);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Sending photo');

    // A new percent changes nothing in the live region.
    rerender(<UploadProgress progress={sending({ fraction: 0.5 })} copy={COPY} />);
    expect(status.textContent).toBe('Sending photo');
    expect(status.textContent).not.toContain('%');

    rerender(<UploadProgress progress={saving} copy={COPY} />);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Photo sent, saving…');
  });
});

describe('UploadProgress — seconds', () => {
  it('never shows the time going up by more than one second between renders', () => {
    const { rerender } = render(<UploadProgress progress={sending({ secondsLeft: 4 })} copy={COPY} />);
    expect(text('upload-progress-time')).toBe('About 4 s left');
    rerender(<UploadProgress progress={sending({ secondsLeft: 11 })} copy={COPY} />);
    expect(text('upload-progress-time')).toBe('About 5 s left');
    rerender(<UploadProgress progress={sending({ secondsLeft: 2.1 })} copy={COPY} />);
    expect(text('upload-progress-time')).toBe('About 3 s left');
  });

  it('starts afresh on a new stage', () => {
    const { rerender } = render(<UploadProgress progress={preparing({ totalSecondsLeft: null, secondsLeft: 1 })} copy={COPY} />);
    rerender(<UploadProgress progress={sending({ secondsLeft: 9 })} copy={COPY} />);
    expect(text('upload-progress-time')).toBe('About 9 s left');
  });
});
