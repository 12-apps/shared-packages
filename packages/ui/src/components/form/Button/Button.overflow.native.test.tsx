import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { Platform } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';

import { Button, overflowOf } from './Button.native';

const realOs = Platform.OS;

/** Run the rest of the test as if on `os`. */
function onPlatform(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

// FUT-3775: a clipped Android button that turned enabled painted its fill and
// no label. Android never clips; iOS and the web keep the clip unless the
// pulse or the glow needs room outside the box. react-native-web writes
// `overflow` as its two axes.
describe('Button (native) overflow', () => {
  afterEach(() => onPlatform(realOs));

  it('never clips on Android, pulse or not', () => {
    expect(overflowOf(false, 'android')).toBe('visible');
    expect(overflowOf(true, 'android')).toBe('visible');
  });

  it('clips elsewhere unless the pulse or the glow needs the room', () => {
    expect(overflowOf(false, 'ios')).toBe('hidden');
    expect(overflowOf(false, 'web')).toBe('hidden');
    expect(overflowOf(true, 'ios')).toBe('visible');
  });

  it('renders an Android button unclipped through a disabled → enabled flip', () => {
    onPlatform('android');
    const { rerender } = render(<Button disabled dataTestId="confirm">Confirmar</Button>);
    expect(screen.getByTestId('confirm')).toHaveStyle({ overflowX: 'visible', overflowY: 'visible' });

    rerender(<Button dataTestId="confirm">Confirmar</Button>);
    expect(screen.getByTestId('confirm')).toHaveStyle({ overflowX: 'visible', overflowY: 'visible' });
  });

  it('renders an iOS button clipped', () => {
    onPlatform('ios');
    render(<Button dataTestId="confirm">Confirmar</Button>);
    expect(screen.getByTestId('confirm')).toHaveStyle({ overflowX: 'hidden', overflowY: 'hidden' });
  });
});
