import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { PT_BR_ADDRESS_AUTOCOMPLETE_COPY } from '../../../pt-BR';

import { AddressAutocomplete } from './AddressAutocomplete';

/**
 * THE EMPTY LIST SAYS WHY IT IS EMPTY (FUT-4162).
 *
 * The field is a `freeSolo` MUI Autocomplete, and MUI never renders
 * `noOptionsText` in that mode: an open list with nothing in it was a blank
 * strip, and the two sentences the copy pack carries for it never showed. The
 * suggestions paper now says them itself.
 */
const meta: Meta<typeof AddressAutocomplete> = {
  title: 'Form/AddressAutocomplete/Tests/Empty list',
  component: AddressAutocomplete,
  args: {
    copy: PT_BR_ADDRESS_AUTOCOMPLETE_COPY,
    label: 'Endereço',
    placeholder: 'Digite o endereço',
    googleMapsApiKey: 'demo-key',
    onSelect: fn(),
  },
  parameters: { layout: 'centered' },
  tags: ['test', 'component:AddressAutocomplete'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const emptyRow = () => within(document.body).findByTestId('address-suggestions-empty', {}, { timeout: 3000 });

export const AsksForMoreCharacters: Story = {
  play: async ({ canvasElement }) => {
    const input = await within(canvasElement).findByPlaceholderText('Digite o endereço');
    await userEvent.type(input, 'ab');

    await expect(await emptyRow()).toHaveTextContent(PT_BR_ADDRESS_AUTOCOMPLETE_COPY.typeToSearch ?? '');
  },
};

export const SaysNothingWasFound: Story = {
  play: async ({ canvasElement }) => {
    const input = await within(canvasElement).findByPlaceholderText('Digite o endereço');
    await userEvent.type(input, 'zzzzzzzzzzz');

    await waitFor(
      async () => {
        await expect(await emptyRow()).toHaveTextContent(PT_BR_ADDRESS_AUTOCOMPLETE_COPY.noAddressesFound ?? '');
      },
      { timeout: 3000 },
    );
  },
};

export const StaysQuietWhileSuggestionsShow: Story = {
  play: async ({ canvasElement }) => {
    const input = await within(canvasElement).findByPlaceholderText('Digite o endereço');
    await userEvent.type(input, 'main street');

    const body = within(document.body);
    await body.findByTestId('address-suggestion-0', {}, { timeout: 3000 });
    await waitFor(() => expect(body.queryByTestId('address-suggestions-empty')).not.toBeInTheDocument());
  },
};
