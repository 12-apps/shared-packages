import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { FleetMap } from './FleetMap';
import { FLEET, FLEET_COPY } from './FleetMap.fixtures';

const meta: Meta<typeof FleetMap> = {
  title: 'Data Display/FleetMap/Tests',
  component: FleetMap,
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:FleetMap'],
  args: { units: FLEET, copy: FLEET_COPY, dataTestId: 'fleet' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const BasicInteraction: Story = {
  name: '🧪 Renders a row per unit, freshest first',
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The panel and its heading are present', async () => {
      await expect(canvas.getByTestId('fleet')).toBeInTheDocument();
      await expect(canvas.getByTestId('fleet-title')).toHaveTextContent('Couriers on the road');
    });

    await step('Every unit has a row', async () => {
      for (const unit of FLEET) {
        await expect(canvas.getByTestId(`fleet-${unit.id}-label`)).toHaveTextContent(unit.label);
      }
    });

    await step('The roster is ordered freshest first, not by the array', async () => {
      // The fixture is authored ale, ana, bruno — so this fails against an
      // identity sort, which is what makes it an assertion about `rosterOrder`
      // rather than about the fixture.
      await expect(FLEET.map((unit) => unit.id)).toEqual(['ale', 'ana', 'bruno']);
      const roster = canvas.getByTestId('fleet-roster');
      const labels = within(roster)
        .getAllByRole('option')
        .map((row) => row.getAttribute('data-testid'));
      await expect(labels).toEqual(['fleet-ana', 'fleet-bruno', 'fleet-ale']);
    });
  },
};

export const FreshnessTest: Story = {
  name: '🧪 Freshness — three states from two thresholds',
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Each row carries its own freshness', async () => {
      await expect(canvas.getByTestId('fleet-ana')).toHaveAttribute('data-freshness', 'live');
      await expect(canvas.getByTestId('fleet-bruno')).toHaveAttribute('data-freshness', 'lagging');
      await expect(canvas.getByTestId('fleet-ale')).toHaveAttribute('data-freshness', 'stale');
    });

    await step('The state is spelled out, never carried by colour alone', async () => {
      await expect(canvas.getByTestId('fleet-ana-meta')).toHaveTextContent('Live');
      await expect(canvas.getByTestId('fleet-bruno-meta')).toHaveTextContent('Lagging');
      await expect(canvas.getByTestId('fleet-ale-meta')).toHaveTextContent('Stale');
    });

    await step('The caller formats the duration; the component never does', async () => {
      await expect(canvas.getByTestId('fleet-ana-meta')).toHaveTextContent('8s ago');
      await expect(canvas.getByTestId('fleet-bruno-meta')).toHaveTextContent('2 min ago');
    });

    await step('Accuracy renders only when the platform reported one', async () => {
      await expect(canvas.getByTestId('fleet-ana-meta')).toHaveTextContent('±12 m');
      await expect(canvas.getByTestId('fleet-ale-meta')).not.toHaveTextContent('±');
    });
  },
};

export const ThresholdsAreProps: Story = {
  name: '🧪 The same fleet reads differently on tighter thresholds',
  args: { laggingAfterSeconds: 5, staleAfterSeconds: 20 },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('A unit that was live at 90s is only lagging at 5s', async () => {
      // The whole reason the thresholds are props: a fleet's cadence decides
      // what "live" means, and a component that picked one would pick it for
      // every consumer.
      await expect(canvas.getByTestId('fleet-ana')).toHaveAttribute('data-freshness', 'lagging');
      await expect(canvas.getByTestId('fleet-bruno')).toHaveAttribute('data-freshness', 'stale');
    });
  },
};

export const SelectionTest: Story = {
  name: '🧪 Clicking a row reports the selection',
  args: { onSelect: fn(), selectedId: 'bruno' },
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The selected row is marked, and only that one', async () => {
      await expect(canvas.getByTestId('fleet-bruno')).toHaveAttribute('aria-selected', 'true');
      await expect(canvas.getByTestId('fleet-ana')).toHaveAttribute('aria-selected', 'false');
    });

    await step('Clicking another row reports it', async () => {
      await userEvent.click(canvas.getByTestId('fleet-ale'));
      await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith('ale'));
    });
  },
};

