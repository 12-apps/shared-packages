import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FleetMap } from '../FleetMap';
import { FLEET, FLEET_COPY } from '../FleetMap.fixtures';

/**
 * The behaviours five review rounds added guards for, as tests CI actually runs.
 *
 * Every one of these is also covered by a story in `FleetMap.test.stories.tsx`,
 * and those are the richer versions — they drive a real Chromium and can assert
 * things jsdom cannot. But `test-storybook` is deliberately NOT in this repo's
 * CI (see the note beside the Storybook job: turning it on means triaging every
 * pre-existing `*.test.stories.tsx` in the package, which is its own change).
 * So the stories are a developer's tool here, not a check — and a guard whose
 * only test never runs is a guard that will be deleted by someone one day with
 * a green pipeline.
 *
 * These are the subset that survives jsdom. They are duplication on purpose.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the arrow keys, when nothing can move the selection', () => {
  it('leaves the event un-prevented for the page', () => {
    // `selectedId` without `onSelect` is a controlled selection nothing can
    // move. Swallowing the keypress there left a keyboard user unable to move
    // the selection AND unable to scroll past the roster.
    const arrows: boolean[] = [];
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') arrows.push(event.defaultPrevented);
    };
    document.addEventListener('keydown', listener);

    render(<FleetMap units={FLEET} copy={FLEET_COPY} selectedId="ana" dataTestId="fleet" />);
    fireEvent.keyDown(screen.getByTestId('fleet-roster'), { key: 'ArrowDown' });
    document.removeEventListener('keydown', listener);

    expect(arrows).toEqual([false]);
  });

  it('DOES consume it when the selection can move', () => {
    // The other polarity, so the case above cannot pass by accident — an
    // assertion that only ever sees one outcome has not been shown to work.
    const arrows: boolean[] = [];
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') arrows.push(event.defaultPrevented);
    };
    document.addEventListener('keydown', listener);

    render(<FleetMap units={FLEET} copy={FLEET_COPY} dataTestId="fleet" />);
    fireEvent.keyDown(screen.getByTestId('fleet-roster'), { key: 'ArrowDown' });
    document.removeEventListener('keydown', listener);

    expect(arrows).toEqual([true]);
  });

  it('ignores a MODIFIED arrow, which belongs to the browser', () => {
    const onSelect = vi.fn();
    render(<FleetMap units={FLEET} copy={FLEET_COPY} onSelect={onSelect} dataTestId="fleet" />);
    fireEvent.keyDown(screen.getByTestId('fleet-roster'), { key: 'ArrowDown', shiftKey: true });

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('selection with neither prop passed', () => {
  it('is kept by the component itself', () => {
    render(<FleetMap units={FLEET} copy={FLEET_COPY} dataTestId="fleet" />);

    fireEvent.click(screen.getByTestId('fleet-ale'));

    expect(screen.getByTestId('fleet-ale')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the reload announcement', () => {
  it('is mounted and EMPTY while idle, so the region exists before its text', () => {
    // A screen reader watches an existing region for mutations; one that appears
    // already populated announces nothing.
    render(
      <FleetMap
        units={FLEET}
        copy={{ ...FLEET_COPY, loading: 'Atualizando a frota' }}
        dataTestId="fleet"
      />,
    );

    const status = screen.getByTestId('fleet-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('');
  });

  it('carries the copy while loading, OUTSIDE the busy subtree', () => {
    // `aria-busy` tells assistive tech to hold back changes within it, so the
    // announcement must not be a descendant of the element carrying it.
    render(
      <FleetMap
        units={FLEET}
        copy={{ ...FLEET_COPY, loading: 'Atualizando a frota' }}
        loading
        dataTestId="fleet"
      />,
    );

    const status = screen.getByTestId('fleet-status');
    const body = screen.getByTestId('fleet-body');
    expect(status).toHaveTextContent('Atualizando a frota');
    expect(body).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('fleet')).not.toHaveAttribute('aria-busy');
    expect(body).not.toContainElement(status);
  });

  it('stays absent when the caller names no loading word', async () => {
    render(<FleetMap units={FLEET} copy={FLEET_COPY} loading dataTestId="fleet" />);

    await waitFor(() => expect(screen.queryByTestId('fleet-status')).not.toBeInTheDocument());
  });
});

describe('a poll over a populated roster', () => {
  it('keeps the listbox mounted, so the focus inside it survives', async () => {
    render(<FleetMap units={FLEET} copy={FLEET_COPY} loading dataTestId="fleet" />);

    expect(screen.getByTestId('fleet-roster')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await waitFor(() => expect(screen.queryByTestId('fleet-skeleton')).not.toBeInTheDocument());
  });

  it('shows skeletons only before the first units land', async () => {
    render(<FleetMap units={[]} copy={FLEET_COPY} loading dataTestId="fleet" />);

    expect(screen.getByTestId('fleet-skeleton')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('fleet-roster')).not.toBeInTheDocument());
  });
});
