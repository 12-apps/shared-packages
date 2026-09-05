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
      const roster = canvas.getByTestId('fleet-roster');
      const labels = within(roster)
        .getAllByRole('option')
        .map((row) => row.getAttribute('data-testid'));
      await expect(labels).toEqual(['fleet-ana', 'fleet-bruno', 'fleet-caio']);
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
      await expect(canvas.getByTestId('fleet-caio')).toHaveAttribute('data-freshness', 'stale');
    });

    await step('The state is spelled out, never carried by colour alone', async () => {
      await expect(canvas.getByTestId('fleet-ana-meta')).toHaveTextContent('Live');
      await expect(canvas.getByTestId('fleet-bruno-meta')).toHaveTextContent('Lagging');
      await expect(canvas.getByTestId('fleet-caio-meta')).toHaveTextContent('Stale');
    });

    await step('The caller formats the duration; the component never does', async () => {
      await expect(canvas.getByTestId('fleet-ana-meta')).toHaveTextContent('8s ago');
      await expect(canvas.getByTestId('fleet-bruno-meta')).toHaveTextContent('2 min ago');
    });

    await step('Accuracy renders only when the platform reported one', async () => {
      await expect(canvas.getByTestId('fleet-ana-meta')).toHaveTextContent('±12 m');
      await expect(canvas.getByTestId('fleet-caio-meta')).not.toHaveTextContent('±');
    });
  },
};

export const ThresholdsAreProps: Story = {
  name: '🧪 The same fleet reads differently on tighter thresholds',
  args: { laggingAfterSeconds: 5, staleAfterSeconds: 20 },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('A unit that was live at 90s is stale at 20s', async () => {
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
      await userEvent.click(canvas.getByTestId('fleet-caio'));
      await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith('caio'));
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
      await waitFor(() => expect(args.onSelect).toHaveBeenCalledWith('caio'));
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

    await step('The selected option is named by aria-activedescendant', async () => {
      const roster = canvas.getByTestId('fleet-roster');
      // Nothing selected here, so the attribute is absent rather than empty —
      // an empty activedescendant points at an element that does not exist.
      await expect(roster).not.toHaveAttribute('aria-activedescendant');
    });

    await step('The map is a NAMED region, never an aria-hidden one', async () => {
      // Its controls are focusable, and `aria-hidden` over a focusable subtree
      // is the `aria-hidden-focus` violation: a keyboard user would tab into a
      // region a screen reader insists is not there.
      const map = canvas.getByTestId('fleet-canvas');
      await expect(map).not.toHaveAttribute('aria-hidden');
      await expect(canvas.getByRole('group', { name: 'Map of where the couriers are' })).toBe(map);
    });

    await step('The freshness dot is hidden, so its state is not read twice', async () => {
      await expect(canvas.getByTestId('fleet-ana-dot')).toHaveAttribute('aria-hidden', 'true');
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
  name: '🧪 Loading — skeletons, and the panel announces busy',
  args: { loading: true },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The panel is busy and the roster is a skeleton', async () => {
      await expect(canvas.getByTestId('fleet')).toHaveAttribute('aria-busy', 'true');
      await expect(canvas.getByTestId('fleet-skeleton')).toBeInTheDocument();
    });

    await step('The heading stays, so the panel does not reflow on load', async () => {
      await expect(canvas.getByTestId('fleet-title')).toBeInTheDocument();
    });

    await step('Loading with no units is NOT the empty state', async () => {
      // The two are opposite messages — "nothing to show" and "not yet asked" —
      // and rendering the empty one while a request is in flight tells a
      // dispatcher the road is clear when nobody has looked.
      await waitFor(() => expect(canvas.queryByTestId('fleet-empty')).not.toBeInTheDocument());
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
