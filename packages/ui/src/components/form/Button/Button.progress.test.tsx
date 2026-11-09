import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormContainer, SubmitButton } from '../total-form';
import { Button } from './Button';

/** FUT-4574's option C: the button is the bar of what it waits for. */
describe('Button with progress', () => {
  const progress = { fraction: 0.62, label: 'Sending photo · ~5 s' };

  it('is aria-disabled and aria-busy, focusable, and shows the label in place of its children', () => {
    render(
      <Button dataTestId="b" progress={progress}>
        Publish
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sending photo · ~5 s' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
    expect(button).not.toHaveTextContent('Publish');
    expect(screen.getByTestId('b-progress-fill')).toHaveAttribute('data-value', '62');
  });

  it('a press calls nothing, and submits nothing', () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick} progress={progress}>
          Publish
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is never disabled, whatever disabled or loading say', () => {
    render(
      <Button disabled loading progress={progress}>
        Publish
      </Button>,
    );
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('draws a spinner and no fill when the fraction is unknown', () => {
    render(
      <Button dataTestId="b" progress={{ fraction: null, label: 'Saving photo…' }}>
        Publish
      </Button>,
    );
    expect(screen.getByTestId('b-progress-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('b-progress-fill')).toBeNull();
    expect(screen.getByRole('button', { name: 'Saving photo…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('acts again once progress is gone', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button onClick={onClick} progress={progress}>
        Publish
      </Button>,
    );
    rerender(<Button onClick={onClick}>Publish</Button>);
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('SubmitButton forwards progress', () => {
  it('renders the bar and submits nothing on a press', () => {
    const onSubmit = vi.fn();
    render(
      <FormContainer initialValues={{}} onSubmit={onSubmit}>
        <SubmitButton progress={{ fraction: 0.3, label: 'Sending photo · ~5 s' }}>Save</SubmitButton>
      </FormContainer>,
    );
    const button = screen.getByTestId('total-form-submit');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Sending photo · ~5 s');
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