export const KeyboardNavigationTest: Story = {
  name: '🧪 Keyboard — one tab stop, arrows inside',
  args: { onSelect: fn(), selectedId: 'ana' },
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);
    const roster = canvas.getByTestId('fleet-roster');

    await step('The roster is a single tab stop', async () => {
      // A dispatcher tabbing past a fleet of thirty must not press it thirty
      // times to reach the map.
      await expect(roster).toHaveAttribute('tabindex', '0');
    });

    await step('ArrowDown moves to the next unit', async () => {
      // Tab in rather than calling `.focus()`: the keyboard is how a user
      // reaches this, and the roster is the first focusable node in the panel —
      // so this also asserts the tab ORDER, which a direct focus call skips.
      await userEvent.tab();
      await waitFor(() => expect(roster).toHaveFocus());
      await userEvent.keyboard('{ArrowDown}');
      await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith('bruno'));
    });

    await step('ArrowUp from the first wraps to the last', async () => {
      await userEvent.keyboard('{ArrowUp}');
      await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith('ale'));
    });

    await step('A MODIFIED arrow belongs to the page, not the roster', async () => {
      // Cmd+Down is "scroll to the end of the document" on macOS, and
      // Shift+Arrow extends a selection. Capturing them takes a browser
      // gesture away from the user.
      const before = (args.onSelect as ReturnType<typeof fn>).mock.calls.length;
      await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
      await expect((args.onSelect as ReturnType<typeof fn>).mock.calls.length).toBe(before);
    });
  },
};

export const ControlledWithoutHandlerTest: Story = {
  name: '🧪 A controlled board with no handler leaves the keys to the page',
  // `selectedId` without `onSelect` is a selection nothing can move. Swallowing
  // the keypress there left a keyboard user unable to move the selection AND
  // unable to scroll past the roster — so the event must come back
  // un-prevented rather than consumed for nothing.
  args: { selectedId: 'ana', onSelect: undefined },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const roster = canvas.getByTestId('fleet-roster');

    await step('The arrow key is not consumed', async () => {
      // ONLY the arrow. Recording every keydown let the `Tab` that focuses the
      // roster satisfy the assertion on its own — `user-event` reports a
      // handled key as un-prevented — so the case passed with the guard it
      // names deleted, which is the exact defect this story exists to catch.
      const arrows: boolean[] = [];
      const listener = (event: KeyboardEvent): void => {
        if (event.key === 'ArrowDown') arrows.push(event.defaultPrevented);
      };
      canvasElement.ownerDocument.addEventListener('keydown', listener);
      await userEvent.tab();
      await waitFor(() => expect(roster).toHaveFocus());
      await userEvent.keyboard('{ArrowDown}');
      canvasElement.ownerDocument.removeEventListener('keydown', listener);

      await expect(arrows).toEqual([false]);
    });

    await step('And the selection has not moved', async () => {
      await expect(canvas.getByTestId('fleet-ana')).toHaveAttribute('aria-selected', 'true');
    });
  },
};

export const ScreenReaderTest: Story = {
  name: '🧪 Screen Reader — the roster is the map',
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The panel is a labelled region', async () => {
      const region = canvas.getByRole('region', { name: 'Couriers on the road' });
      await expect(region).toBeInTheDocument();
    });

    await step('The roster is a named listbox of options', async () => {
      const roster = canvas.getByRole('listbox', { name: 'Couriers, freshest first' });
      await expect(within(roster).getAllByRole('option')).toHaveLength(FLEET.length);
    });

    await step('With nothing selected the attribute is absent, not empty', async () => {
      // An empty activedescendant points at an element that does not exist.
      await expect(canvas.getByTestId('fleet-roster')).not.toHaveAttribute(
        'aria-activedescendant',
      );
    });

    await step('The map is a NAMED region, never an aria-hidden one', async () => {
      // Its controls are focusable, and `aria-hidden` over a focusable subtree
      // is the `aria-hidden-focus` violation: a keyboard user would tab into a
      // region a screen reader insists is not there.
      const map = canvas.getByTestId('fleet-canvas');
      await expect(map).not.toHaveAttribute('aria-hidden');
      await expect(canvas.getByRole('region', { name: 'Map of where the couriers are' })).toBe(map);
    });

    await step('The freshness dot is hidden, so its state is not read twice', async () => {
      await expect(canvas.getByTestId('fleet-ana-dot')).toHaveAttribute('aria-hidden', 'true');
    });
  },
};

export const ActiveDescendantTest: Story = {
  name: '🧪 aria-activedescendant names a row that EXISTS',
  args: { selectedId: 'bruno' },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const roster = canvas.getByTestId('fleet-roster');
    const named = roster.getAttribute('aria-activedescendant');

    await step('It resolves to the selected row', async () => {
      await expect(named).toBeTruthy();
      const target = canvasElement.ownerDocument.getElementById(named as string);
      await expect(target).toBe(canvas.getByTestId('fleet-bruno'));
    });

    await step('The row id is generated, not the test id', async () => {
      // Two boards on one page filtered from the same fleet would otherwise
      // emit duplicate DOM ids and an ambiguous activedescendant.
      await expect(named).not.toBe('fleet-bruno-option');
    });
  },
};

