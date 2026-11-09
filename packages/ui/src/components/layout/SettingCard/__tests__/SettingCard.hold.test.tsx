/**
 * `SettingCard` as a form hold scope (FUT-4574): while the host's form holds
 * it, Save does nothing and shows no saving spinner; Cancel stays live.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SETTING_CARD_COPY as COPY } from '../../../../en-US';
import { FormHoldProvider, useFormBusy, useFormHold } from '../../../form/FormHold';
import { SettingCard } from '../SettingCard';
import { deferred } from './deferred';

afterEach(cleanup);

function LogoField({ uploading }: { uploading: boolean }): React.ReactElement {
  useFormHold('logo', uploading);
  return <input data-testid="logo" />;
}

function Card({
  uploading,
  onSave,
  onCancel,
}: {
  uploading: boolean;
  onSave: () => void | Promise<unknown>;
  onCancel?: () => void;
}): React.ReactElement {
  return (
    <SettingCard title="Brand" copy={COPY} dataTestId="card" defaultOpen onSave={onSave} onCancel={onCancel}>
      <LogoField uploading={uploading} />
    </SettingCard>
  );
}

describe('SettingCard while busy', () => {
  it('Save is aria-disabled, does nothing, and shows no saving spinner', () => {
    const onSave = vi.fn();
    render(<Card uploading onSave={onSave} />);
    const save = screen.getByTestId('card-save');
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(save).toHaveTextContent(COPY.save);
    expect(screen.queryAllByTestId('card-saving')).toHaveLength(0);
    expect(screen.getByTestId('card')).not.toHaveAttribute('aria-busy');
  });

  it('Cancel stays enabled and calls the host, which aborts the upload', () => {
    const onCancel = vi.fn();
    render(<Card uploading onSave={vi.fn()} onCancel={onCancel} />);
    const cancel = screen.getByTestId('card-cancel');
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Save acts again once the hold is released', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<Card uploading onSave={onSave} />);
    rerender(<Card uploading={false} onSave={onSave} />);
    const save = screen.getByTestId('card-save');
    expect(save).not.toHaveAttribute('aria-disabled');
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('Cancel is disabled only by the card’s own save, as before', async () => {
    const pending = deferred();
    render(<Card uploading={false} onSave={() => pending.promise} />);
    fireEvent.click(screen.getByTestId('card-save'));
    expect(await screen.findByTestId('card-saving')).toBeInTheDocument();
    expect(screen.getByTestId('card-cancel')).toBeDisabled();
    pending.resolve();
  });
});

describe('SettingCard is its own hold scope', () => {
  function PageBusy(): React.ReactElement {
    return <span data-testid="page-busy">{String(useFormBusy())}</span>;
  }

  it("one card's upload leaves another card's Save working, under a shared provider", async () => {
    const onSaveB = vi.fn();
    render(
      <FormHoldProvider>
        <PageBusy />
        <SettingCard title="Brand" copy={COPY} dataTestId="brand" defaultOpen onSave={vi.fn()}>
          <LogoField uploading />
        </SettingCard>
        <SettingCard title="Dark mode" copy={COPY} dataTestId="dark" defaultOpen onSave={onSaveB}>
          <input data-testid="dark-field" />
        </SettingCard>
      </FormHoldProvider>,
    );
    expect(screen.getByTestId('brand-save')).toHaveAttribute('aria-disabled', 'true');
    const saveB = screen.getByTestId('dark-save');
    expect(saveB).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('page-busy')).toHaveTextContent('false');
    fireEvent.click(saveB);
    await waitFor(() => expect(onSaveB).toHaveBeenCalledTimes(1));
  });
});
