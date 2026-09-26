/**
 * `SettingGroup` — one subject, a main switch, dependent rows that dim rather
 * than vanish (FUT-2823).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SETTING_SWITCH_COPY as COPY } from '../../../../en-US';
import { SettingGroup } from '../SettingGroup';
import { SettingToggle } from '../SettingToggle';
import { deferred } from './deferred';

afterEach(cleanup);

const HINT = 'Turn on notifications to choose which ones you get.';

function Host({ initial = false, save = vi.fn() }: { initial?: boolean; save?: (next: boolean) => Promise<void> | void }) {
  const [on, setOn] = useState(initial);
  const [digest, setDigest] = useState(true);
  return (
    <SettingGroup
      title="Notifications"
      summary="What we tell you about, and how"
      inactiveHint={HINT}
      copy={COPY}
      dataTestId="group"
      checked={on}
      onChange={async (next) => {
        await save(next);
        setOn(next);
      }}
    >
      <SettingToggle
        variant="row"
        title="Weekly digest"
        copy={COPY}
        checked={digest}
        onChange={setDigest}
        dataTestId="digest"
      />
      <label htmlFor="quiet">Quiet hours from</label>
      <input id="quiet" data-testid="quiet" />
    </SettingGroup>
  );
}

const main = () => screen.getByTestId('group-switch');
const dependents = () => screen.getByTestId('group-dependents');

describe('SettingGroup off', () => {
  it('keeps the dependent rows rendered, dimmed and inert, and explains why', () => {
    render(<Host />);

    expect(within(dependents()).getByText('Weekly digest')).toBeInTheDocument();
    expect(screen.getByTestId('quiet')).toBeInTheDocument();
    expect(dependents()).toHaveAttribute('inert');
    expect(dependents()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('group-hint')).toHaveTextContent(HINT);
    expect(dependents()).toHaveAttribute('aria-describedby', screen.getByTestId('group-hint').id);
    expect(screen.getByTestId('group')).toHaveAttribute('data-active', 'false');
  });

  it("disables the family's own rows, not just their container", () => {
    render(<Host />);

    expect(screen.getByTestId('digest-switch')).toBeDisabled();
  });

  it('labels the dependent rows with the subject', () => {
    render(<Host />);

    expect(screen.getByRole('group', { name: 'Notifications' })).toBe(dependents());
  });
});

describe('SettingGroup on', () => {
  it('activates the rows and drops the hint once the main switch is saved on', async () => {
    render(<Host />);
    fireEvent.click(main());

    await waitFor(() => expect(dependents()).not.toHaveAttribute('inert'));
    await waitFor(() => expect(screen.queryByTestId('group-hint')).toBeNull());
    expect(dependents()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('digest-switch')).not.toBeDisabled();
  });

  it('keeps the rows inactive until the save lands', async () => {
    const pending = deferred();
    render(<Host save={() => pending.promise} />);
    fireEvent.click(main());

    await waitFor(() => expect(main()).toHaveAttribute('aria-busy', 'true'));
    expect(main()).toBeChecked();
    expect(dependents()).toHaveAttribute('inert');

    pending.resolve();
    await waitFor(() => expect(dependents()).not.toHaveAttribute('inert'));
  });

  it('dims the rows at once when the main switch is turned off', async () => {
    const pending = deferred();
    render(<Host initial save={() => pending.promise} />);
    expect(dependents()).not.toHaveAttribute('inert');
    fireEvent.click(main());

    await waitFor(() => expect(dependents()).toHaveAttribute('inert'));
    pending.resolve();
    await waitFor(() => expect(main()).toHaveAttribute('aria-busy', 'false'));
  });

  it('stays off, with the error, when turning it on fails', async () => {
    render(<Host save={() => Promise.reject(new Error('nope'))} />);
    fireEvent.click(main());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(COPY.saveFailed));
    expect(main()).not.toBeChecked();
    expect(dependents()).toHaveAttribute('inert');
  });
});
