import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch.native';
import {
  DISABLED,
  SWITCH_LABEL,
  SWITCH_SIZES,
  TRACK_RADIUS,
  thumbTravel,
} from './Switch.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';

const theme = createUiTheme();

/** The track sits behind the thumb: the control's first child. */
const trackOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).firstElementChild as HTMLElement;
/** The thumb is the last child, after the track and any overlay. */
const thumbOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).lastElementChild as HTMLElement;

describe('Switch (native)', () => {
  it('renders a checkbox role under the web ids, off by default', () => {
    render(<Switch label="Notificações" helperText="Aviso" />);
    const control = screen.getByRole('checkbox');
    expect(control).toHaveAttribute('data-testid', 'switch');
    expect(control).not.toBeChecked();
    expect(screen.getByTestId('switch-container')).toContainElement(control);
    expect(screen.getByTestId('switch-label')).toHaveTextContent('Notificações');
    expect(screen.getByTestId('switch-helper')).toHaveTextContent('Aviso');
  });

  it('derives the container, label and helper ids from the caller id', () => {
    render(<Switch dataTestId="alerts" label="Alertas" helperText="Aviso" />);
    expect(screen.getByTestId('alerts')).toHaveAttribute('role', 'checkbox');
    expect(screen.getByTestId('alerts-container')).toBeInTheDocument();
    expect(screen.getByTestId('alerts-label')).toBeInTheDocument();
    expect(screen.getByTestId('alerts-helper')).toBeInTheDocument();
  });

  it('toggles itself when uncontrolled, and reports the change MUI-shaped', () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(<Switch dataTestId="s" defaultChecked onChange={onChange} onClick={onClick} />);
    expect(screen.getByTestId('s')).toBeChecked();
    fireEvent.click(screen.getByTestId('s'));
    expect(onChange).toHaveBeenCalledWith({ target: { checked: false } }, false);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('s')).not.toBeChecked();
  });

  it('defers to a caller that controls it', () => {
    const onChange = vi.fn();
    render(<Switch dataTestId="s" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('s'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('s')).not.toBeChecked();
  });

  it('toggles on the space bar, which react-native-web does not press for a checkbox', () => {
    const onChange = vi.fn();
    render(<Switch dataTestId="s" onChange={onChange} />);
    fireEvent.keyDown(screen.getByTestId('s'), { key: ' ' });
    expect(onChange).toHaveBeenCalledWith({ target: { checked: true } }, true);
    expect(screen.getByTestId('s')).toBeChecked();
  });

  it.each(['xs', 'sm', 'md', 'lg', 'xl'] as const)('size %s draws the web geometry', (size) => {
    render(<Switch dataTestId={size} size={size} />);
    const geometry = SWITCH_SIZES[size];
    expect(screen.getByTestId(size)).toHaveStyle({
      width: `${geometry.width}px`,
      height: `${geometry.height}px`,
    });
    expect(thumbOf(size)).toHaveStyle({
      width: `${geometry.thumbSize}px`,
      height: `${geometry.thumbSize}px`,
      top: `${geometry.padding}px`,
    });
    expect(trackOf(size)).toHaveStyle({
      borderTopLeftRadius: `${TRACK_RADIUS.default(geometry.height)}px`,
    });
  });

  it('takes the caller custom track size over the preset', () => {
    render(<Switch dataTestId="s" trackWidth={100} trackHeight={50} />);
    expect(screen.getByTestId('s')).toHaveStyle({ width: '100px', height: '50px' });
  });

  it('starts the thumb at the padding and travels the track minus its own width', () => {
    render(<Switch dataTestId="s" size="md" />);
    const geometry = SWITCH_SIZES.md;
    const { rest, travel } = thumbTravel('default', geometry);
    expect(rest).toBe(geometry.padding);
    expect(travel).toBe(geometry.width - geometry.thumbSize - geometry.padding * 2);
    expect(thumbOf('s')).toHaveStyle({ left: `${rest}px` });
  });

  it('fills the track with the hue once on, and the disabled ink while off', () => {
    render(
      <>
        <Switch dataTestId="on" checked />
        <Switch dataTestId="off" />
        <Switch dataTestId="danger" checked color="danger" />
        <Switch dataTestId="neutral" checked color="neutral" />
      </>,
    );
    expect(trackOf('on')).toHaveStyle({ backgroundColor: theme.palette.primary.main });
    expect(trackOf('off')).toHaveStyle({
      backgroundColor: alpha(theme.palette.action.disabled, 0.3),
    });
    expect(trackOf('danger')).toHaveStyle({ backgroundColor: theme.palette.danger.main });
    expect(trackOf('neutral')).toHaveStyle({ backgroundColor: theme.palette.grey[700] });
  });

  it('gives each look its own track radius and iOS its own travel', () => {
    const geometry = SWITCH_SIZES.md;
    render(
      <>
        <Switch dataTestId="ios" variant="ios" />
        <Switch dataTestId="android" variant="android" />
        <Switch dataTestId="material" variant="material" />
      </>,
    );
    expect(trackOf('android')).toHaveStyle({
      borderTopLeftRadius: `${TRACK_RADIUS.android(geometry.height)}px`,
    });
    expect(trackOf('material')).toHaveStyle({
      borderTopLeftRadius: `${TRACK_RADIUS.material(geometry.height)}px`,
    });
    // The iOS look nudges the whole control 2px right and shortens the trip.
    expect(thumbOf('ios')).toHaveStyle({ left: `${geometry.padding + 2}px` });
    expect(thumbTravel('ios', geometry).travel).toBe(geometry.width - geometry.thumbSize - 4);
  });

  it('greys the thumb and fades the track while disabled, and stays put', () => {
    const onChange = vi.fn();
    render(<Switch dataTestId="s" disabled onChange={onChange} />);
    expect(thumbOf('s')).toHaveStyle({ backgroundColor: theme.palette.grey[100] });
    expect(trackOf('s')).toHaveStyle({ opacity: String(DISABLED.trackOpacity) });
    expect(screen.getByTestId('s')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('s'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('spins inside the thumb while loading, and refuses the press', () => {
    const onChange = vi.fn();
    render(<Switch dataTestId="s" loading onChange={onChange} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('s'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('prints the label wording inside the track for the label variant', () => {
    render(<Switch dataTestId="s" variant="label" onText="ON" offText="OFF" />);
    expect(screen.getByTestId('s')).toHaveTextContent('ON');
    expect(screen.getByTestId('s')).toHaveTextContent('OFF');
  });

  it('sets the label in MUI body2 at 500, and the error hue when it errs', () => {
    const { rerender } = render(<Switch dataTestId="s" label="Som" description="Alto" />);
    const label = screen.getByTestId('s-label');
    expect(label.style.fontSize).toBe(`${SWITCH_LABEL.fontSize}px`);
    expect(label.style.fontWeight).toBe(String(SWITCH_LABEL.fontWeight));
    expect(label).toHaveStyle({ color: theme.palette.text.primary });

    rerender(<Switch dataTestId="s" label="Som" description="Alto" error helperText="Erro" />);
    expect(screen.getByTestId('s-label')).toHaveStyle({ color: theme.palette.danger.main });
    expect(screen.getByTestId('s-helper')).toHaveStyle({ color: theme.palette.danger.main });
  });

  it('puts the control before the label when asked, and stacks it when told to', () => {
    const { rerender } = render(<Switch dataTestId="s" label="Som" labelPosition="start" />);
    const row = screen.getByTestId('s').parentElement as HTMLElement;
    expect(row.firstElementChild).toBe(screen.getByTestId('s'));
    expect(row).toHaveStyle({ flexDirection: 'row' });

    rerender(<Switch dataTestId="s" label="Som" labelPosition="top" />);
    expect(screen.getByTestId('s').parentElement).toHaveStyle({ flexDirection: 'column' });
  });

  it('reads the provider theme for the hue it fills with', () => {
    render(
      <UiProvider theme={{ palette: { primary: '#00897b' } }}>
        <Switch dataTestId="t" checked />
      </UiProvider>,
    );
    expect(trackOf('t')).toHaveStyle({ backgroundColor: 'rgb(0, 137, 123)' });
  });
});
