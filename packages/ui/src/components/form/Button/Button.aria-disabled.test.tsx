import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

/**
 * MUI's ButtonBase marks a disabled control that is not a native <button>
 * (a link, `href`) with `aria-disabled="true"`, because a link has no
 * `disabled` attribute. Button must not override that with an empty value
 * when nothing holds it (regression of the progress/hold change, FUT-4574).
 */
describe('Button aria-disabled', () => {
  it('keeps aria-disabled on a disabled link button', () => {
    render(
      <Button href="https://example.test/contact" disabled dataTestId="contact">
        Contact
      </Button>,
    );
    expect(screen.getByTestId('contact')).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves an enabled link button without aria-disabled', () => {
    render(
      <Button href="https://example.test/contact" dataTestId="contact">
        Contact
      </Button>,
    );
    expect(screen.getByTestId('contact')).not.toHaveAttribute('aria-disabled');
  });

  it('keeps a host-given aria-disabled on a plain button', () => {
    render(
      <Button aria-disabled="true" dataTestId="plain">
        Plain
      </Button>,
    );
    expect(screen.getByTestId('plain')).toHaveAttribute('aria-disabled', 'true');
  });
});