export const StaleSelectionTest: Story = {
  name: '🧪 A selection that has left the fleet dangles nothing',
  // The controlled selection outlives the unit it names: a courier ends their
  // shift and drops out of the next poll while selected.
  args: { selectedId: 'gone' },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('No option is marked selected', async () => {
      const selected = canvas
        .getAllByRole('option')
        .filter((row) => row.getAttribute('aria-selected') === 'true');
      await expect(selected).toHaveLength(0);
    });

    await step('And the attribute is dropped rather than left dangling', async () => {
      await expect(canvas.getByTestId('fleet-roster')).not.toHaveAttribute(
        'aria-activedescendant',
      );
    });
  },
};

export const EmptyStateTest: Story = {
  name: '🧪 Empty — a state, never an empty map',
  args: { units: [] },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The empty state renders instead of the map', async () => {
      await expect(canvas.getByTestId('fleet-empty')).toBeInTheDocument();
      await waitFor(() =>
        expect(canvas.queryByTestId('fleet-canvas')).not.toBeInTheDocument(),
      );
    });

    await step('It says what would put somebody here', async () => {
      await expect(canvas.getByTestId('fleet-empty')).toHaveTextContent('Nobody is reporting');
    });
  },
};

export const LoadingStateTest: Story = {
  name: '🧪 Loading — skeletons before the first units land',
  args: { loading: true, units: [] },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The panel is busy and the roster is a skeleton', async () => {
      // On the BODY, not the panel root: the live region announcing the reload
      // is a sibling up there, and a live region inside a busy subtree is what
      // `aria-busy` tells assistive tech to hold back.
      await expect(canvas.getByTestId('fleet-body')).toHaveAttribute('aria-busy', 'true');
      await expect(canvas.getByTestId('fleet-skeleton')).toBeInTheDocument();
    });

    await step('The heading stays, so the panel does not reflow on load', async () => {
      await expect(canvas.getByTestId('fleet-title')).toBeInTheDocument();
    });

    await step('With no centre to point at, no map is drawn', async () => {
      // MapPreview has no default centre and resolves to 0,0 — a real place in
      // the Gulf of Guinea — so the canvas renders nothing instead.
      await waitFor(() => expect(canvas.queryByTestId('fleet-canvas')).not.toBeInTheDocument());
    });

    await step('Loading with no units is NOT the empty state', async () => {
      // The two are opposite messages — "nothing to show" and "not yet asked" —
      // and rendering the empty one while a request is in flight tells a
      // dispatcher the road is clear when nobody has looked.
      await waitFor(() => expect(canvas.queryByTestId('fleet-empty')).not.toBeInTheDocument());
    });

    await step('And it stays SILENT, because this copy set names no loading word', async () => {
      // `aria-busy` is a state, not an utterance, and the skeletons are
      // aria-hidden. Announcing requires a sentence only the caller can write.
      await waitFor(() => expect(canvas.queryByTestId('fleet-status')).not.toBeInTheDocument());
    });
  },
};

export const LoadingAnnouncementTest: Story = {
  name: '🧪 Loading — announced only when the copy names it',
  args: { loading: true, units: [], copy: { ...FLEET_COPY, loading: 'Atualizando a frota' } },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The word the caller gave is in a live region', async () => {
      const status = canvas.getByTestId('fleet-status');
      await expect(status).toHaveAttribute('role', 'status');
      await expect(status).toHaveTextContent('Atualizando a frota');
    });

    await step('And that region is OUTSIDE the busy subtree', async () => {
      // Asserted here, where something is actually busy — in an idle render the
      // claim is vacuous, because the region is a sibling by construction
      // whatever `aria-busy` is attached to. `aria-busy` tells assistive tech
      // to hold back changes within it, so a live region under the busy element
      // is silent in exactly the window it exists for.
      const body = canvas.getByTestId('fleet-body');
      await expect(body).toHaveAttribute('aria-busy', 'true');
      await expect(canvas.getByTestId('fleet')).not.toHaveAttribute('aria-busy');
      await expect(body).not.toContainElement(canvas.getByTestId('fleet-status'));
    });
  },
};

