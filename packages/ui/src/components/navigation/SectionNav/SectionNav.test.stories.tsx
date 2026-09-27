import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EN_US_SECTION_NAV_COPY } from '../../../en-US.navigation';

import { SectionNav } from './SectionNav';
import { DESTINATIONS, MORE, PRIMARY, PhoneFrame, RailFrame } from './__stories__/fixtures';

const meta: Meta<typeof SectionNav> = {
  title: 'Navigation/SectionNav/Tests',
  component: SectionNav,
  args: {
    layout: 'bar',
    label: 'Operations',
    destinations: DESTINATIONS,
    primary: PRIMARY,
    more: MORE,
    copy: EN_US_SECTION_NAV_COPY,
  },
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
    docs: { description: { component: 'Interaction tests for SectionNav: slot order, the primary sheet, the more sheet, the rail.' } },
  },
  tags: ['autodocs', 'test', 'component:SectionNav'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

export const PrimarySitsInTheMiddle: Story = {
  name: 'Bar: the raised action sits between the second and third slots',
  render: (args) => (
    <PhoneFrame>
      <SectionNav {...args} />
    </PhoneFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole('navigation', { name: 'Operations' });
    const ids = Array.from(nav.querySelectorAll('[data-testid]'))
      .map((node) => node.getAttribute('data-testid') ?? '')
      .filter((id) => /^section-nav-(dest-[a-z]+|primary|more)$/.test(id));
    await expect(ids).toEqual([
      'section-nav-dest-floor',
      'section-nav-dest-board',
      'section-nav-primary',
      'section-nav-dest-serve',
      'section-nav-more',
    ]);
  },
};

export const PrimaryOpensAndCloses: Story = {
  name: 'Bar: the raised action opens its sheet and closes it again',
  render: (args) => (
    <PhoneFrame>
      <SectionNav {...args} />
    </PhoneFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const button = canvas.getByTestId('section-nav-primary');
    await userEvent.click(button);
    await waitFor(() => expect(body.getByText('Create now')).toBeVisible());
    await expect(button).toHaveAttribute('aria-label', 'Close');
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'));
  },
};

export const MoreRollsUpItsCounts: Story = {
  name: 'Bar: more carries its entries’ counts and lists them in its sheet',
  render: (args) => (
    <PhoneFrame>
      <SectionNav {...args} />
    </PhoneFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const more = canvas.getByTestId('section-nav-more');
    await expect(within(more).getByLabelText('1 pending')).toBeInTheDocument();
    await userEvent.click(more);
    await waitFor(() => expect(body.getByTestId('section-nav-more-sheet-entry-queue')).toBeVisible());
  },
};

export const RailListsEverything: Story = {
  name: 'Rail: the way back, the destinations and every entry are all visible',
  args: { layout: 'rail', back: { label: 'Back', href: '#home' }, heading: 'Operations' },
  render: (args) => (
    <RailFrame>
      <SectionNav {...args} />
    </RailFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('section-nav-back')).toBeVisible();
    await expect(canvas.getByTestId('section-nav-dest-board')).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByTestId('section-nav-primary-entry-pause')).toBeVisible();
    await expect(canvas.getByTestId('section-nav-more-entry-queue')).toBeVisible();
  },
};
