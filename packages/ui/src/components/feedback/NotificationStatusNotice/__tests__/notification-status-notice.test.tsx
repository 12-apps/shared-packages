import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NotificationStatusNotice } from '../NotificationStatusNotice';

describe('Given a reader whose notifications are on', () => {
  it('then it says so and offers nothing to press', async () => {
    render(<NotificationStatusNotice status="enabled" title="You will be notified here." />);

    const root = screen.getByTestId('notification-status-notice');
    expect(root).toHaveAttribute('data-status', 'enabled');
    expect(root).toHaveTextContent('You will be notified here.');
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });
});

describe('Given notifications that are off but can be asked for', () => {
  it('then the action calls onEnable', () => {
    const onEnable = vi.fn();
    render(
      <NotificationStatusNotice
        status="disabled"
        title="Notifications are off."
        enableLabel="Turn on"
        onEnable={onEnable}
      />,
    );

    fireEvent.click(screen.getByTestId('notification-status-notice-enable'));

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('then a pending request cannot be sent twice', () => {
    const onEnable = vi.fn();
    render(
      <NotificationStatusNotice
        status="disabled"
        title="Notifications are off."
        enableLabel="Turn on"
        onEnable={onEnable}
        pending
      />,
    );

    const action = screen.getByTestId('notification-status-notice-enable');
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(onEnable).not.toHaveBeenCalled();
  });
});

describe('Given notifications the browser has blocked', () => {
  const steps = ['Open the site settings.', 'Find Notifications.', 'Choose Allow.'];

  it('then the steps start collapsed behind a disclosure', async () => {
    render(
      <NotificationStatusNotice
        status="blocked"
        title="Notifications are blocked."
        stepsToggleLabel="Turn them back on"
        steps={steps}
      />,
    );

    const toggle = screen.getByTestId('notification-status-notice-steps-toggle');
    const list = screen.getByTestId('notification-status-notice-steps');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', list.id);
    await waitFor(() => expect(list).not.toBeVisible());
  });

  it('then opening the disclosure shows every step, in order', () => {
    render(
      <NotificationStatusNotice
        status="blocked"
        title="Notifications are blocked."
        stepsToggleLabel="Turn them back on"
        steps={steps}
      />,
    );

    fireEvent.click(screen.getByTestId('notification-status-notice-steps-toggle'));

    const list = screen.getByTestId('notification-status-notice-steps');
    expect(list).toBeVisible();
    expect(list.tagName).toBe('OL');
    expect(Array.from(list.querySelectorAll('li'), (item) => item.textContent)).toEqual(steps);
    expect(screen.getByTestId('notification-status-notice-steps-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('then a second press folds them away again', async () => {
    render(
      <NotificationStatusNotice
        status="blocked"
        title="Notifications are blocked."
        stepsToggleLabel="Turn them back on"
        steps={steps}
        defaultStepsOpen
      />,
    );

    fireEvent.click(screen.getByTestId('notification-status-notice-steps-toggle'));

    await waitFor(() => expect(screen.getByTestId('notification-status-notice-steps')).not.toBeVisible());
  });
});

describe('Given a browser that cannot be notified at all', () => {
  it('then it says so and offers nothing to press', async () => {
    render(
      <NotificationStatusNotice
        status="unavailable"
        title="We cannot notify you in this browser."
        dataTestId="push"
      />,
    );

    expect(screen.getByTestId('push')).toHaveAttribute('data-status', 'unavailable');
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });
});

describe('Given any status', () => {
  it('then it announces politely rather than interrupting', () => {
    render(<NotificationStatusNotice status="blocked" title="Blocked." stepsToggleLabel="Fix" steps={[]} />);

    const root = screen.getByTestId('notification-status-notice');
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveAttribute('aria-live', 'polite');
  });
});