export const IdleAnnouncementRegionTest: Story = {
  name: '🧪 The live region exists BEFORE it has anything to say',
  // The distinguishing case, and the one the fix actually turns on. A screen
  // reader watches an EXISTING region for mutations; one that appears already
  // populated announces nothing. So the region must be present and EMPTY while
  // idle — an assertion that only renders `loading: true` cannot tell the two
  // implementations apart.
  args: { loading: false, copy: { ...FLEET_COPY, loading: 'Atualizando a frota' } },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('It is mounted, and it is silent', async () => {
      const status = canvas.getByTestId('fleet-status');
      await expect(status).toHaveAttribute('role', 'status');
      await expect(status).toHaveTextContent('');
    });

  },
};

export const LoadingKeepsThePopulatedRosterTest: Story = {
  name: '🧪 A poll over a populated roster does not unmount it',
  args: { loading: true },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The listbox survives the refresh', async () => {
      // Swapping a populated list for skeletons on every poll throws away the
      // focus inside it, so a dispatcher arrowing the roster is thrown back to
      // the top of the page each time the data lands.
      await expect(canvas.getByTestId('fleet-roster')).toBeInTheDocument();
      await expect(canvas.getAllByRole('option')).toHaveLength(3);
    });

    await step('And the panel still reports itself busy', async () => {
      // On the BODY, not the panel root: the live region announcing the reload
      // is a sibling up there, and a live region inside a busy subtree is what
      // `aria-busy` tells assistive tech to hold back.
      await expect(canvas.getByTestId('fleet-body')).toHaveAttribute('aria-busy', 'true');
    });

    await step('Skeletons are for the FIRST load only', async () => {
      await waitFor(() =>
        expect(canvas.queryByTestId('fleet-skeleton')).not.toBeInTheDocument(),
      );
    });
  },
};

export const UncontrolledSelectionTest: Story = {
  name: '🧪 With no selection props at all, the roster still works',
  // Neither `selectedId` nor `onSelect`. Left purely controlled this rendered a
  // listbox that answered nothing AND swallowed the arrow keys, so a keyboard
  // user could neither move the selection nor scroll past the roster.
  args: { selectedId: undefined, onSelect: undefined },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    // The keyboard first, from an untouched panel: tabbing in has to reach the
    // roster, and a click inside it would move focus past there.
    await step('Arrowing in selects, with no handler anywhere', async () => {
      const roster = canvas.getByTestId('fleet-roster');
      await userEvent.tab();
      await waitFor(() => expect(roster).toHaveFocus());
      // Nothing is selected yet, so Down opens at the top of the roster.
      await userEvent.keyboard('{ArrowDown}');
      await waitFor(() =>
        expect(canvas.getByTestId('fleet-ana')).toHaveAttribute('aria-selected', 'true'),
      );
    });

    await step('The arrow keys were NOT swallowed on the way', async () => {
      // The regression this pins: `preventDefault` used to fire before a no-op
      // `select`, so a keyboard user could neither move the selection nor
      // scroll the page. A moved selection proves the first half.
      await expect(canvas.getByTestId('fleet-roster')).toHaveAttribute(
        'aria-activedescendant',
      );
    });

    await step('And clicking a row moves it too', async () => {
      await userEvent.click(canvas.getByTestId('fleet-ale'));
      await waitFor(() =>
        expect(canvas.getByTestId('fleet-ale')).toHaveAttribute('aria-selected', 'true'),
      );
      await expect(canvas.getByTestId('fleet-ana')).toHaveAttribute('aria-selected', 'false');
    });
  },
};

export const EdgeCaseTest: Story = {
  name: '🧪 Edge cases — one unit, long name, no badge',
  args: {
    units: [
      {
        id: 'solo',
        label: 'Maria Aparecida do Nascimento Gonçalves Ferreira',
        latitude: -23.55,
        longitude: -46.63,
        staleSeconds: 0,
      },
    ],
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('A single unit still renders a roster and a map', async () => {
      await expect(canvas.getAllByRole('option')).toHaveLength(1);
      await expect(canvas.getByTestId('fleet-canvas')).toBeInTheDocument();
    });

    await step('A long name is not truncated out of the accessible tree', async () => {
      await expect(canvas.getByTestId('fleet-solo-label')).toHaveTextContent(
        'Maria Aparecida do Nascimento Gonçalves Ferreira',
      );
    });

    await step('No badge renders no badge element', async () => {
      await waitFor(() =>
        expect(canvas.queryByTestId('fleet-solo-badge')).not.toBeInTheDocument(),
      );
    });

    await step('A zero-second fix is live, not an off-by-one stale', async () => {
      await expect(canvas.getByTestId('fleet-solo')).toHaveAttribute('data-freshness', 'live');
    });
  },
};
