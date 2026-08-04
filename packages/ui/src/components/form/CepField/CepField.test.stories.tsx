import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { CepField } from './CepField';
import type { CepAddress } from './CepField.types';

const ADDRESS: CepAddress = {
  cep: '01310100',
  street: 'Avenida Paulista',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};

const meta: Meta<typeof CepField> = {
  title: 'Form/CepField/Tests',
  component: CepField,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
    docs: {
      description: { component: 'Test stories for CepField masking, lookup and race-safety' },
    },
  },
  tags: ['autodocs', 'test'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

/** Controlled harness — the field is controlled, so tests need real state. */
function Harness({
  onLookup,
  onResolved,
  onNotFound,
  debounceMs = 0,
  initial = '',
  disabled = false,
}: {
  onLookup?: (cep: string) => Promise<CepAddress | null>;
  onResolved?: (address: CepAddress) => void;
  onNotFound?: () => void;
  debounceMs?: number;
  initial?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <CepField
      value={value}
      onChange={setValue}
      onLookup={onLookup}
      onResolved={onResolved}
      onNotFound={onNotFound}
      debounceMs={debounceMs}
      disabled={disabled}
    />
  );
}

// 1. Masking

export const MasksWhileTyping: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '01310100');
    await expect(input).toHaveValue('01310-100');
  },
};

export const StripsNonDigitsAndCaps: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, 'ab01310100999');
    await expect(input).toHaveValue('01310-100');
  },
};

// 2. Lookup

export const ResolvesACompleteCep: Story = {
  render: function ResolvesStory() {
    const onResolved = fn();
    return (
      <Harness onLookup={async () => ADDRESS} onResolved={onResolved} />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '01310100');
    await waitFor(() => expect(canvas.getByTestId('cep-field-postalCode-found')).toBeInTheDocument());
  },
};

export const DoesNotLookUpAnIncompleteCep: Story = {
  render: function IncompleteStory() {
    const lookup = fn(async () => ADDRESS);
    return <Harness onLookup={lookup} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '0131');
    // Presence evidence first: the field really did take the partial value…
    await expect(input).toHaveValue('0131');
    // …and no status line ever appears, because an incomplete CEP is never
    // queried. waitFor gives the (absent) debounce a chance to fire first.
    await waitFor(() => {
      expect(canvas.queryByTestId('cep-field-postalCode-loading')).toBeNull();
      expect(canvas.queryByTestId('cep-field-postalCode-found')).toBeNull();
    });
  },
};

export const ReportsAnUnknownCep: Story = {
  render: () => <Harness onLookup={async () => null} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '00000000');
    await waitFor(() =>
      expect(canvas.getByTestId('cep-field-postalCode-notfound')).toBeInTheDocument(),
    );
  },
};

/**
 * A miss must be REPORTED, not just displayed: callers that auto-filled from a
 * previous CEP rely on `onNotFound` to undo it, so the form never shows one
 * CEP's street under another's.
 */
export const ReportsAMissToTheCaller: Story = {
  render: function ReportsMissStory() {
    const [missed, setMissed] = useState(false);
    return (
      <div>
        <Harness onLookup={async () => null} onNotFound={() => setMissed(true)} />
        <span data-testid="miss-flag">{missed ? 'missed' : 'clean'}</span>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '00000000');
    await waitFor(() => expect(canvas.getByTestId('miss-flag')).toHaveTextContent('missed'));
  },
};

/** …and a resolved CEP must NOT report a miss. */
export const DoesNotReportAMissOnSuccess: Story = {
  render: function NoMissStory() {
    const [missed, setMissed] = useState(false);
    return (
      <div>
        <Harness onLookup={async () => ADDRESS} onNotFound={() => setMissed(true)} />
        <span data-testid="miss-flag">{missed ? 'missed' : 'clean'}</span>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '01310100');
    await waitFor(() => expect(canvas.getByTestId('cep-field-postalCode-found')).toBeInTheDocument());
    await expect(canvas.getByTestId('miss-flag')).toHaveTextContent('clean');
  },
};

/** A lookup that throws is indistinguishable from "not found" — never a crash. */
export const SurvivesAThrowingLookup: Story = {
  render: () => (
    <Harness
      onLookup={async () => {
        throw new Error('provider down');
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '01310100');
    await waitFor(() =>
      expect(canvas.getByTestId('cep-field-postalCode-notfound')).toBeInTheDocument(),
    );
  },
};

/**
 * …including a lookup that throws BEFORE returning a promise, which is what a
 * misconfigured adapter does. Awaiting the call and catching on its result
 * would miss this one entirely and surface it as an unhandled rejection.
 */
export const SurvivesASynchronousThrow: Story = {
  render: () => (
    <Harness
      onLookup={() => {
        throw new Error('adapter misconfigured');
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '01310100');
    await waitFor(() =>
      expect(canvas.getByTestId('cep-field-postalCode-notfound')).toBeInTheDocument(),
    );
  },
};

// 3. State

export const DisabledSuppressesLookup: Story = {
  render: () => <Harness initial="01310-100" disabled onLookup={async () => ADDRESS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await expect(input).toBeDisabled();
    await expect(input).toHaveValue('01310-100');
    // A complete CEP, but disabled suppresses the lookup entirely.
    await waitFor(() => expect(canvas.queryByTestId('cep-field-postalCode-found')).toBeNull());
  },
};

export const ClearsStatusWhenEditedBackToIncomplete: Story = {
  render: () => <Harness onLookup={async () => ADDRESS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await userEvent.type(input, '01310100');
    await waitFor(() => expect(canvas.getByTestId('cep-field-postalCode-found')).toBeInTheDocument());

    await userEvent.type(input, '{backspace}');
    await waitFor(() => expect(canvas.queryByTestId('cep-field-postalCode-found')).toBeNull());
  },
};

// 4. Accessibility

export const ExposesAccessibleStatus: Story = {
  render: () => <Harness onLookup={async () => ADDRESS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('cep-field-postalCode');

    await expect(input).toHaveAttribute('aria-describedby', 'cep-field-postalCode-status');
    await userEvent.type(input, '01310100');
    await waitFor(() => expect(canvas.getByRole('status')).toBeInTheDocument());
  },
};

export const RendersACallerError: Story = {
  render: function ErrorStory() {
    const [value, setValue] = useState('123');
    return <CepField value={value} onChange={setValue} error="CEP inválido." />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('cep-field-postalCode-message')).toHaveTextContent(
      'CEP inválido.',
    );
  },
};
